import { 
  CloudFormationClient, 
  CreateStackCommand, 
  UpdateStackCommand,
  DescribeStacksCommand,
  DescribeStackEventsCommand,
  DetectStackDriftCommand,
  DescribeStackDriftDetectionStatusCommand,
  DescribeStackResourceDriftsCommand,
  GetTemplateCommand,
  StackStatus,
  Stack,
  StackEvent,
  StackDriftStatus,
  StackResourceDriftStatus,
} from '@aws-sdk/client-cloudformation';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3EventBridgeService } from './s3EventBridgeService';

import { 
  DeploymentContext,
  DeploymentStatus,
  DeploymentStep,
} from '../types/deployment';

export class CloudFormationDeployer {
  private cfnClient: CloudFormationClient;
  private dynamoClient: DynamoDBClient;
  private docClient: DynamoDBDocumentClient;

  constructor() {
    console.log('CloudFormation: Initializing CloudFormation client');
    console.log('CloudFormation: AWS Region:', process.env.AWS_REGION);
    console.log('CloudFormation: AWS credentials available:', !!process.env.AWS_ACCESS_KEY_ID || 'using IAM role');
    
    this.cfnClient = new CloudFormationClient({ 
      region: process.env.AWS_REGION,
      maxAttempts: 3,
    });

    this.dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
    this.docClient = DynamoDBDocumentClient.from(this.dynamoClient);
    
    console.log('CloudFormation: Client initialized successfully');
  }

