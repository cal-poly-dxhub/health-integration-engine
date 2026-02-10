import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { CloudFormationClient, DescribeStacksCommand, GetTemplateCommand } from '@aws-sdk/client-cloudformation';
import { S3EventBridgeService } from '../services/s3EventBridgeService';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cfnClient = new CloudFormationClient({ region: process.env.AWS_REGION });

const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE || 'WorkflowBuilder-Deployments';
const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';

/**
 * Update deployment status and workflow status when deployment completes
 * This handler is called by the Step Functions state machine
 */
export const handler = async (event: any): Promise<any> => {
  console.log('🔄 UPDATE DEPLOYMENT STATUS HANDLER INVOKED');
  console.log('📋 Event received:', JSON.stringify(event, null, 2));
  console.log('🌍 Environment variables:', {
    DEPLOYMENTS_TABLE: process.env.DEPLOYMENTS_TABLE,
    WORKFLOWS_TABLE: process.env.WORKFLOWS_TABLE,
    AWS_REGION: process.env.AWS_REGION,
  });

  try {
    const { deploymentId, status, cloudFormationStackArn, error } = event;

    if (!deploymentId) {
      console.error('❌ Missing deploymentId in event');
      console.error('❌ Event received instead:', JSON.stringify(event, null, 2));
      console.error('❌ Event keys available:', Object.keys(event));
      
      // Check if this is an API Gateway event (wrong Lambda being called)
      if (event.httpMethod && event.body) {
        console.error('❌ CRITICAL: Received API Gateway event format');
        console.error('❌ This means the Step Functions state machine is calling the WRONG Lambda function');
        console.error('❌ Expected: Step Functions event with deploymentId, status, cloudFormationStackArn');
        console.error('❌ Received: API Gateway event with httpMethod, path, body');
        
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: 'Wrong Lambda function called',
            message: 'Step Functions state machine is calling the wrong Lambda function',
            expectedEvent: 'Step Functions event',
            receivedEvent: 'API Gateway event'
          })
        };
      }
      
      throw new Error('Deployment ID is required');
    }

    console.log('📊 Processing deployment status update:', { 
      deploymentId, 
      status, 
      hasStackArn: !!cloudFormationStackArn,
      hasError: !!error 
    });

    // Get deployment record to find workflowId and userId
    console.log('📋 Getting deployment record...');
    const deploymentRecord = await getDeploymentRecord(deploymentId);
    if (!deploymentRecord) {
      console.error('❌ Deployment record not found:', deploymentId);
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    const { workflowId, userId } = deploymentRecord;
    console.log('✅ Found deployment record:', { workflowId, userId });
    console.log('📋 Deployment record details:', JSON.stringify(deploymentRecord, null, 2));

    // Update deployment status
    await updateDeploymentStatus(deploymentId, workflowId, {
      status,
      updatedAt: new Date().toISOString(),
      ...(cloudFormationStackArn && { cloudFormationStackArn }),
      ...(error && { error }),
    });

    // If deployment completed successfully, update workflow status and get Step Functions ARN
    if (status === 'completed' && cloudFormationStackArn) {
      console.log('✅ Deployment completed successfully, updating workflow status');
      console.log('📋 CloudFormation Stack ARN:', cloudFormationStackArn);
      
      try {
        // Get CloudFormation stack outputs to find the workflow Step Functions ARN
        const stackName = cloudFormationStackArn.split('/')[1]; // Extract stack name from ARN
        console.log('📋 Extracted stack name:', stackName);
        
        console.log('📋 Getting CloudFormation stack outputs...');
        const stackOutputs = await getCloudFormationStackOutputs(stackName);
        
        console.log('📋 CloudFormation stack outputs found:', Object.keys(stackOutputs));
        console.log('📋 Full stack outputs:', JSON.stringify(stackOutputs, null, 2));
        
        // Check if we have the required Step Function ARN
        const stepFunctionArn = stackOutputs.StepFunctionAliasArn || stackOutputs.StepFunctionArn;
        if (!stepFunctionArn) {
          console.error('❌ StepFunctionArn not found in stack outputs');
          console.error('❌ Available outputs:', Object.keys(stackOutputs));
          throw new Error('StepFunctionArn not found in CloudFormation stack outputs');
        }
        
        console.log('✅ Step Function ARN found:', stepFunctionArn);
        
        // Prepare workflow updates
        const workflowUpdates = {
          isDeployed: true,
          deploymentStatus: 'deployed',
          stepFunctionArn: stepFunctionArn,
          stepFunctionVersionArn: stackOutputs.StepFunctionVersionArn,
          lastDeploymentId: deploymentId,
          cloudFormationStackArn: cloudFormationStackArn,
          cloudFormationStackName: stackName,
          updatedAt: new Date().toISOString(),
        };
        
        console.log('📋 Workflow updates to apply:', JSON.stringify(workflowUpdates, null, 2));
        
        // Update workflow status with deployment info
        console.log('📊 Updating workflow status...');
        await updateWorkflowStatus(userId, workflowId, workflowUpdates);

        console.log('✅ Workflow status updated successfully');
        console.log('🎯 WORKFLOW UPDATE COMPLETE - UI should now show deployed status');
        
        // Enable S3 EventBridge notifications if the stack has an S3 trigger
        await enableS3EventBridgeIfNeeded(stackName);
        
        return {
          statusCode: 200,
          deploymentId,
          status: 'completed',
          workflowStepFunctionArn: stepFunctionArn,
          message: 'Deployment completed and workflow status updated successfully',
        };
        
      } catch (workflowUpdateError) {
        console.error('❌ Failed to update workflow status:', workflowUpdateError);
        console.error('❌ Error details:', workflowUpdateError instanceof Error ? workflowUpdateError.message : 'Unknown error');
        
        // This is critical - the deployment succeeded but the workflow status wasn't updated
        // Return an error to indicate the issue
        return {
          statusCode: 500,
          deploymentId,
          status: 'completed',
          error: 'Deployment completed but workflow status update failed',
          details: workflowUpdateError instanceof Error ? workflowUpdateError.message : 'Unknown error',
        };
      }
    }

    // If deployment failed, update workflow status to failed
    if (status === 'failed') {
      console.log('❌ Deployment failed, updating workflow status');
      
      try {
        await updateWorkflowStatus(userId, workflowId, {
          deploymentStatus: 'failed',
          updatedAt: new Date().toISOString(),
        });
        console.log('✅ Workflow status updated to failed');
      } catch (workflowUpdateError) {
        console.error('❌ Failed to update workflow status to failed:', workflowUpdateError);
      }
    }

    return {
      statusCode: 200,
      deploymentId,
      status,
    };

  } catch (error) {
    console.error('❌ Update deployment status error:', error);
    
    return {
      statusCode: 500,
      error: 'Failed to update deployment status',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/**
 * Get deployment record from database
 */
async function getDeploymentRecord(deploymentId: string): Promise<{ workflowId: string; userId: string } | null> {
  const response = await docClient.send(new ScanCommand({
    TableName: DEPLOYMENTS_TABLE,
    FilterExpression: 'deploymentId = :deploymentId',
    ExpressionAttributeValues: {
      ':deploymentId': deploymentId,
    },
  }));

  if (!response.Items || response.Items.length === 0) {
    return null;
  }

  const record = response.Items[0];
  
  if (!record.userId) {
    throw new Error(`Deployment ${deploymentId} missing userId - cannot update status`);
  }
  
  return {
    workflowId: record.workflowId,
    userId: record.userId,
  };
}

/**
 * Update deployment status in database
 */
async function updateDeploymentStatus(
  deploymentId: string,
  workflowId: string,
  updates: Record<string, any>
): Promise<void> {
  const updateExpression: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  Object.entries(updates).forEach(([key, value], index) => {
    const attrName = `#attr${index}`;
    const attrValue = `:val${index}`;
    
    updateExpression.push(`${attrName} = ${attrValue}`);
    expressionAttributeNames[attrName] = key;
    expressionAttributeValues[attrValue] = value;
  });

  await docClient.send(new UpdateCommand({
    TableName: DEPLOYMENTS_TABLE,
    Key: {
      PK: `DEPLOYMENT#${deploymentId}`,
      SK: `WORKFLOW#${workflowId}`,
    },
    UpdateExpression: `SET ${updateExpression.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));
}

/**
 * Update workflow status in database with proper relationship maintenance
 */
async function updateWorkflowStatus(
  userId: string,
  workflowId: string,
  updates: Record<string, any>
): Promise<void> {
  // First, get the current workflow to preserve important fields
  const currentWorkflow = await getCurrentWorkflow(userId, workflowId);
  
  if (!currentWorkflow) {
    console.warn(`⚠️ Workflow ${workflowId} not found for user ${userId}`);
    return;
  }

  // Prepare updates while preserving existing data and maintaining deployment history
  const safeUpdates = {
    ...updates,
    // Increment version for optimistic locking and change tracking
    version: (currentWorkflow.version || 0) + 1,
    // Preserve existing nodes and connections (these should not be overwritten by deployment)
    nodes: currentWorkflow.nodes || [],
    connections: currentWorkflow.connections || [],
    stepFunctionDefinition: currentWorkflow.stepFunctionDefinition || {},
    // Maintain deployment history (only if we have deployment info)
    ...(updates.lastDeploymentId && {
      deploymentHistory: [
        ...(currentWorkflow.deploymentHistory || []),
        {
          deploymentId: updates.lastDeploymentId,
          timestamp: updates.updatedAt,
          status: updates.deploymentStatus,
          stepFunctionArn: updates.stepFunctionArn,
          cloudFormationStackArn: updates.cloudFormationStackArn,
        }
      ].slice(-10) // Keep last 10 deployments
    }),
    // Track CloudFormation stack relationship
    ...(updates.cloudFormationStackArn && {
      cloudFormationStackName: `workflow-${workflowId}`
    }),
  };

  const updateExpression: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  Object.entries(safeUpdates).forEach(([key, value], index) => {
    // Skip undefined values to avoid DynamoDB errors
    if (value !== undefined) {
      const attrName = `#attr${index}`;
      const attrValue = `:val${index}`;
      
      updateExpression.push(`${attrName} = ${attrValue}`);
      expressionAttributeNames[attrName] = key;
      expressionAttributeValues[attrValue] = value;
    }
  });

  await docClient.send(new UpdateCommand({
    TableName: WORKFLOWS_TABLE,
    Key: {
      PK: `USER#${userId}`,
      SK: `WORKFLOW#${workflowId}`,
    },
    UpdateExpression: `SET ${updateExpression.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    // Add condition to prevent overwriting if workflow was modified
    ConditionExpression: 'attribute_exists(PK)',
  }));

  console.log('✅ Workflow status updated with proper relationship maintenance and deployment history');
}

/**
 * Get current workflow from database
 */
async function getCurrentWorkflow(userId: string, workflowId: string): Promise<any | null> {
  try {
    const response = await docClient.send(new GetCommand({
      TableName: WORKFLOWS_TABLE,
      Key: {
        PK: `USER#${userId}`,
        SK: `WORKFLOW#${workflowId}`,
      },
    }));

    return response.Item || null;
  } catch (error) {
    console.error('Error fetching current workflow:', error);
    return null;
  }
}

