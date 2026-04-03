import { 
  CloudFormationClient, 
  DescribeStacksCommand,
  DescribeStackEventsCommand,
  ListStackResourcesCommand,
  GetTemplateCommand,
  DetectStackDriftCommand,
  DescribeStackDriftDetectionStatusCommand,
  DescribeStackResourceDriftsCommand,
  DeleteStackCommand,
  StackStatus,
  StackResourceDriftStatus,
} from '@aws-sdk/client-cloudformation';
import { EventBridgeClient, ListTargetsByRuleCommand, RemoveTargetsCommand, DeleteRuleCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

import { 
  DeploymentContext,
  ChangeAnalysis,
  StackDriftDetail,
} from '../types/deployment';

/**
 * CloudFormation Stack Manager
 * Handles CloudFormation stack lifecycle operations with enhanced update functionality
 */
export class CloudFormationStackManager {
  private cfnClient: CloudFormationClient;
  private dynamoClient: DynamoDBClient;
  private docClient: DynamoDBDocumentClient;

  constructor() {
    this.cfnClient = new CloudFormationClient({ 
      region: process.env.AWS_REGION,
      maxAttempts: 3,
    });
    this.dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
    this.docClient = DynamoDBDocumentClient.from(this.dynamoClient);
  }

  /**
   * Get CloudFormation stack information
   */
  async getStackInfo(stackName: string): Promise<any | null> {
    try {
      const response = await this.cfnClient.send(new DescribeStacksCommand({
        StackName: stackName,
      }));

      const stack = response.Stacks?.[0];
      if (!stack) {
        return null;
      }

      return {
        stackId: stack.StackId,
        stackName: stack.StackName,
        stackStatus: stack.StackStatus,
        creationTime: stack.CreationTime,
        lastUpdatedTime: stack.LastUpdatedTime,
        description: stack.Description,
        parameters: stack.Parameters,
        outputs: this.extractStackOutputs(stack.Outputs || []),
        tags: stack.Tags,
        capabilities: stack.Capabilities,
        driftInformation: stack.DriftInformation,
      };
    } catch (error: any) {
      if (error.name === 'ValidationError' && error.message.includes('does not exist')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Check if multiple deployments of the same workflow update existing resources
   */
  async validateWorkflowUpdateBehavior(
    workflowId: string,
    deploymentContext: DeploymentContext
  ): Promise<{
    isValid: boolean;
    stackExists: boolean;
    stackInfo?: any;
    issues: string[];
  }> {
    console.log(`🔍 CloudFormation Stack Manager: Validating workflow update behavior for ${workflowId}`);
    
    const stackName = `workflow-${workflowId}`;
    const issues: string[] = [];
    
    try {
      const stackInfo = await this.getStackInfo(stackName);
      
      if (!stackInfo) {
        console.log('🆕 CloudFormation Stack Manager: No existing stack found - first deployment');
        return {
          isValid: true,
          stackExists: false,
          issues: [],
        };
      }

      console.log('📋 CloudFormation Stack Manager: Found existing stack:', {
        stackName: stackInfo.stackName,
        status: stackInfo.stackStatus,
        lastUpdated: stackInfo.lastUpdatedTime,
      });

      // Check if stack is in a valid state for updates
      if (!this.isStackUpdateable(stackInfo.stackStatus)) {
        issues.push(`Stack is in non-updateable state: ${stackInfo.stackStatus}`);
      }

      // Verify that the stack was created by this workflow system
      const workflowIdTag = stackInfo.tags?.find((tag: any) => tag.Key === 'WorkflowId');
      if (!workflowIdTag || workflowIdTag.Value !== workflowId) {
        issues.push('Stack exists but was not created by this workflow system');
      }

      // Check for resource naming consistency
      const resourceValidation = await this.validateResourceNaming(stackName, workflowId);
      if (!resourceValidation.isValid) {
        issues.push(...resourceValidation.issues);
      }

      return {
        isValid: issues.length === 0,
        stackExists: true,
        stackInfo,
        issues,
      };

    } catch (error) {
      console.error('❌ CloudFormation Stack Manager: Error validating workflow update behavior:', error);
      issues.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      return {
        isValid: false,
        stackExists: false,
        issues,
      };
    }
  }

  /**
   * Validate that resources follow the correct naming pattern
   */
  private async validateResourceNaming(stackName: string, workflowId: string): Promise<{
    isValid: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];
    
    try {
      const response = await this.cfnClient.send(new ListStackResourcesCommand({
        StackName: stackName,
      }));

      const resources = response.StackResourceSummaries || [];
      
      // Check Step Functions state machine naming
      const stepFunctionResource = resources.find(r => r.ResourceType === 'AWS::StepFunctions::StateMachine');
      if (stepFunctionResource) {
        const expectedName = `SF-${workflowId}`;
        if (!stepFunctionResource.PhysicalResourceId?.includes(expectedName)) {
          issues.push(`Step Functions state machine does not follow naming pattern: expected ${expectedName}`);
        }
      }

      // Check IAM role naming
      const iamRoleResource = resources.find(r => r.ResourceType === 'AWS::IAM::Role');
      if (iamRoleResource) {
        const expectedPattern = `SF-Role-${workflowId}`;
        if (!iamRoleResource.PhysicalResourceId?.includes(expectedPattern)) {
          issues.push(`IAM role does not follow naming pattern: expected ${expectedPattern}`);
        }
      }

      // Check Lambda function naming (if any)
      const lambdaResources = resources.filter(r => r.ResourceType === 'AWS::Lambda::Function');
      lambdaResources.forEach(lambdaResource => {
        if (!lambdaResource.PhysicalResourceId?.includes(workflowId)) {
          issues.push(`Lambda function does not include workflowId in name: ${lambdaResource.LogicalResourceId}`);
        }
      });

      console.log(`📋 CloudFormation Stack Manager: Resource naming validation completed with ${issues.length} issues`);
      
    } catch (error) {
      console.warn('⚠️ CloudFormation Stack Manager: Could not validate resource naming:', error);
      issues.push('Could not validate resource naming');
    }

    return {
      isValid: issues.length === 0,
      issues,
    };
  }

  /**
   * Perform comprehensive stack drift detection and reconciliation
   */
  async detectAndReconcileStackDrift(
    stackName: string,
    expectedTemplate: string
  ): Promise<{
    hasDrift: boolean;
    driftDetails: StackDriftDetail[];
    reconciliationNeeded: boolean;
    reconciliationActions: string[];
  }> {
    console.log(`🌊 CloudFormation Stack Manager: Detecting stack drift for ${stackName}`);
    
    const result = {
      hasDrift: false,
      driftDetails: [] as StackDriftDetail[],
      reconciliationNeeded: false,
      reconciliationActions: [] as string[],
    };

    try {
      // Start drift detection
      const driftResponse = await this.cfnClient.send(new DetectStackDriftCommand({
        StackName: stackName,
      }));

      const detectionId = driftResponse.StackDriftDetectionId!;
      console.log(`🔍 CloudFormation Stack Manager: Drift detection started with ID: ${detectionId}`);

      // Wait for drift detection to complete
      await this.waitForDriftDetection(detectionId);

      // Get drift details
      const driftDetailsResponse = await this.cfnClient.send(new DescribeStackResourceDriftsCommand({
        StackName: stackName,
      }));

      const driftedResources = driftDetailsResponse.StackResourceDrifts?.filter(
        drift => drift.StackResourceDriftStatus !== StackResourceDriftStatus.IN_SYNC
      ) || [];

      result.hasDrift = driftedResources.length > 0;
      result.driftDetails = driftedResources.map(drift => ({
        resourceId: drift.LogicalResourceId || '',
        resourceType: drift.ResourceType || '',
        driftStatus: drift.StackResourceDriftStatus || '',
        actualProperties: drift.ActualProperties,
        expectedProperties: drift.ExpectedProperties,
        propertyDifferences: drift.PropertyDifferences,
      }));

      // Analyze drift and determine reconciliation actions
      if (result.hasDrift) {
        const reconciliationAnalysis = this.analyzeDriftForReconciliation(result.driftDetails);
        result.reconciliationNeeded = reconciliationAnalysis.needed;
        result.reconciliationActions = reconciliationAnalysis.actions;
      }

      console.log(`🌊 CloudFormation Stack Manager: Drift detection completed:`, {
        hasDrift: result.hasDrift,
        driftedResources: result.driftDetails.length,
        reconciliationNeeded: result.reconciliationNeeded,
      });

    } catch (error) {
      console.warn('⚠️ CloudFormation Stack Manager: Drift detection failed:', error);
      // Don't fail the deployment if drift detection fails
    }

    return result;
  }

  /**
   * Wait for drift detection to complete
   */
  private async waitForDriftDetection(detectionId: string): Promise<void> {
    const maxAttempts = 20; // 10 minutes max
    let attempts = 0;

    while (attempts < maxAttempts) {
      await this.sleep(30000); // Wait 30 seconds
      attempts++;

      const statusResponse = await this.cfnClient.send(new DescribeStackDriftDetectionStatusCommand({
        StackDriftDetectionId: detectionId,
      }));

      const detectionStatus = statusResponse.DetectionStatus;
      console.log(`📊 CloudFormation Stack Manager: Drift detection status: ${detectionStatus}`);

      if (detectionStatus === 'DETECTION_COMPLETE') {
        return;
      } else if (detectionStatus === 'DETECTION_FAILED') {
        throw new Error(`Drift detection failed: ${statusResponse.DetectionStatusReason}`);
      }
    }

    throw new Error('Drift detection timed out');
  }

  /**
   * Analyze drift details to determine reconciliation actions
   */
  private analyzeDriftForReconciliation(driftDetails: StackDriftDetail[]): {
    needed: boolean;
    actions: string[];
  } {
    const actions: string[] = [];
    
    driftDetails.forEach(drift => {
      switch (drift.driftStatus) {
        case 'MODIFIED':
          actions.push(`Update ${drift.resourceId} (${drift.resourceType}) to match expected configuration`);
          break;
        case 'DELETED':
          actions.push(`Recreate ${drift.resourceId} (${drift.resourceType}) - resource was deleted outside CloudFormation`);
          break;
        case 'NOT_CHECKED':
          actions.push(`Manual verification needed for ${drift.resourceId} (${drift.resourceType})`);
          break;
      }
    });

    return {
      needed: actions.length > 0,
      actions,
    };
  }

  /**
   * Delete CloudFormation stack and clean up resources with comprehensive error handling
   */
  async deleteStack(
    stackName: string,
    workflowId: string,
    userId: string
  ): Promise<{
    success: boolean;
    message: string;
    deletedResources?: string[];
    partialFailures?: string[];
    warnings?: string[];
  }> {
    console.log(`🗑️ CloudFormation Stack Manager: Deleting stack ${stackName}`);
    
    const result = {
      success: false,
      message: '',
      deletedResources: [] as string[],
      partialFailures: [] as string[],
      warnings: [] as string[],
    };

    try {
      // 1. Check if stack exists and get resources before deletion
      let stackExists = false;
      let resources: string[] = [];
      
      try {
        const stackInfo = await this.getStackInfo(stackName);
        if (stackInfo) {
          stackExists = true;
          
          // Get detailed resource list
          const resourcesResponse = await this.cfnClient.send(new ListStackResourcesCommand({
            StackName: stackName,
          }));
          
          resources = resourcesResponse.StackResourceSummaries?.map(r => 
            `${r.LogicalResourceId} (${r.ResourceType})`
          ) || [];
          
          console.log(`📋 CloudFormation Stack Manager: Found ${resources.length} resources to delete`);
          resources.forEach(resource => console.log(`  - ${resource}`));
        }
      } catch (error: any) {
        if (error.name === 'ValidationError' && error.message.includes('does not exist')) {
          console.log(`ℹ️ CloudFormation Stack Manager: Stack ${stackName} does not exist`);
          result.warnings.push('CloudFormation stack does not exist - may have been deleted manually');
        } else {
          throw error;
        }
      }

      // 2. Clean up EventBridge rule targets before stack deletion (prevents DELETE_FAILED)
      if (stackExists) {
        try {
          await this.cleanupEventBridgeRules(workflowId);
        } catch (ebError) {
          console.warn('⚠️ CloudFormation Stack Manager: EventBridge cleanup failed (non-fatal):', ebError);
        }
      }

      // 3. Delete the stack if it exists
      if (stackExists) {
        try {
          console.log(`🚀 CloudFormation Stack Manager: About to send DeleteStackCommand for ${stackName}`);
          
          const deleteCommand = new DeleteStackCommand({
            StackName: stackName,
          });
          
          console.log(`📤 CloudFormation Stack Manager: Sending DeleteStackCommand...`);
          const deleteResponse = await this.cfnClient.send(deleteCommand);
          console.log(`📥 CloudFormation Stack Manager: DeleteStackCommand response:`, deleteResponse);

          console.log(`🗑️ CloudFormation Stack Manager: Stack deletion initiated for ${stackName}`);
          console.log(`ℹ️ CloudFormation Stack Manager: Deletion will continue asynchronously in the background`);
          
          result.deletedResources = resources;
          result.warnings.push('CloudFormation stack deletion initiated - resources will be cleaned up asynchronously');
          console.log(`✅ CloudFormation Stack Manager: Stack deletion initiated successfully for ${stackName}`);
          
        } catch (deletionError: any) {
          console.error(`❌ CloudFormation Stack Manager: Stack deletion failed:`, deletionError);
          console.error(`❌ CloudFormation Stack Manager: Error name:`, deletionError.name);
          console.error(`❌ CloudFormation Stack Manager: Error message:`, deletionError.message);
          console.error(`❌ CloudFormation Stack Manager: Error code:`, deletionError.code);
          console.error(`❌ CloudFormation Stack Manager: Full error:`, JSON.stringify(deletionError, null, 2));
          
          // Handle specific CloudFormation deletion errors
          if (deletionError.name === 'ValidationError') {
            if (deletionError.message.includes('DELETE_FAILED')) {
              result.partialFailures.push('Some resources could not be deleted automatically');
              result.warnings.push('Manual cleanup may be required for remaining resources');
            } else if (deletionError.message.includes('does not exist')) {
              result.warnings.push('Stack was already deleted');
            } else {
              throw deletionError;
            }
          } else {
            throw deletionError;
          }
        }
      }

      // 4. Clean up workflow database records regardless of stack deletion outcome
      try {
        await this.cleanupWorkflowRecords(workflowId, userId);
        console.log('✅ CloudFormation Stack Manager: Workflow database records cleaned up');
      } catch (dbError) {
        console.error('⚠️ CloudFormation Stack Manager: Failed to clean up database records:', dbError);
        result.partialFailures.push('Failed to clean up workflow database records');
      }

      // 5. Determine overall success
      const hasPartialFailures = result.partialFailures.length > 0;
      result.success = !hasPartialFailures;
      
      if (result.success) {
        result.message = `Workflow ${workflowId} deletion initiated successfully - AWS resources cleanup in progress`;
        if (result.warnings.length > 0) {
          result.message += ` (${result.warnings.join(', ')})`;
        }
      } else {
        result.message = `Workflow deletion completed with issues: ${result.partialFailures.join(', ')}`;
        if (result.warnings.length > 0) {
          result.message += `. Warnings: ${result.warnings.join(', ')}`;
        }
      }

      return result;

    } catch (error) {
      console.error(`❌ CloudFormation Stack Manager: Critical error during stack deletion:`, error);
      
      result.success = false;
      result.message = `Critical error during deletion: ${error instanceof Error ? error.message : 'Unknown error'}`;
      result.partialFailures.push('Stack deletion process failed');
      
      // Still try to clean up database records
      try {
        await this.cleanupWorkflowRecords(workflowId, userId);
        result.warnings.push('Database records were cleaned up despite stack deletion failure');
      } catch (dbError) {
        result.partialFailures.push('Failed to clean up database records');
      }
      
      return result;
    }
  }

  /**
   * Wait for stack deletion to complete with enhanced progress tracking
   */
  private async waitForStackDeletionWithProgress(
    stackName: string, 
    progressCallback?: (status: string, resourceCount?: number) => Promise<void>
  ): Promise<void> {
    const maxAttempts = 60; // 30 minutes max
    let attempts = 0;
    let lastStatus = '';
    let lastResourceCount = 0;

    console.log(`⏳ CloudFormation Stack Manager: Waiting for stack ${stackName} deletion to complete...`);

    while (attempts < maxAttempts) {
      try {
        const response = await this.cfnClient.send(new DescribeStacksCommand({
          StackName: stackName,
        }));

        const stack = response.Stacks?.[0];
        if (!stack) {
          console.log(`✅ CloudFormation Stack Manager: Stack ${stackName} deleted successfully`);
          if (progressCallback) {
            await progressCallback('DELETE_COMPLETE', 0);
          }
          return;
        }

        const status = stack.StackStatus;
        
        // Log status changes
        if (status !== lastStatus) {
          console.log(`📊 CloudFormation Stack Manager: Stack ${stackName} status changed: ${lastStatus} → ${status}`);
          lastStatus = status;
        }

        // Check for completion
        if (status === 'DELETE_COMPLETE') {
          console.log(`✅ CloudFormation Stack Manager: Stack ${stackName} deletion completed`);
          if (progressCallback) {
            await progressCallback('DELETE_COMPLETE', 0);
          }
          return;
        } else if (status === 'DELETE_FAILED') {
          // Get more details about the failure
          const failureReason = stack.StackStatusReason || 'Unknown failure reason';
          console.error(`❌ CloudFormation Stack Manager: Stack deletion failed: ${failureReason}`);
          
          // Try to get details about which resources failed
          try {
            const resourcesResponse = await this.cfnClient.send(new ListStackResourcesCommand({
              StackName: stackName,
            }));
            
            const failedResources = resourcesResponse.StackResourceSummaries?.filter(r => 
              r.ResourceStatus?.includes('DELETE_FAILED')
            ) || [];
            
            if (failedResources.length > 0) {
              console.error(`❌ Failed to delete resources:`);
              failedResources.forEach(resource => {
                console.error(`  - ${resource.LogicalResourceId} (${resource.ResourceType}): ${resource.ResourceStatusReason}`);
              });
            }
          } catch (resourceError) {
            console.warn('⚠️ Could not get details about failed resources:', resourceError);
          }
          
          throw new Error(`Stack deletion failed: ${failureReason}`);
        }

        // Track resource deletion progress
        try {
          const resourcesResponse = await this.cfnClient.send(new ListStackResourcesCommand({
            StackName: stackName,
          }));
          
          const currentResourceCount = resourcesResponse.StackResourceSummaries?.length || 0;
          
          if (currentResourceCount !== lastResourceCount) {
            console.log(`📊 CloudFormation Stack Manager: ${currentResourceCount} resources remaining`);
            lastResourceCount = currentResourceCount;
            
            // Send progress update via callback
            if (progressCallback) {
              await progressCallback(status, currentResourceCount);
            }
          }
        } catch (resourceError) {
          // Don't fail the whole process if we can't get resource details
          console.warn('⚠️ Could not get resource count:', resourceError);
        }

        await this.sleep(30000); // Wait 30 seconds
        attempts++;

      } catch (error: any) {
        if (error.name === 'ValidationError' && error.message.includes('does not exist')) {
          console.log(`✅ CloudFormation Stack Manager: Stack ${stackName} deleted successfully`);
          if (progressCallback) {
            await progressCallback('DELETE_COMPLETE', 0);
          }
          return;
        }
        
        if (attempts >= maxAttempts - 1) {
          console.error(`❌ CloudFormation Stack Manager: Stack deletion timed out after ${maxAttempts * 30} seconds`);
          throw new Error(`Stack deletion timed out after ${maxAttempts * 30} seconds. Last status: ${lastStatus}`);
        }
        
        console.warn(`⚠️ CloudFormation Stack Manager: Error checking stack status (attempt ${attempts + 1}/${maxAttempts}):`, error.message);
        await this.sleep(30000);
        attempts++;
      }
    }

    throw new Error(`Stack deletion timed out after ${maxAttempts * 30} seconds. Last status: ${lastStatus}`);
  }

  /**
   * Wait for stack deletion to complete (legacy method for backward compatibility)
   */
  private async waitForStackDeletion(stackName: string): Promise<void> {
    return this.waitForStackDeletionWithProgress(stackName);
  }

  /**
   * Clean up workflow database records after stack deletion with enhanced error handling
   */
  private async cleanupWorkflowRecords(workflowId: string, userId: string): Promise<void> {
    const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';
    const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE || 'WorkflowBuilder-Deployments';
    
    try {
      // 1. Update workflow record to mark as not deployed
      console.log('🧹 CloudFormation Stack Manager: Cleaning up workflow record...');
      
      await this.docClient.send(new UpdateCommand({
        TableName: WORKFLOWS_TABLE,
        Key: {
          PK: `USER#${userId}`,
          SK: `WORKFLOW#${workflowId}`,
        },
        UpdateExpression: 'SET isDeployed = :false, deploymentStatus = :status, stepFunctionArn = :arn, cloudFormationStackArn = :stackArn, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':false': false,
          ':status': 'not_deployed',
          ':arn': null,
          ':stackArn': null,
          ':updatedAt': new Date().toISOString(),
        },
        ConditionExpression: 'attribute_exists(PK)', // Ensure the workflow exists
      }));

      console.log('✅ CloudFormation Stack Manager: Workflow record updated successfully');

      // 2. Clean up deployment records for this workflow
      console.log('🧹 CloudFormation Stack Manager: Cleaning up deployment records...');
      
      try {
        // Get all deployment records for this workflow
        const scanResponse = await this.docClient.send(new GetCommand({
          TableName: DEPLOYMENTS_TABLE,
          Key: {
            PK: `WORKFLOW#${workflowId}`,
            SK: `DEPLOYMENT#latest`,
          },
        }));

        if (scanResponse.Item) {
          // Update the latest deployment record to mark as deleted
          await this.docClient.send(new UpdateCommand({
            TableName: DEPLOYMENTS_TABLE,
            Key: {
              PK: `WORKFLOW#${workflowId}`,
              SK: `DEPLOYMENT#latest`,
            },
            UpdateExpression: 'SET #status = :status, deletedAt = :deletedAt, updatedAt = :updatedAt',
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':status': 'deleted',
              ':deletedAt': new Date().toISOString(),
              ':updatedAt': new Date().toISOString(),
            },
          }));

          console.log('✅ CloudFormation Stack Manager: Deployment records updated successfully');
        } else {
          console.log('ℹ️ CloudFormation Stack Manager: No deployment records found to clean up');
        }
      } catch (deploymentError) {
        console.warn('⚠️ CloudFormation Stack Manager: Failed to clean up deployment records:', deploymentError);
        // Don't fail the whole cleanup process for deployment record issues
      }

      console.log('✅ CloudFormation Stack Manager: Database cleanup completed successfully');
      
    } catch (error: any) {
      console.error('❌ CloudFormation Stack Manager: Failed to clean up workflow records:', error);
      
      if (error.name === 'ConditionalCheckFailedException') {
        throw new Error('Workflow record not found - may have been deleted already');
      } else {
        throw new Error(`Database cleanup failed: ${error.message}`);
      }
    }
  }

  /**
   * Extract stack outputs as key-value pairs
   */
  private extractStackOutputs(outputs: any[]): Record<string, string> {
    const result: Record<string, string> = {};
    outputs.forEach(output => {
      if (output.OutputKey && output.OutputValue) {
        result[output.OutputKey] = output.OutputValue;
      }
    });
    return result;
  }

  /**
   * Check if stack is in a state that allows updates
   */
  private isStackUpdateable(stackStatus: string): boolean {
    const updateableStates = [
      'CREATE_COMPLETE',
      'UPDATE_COMPLETE',
      'UPDATE_ROLLBACK_COMPLETE',
    ];
    return updateableStates.includes(stackStatus);
  }

  /**
   * Clean up EventBridge rules and targets for a workflow before stack deletion
   */
  private async cleanupEventBridgeRules(workflowId: string): Promise<void> {
    const ebClient = new EventBridgeClient({ region: process.env.AWS_REGION });
    const ruleName = `S3Trigger-${workflowId}`;

    try {
      // List targets on the rule
      const targets = await ebClient.send(new ListTargetsByRuleCommand({ Rule: ruleName }));
      const targetIds = targets.Targets?.map(t => t.Id!).filter(Boolean) || [];

      if (targetIds.length > 0) {
        console.log(`🧹 Removing ${targetIds.length} targets from EventBridge rule: ${ruleName}`);
        await ebClient.send(new RemoveTargetsCommand({ Rule: ruleName, Ids: targetIds }));
      }

      console.log(`🧹 Deleting EventBridge rule: ${ruleName}`);
      await ebClient.send(new DeleteRuleCommand({ Name: ruleName }));
      console.log(`✅ EventBridge rule cleaned up: ${ruleName}`);
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        console.log(`ℹ️ EventBridge rule ${ruleName} does not exist — skipping`);
        return;
      }
      throw error;
    }
  }

  /**
   * Utility function to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}