import { EventBridgeEvent } from 'aws-lambda';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE_NAME || 'WebSocketConnections';

interface StepFunctionStateChangeEvent {
  executionArn: string;
  stateMachineArn: string;
  name: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'ABORTED';
  startDate: number;
  stopDate?: number;
  input: string;
  output?: string;
  error?: string;
  cause?: string;
}

/**
 * Handle EventBridge events for both deployment and deletion updates
 * Following AWS sample pattern: https://github.com/aws-samples/aws-step-functions-progress-tracking
 */
export const handler = async (event: EventBridgeEvent<string, any>): Promise<void> => {
  console.log('EventBridge event received:', JSON.stringify({ source: event.source, detailType: event['detail-type'], id: event.id }, null, 2));

  try {
    const { source, detail } = event;

    // Handle different event sources
    if (source === 'aws.states') {
      await handleStepFunctionEvent(event);
    } else if (source === 'workflow-builder.deployment') {
      await handleDeploymentEvent(event);
    } else if (source === 'workflow-builder.deletion') {
      await handleDeletionEvent(event);
    } else {
      console.log(`Unknown event source: ${source}, skipping`);
    }

    console.log('EventBridge event processed successfully');

  } catch (error) {
    console.error('Error processing EventBridge event:', error);
    throw error;
  }
};



/**
 * Handle deployment events
 */
async function handleDeploymentEvent(event: EventBridgeEvent<string, any>): Promise<void> {
  const { detail } = event;

  console.log(`Processing deployment event for deployment: ${detail.deploymentId}`);

  const progressUpdate = {
    type: 'deployment_progress',
    deploymentId: detail.deploymentId,
    status: mapDeploymentEventStatus(detail.status), // Map to frontend-compatible status
    message: detail.message || getDeploymentEventStatusMessage(detail.status),
    timestamp: detail.timestamp || new Date().toISOString(),
    // Include original status for detailed step tracking
    originalStatus: detail.status,
  };

  // Scope to connections subscribed to this deployment (+ the initiating
  // user's connections if the event carries a userId). Never broadcast to all.
  await broadcastToScopedConnections(
    { deploymentId: detail.deploymentId, userId: detail.userId },
    progressUpdate
  );
}

/**
 * Handle deletion events
 */
async function handleDeletionEvent(event: EventBridgeEvent<string, any>): Promise<void> {
  const { detail } = event;

  console.log(`Processing deletion event for workflow: ${detail.workflowId}`);

  const deletionUpdate = {
    type: 'workflow_deletion_update',
    workflowId: detail.workflowId,
    userId: detail.userId,
    status: detail.status,
    message: detail.message || getDeletionStatusMessage(detail.status),
    timestamp: detail.timestamp || new Date().toISOString(),
  };

  // The deletion progress modal subscribes with the workflowId as its
  // deploymentId, so scope by that id plus the initiating user's connections.
  await broadcastToScopedConnections(
    { deploymentId: detail.workflowId, userId: detail.userId },
    deletionUpdate
  );
}

/**
 * Handle Step Functions state change events
 */
async function handleStepFunctionEvent(event: EventBridgeEvent<string, StepFunctionStateChangeEvent>): Promise<void> {
  const { detail } = event;

  // Check if this is a deployment or deletion state machine
  if (detail.stateMachineArn.includes('workflow-builder-deployment')) {
    await handleDeploymentStepFunctionEvent(detail);
  } else if (detail.stateMachineArn.includes('workflow-builder-deletion')) {
    await handleDeletionStepFunctionEvent(detail);
  } else {
    console.log(`Unknown state machine: ${detail.stateMachineArn}, skipping`);
  }
}

/**
 * Handle deployment Step Functions state change events
 */
async function handleDeploymentStepFunctionEvent(detail: StepFunctionStateChangeEvent): Promise<void> {
  // Extract deployment ID from execution name
  const deploymentId = extractDeploymentId(detail.name);
  if (!deploymentId) {
    console.log('No deployment ID found in execution name, skipping');
    return;
  }

  console.log(`Processing deployment Step Functions event for deployment: ${deploymentId}`);

  // Create progress update message - simplified format following AWS sample
  const progressUpdate = {
    type: 'deployment_progress',
    deploymentId,
    status: mapStepFunctionStatus(detail.status),
    message: getDeploymentStatusMessage(detail.status),
    timestamp: new Date().toISOString(),
    executionArn: detail.executionArn,
    // Include original status for detailed step tracking
    originalStatus: detail.status,
  };

  // Scope to connections subscribed to this deployment id (unguessable,
  // owner-only). No all-connections fallback.
  await broadcastToScopedConnections({ deploymentId }, progressUpdate);
}

