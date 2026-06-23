import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';

export interface WorkflowStatusUpdateEvent {
  workflowId: string;
  // userId is no longer used as a key but is preserved on the event payload
  // for legacy callers; it's ignored.
  userId?: string;
  status: 'deploying' | 'deployed' | 'failed' | 'not_deployed' | 'deleting' | 'delete_failed';
  stateMachineArn?: string;
  stackName?: string;
  errorMessage?: string;
  message?: string;
  timestamp: string;
}

export interface WorkflowStatusUpdateResult {
  success: boolean;
  message: string;
  workflowId: string;
  status: string;
}

/**
 * Lambda handler for updating workflow deployment status
 * Called by Step Functions deployment and deletion workflows
 */
export const handler = async (event: WorkflowStatusUpdateEvent): Promise<WorkflowStatusUpdateResult> => {
  console.log('Updating workflow status:', JSON.stringify({ workflowId: event.workflowId, status: event.status }, null, 2));

  try {
    const { workflowId, userId, status, stateMachineArn, stackName, errorMessage, message, timestamp } = event;

    if (!workflowId || !status) {
      throw new Error('Missing required fields: workflowId or status');
    }

    // Build update expression dynamically based on provided fields
    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    // Always update status and timestamp
    updateExpressions.push('#status = :status');
    updateExpressions.push('#updatedAt = :updatedAt');
    updateExpressions.push('#isDeployed = :isDeployed');
    
    expressionAttributeNames['#status'] = 'deploymentStatus';
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeNames['#isDeployed'] = 'isDeployed';
    
    expressionAttributeValues[':status'] = status;
    expressionAttributeValues[':updatedAt'] = timestamp;
    expressionAttributeValues[':isDeployed'] = status === 'deployed';

    // Add optional fields if provided
    if (stateMachineArn) {
      updateExpressions.push('#stateMachineArn = :stateMachineArn');
      expressionAttributeNames['#stateMachineArn'] = 'stateMachineArn';
      expressionAttributeValues[':stateMachineArn'] = stateMachineArn;
    }

    if (stackName) {
      updateExpressions.push('#stackName = :stackName');
      expressionAttributeNames['#stackName'] = 'stackName';
      expressionAttributeValues[':stackName'] = stackName;
    }

    if (errorMessage) {
      updateExpressions.push('#errorMessage = :errorMessage');
      expressionAttributeNames['#errorMessage'] = 'lastDeploymentError';
      expressionAttributeValues[':errorMessage'] = errorMessage;
    } else if (status === 'deployed') {
      // Clear error message on successful deployment
      updateExpressions.push('#errorMessage = :errorMessage');
      expressionAttributeNames['#errorMessage'] = 'lastDeploymentError';
      expressionAttributeValues[':errorMessage'] = null;
    }

    const updateCommand = new UpdateCommand({
      TableName: WORKFLOWS_TABLE,
      Key: {
        PK: `WORKFLOW#${workflowId}`,
        SK: 'META',
      },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ConditionExpression: 'attribute_exists(PK)',
      ReturnValues: 'UPDATED_NEW',
    });

    const result = await docClient.send(updateCommand);
    
    console.log('Workflow status updated successfully:', {
      workflowId,
      status,
      updatedAttributes: result.Attributes,
    });

    // Send WebSocket notification based on status
    await sendWebSocketNotification(workflowId, userId || '', status, message, errorMessage);

    return {
      success: true,
      message: `Workflow ${workflowId} status updated to ${status}`,
      workflowId,
      status,
    };

  } catch (error) {
    console.error('Error updating workflow status:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return {
      success: false,
      message: `Failed to update workflow status: ${errorMessage}`,
      workflowId: event.workflowId,
      status: event.status,
    };
  }
};

/**
 * Send WebSocket notification for workflow status updates
 */
async function sendWebSocketNotification(
  workflowId: string, 
  userId: string, 
  status: string, 
  message?: string, 
  errorMessage?: string
): Promise<void> {
  try {
    console.log('Sending WebSocket notification:', { workflowId, userId, status, message });

    // Map status to appropriate WebSocket message type and content
    let notificationType: string;
    let notificationMessage: string;
    
    switch (status) {
      case 'deleting':
        notificationType = 'workflow_deletion_progress';
        notificationMessage = message || 'Workflow deletion in progress...';
        break;
      case 'not_deployed':
        notificationType = 'workflow_deletion_completed';
        notificationMessage = message || 'Workflow deletion completed successfully';
        break;
      case 'delete_failed':
        notificationType = 'workflow_deletion_failed';
        notificationMessage = errorMessage || message || 'Workflow deletion failed';
        break;
      case 'deploying':
        notificationType = 'workflow_deployment_progress';
        notificationMessage = message || 'Workflow deployment in progress...';
        break;
      case 'deployed':
        notificationType = 'workflow_deployment_completed';
        notificationMessage = message || 'Workflow deployment completed successfully';
        break;
      case 'failed':
        notificationType = 'workflow_deployment_failed';
        notificationMessage = errorMessage || message || 'Workflow deployment failed';
        break;
      default:
        notificationType = 'workflow_status_update';
        notificationMessage = message || `Workflow status updated to ${status}`;
    }

    // WebSocket notifications are handled by EventBridge -> eventbridge handler
    console.log('Workflow status update notification:', { type: notificationType, workflowId, status });
  } catch (error) {
    console.error('Failed to send WebSocket notification:', error);
    // Don't throw - WebSocket notifications are non-critical
  }
}