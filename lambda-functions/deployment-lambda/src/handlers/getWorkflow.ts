import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, DescribeStateMachineCommand } from '@aws-sdk/client-sfn';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { createSuccessHeaders } from '../utils/auth';
import { resolveCaller, canReadTeam, unauthenticated, forbidden } from '../utils/authz';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sfnClient = new SFNClient({ region: process.env.AWS_REGION });
const cfnClient = new CloudFormationClient({ region: process.env.AWS_REGION });

const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';

/**
 * Get a single workflow. Caller must be a reader on the workflow's team
 * (or admin). Returns 404 to avoid leaking the existence of out-of-scope
 * workflows.
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Get workflow event:', JSON.stringify({ httpMethod: event.httpMethod, path: event.path, pathParameters: event.pathParameters }, null, 2));

  try {
    const workflowId = event.pathParameters?.workflowId;
    if (!workflowId) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'Workflow ID is required' }),
      };
    }

    const caller = await resolveCaller(event);
    if (!caller) return unauthenticated();

    const workflow = await getWorkflowFromDatabase(workflowId);
    if (!workflow) {
      return {
        statusCode: 404,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'Workflow not found' }),
      };
    }

    if (!canReadTeam(caller, workflow.teamId)) {
      // Mask as 404 so out-of-scope workflows aren't enumerable.
      return {
        statusCode: 404,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'Workflow not found' }),
      };
    }

    const updated = await refreshWorkflowDeploymentStatus(workflow);

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify(updated),
    };
  } catch (error) {
    console.error('Get workflow error:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

async function getWorkflowFromDatabase(workflowId: string): Promise<any | null> {
  try {
    const response = await docClient.send(new GetCommand({
      TableName: WORKFLOWS_TABLE,
      Key: {
        PK: `WORKFLOW#${workflowId}`,
        SK: 'META',
      },
    }));
    return response.Item || null;
  } catch (error) {
    console.error('Error fetching workflow:', error);
    return null;
  }
}

async function refreshWorkflowDeploymentStatus(workflow: any): Promise<any> {
  if (!workflow.stepFunctionArn || workflow.deploymentStatus === 'failed') {
    return workflow;
  }

  try {
    const stepFunctionStatus = await checkStepFunctionStatus(workflow.stepFunctionArn);
    const stackName = `workflow-${workflow.id}`;
    const cloudFormationStatus = await checkCloudFormationStatus(stackName);

    let actualStatus = workflow.deploymentStatus;
    let isDeployed = workflow.isDeployed;

    const stackIsComplete = cloudFormationStatus === 'CREATE_COMPLETE' || cloudFormationStatus === 'UPDATE_COMPLETE';
    if (stepFunctionStatus === 'ACTIVE' && stackIsComplete) { actualStatus = 'deployed'; isDeployed = true; }
    else if (stepFunctionStatus === 'DELETING' || cloudFormationStatus === 'DELETE_IN_PROGRESS') { actualStatus = 'deleting'; isDeployed = false; }
    else if (stepFunctionStatus === null && (cloudFormationStatus === 'DELETE_COMPLETE' || cloudFormationStatus === null)) { actualStatus = 'draft'; isDeployed = false; }
    else if (cloudFormationStatus === 'CREATE_FAILED' || cloudFormationStatus === 'UPDATE_FAILED' || cloudFormationStatus === 'ROLLBACK_COMPLETE') { actualStatus = 'failed'; isDeployed = false; }
    else if (cloudFormationStatus === 'CREATE_IN_PROGRESS' || cloudFormationStatus === 'UPDATE_IN_PROGRESS') { actualStatus = 'deploying'; isDeployed = false; }

    if (actualStatus !== workflow.deploymentStatus || isDeployed !== workflow.isDeployed) {
      await updateWorkflowDeploymentStatus(workflow.id, {
        deploymentStatus: actualStatus,
        isDeployed,
        updatedAt: new Date().toISOString(),
      });
      return { ...workflow, deploymentStatus: actualStatus, isDeployed, updatedAt: new Date().toISOString() };
    }
    return workflow;
  } catch (error) {
    console.error(`Error checking deployment status for workflow ${workflow.id}:`, error);
    return workflow;
  }
}

async function checkStepFunctionStatus(stateMachineArn: string): Promise<string | null> {
  try {
    const response = await sfnClient.send(new DescribeStateMachineCommand({ stateMachineArn }));
    return response.status || 'ACTIVE';
  } catch (error: any) {
    if (error.name === 'StateMachineDoesNotExist') return null;
    return null;
  }
}

async function checkCloudFormationStatus(stackName: string): Promise<string | null> {
  try {
    const response = await cfnClient.send(new DescribeStacksCommand({ StackName: stackName }));
    return response.Stacks?.[0]?.StackStatus || null;
  } catch (error: any) {
    if (error.name === 'ValidationError' && error.message.includes('does not exist')) return 'DELETE_COMPLETE';
    return null;
  }
}

async function updateWorkflowDeploymentStatus(
  workflowId: string,
  updates: { deploymentStatus: string; isDeployed: boolean; updatedAt: string }
): Promise<void> {
  await docClient.send(new UpdateCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `WORKFLOW#${workflowId}`, SK: 'META' },
    UpdateExpression: 'SET deploymentStatus = :status, isDeployed = :deployed, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':status': updates.deploymentStatus,
      ':deployed': updates.isDeployed,
      ':updatedAt': updates.updatedAt,
    },
  }));
}