/**
 * Handle deletion Step Functions state change events
 */
async function handleDeletionStepFunctionEvent(detail: StepFunctionStateChangeEvent): Promise<void> {
  // Extract workflow ID from execution input
  const workflowId = extractWorkflowIdFromDeletionExecution(detail);
  if (!workflowId) {
    console.log('No workflow ID found in deletion execution, skipping');
    return;
  }

  console.log(`Processing deletion Step Functions event for workflow: ${workflowId}`);

  // The deletion execution input carries the initiating user's id (set by
  // deleteWorkflow), so we can scope updates to that user's connections.
  const ownerUserId = extractUserIdFromDeletionExecution(detail);

  // Create deletion update message
  const deletionUpdate = {
    type: 'workflow_deletion_update',
    workflowId,
    status: mapDeletionStepFunctionStatus(detail.status),
    message: getDeletionStepFunctionStatusMessage(detail.status),
    timestamp: new Date().toISOString(),
    executionArn: detail.executionArn,
  };

  // Scope to the workflow's subscribers and the initiating user. Never all.
  await broadcastToScopedConnections(
    { deploymentId: workflowId, userId: ownerUserId || undefined },
    deletionUpdate
  );
}

/**
 * Extract deployment ID from Step Functions execution name
 */
function extractDeploymentId(executionName: string): string | null {
  // Execution name format: deployment-{deploymentId}
  if (executionName.startsWith('deployment-')) {
    return executionName.replace('deployment-', '');
  }
  return null;
}

/**
 * Map Step Functions status to our deployment status
 */