/**
 * Get CloudFormation stack outputs
 */
async function getCloudFormationStackOutputs(stackName: string): Promise<Record<string, string>> {
  const response = await cfnClient.send(new DescribeStacksCommand({
    StackName: stackName,
  }));

  const stack = response.Stacks?.[0];
  if (!stack) {
    throw new Error(`Stack ${stackName} not found`);
  }

  const outputs: Record<string, string> = {};
  stack.Outputs?.forEach(output => {
    if (output.OutputKey && output.OutputValue) {
      outputs[output.OutputKey] = output.OutputValue;
    }
  });

  return outputs;
}

/**
 * Enable S3 EventBridge notifications if the deployed stack has an S3 trigger
 */
async function enableS3EventBridgeIfNeeded(stackName: string): Promise<void> {
  try {
    console.log('🔔 Checking if stack has S3 EventBridge trigger...');
    
    const templateResponse = await cfnClient.send(new GetTemplateCommand({
      StackName: stackName,
    }));
    
    if (!templateResponse.TemplateBody) return;
    
    const template = JSON.parse(templateResponse.TemplateBody);
    
    if (!template.Resources?.S3TriggerEventRule) {
      console.log('ℹ️ No S3 trigger configured, skipping EventBridge setup');
      return;
    }
    
    const bucketName = template.Resources.S3TriggerEventRule.Properties?.EventPattern?.detail?.bucket?.name?.[0];
    if (!bucketName) {
      console.log('⚠️ S3 trigger found but no bucket name specified');
      return;
    }
    
    console.log(`🔔 Enabling EventBridge notifications on bucket: ${bucketName}`);
    const s3EventBridgeService = new S3EventBridgeService();
    await s3EventBridgeService.enableEventBridgeNotifications(bucketName);
    console.log(`✅ EventBridge notifications enabled on bucket: ${bucketName}`);
  } catch (error) {
    console.error('⚠️ Failed to enable S3 EventBridge notifications (non-fatal):', error);
    // Non-fatal: the deployment itself succeeded, this is a post-deployment enhancement
  }
}