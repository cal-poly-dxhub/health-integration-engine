import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

import { createSuccessHeaders } from '../utils/auth';
import { resolveCaller, canWriteTeam, unauthenticated, forbidden } from '../utils/authz';
import { writeWorkflowChangeLog } from '../utils/changeLog';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sfnClient = new SFNClient({ region: process.env.AWS_REGION });

const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';

const AWS_REGION = process.env.AWS_REGION;
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID;
const DELETION_STATE_MACHINE_ARN = `arn:aws:states:${AWS_REGION}:${AWS_ACCOUNT_ID}:stateMachine:workflow-builder-deletion`;

/**
 * Delete a workflow.
 *
 * Two entry shapes:
 *   - API Gateway request → caller must be a writer on the workflow's team (or admin).
 *   - Step Functions internal call → no auth check (the SF role authorizes invocation).
 */
export const handler = async (
  event: APIGatewayProxyEvent | any
): Promise<APIGatewayProxyResult | any> => {
  console.log('DELETE WORKFLOW HANDLER INVOKED');
  console.log('Event received:', JSON.stringify({ httpMethod: event.httpMethod, path: event.path, pathParameters: event.pathParameters }, null, 2));

  if (event.action) {
    return await handleStepFunctionsAction(event);
  }
  return await handleApiGatewayRequest(event as APIGatewayProxyEvent);
};

async function handleStepFunctionsAction(event: any): Promise<any> {
  const { action, workflowId, userId } = event;
  console.log(`Handling Step Functions action: ${action} for workflow: ${workflowId}`);
  try {
    switch (action) {
      case 'deleteCloudFormationStack':
        return await deleteCloudFormationStackAction(workflowId, userId);
      case 'deleteDatabaseRecords':
        return await deleteDatabaseRecordsAction(workflowId);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error(`Step Functions action ${action} failed:`, error);
    throw error;
  }
}

async function handleApiGatewayRequest(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const caller = await resolveCaller(event);
    if (!caller) return unauthenticated();

    const workflowId = event.pathParameters?.workflowId;
    if (!workflowId) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'Workflow ID is required' }),
      };
    }

    const workflow = await getWorkflowMeta(workflowId);
    if (!workflow) {
      return {
        statusCode: 404,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'Workflow not found' }),
      };
    }

    if (!canWriteTeam(caller, workflow.teamId)) {
      return forbidden('You do not have writer access on this team');
    }

    if (!DELETION_STATE_MACHINE_ARN) {
      return {
        statusCode: 500,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'Deletion service not configured' }),
      };
    }

    const executionName = `deletion-${workflowId}-${Date.now()}`;
    const executionInput = {
      workflowId,
      userId: caller.userId,
      workflowName: workflow.name,
      isDeployed: workflow.isDeployed || false,
    };

    const executionResponse = await sfnClient.send(new StartExecutionCommand({
      stateMachineArn: DELETION_STATE_MACHINE_ARN,
      name: executionName,
      input: JSON.stringify(executionInput),
    }));

    await writeWorkflowChangeLog({
      workflowId,
      action: 'delete_triggered',
      actorUserId: caller.userId,
      actorEmail: caller.email,
      teamId: workflow.teamId,
      workflowName: workflow.name,
    });

    return {
      statusCode: 202,
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

async function deleteCloudFormationStackAction(workflowId: string, userId: string): Promise<any> {
  const { CloudFormationStackManager } = await import('../services/cloudFormationStackManager');
  const stackManager = new CloudFormationStackManager();
  const stackName = `workflow-${workflowId}`;
  const result = await stackManager.deleteStack(stackName, workflowId, userId);
  return {
    success: result.success,
    message: result.message,
    deletedResources: result.deletedResources,
    warnings: result.warnings,
  };
}

async function deleteDatabaseRecordsAction(workflowId: string): Promise<any> {
  await docClient.send(new DeleteCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `WORKFLOW#${workflowId}`, SK: 'META' },
  }));

  const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE || 'WorkflowBuilder-Deployments';
  try {
    await docClient.send(new DeleteCommand({
      TableName: DEPLOYMENTS_TABLE,
      Key: { PK: `WORKFLOW#${workflowId}`, SK: 'DEPLOYMENT#latest' },
    }));
  } catch (deploymentError) {
    console.warn('Failed to clean up deployment records (may not exist):', deploymentError);
  }
  return { success: true, message: 'Database records deleted successfully', workflowRemoved: true, deploymentRecordsRemoved: true };
}

async function getWorkflowMeta(workflowId: string): Promise<any> {
  const response = await docClient.send(new GetCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `WORKFLOW#${workflowId}`, SK: 'META' },
  }));
  return response.Item || null;
}