function mapStepFunctionStatus(status: string): string {
  switch (status) {
    case 'RUNNING':
      return 'IN_PROGRESS';
    case 'SUCCEEDED':
      return 'COMPLETED';
    case 'FAILED':
    case 'TIMED_OUT':
    case 'ABORTED':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

/**
 * Map deployment event status to frontend-compatible status
 */
function mapDeploymentEventStatus(status: string): string {
  switch (status) {
    case 'initializing':
    case 'template_generated':
    case 'deploying_infrastructure':
    case 'stack_creating':
    case 'stack_updating':
    case 'monitoring_stack':
      return 'IN_PROGRESS';
    case 'completed':
      return 'COMPLETED';
    case 'failed':
      return 'FAILED';
    default:
      return 'IN_PROGRESS';
  }
}

/**
 * Extract workflow ID from deletion execution input
 */
function extractWorkflowIdFromDeletionExecution(detail: StepFunctionStateChangeEvent): string | null {
  try {
    if (detail.input) {
      const input = JSON.parse(detail.input);
      return input.workflowId || null;
    }
  } catch (error) {
    console.error('Error parsing deletion execution input:', error);
  }
  return null;
}

/**
 * Extract the initiating user's id from the deletion execution input
 * (set by deleteWorkflow as { workflowId, userId, ... }). Used to scope
 * realtime deletion updates to that user's connections.
 */
function extractUserIdFromDeletionExecution(detail: StepFunctionStateChangeEvent): string | null {
  try {
    if (detail.input) {
      const input = JSON.parse(detail.input);
      return input.userId || null;
    }
  } catch (error) {
    console.error('Error parsing deletion execution input for userId:', error);
  }
  return null;
}

/**
 * Map Step Functions status to deletion status
 */
function mapDeletionStepFunctionStatus(status: string): string {
  switch (status) {
    case 'RUNNING':
      return 'deleting';
    case 'SUCCEEDED':
      return 'completed';
    case 'FAILED':
    case 'TIMED_OUT':
    case 'ABORTED':
      return 'failed';
    default:
      return 'deleting';
  }
}

/**
 * Get user-friendly status message for deletion Step Functions
 */
function getDeletionStepFunctionStatusMessage(status: string): string {
  switch (status) {
    case 'RUNNING':
      return 'Workflow deletion in progress...';
    case 'SUCCEEDED':
      return 'Workflow deleted successfully!';
    case 'FAILED':
      return 'Workflow deletion failed';
    case 'TIMED_OUT':
      return 'Workflow deletion timed out';
    case 'ABORTED':
      return 'Workflow deletion was aborted';
    default:
      return 'Deletion status updated';
  }
}

/**
 * Get user-friendly status message for deployment Step Functions
 */
function getDeploymentStatusMessage(status: string): string {
  switch (status) {
    case 'IN_PROGRESS':
      return 'Deployment is in progress...';
    case 'COMPLETED':
      return 'Deployment completed successfully!';
    case 'FAILED':
      return 'Deployment failed';
    default:
      return 'Deployment status updated';
  }
}

/**
 * Get user-friendly status message for deployment events
 */
function getDeploymentEventStatusMessage(status: string): string {
  switch (status) {
    case 'initializing':
      return 'Starting workflow deployment process...';
    case 'template_generated':
      return 'Workflow Template Generation';
    case 'deploying_infrastructure':
      return 'Workflow Template Deployment Started';
    case 'stack_creating':
      return 'Workflow Resources being deployed';
    case 'stack_updating':
      return 'Workflow Resources being updated';
    case 'monitoring_stack':
      return 'Monitoring deployment progress...';
    case 'completed':
      return 'Workflow Deployed successfully';
    case 'failed':
      return 'Workflow Deployment failed';
    default:
      return 'Deployment status updated';
  }
}

/**
 * Get user-friendly status message for deletion events
 */
function getDeletionStatusMessage(status: string): string {
  switch (status) {
    case 'deleting':
      return 'Starting workflow deletion...';
    case 'deleting_aws_resources':
      return 'Deleting AWS resources (CloudFormation stack, Lambda functions, IAM roles)...';
    case 'aws_resources_deleted':
      return 'AWS resources successfully deleted. Cleaning up database records...';
    case 'aws_cleanup_failed':
      return 'AWS resource cleanup failed. Continuing with database cleanup...';
    case 'cleaning_database':
      return 'Cleaning up database records...';
    case 'completed':
      return 'Workflow deleted successfully!';
    case 'failed':
      return 'Workflow deletion failed';
    default:
      return 'Deletion status updated';
  }
}



/**
 * Broadcast a message ONLY to connections that legitimately belong to the
 * target deployment/workflow — connections subscribed to the exact
 * deployment/workflow id and/or owned by the initiating user. Never broadcasts
 * to all connections (which would leak other tenants' progress data).
 */
async function broadcastToScopedConnections(
  scope: { deploymentId?: string; userId?: string },
  message: any
): Promise<void> {
  try {
    const scopeLabel = scope.deploymentId || scope.userId || 'unknown';
    console.log(`[websocket] INFO: [broadcaster] Starting scoped broadcast for ${scopeLabel}`);

    // Get WebSocket endpoint from environment
    const websocketEndpoint = process.env.WEBSOCKET_ENDPOINT;
    if (!websocketEndpoint) {
      console.error('WEBSOCKET_ENDPOINT environment variable not set');
      return;
    }

    // Create API Gateway Management API client
    // Convert WebSocket URL to HTTPS endpoint for API Gateway Management API
    const httpsEndpoint = websocketEndpoint.replace('wss://', 'https://');
    const apiGatewayClient = new ApiGatewayManagementApiClient({
      endpoint: httpsEndpoint,
      region: process.env.AWS_REGION,
    });

    // Resolve the UNION of (a) connections subscribed to this exact
    // deployment/workflow id and (b) connections owned by the initiating user.
    // Both are tenant-safe: the deployment/workflow id is an unguessable,
    // owner-only identifier, and userId scopes to the acting user's own
    // sessions. There is intentionally NO "broadcast to all connections"
    // fallback — that would leak other tenants' deployment/deletion progress
    // (ids, statuses, error messages, execution ARNs) to every connected
    // client, regardless of team.
    const [byDeployment, byUser] = await Promise.all([
      scope.deploymentId ? getDeploymentConnections(scope.deploymentId) : Promise.resolve<string[]>([]),
      scope.userId ? getUserConnections(scope.userId) : Promise.resolve<string[]>([]),
    ]);
    const connections = [...new Set([...byDeployment, ...byUser])];
    console.log(`[websocket] INFO: Found ${connections.length} scoped connections (deployment=${byDeployment.length}, user=${byUser.length})`);

    if (connections.length === 0) {
      console.log(`[websocket] WARN: No scoped connections found for broadcasting`);
      return;
    }

    // Send message to each connection
    let successful = 0;
    let failed = 0;
    let staleConnectionsRemoved = 0;

    const sendPromises = connections.map(async (connectionId) => {
      try {
        await apiGatewayClient.send(new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: JSON.stringify(message),
        }));
        console.log(`[websocket] DEBUG: Message sent to connection ${connectionId}`);
        return { success: true, connectionId };
      } catch (error: any) {
        console.error(`[websocket] ERROR: Failed to send message to connection ${connectionId}:`, error.message);

        // If connection is stale, remove it from DynamoDB (AWS sample pattern)
        if (error.statusCode === 410) {
          console.log(`[websocket] INFO: Connection ${connectionId} is stale, removing from DynamoDB`);
          await removeStaleConnection(connectionId);
          staleConnectionsRemoved++;
        }
        return { success: false, connectionId, error: error.message };
      }
    });

    const results = await Promise.allSettled(sendPromises);

    // Count results
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        if (result.value.success) {
          successful++;
        } else {
          failed++;
        }
      } else {
        failed++;
      }
    });

    console.log(`[websocket] INFO: [broadcaster] Broadcast completed`, {
      totalConnections: connections.length,
      successful,
      failed,
      retried: 0,
      staleConnectionsRemoved
    });

  } catch (error) {
    console.error('[websocket] ERROR: Error broadcasting to connections:', error);
    throw error;
  }
}