  /**
   * Deploy workflow using CloudFormation with enhanced update functionality
   */
  async deployWorkflow(
    deploymentContext: DeploymentContext,
    cloudFormationTemplate: string,
    updateStatus: (status: Partial<DeploymentStatus>) => Promise<void>
  ): Promise<DeploymentStatus> {
    console.log('CloudFormation: Starting deployment with enhanced update functionality');
    console.log('CloudFormation: Template received, size:', cloudFormationTemplate.length, 'characters');
    console.log('CloudFormation: Template preview:', cloudFormationTemplate.substring(0, 500));
    
    // Use consistent stack name based on workflow ID only (not deployment ID)
    // This ensures updates target the same stack instead of creating new ones
    const stackName = `workflow-${deploymentContext.workflowId}`;
    
    const steps: DeploymentStep[] = [
      { id: 'template-validation', name: 'Validate CloudFormation Template', status: 'pending' },
      { id: 's3-eventbridge-setup', name: 'Enable S3 EventBridge Notifications', status: 'pending' },
      { id: 'change-detection', name: 'Detect Changes and Stack Drift', status: 'pending' },
      { id: 'deployment-history', name: 'Record Deployment History', status: 'pending' },
      { id: 'stack-deployment', name: 'Deploy CloudFormation Stack', status: 'pending' },
      { id: 'resource-verification', name: 'Verify Resources', status: 'pending' },
    ];

    let deploymentStatus: DeploymentStatus = {
      deploymentId: deploymentContext.deploymentId,
      workflowId: deploymentContext.workflowId,
      status: 'in_progress',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps,
    };

    console.log('CloudFormation: Updating initial deployment status');
    await updateStatus(deploymentStatus);

    try {
      // Step 1: Validate template
      await this.executeStep(
        steps[0],
        () => this.validateTemplate(cloudFormationTemplate),
        updateStatus,
        deploymentStatus
      );

      // Step 2: Enable S3 EventBridge notifications (if S3 trigger is configured)
      await this.executeStep(
        steps[1],
        () => this.enableS3EventBridgeIfNeeded(cloudFormationTemplate),
        updateStatus,
        deploymentStatus
      );

      // Step 3: Detect changes and stack drift
      const changeAnalysis = await this.executeStep(
        steps[2],
        () => this.detectChangesAndDrift(stackName, cloudFormationTemplate, deploymentContext),
        updateStatus,
        deploymentStatus
      );

      // Step 4: Record deployment history
      await this.executeStep(
        steps[3],
        () => this.recordDeploymentHistory(deploymentContext, changeAnalysis),
        updateStatus,
        deploymentStatus
      );

      // Step 5: Deploy stack with change-aware logic
      const stackArn = await this.executeStep(
        steps[4],
        () => this.deployStackWithChangeDetection(stackName, cloudFormationTemplate, deploymentContext, changeAnalysis),
        updateStatus,
        deploymentStatus
      );

      // Step 6: Verify resources
      const stackOutputs = await this.executeStep(
        steps[5],
        () => this.verifyStack(stackName),
        updateStatus,
        deploymentStatus
      );

      deploymentStatus.status = 'completed';
      // Use the alias ARN for new executions, but keep base ARN for compatibility
      deploymentStatus.stepFunctionArn = stackOutputs.StepFunctionAliasArn || stackOutputs.StepFunctionArn;
      deploymentStatus.stepFunctionVersionArn = stackOutputs.StepFunctionVersionArn;
      deploymentStatus.cloudFormationStackArn = stackArn;
      deploymentStatus.changeAnalysis = changeAnalysis;
      deploymentStatus.updatedAt = new Date().toISOString();

      // Update workflow status in database when deployment completes successfully
      console.log('CloudFormation: Updating workflow status after successful deployment');
      console.log('CloudFormation: Stack outputs available:', Object.keys(stackOutputs));
      
      const workflowUpdates = {
        isDeployed: true,
        deploymentStatus: 'deployed',
        stepFunctionArn: stackOutputs.StepFunctionAliasArn || stackOutputs.StepFunctionArn,
        stepFunctionVersionArn: stackOutputs.StepFunctionVersionArn,
        lastDeploymentId: deploymentContext.deploymentId,
        cloudFormationStackArn: stackArn,
        cloudFormationStackName: `workflow-${deploymentContext.workflowId}`,
        updatedAt: new Date().toISOString(),
      };
      
      console.log('CloudFormation: Workflow updates to apply:', JSON.stringify(workflowUpdates, null, 2));
      
      await this.updateWorkflowStatus(deploymentContext, workflowUpdates);

      // Also call the updateDeploymentStatus handler to maintain consistency with Step Functions flow
      console.log('CloudFormation: Calling updateDeploymentStatus handler for completion event');
      await this.callUpdateDeploymentStatusHandler({
        deploymentId: deploymentContext.deploymentId,
        status: 'completed',
        cloudFormationStackArn: stackArn,
      });

    } catch (error) {
      console.error('CloudFormation deployment failed:', error);
      deploymentStatus.status = 'failed';
      deploymentStatus.error = {
        code: 'CLOUDFORMATION_DEPLOYMENT_FAILED',
        message: error instanceof Error ? error.message : 'Unknown CloudFormation error',
        details: error,
      };
      deploymentStatus.updatedAt = new Date().toISOString();

      // Update workflow status to failed
      try {
        await this.updateWorkflowStatus(deploymentContext, {
          deploymentStatus: 'failed',
          updatedAt: new Date().toISOString(),
        });
      } catch (updateError) {
        console.error('Failed to update workflow status to failed:', updateError);
      }

      // Also call the updateDeploymentStatus handler for failed deployments
      console.log('CloudFormation: Calling updateDeploymentStatus handler for failure event');
      await this.callUpdateDeploymentStatusHandler({
        deploymentId: deploymentContext.deploymentId,
        status: 'failed',
        error: {
          code: 'CLOUDFORMATION_DEPLOYMENT_FAILED',
          message: error instanceof Error ? error.message : 'Unknown CloudFormation error',
          details: error,
        },
      });
    }

    await updateStatus(deploymentStatus);
    return deploymentStatus;
  }

