import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/**
 * WebSocket connect handler - simplified following AWS sample pattern
 * Stores connection ID in DynamoDB for later message broadcasting.
 * The userId is extracted from the authorizer context (validated JWT).
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId!;
  const tableName = process.env.CONNECTIONS_TABLE_NAME!;
  
  try {
    // Extract query parameters for deployment context
    const queryParams = event.queryStringParameters || {};
    const deploymentId = queryParams.deploymentId;
    // userId comes from the authorizer (validated JWT), not raw query params
    const userId = (event.requestContext.authorizer as any)?.userId || queryParams.userId;
    
    // Store connection in DynamoDB with deployment context
    const connectionData: any = {
      connectionId,
      connectedAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours TTL
    };
    
    if (deploymentId) {
      connectionData.deploymentId = deploymentId;
    }
    if (userId) {
      connectionData.userId = userId;
    }
    
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: connectionData,
    }));
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Connected' }),
    };
  } catch (error) {
    console.error('Error storing connection:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to connect' }),
    };
  }
};