/**
 * Get WebSocket connections owned by a specific user (Cognito sub) via the
 * UserIdIndex GSI. Falls back to a userId-filtered scan if the GSI is absent.
 * Always scoped to the one user — never returns unrelated connections.
 */
async function getUserConnections(userId: string): Promise<string[]> {
  try {
    try {
      const response = await docClient.send(new QueryCommand({
        TableName: CONNECTIONS_TABLE,
        IndexName: 'UserIdIndex',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId },
      }));
      return response.Items?.map(item => item.connectionId).filter(Boolean) || [];
    } catch (gsiError: any) {
      if (gsiError.name === 'ResourceNotFoundException') {
        const response = await docClient.send(new ScanCommand({
          TableName: CONNECTIONS_TABLE,
          FilterExpression: 'userId = :userId',
          ExpressionAttributeValues: { ':userId': userId },
        }));
        return response.Items?.map(item => item.connectionId).filter(Boolean) || [];
      }
      throw gsiError;
    }
  } catch (error) {
    console.error(`[websocket] ERROR: Error getting user connections for ${userId}:`, error);
    return [];
  }
}

/**
 * Get WebSocket connections for a specific deployment
 */
async function getDeploymentConnections(deploymentId: string): Promise<string[]> {
  try {
    // First try to query using the DeploymentIdIndex GSI
    try {
      const response = await docClient.send(new QueryCommand({
        TableName: CONNECTIONS_TABLE,
        IndexName: 'DeploymentIdIndex',
        KeyConditionExpression: 'deploymentId = :deploymentId',
        ExpressionAttributeValues: {
          ':deploymentId': deploymentId
        }
      }));

      const connections = response.Items?.map(item => item.connectionId).filter(Boolean) || [];
      console.log(`[websocket] DEBUG: Found ${connections.length} connections via DeploymentIdIndex GSI`);
      return connections;
    } catch (gsiError: any) {
      if (gsiError.name === 'ResourceNotFoundException') {
        console.log(`[websocket] WARN: DeploymentIdIndex GSI not found, falling back to scan`);

        // Fallback to scanning all connections and filtering
        const response = await docClient.send(new ScanCommand({
          TableName: CONNECTIONS_TABLE,
          FilterExpression: 'deploymentId = :deploymentId',
          ExpressionAttributeValues: {
            ':deploymentId': deploymentId
          }
        }));

        const connections = response.Items?.map(item => item.connectionId).filter(Boolean) || [];
        console.log(`[websocket] DEBUG: Found ${connections.length} connections via scan fallback`);
        return connections;
      } else {
        throw gsiError;
      }
    }
  } catch (error) {
    console.error(`[websocket] ERROR: Error getting deployment connections for ${deploymentId}:`, error);
    return [];
  }
}

/**
 * Remove stale connection from DynamoDB - using correct table structure
 */
async function removeStaleConnection(connectionId: string): Promise<void> {
  try {
    await docClient.send(new DeleteCommand({
      TableName: CONNECTIONS_TABLE,
      Key: {
        connectionId: connectionId,
      },
    }));
    console.log(`Removed stale connection ${connectionId} from DynamoDB`);
  } catch (error) {
    console.error(`Error removing stale connection ${connectionId}:`, error);
  }
}