  /**
   * Execute a deployment step with error handling and WebSocket notifications
   */
  private async executeStep<T>(
    step: DeploymentStep,
    operation: () => Promise<T>,
    updateStatus: (status: Partial<DeploymentStatus>) => Promise<void>,
    deploymentStatus: DeploymentStatus
  ): Promise<T> {
    console.log(`CloudFormation: Starting step: ${step.name}`);
    step.status = 'in_progress';
    step.startTime = new Date().toISOString();
    
    // Step progress is tracked via EventBridge -> WebSocket handler
    
    await updateStatus({ 
      steps: deploymentStatus.steps,
      updatedAt: new Date().toISOString(),
    });

    try {
      const result = await operation();
      
      console.log(`CloudFormation: Completed step: ${step.name}`);
      step.status = 'completed';
      step.endTime = new Date().toISOString();
      step.duration = new Date(step.endTime).getTime() - new Date(step.startTime!).getTime();
      
      await updateStatus({ 
        steps: deploymentStatus.steps,
        updatedAt: new Date().toISOString(),
      });
      return result;
      
    } catch (error) {
      console.error(`CloudFormation: Failed step: ${step.name}`, error);
      step.status = 'failed';
      step.endTime = new Date().toISOString();
      step.duration = new Date(step.endTime).getTime() - new Date(step.startTime!).getTime();
      step.error = {
        code: 'STEP_FAILED',
        message: error instanceof Error ? error.message : 'Unknown step error',
        details: error,
      };
      
      await updateStatus({ 
        steps: deploymentStatus.steps,
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  /**
   * Validate CloudFormation template
   */
  private async validateTemplate(template: string): Promise<void> {
    console.log('CloudFormation: Template validation - skipped (will be validated during deployment)');
    // CloudFormation validates templates automatically during deployment
    // We could add client-side validation here if needed
  }

  /**
   * Enable S3 EventBridge notifications if the template contains S3 trigger resources
   */
  private async enableS3EventBridgeIfNeeded(template: string): Promise<void> {
    console.log('CloudFormation: Checking for S3 EventBridge trigger configuration...');
    
    try {
      const templateObj = JSON.parse(template);
      
      // Check if template has S3TriggerEventRule resource
      if (!templateObj.Resources?.S3TriggerEventRule) {
        console.log('CloudFormation: No S3 trigger configured, skipping EventBridge setup');
        return;
      }

      // Extract bucket name from the EventBridge rule's event pattern
      const eventPattern = templateObj.Resources.S3TriggerEventRule.Properties?.EventPattern;
      const bucketName = eventPattern?.detail?.bucket?.name?.[0];

      if (!bucketName) {
        console.log('CloudFormation: S3 trigger found but no bucket name specified');
        return;
      }

      console.log(`CloudFormation: Enabling EventBridge notifications on bucket: ${bucketName}`);
      
      const s3EventBridgeService = new S3EventBridgeService();
      await s3EventBridgeService.enableEventBridgeNotifications(bucketName);
      
      console.log(`CloudFormation: EventBridge notifications enabled on bucket: ${bucketName}`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.error('CloudFormation: Failed to parse template as JSON');
        throw error;
      }
      console.error('CloudFormation: Failed to enable S3 EventBridge notifications:', error);
      throw new Error(`Failed to enable S3 EventBridge notifications: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Detect changes and stack drift before deployment
   */
  private async detectChangesAndDrift(
    stackName: string,
    newTemplate: string,
    deploymentContext: DeploymentContext
  ): Promise<any> {
    console.log(`CloudFormation: Detecting changes and drift for stack ${stackName}`);
    
    const changeAnalysis = {
      stackExists: false,
      hasChanges: false,
      hasDrift: false,
      changeType: 'CREATE' as 'CREATE' | 'UPDATE' | 'NO_CHANGE',
      templateChanges: [] as string[],
      driftDetails: [] as any[],
      previousTemplate: null as string | null,
    };

    try {
      // Check if stack exists
      const stackResponse = await this.cfnClient.send(new DescribeStacksCommand({
        StackName: stackName,
      }));

      const stack = stackResponse.Stacks?.[0];
      if (stack) {
        changeAnalysis.stackExists = true;
        console.log(`CloudFormation: Stack exists with status: ${stack.StackStatus}`);

        // Get current template
        try {
          const templateResponse = await this.cfnClient.send(new GetTemplateCommand({
            StackName: stackName,
          }));
          changeAnalysis.previousTemplate = JSON.stringify(templateResponse.TemplateBody, null, 2);
          
          // Compare templates to detect changes
          const templateChanges = this.compareTemplates(changeAnalysis.previousTemplate, newTemplate);
          changeAnalysis.templateChanges = templateChanges;
          changeAnalysis.hasChanges = templateChanges.length > 0;
          changeAnalysis.changeType = changeAnalysis.hasChanges ? 'UPDATE' : 'NO_CHANGE';
          
          console.log(`CloudFormation: Template changes detected: ${templateChanges.length}`);
          templateChanges.forEach(change => console.log(`  - ${change}`));
          
        } catch (templateError) {
          console.warn('CloudFormation: Could not retrieve current template:', templateError);
        }

        // Detect stack drift if stack exists and is in a stable state
        if (this.isStackInStableState(stack.StackStatus!)) {
          try {
            const driftDetails = await this.detectStackDrift(stackName);
            changeAnalysis.hasDrift = driftDetails.length > 0;
            changeAnalysis.driftDetails = driftDetails;
            
            console.log(`CloudFormation: Stack drift detected: ${changeAnalysis.hasDrift}`);
            if (changeAnalysis.hasDrift) {
              driftDetails.forEach(drift => 
                console.log(`  - ${drift.resourceId}: ${drift.driftStatus} (${drift.resourceType})`)
              );
            }
          } catch (driftError) {
            console.warn('CloudFormation: Could not detect stack drift:', driftError);
          }
        } else {
          console.log(`CloudFormation: Stack not in stable state (${stack.StackStatus}), skipping drift detection`);
        }
      } else {
        console.log('CloudFormation: Stack does not exist, will create new stack');
        changeAnalysis.changeType = 'CREATE';
      }

    } catch (error: any) {
      if (error.name === 'ValidationError' && error.message.includes('does not exist')) {
        console.log('CloudFormation: Stack does not exist, will create new stack');
        changeAnalysis.changeType = 'CREATE';
      } else {
        console.warn('CloudFormation: Error during change detection:', error);
        // Continue with deployment, assume UPDATE to be safe
        changeAnalysis.changeType = 'UPDATE';
        changeAnalysis.hasChanges = true;
      }
    }

    console.log('CloudFormation: Change analysis completed:', {
      stackExists: changeAnalysis.stackExists,
      changeType: changeAnalysis.changeType,
      hasChanges: changeAnalysis.hasChanges,
      hasDrift: changeAnalysis.hasDrift,
      templateChanges: changeAnalysis.templateChanges.length,
      driftDetails: changeAnalysis.driftDetails.length,
    });

    return changeAnalysis;
  }

  /**
   * Compare two CloudFormation templates to detect changes
   */
  private compareTemplates(oldTemplate: string, newTemplate: string): string[] {
    const changes: string[] = [];
    
    try {
      const oldObj = JSON.parse(oldTemplate);
      const newObj = JSON.parse(newTemplate);
      
      // Compare resources
      const oldResources = oldObj.Resources || {};
      const newResources = newObj.Resources || {};
      
      // Check for added resources
      Object.keys(newResources).forEach(resourceName => {
        if (!oldResources[resourceName]) {
          changes.push(`Added resource: ${resourceName}`);
        } else {
          // Check for modified resources (simplified comparison)
          const oldResource = JSON.stringify(oldResources[resourceName]);
          const newResource = JSON.stringify(newResources[resourceName]);
          if (oldResource !== newResource) {
            changes.push(`Modified resource: ${resourceName}`);
          }
        }
      });
      
      // Check for removed resources
      Object.keys(oldResources).forEach(resourceName => {
        if (!newResources[resourceName]) {
          changes.push(`Removed resource: ${resourceName}`);
        }
      });
      
      // Compare parameters
      const oldParams = oldObj.Parameters || {};
      const newParams = newObj.Parameters || {};
      if (JSON.stringify(oldParams) !== JSON.stringify(newParams)) {
        changes.push('Parameters changed');
      }
      
      // Compare outputs
      const oldOutputs = oldObj.Outputs || {};
      const newOutputs = newObj.Outputs || {};
      if (JSON.stringify(oldOutputs) !== JSON.stringify(newOutputs)) {
        changes.push('Outputs changed');
      }
      
    } catch (error) {
      console.warn('CloudFormation: Error comparing templates:', error);
      changes.push('Template comparison failed - assuming changes exist');
    }
    
    return changes;
  }

  /**
   * Detect stack drift
   */
  private async detectStackDrift(stackName: string): Promise<any[]> {
    console.log(`CloudFormation: Starting drift detection for stack ${stackName}`);
    
    try {
      // Start drift detection
      const driftResponse = await this.cfnClient.send(new DetectStackDriftCommand({
        StackName: stackName,
      }));
      
      const detectionId = driftResponse.StackDriftDetectionId!;
      console.log(`CloudFormation: Drift detection started with ID: ${detectionId}`);
      
      // Wait for drift detection to complete
      let detectionComplete = false;
      let attempts = 0;
      const maxAttempts = 20; // 10 minutes max
      
      while (!detectionComplete && attempts < maxAttempts) {
        await this.sleep(30000); // Wait 30 seconds
        attempts++;
        
        const statusResponse = await this.cfnClient.send(new DescribeStackDriftDetectionStatusCommand({
          StackDriftDetectionId: detectionId,
        }));
        
        const detectionStatus = statusResponse.DetectionStatus;
        console.log(`CloudFormation: Drift detection status: ${detectionStatus}`);
        
        if (detectionStatus === 'DETECTION_COMPLETE') {
          detectionComplete = true;
        } else if (detectionStatus === 'DETECTION_FAILED') {
          throw new Error(`Drift detection failed: ${statusResponse.DetectionStatusReason}`);
        }
      }
      
      if (!detectionComplete) {
        throw new Error('Drift detection timed out');
      }
      
      // Get drift details
      const driftResponse2 = await this.cfnClient.send(new DescribeStackResourceDriftsCommand({
        StackName: stackName,
      }));
      
      const driftedResources = driftResponse2.StackResourceDrifts?.filter(
        drift => drift.StackResourceDriftStatus !== StackResourceDriftStatus.IN_SYNC
      ) || [];
      
      console.log(`CloudFormation: Found ${driftedResources.length} drifted resources`);
      
      return driftedResources.map(drift => ({
        resourceId: drift.LogicalResourceId,
        resourceType: drift.ResourceType,
        driftStatus: drift.StackResourceDriftStatus,
        actualProperties: drift.ActualProperties,
        expectedProperties: drift.ExpectedProperties,
        propertyDifferences: drift.PropertyDifferences,
      }));
      
    } catch (error) {
      console.warn('CloudFormation: Drift detection failed:', error);
      return [];
    }
  }

  /**
   * Check if stack is in a stable state for drift detection
   */
  private isStackInStableState(stackStatus: string): boolean {
    const stableStates = [
      'CREATE_COMPLETE',
      'UPDATE_COMPLETE',
      'ROLLBACK_COMPLETE',
      'UPDATE_ROLLBACK_COMPLETE',
    ];
    return stableStates.includes(stackStatus);
  }

  /**
   * Record deployment history
   */
  private async recordDeploymentHistory(
    deploymentContext: DeploymentContext,
    changeAnalysis: any
  ): Promise<void> {
    console.log('CloudFormation: Recording deployment history');
    
    const historyRecord = {
      deploymentId: deploymentContext.deploymentId,
      workflowId: deploymentContext.workflowId,
      userId: deploymentContext.userId,
      timestamp: new Date().toISOString(),
      changeType: changeAnalysis.changeType,
      hasChanges: changeAnalysis.hasChanges,
      hasDrift: changeAnalysis.hasDrift,
      templateChanges: changeAnalysis.templateChanges,
      driftDetails: changeAnalysis.driftDetails,
      environment: deploymentContext.environment,
    };
    
    try {
      // Store deployment history in DynamoDB
      const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE || 'WorkflowBuilder-Deployments';
      
      await this.docClient.send(new UpdateCommand({
        TableName: DEPLOYMENTS_TABLE,
        Key: {
          PK: `DEPLOYMENT#${deploymentContext.deploymentId}`,
          SK: `WORKFLOW#${deploymentContext.workflowId}`,
        },
        UpdateExpression: 'SET deploymentHistory = :history, changeAnalysis = :analysis',
        ExpressionAttributeValues: {
          ':history': historyRecord,
          ':analysis': changeAnalysis,
        },
      }));
      
      console.log('CloudFormation: Deployment history recorded successfully');
    } catch (error) {
      console.warn('CloudFormation: Failed to record deployment history:', error);
      // Don't fail deployment if history recording fails
    }
  }

  /**
   * Deploy CloudFormation stack with change-aware logic
   */
  private async deployStackWithChangeDetection(
    stackName: string,
    template: string,
    deploymentContext: DeploymentContext,
    changeAnalysis: any
  ): Promise<string> {
    console.log(`CloudFormation: Deploying stack ${stackName} with change detection`);
    console.log('CloudFormation: Change analysis:', {
      changeType: changeAnalysis.changeType,
      hasChanges: changeAnalysis.hasChanges,
      hasDrift: changeAnalysis.hasDrift,
    });

    // If no changes detected and no drift, skip deployment
    if (changeAnalysis.changeType === 'NO_CHANGE' && !changeAnalysis.hasDrift) {
      console.log('CloudFormation: No changes detected, skipping deployment');
      
      // Get existing stack ARN
      const stackResponse = await this.cfnClient.send(new DescribeStacksCommand({
        StackName: stackName,
      }));
      
      return stackResponse.Stacks?.[0]?.StackId || stackName;
    }

    return this.deployStack(stackName, template, deploymentContext);
  }

  /**
   * Deploy CloudFormation stack (original method)
   */
  private async deployStack(
    stackName: string, 
    template: string, 
    deploymentContext: DeploymentContext
  ): Promise<string> {
    console.log(`CloudFormation: Deploying stack ${stackName}`);
    console.log('CloudFormation: Template size:', template.length, 'characters');
    console.log('CloudFormation: Template content:');
    console.log('=' .repeat(80));
    console.log(template);
    console.log('=' .repeat(80));

    const parameters = [
      {
        ParameterKey: 'WorkflowId',
        ParameterValue: deploymentContext.workflowId,
      },
      {
        ParameterKey: 'DeploymentId',
        ParameterValue: deploymentContext.deploymentId,
      },
      {
        ParameterKey: 'Environment',
        ParameterValue: deploymentContext.environment,
      },
    ];

    const tags = [
      { Key: 'WorkflowId', Value: deploymentContext.workflowId },
      { Key: 'DeploymentId', Value: deploymentContext.deploymentId },
      { Key: 'DeployedBy', Value: deploymentContext.userId },
      { Key: 'Environment', Value: deploymentContext.environment },
      ...Object.entries(deploymentContext.configuration.tags || {}).map(([Key, Value]) => ({ Key, Value })),
    ];

    try {
      // Try to update existing stack first
      console.log('CloudFormation: Attempting stack update...');
      console.log('CloudFormation: Stack name:', stackName);
      console.log('CloudFormation: Parameters:', JSON.stringify(parameters, null, 2));
      console.log('CloudFormation: Tags:', JSON.stringify(tags, null, 2));
      console.log('CloudFormation: Capabilities: CAPABILITY_IAM, CAPABILITY_NAMED_IAM');
      
      console.log('CloudFormation: Sending UpdateStackCommand...');
      const updateResponse = await this.cfnClient.send(new UpdateStackCommand({
        StackName: stackName,
        TemplateBody: template,
        Parameters: parameters,
        Tags: tags,
        Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM'],
      }));
      console.log('CloudFormation: UpdateStackCommand completed successfully');

      console.log(`CloudFormation: Stack update initiated: ${updateResponse.StackId}`);
      await this.waitForStackCompletion(stackName, 'UPDATE');
      return updateResponse.StackId!;

    } catch (error: any) {
      console.error('CloudFormation: Stack update failed');
      console.error('CloudFormation: Error name:', error.name);
      console.error('CloudFormation: Error message:', error.message);
      console.error('CloudFormation: Error code:', error.Code || error.$metadata?.httpStatusCode);
      console.error('CloudFormation: Full error:', JSON.stringify(error, null, 2));
      
      if (error.name === 'ValidationError' && error.message.includes('does not exist')) {
        // Stack doesn't exist, create it
        console.log(`CloudFormation: Creating new stack ${stackName}`);
        console.log('CloudFormation: Create parameters:', JSON.stringify(parameters, null, 2));
        console.log('CloudFormation: Create tags:', JSON.stringify(tags, null, 2));
        console.log('CloudFormation: OnFailure: ROLLBACK');
        
        console.log('CloudFormation: Sending CreateStackCommand...');
        const createResponse = await this.cfnClient.send(new CreateStackCommand({
          StackName: stackName,
          TemplateBody: template,
          Parameters: parameters,
          Tags: tags,
          Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM'],
          OnFailure: 'ROLLBACK',
        }));
        console.log('CloudFormation: CreateStackCommand completed successfully');

        console.log(`CloudFormation: Stack creation initiated: ${createResponse.StackId}`);
        await this.waitForStackCompletion(stackName, 'CREATE');
        return createResponse.StackId!;
      } else {
        console.log('CloudFormation: Unexpected error during stack creation:', error);
        throw error;
      }
    }
  }

  /**
   * Wait for CloudFormation stack operation to complete
   */
  private async waitForStackCompletion(stackName: string, operation: 'CREATE' | 'UPDATE'): Promise<void> {
    const maxAttempts = 60; // 30 minutes max (30 second intervals)
    let attempts = 0;

    const successStatuses = operation === 'CREATE' 
      ? ['CREATE_COMPLETE'] 
      : ['UPDATE_COMPLETE'];
    
    const failureStatuses = operation === 'CREATE'
      ? ['CREATE_FAILED', 'ROLLBACK_COMPLETE', 'ROLLBACK_FAILED']
      : ['UPDATE_FAILED', 'UPDATE_ROLLBACK_COMPLETE', 'UPDATE_ROLLBACK_FAILED'];

    while (attempts < maxAttempts) {
      try {
        const response = await this.cfnClient.send(new DescribeStacksCommand({
          StackName: stackName,
        }));

        const stack = response.Stacks?.[0];
        if (!stack) {
          throw new Error(`Stack ${stackName} not found`);
        }

        const status = stack.StackStatus;
        console.log(`CloudFormation: Stack ${stackName} status: ${status}`);

        if (successStatuses.includes(status!)) {
          console.log(`CloudFormation: Stack ${operation.toLowerCase()} completed successfully`);
          return;
        }

        if (failureStatuses.includes(status!)) {
          // Get stack events for error details
          const events = await this.getStackEvents(stackName);
          const errorEvents = events.filter(event => 
            event.ResourceStatus?.includes('FAILED') && event.ResourceStatusReason
          );
          
          const errorDetails = errorEvents.map(event => 
            `${event.LogicalResourceId}: ${event.ResourceStatusReason}`
          ).join('; ');

          throw new Error(`Stack ${operation.toLowerCase()} failed: ${status}. Details: ${errorDetails}`);
        }

        // Wait before next check
        await this.sleep(30000); // 30 seconds
        attempts++;

      } catch (error) {
        if (attempts >= maxAttempts - 1) {
          throw error;
        }
        await this.sleep(30000);
        attempts++;
      }
    }

    throw new Error(`Stack ${operation.toLowerCase()} timed out after ${maxAttempts * 30} seconds`);
  }

  /**
   * Get CloudFormation stack events
   */
  private async getStackEvents(stackName: string): Promise<StackEvent[]> {
    try {
      const response = await this.cfnClient.send(new DescribeStackEventsCommand({
        StackName: stackName,
      }));
      return response.StackEvents || [];
    } catch (error) {
      console.error('Failed to get stack events:', error);
      return [];
    }
  }

  /**
   * Verify stack deployment and get outputs
   */
  private async verifyStack(stackName: string): Promise<Record<string, string>> {
    console.log(`CloudFormation: Verifying stack ${stackName}`);

    const response = await this.cfnClient.send(new DescribeStacksCommand({
      StackName: stackName,
    }));

    const stack = response.Stacks?.[0];
    if (!stack) {
      throw new Error(`Stack ${stackName} not found`);
    }

    if (stack.StackStatus !== 'CREATE_COMPLETE' && stack.StackStatus !== 'UPDATE_COMPLETE') {
      throw new Error(`Stack is not in a complete state: ${stack.StackStatus}`);
    }

    // Extract outputs
    const outputs: Record<string, string> = {};
    stack.Outputs?.forEach(output => {
      if (output.OutputKey && output.OutputValue) {
        outputs[output.OutputKey] = output.OutputValue;
      }
    });

    console.log(`CloudFormation: Stack verification completed. Outputs:`, outputs);
    return outputs;
  }

  /**
   * Update workflow status in database with enhanced error handling and data preservation
   */
  private async updateWorkflowStatus(
    deploymentContext: DeploymentContext,
    updates: Record<string, any>
  ): Promise<void> {
    const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';
    
    console.log('CloudFormation: Updating workflow status in database');
    console.log('CloudFormation: Workflow ID:', deploymentContext.workflowId);
    console.log('CloudFormation: User ID:', deploymentContext.userId);
    console.log('CloudFormation: Updates:', JSON.stringify(updates, null, 2));

    try {
      // First, get the current workflow to preserve important fields
      console.log('CloudFormation: Getting current workflow to preserve data...');
      const currentWorkflow = await this.getCurrentWorkflow(deploymentContext.userId, deploymentContext.workflowId);
      
      if (!currentWorkflow) {
        console.error('CloudFormation: Workflow not found for update');
        console.error('CloudFormation: User ID:', deploymentContext.userId);
        console.error('CloudFormation: Workflow ID:', deploymentContext.workflowId);
        throw new Error(`Workflow ${deploymentContext.workflowId} not found for user ${deploymentContext.userId}`);
      }

      console.log('CloudFormation: Current workflow found, preserving existing data');
      console.log('CloudFormation: Current deploymentStatus:', currentWorkflow.deploymentStatus);
      console.log('CloudFormation: Current isDeployed:', currentWorkflow.isDeployed);

      // Prepare safe updates while preserving existing data
      const safeUpdates = {
        ...updates,
        // Increment version for change tracking
        version: (currentWorkflow.version || 0) + 1,
        // Preserve existing nodes and connections (critical - don't overwrite workflow design)
        nodes: currentWorkflow.nodes || [],
        connections: currentWorkflow.connections || [],
        stepFunctionDefinition: currentWorkflow.stepFunctionDefinition || {},
        // Maintain deployment history
        deploymentHistory: [
          ...(currentWorkflow.deploymentHistory || []),
          {
            deploymentId: updates.lastDeploymentId,
            timestamp: updates.updatedAt,
            status: updates.deploymentStatus,
            stepFunctionArn: updates.stepFunctionArn,
            cloudFormationStackArn: updates.cloudFormationStackArn,
          }
        ].slice(-10), // Keep last 10 deployments
      };

      // Build DynamoDB update expression
      const updateExpression: string[] = [];
      const expressionAttributeNames: Record<string, string> = {};
      const expressionAttributeValues: Record<string, any> = {};

      Object.entries(safeUpdates).forEach(([key, value], index) => {
        if (value !== undefined && value !== null) {
          const attrName = `#attr${index}`;
          const attrValue = `:val${index}`;
          
          updateExpression.push(`${attrName} = ${attrValue}`);
          expressionAttributeNames[attrName] = key;
          expressionAttributeValues[attrValue] = value;
        }
      });

      console.log('CloudFormation: Executing DynamoDB update...');
      console.log('CloudFormation: Update expression:', updateExpression.join(', '));

      await this.docClient.send(new UpdateCommand({
        TableName: WORKFLOWS_TABLE,
        Key: {
          PK: `WORKFLOW#${deploymentContext.workflowId}`,
          SK: 'META',
        },
        UpdateExpression: `SET ${updateExpression.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: 'attribute_exists(PK)',
      }));

      console.log('CloudFormation: Workflow status updated successfully');
      console.log('CloudFormation: New deploymentStatus: deployed');
      console.log('CloudFormation: New isDeployed: true');
      console.log('CloudFormation: New stepFunctionArn:', updates.stepFunctionArn);
      
    } catch (error) {
      console.error('CloudFormation: Failed to update workflow status:', error);
      console.error('CloudFormation: Error details:', JSON.stringify(error, null, 2));
      
      // This is critical for the user experience - throw the error
      throw new Error(`Failed to update workflow status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get current workflow from database
   */
  private async getCurrentWorkflow(userId: string, workflowId: string): Promise<any | null> {
    const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';

    try {
      const response = await this.docClient.send(new GetCommand({
        TableName: WORKFLOWS_TABLE,
        Key: {
          PK: `WORKFLOW#${workflowId}`,
          SK: 'META',
        },
      }));

      return response.Item || null;
    } catch (error) {
      console.error('CloudFormation: Error fetching current workflow:', error);
      return null;
    }
  }

  /**
   * Call the updateDeploymentStatus handler to maintain consistency with Step Functions flow
   */
  private async callUpdateDeploymentStatusHandler(event: {
    deploymentId: string;
    status: string;
    cloudFormationStackArn?: string;
    error?: any;
  }): Promise<void> {
    try {
      console.log('Update deployment status event:', JSON.stringify({ deploymentId: event.deploymentId, status: event.status }, null, 2));
      
      // Import and call the updateDeploymentStatus handler directly
      const { handler: updateDeploymentStatusHandler } = await import('../handlers/updateDeploymentStatus');
      
      const result = await updateDeploymentStatusHandler(event);
      console.log('UpdateDeploymentStatus handler completed:', result);
      
    } catch (error) {
      console.error('Failed to call updateDeploymentStatus handler:', error);
      // Don't throw - this is supplementary to the main deployment flow
    }
  }

  /**
   * Utility function to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}