import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { extractUserIdFromEvent, createAuthErrorResponse, createSuccessHeaders } from '../utils/auth';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const DEPLOYMENTS_TABLE = process.env.DEPLOYMENT_TABLE_NAME || 'WorkflowBuilder-Deployments';

interface DeploymentHistoryResponse {
  deployments: any[];
  count: number;
}

/**
 * Get deployment history for a specific workflow
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    console.log('Get deployment history event:', JSON.stringify(event, null, 2));

    // Validate authentication
    const userId = extractUserIdFromEvent(event);
    if (!userId) {
      return createAuthErrorResponse('Valid authentication token required');
    }

    const workflowId = event.pathParameters?.workflowId;
    if (!workflowId) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'Missing workflowId parameter' }),
      };
    }

    // Query deployment history for the workflow
    const queryParams = {
      TableName: DEPLOYMENTS_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `WORKFLOW#${workflowId}`,
        ':sk': 'DEPLOYMENT#',
      },
      ScanIndexForward: false, // Sort by SK in descending order (newest first)
    };

    const result = await docClient.send(new QueryCommand(queryParams));
    const deployments = result.Items || [];

    // Filter deployments to only show those belonging to the authenticated user
    const userDeployments = deployments.filter(deployment => deployment.userId === userId);

    console.log(`Found ${userDeployments.length} deployments for workflow ${workflowId} and user ${userId}`);

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        deployments: userDeployments,
        count: userDeployments.length,
      } as DeploymentHistoryResponse),
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