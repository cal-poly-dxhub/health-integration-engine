import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

import { extractUserIdFromEvent, createAuthErrorResponse, createSuccessHeaders } from '../utils/auth';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sfnClient = new SFNClient({ region: process.env.AWS_REGION });

const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';

// Construct deletion state machine ARN dynamically
const AWS_REGION = process.env.AWS_REGION;
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID;
const DELETION_STATE_MACHINE_ARN = `arn:aws:states:${AWS_REGION}:${AWS_ACCOUNT_ID}:stateMachine:workflow-builder-deletion`;

/**
 * Delete a workflow and all its associated AWS resources
 * Handles both API Gateway requests and Step Functions actions
 */
export const handler = async (
  event: APIGatewayProxyEvent | any
): Promise<APIGatewayProxyResult | any> => {
  console.log('DELETE WORKFLOW HANDLER INVOKED');
  console.log('Event received:', JSON.stringify({ httpMethod: event.httpMethod, path: event.path, pathParameters: event.pathParameters }, null, 2));

  // Check if this is a Step Functions action call
  if (event.action) {
    return await handleStepFunctionsAction(event);
  }

  // Handle API Gateway request
  return await handleApiGatewayRequest(event as APIGatewayProxyEvent);
};

/**
 * Handle Step Functions action calls
 */
async function handleStepFunctionsAction(event: any): Promise<any> {
  const { action, workflowId, userId } = event;
  
  console.log(`Handling Step Functions action: ${action} for workflow: ${workflowId}`);

  try {
    switch (action) {
      case 'deleteCloudFormationStack':
        return await deleteCloudFormationStackAction(workflowId, userId);
      
      case 'deleteDatabaseRecords':
        return await deleteDatabaseRecordsAction(workflowId, userId);
      
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error(`Step Functions action ${action} failed:`, error);
    throw error;
  }
}

/**
 * Handle API Gateway request to initiate deletion
 */
async function handleApiGatewayRequest(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    // Get user ID from JWT token
    const userId = extractUserIdFromEvent(event);
    
    if (!userId) {
      console.error('No user ID found in JWT token');
      return createAuthErrorResponse('Valid authentication token required');
    }

    // Get workflow ID from path parameters
    const workflowId = event.pathParameters?.workflowId;
    if (!workflowId) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          error: 'Workflow ID is required',
        }),
      };
    }

    console.log('Deleting workflow:', workflowId, 'for user:', userId);

    // 1. Get workflow from database to check ownership and get deployment info
    const workflow = await getWorkflow(workflowId, userId);
    if (!workflow) {
      return {
        statusCode: 404,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          error: 'Workflow not found',
        }),
      };
    }

    console.log('Found workflow:', workflow.name);

    // 2. Start Step Functions deletion workflow
    if (!DELETION_STATE_MACHINE_ARN) {
      return {
        statusCode: 500,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          error: 'Deletion service not configured',
          message: 'Deletion state machine ARN not found',
        }),
      };
    }

    try {
      const executionName = `deletion-${workflowId}-${Date.now()}`;
      const executionInput = {
        workflowId,
        userId,
        workflowName: workflow.name,
        isDeployed: workflow.isDeployed || false,
      };

      console.log('Starting Step Functions execution:', {
        stateMachineArn: DELETION_STATE_MACHINE_ARN,
        executionName,
        input: executionInput,
      });

      const executionResponse = await sfnClient.send(new StartExecutionCommand({
        stateMachineArn: DELETION_STATE_MACHINE_ARN,
        name: executionName,
        input: JSON.stringify(executionInput),
      }));

      console.log('Step Functions deletion execution started:', executionResponse.executionArn);

      return {
        statusCode: 202, // Accepted - will process asynchronously
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          message: 'Workflow deletion initiated via Step Functions',
          workflowId,
          executionArn: executionResponse.executionArn,
          status: 'DELETION_IN_PROGRESS',
          details: {
            message: 'Deletion workflow started. You will receive real-time updates on progress.',
            requiresAwsCleanup: workflow.isDeployed,
            realTimeUpdates: true,
            stepFunctionsExecution: true,
          },
        }),
      };

    } catch (sfnError) {
      console.error('Failed to start Step Functions deletion:', sfnError);
      return {
        statusCode: 500,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          error: 'Failed to start deletion workflow',
          message: sfnError instanceof Error ? sfnError.message : 'Unknown error',
        }),
      };
    }

  } catch (error) {
    console.error('Delete workflow error:', error);
    
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

/**
 * Step Functions action: Delete CloudFormation stack
 */
async function deleteCloudFormationStackAction(workflowId: string, userId: string): Promise<any> {
  console.log(`Step Functions Action: Deleting CloudFormation stack for workflow: ${workflowId}`);
  
  try {
    const { CloudFormationStackManager } = await import('../services/cloudFormationStackManager');
    const stackManager = new CloudFormationStackManager();
    
    const stackName = `workflow-${workflowId}`;
    const result = await stackManager.deleteStack(stackName, workflowId, userId);
    
    console.log('CloudFormation stack deletion result:', result);
    
    return {
      success: result.success,
      message: result.message,
      deletedResources: result.deletedResources,
      warnings: result.warnings,
    };
  } catch (error) {
    console.error('CloudFormation stack deletion failed:', error);
    throw error;
  }
}

/**
 * Step Functions action: Delete database records
 */
async function deleteDatabaseRecordsAction(workflowId: string, userId: string): Promise<any> {
  console.log(`Step Functions Action: Deleting database records for workflow: ${workflowId}`);
  
  try {
    // Delete workflow record from database
    await docClient.send(new DeleteCommand({
      TableName: WORKFLOWS_TABLE,
      Key: {
        PK: `USER#${userId}`,
        SK: `WORKFLOW#${workflowId}`,
      },
    }));
    
    console.log('Workflow record deleted from database');
    
    // Also clean up deployment records
    const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE || 'WorkflowBuilder-Deployments';
    
    try {
      await docClient.send(new DeleteCommand({
        TableName: DEPLOYMENTS_TABLE,
        Key: {
          PK: `WORKFLOW#${workflowId}`,
          SK: `DEPLOYMENT#latest`,
        },
      }));
      console.log('Deployment records cleaned up');
    } catch (deploymentError) {
      console.warn('Failed to clean up deployment records (may not exist):', deploymentError);
    }
    
    return {
      success: true,
      message: 'Database records deleted successfully',
      workflowRemoved: true,
      deploymentRecordsRemoved: true,
    };
  } catch (error) {
    console.error('Database records deletion failed:', error);
    throw error;
  }
}

/**
 * Get workflow from database
 */
async function getWorkflow(workflowId: string, userId: string): Promise<any> {
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
    console.error('Error fetching workflow:', error);
    return null;
  }
}



