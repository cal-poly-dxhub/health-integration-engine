import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { createSuccessHeaders } from '../utils/auth';
import { resolveCaller, canReadTeam, unauthenticated } from '../utils/authz';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const DEPLOYMENTS_TABLE = process.env.DEPLOYMENT_TABLE_NAME || 'WorkflowBuilder-Deployments';
const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';

interface DeploymentHistoryResponse {
  deployments: any[];
  count: number;
}

/**
 * Get deployment history for a workflow. Caller must be a reader on the
 * workflow's team (or admin). 404 masks out-of-scope workflows.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const caller = await resolveCaller(event);
    if (!caller) return unauthenticated();

    const workflowId = event.pathParameters?.workflowId;
    if (!workflowId) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'Missing workflowId parameter' }),
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
    if (!canReadTeam(caller, workflow.teamId)) {
      return {
        statusCode: 404,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'Workflow not found' }),
      };
    }

    const result = await docClient.send(new QueryCommand({
      TableName: DEPLOYMENTS_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `WORKFLOW#${workflowId}`,
        ':sk': 'DEPLOYMENT#',
      },
      ScanIndexForward: false,
    }));

    const deployments = result.Items || [];
    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ deployments, count: deployments.length } as DeploymentHistoryResponse),
    };
  } catch (error) {
    console.error('Error getting deployment history:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Failed to get deployment history' }),
    };
  }
};

async function getWorkflowMeta(workflowId: string): Promise<any | null> {
  const response = await docClient.send(new GetCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `WORKFLOW#${workflowId}`, SK: 'META' },
  }));
  return response.Item || null;
}
