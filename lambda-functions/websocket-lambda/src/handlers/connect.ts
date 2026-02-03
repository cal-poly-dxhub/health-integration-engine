import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/**
 * WebSocket connect handler - simplified following AWS sample pattern
 * Stores connection ID in DynamoDB for later message broadcasting
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('WebSocket Connect:', JSON.stringify(event, null, 2));
  
  const connectionId = event.requestContext.connectionId!;
  const tableName = process.env.CONNECTIONS_TABLE_NAME!;
  
  try {
    console.log(`New WebSocket connection: ${connectionId}`);
    
    // Extract query parameters for deployment and user context
    const queryParams = event.queryStringParameters || {};
    const deploymentId = queryParams.deploymentId;
    const userId = queryParams.userId;
    
    console.log('Connection parameters:', { connectionId, deploymentId, userId });
    
    // Store connection in DynamoDB with deployment context
    const connectionData: any = {
      connectionId,
      connectedAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours TTL
    };
    
    // Add optional fields if provided
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
    
    console.log(`Connection ${connectionId} stored successfully with deployment context:`, {
      deploymentId,
      userId
    });
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'Connected successfully',
        connectionId,
        deploymentId,
        userId
      }),
    };
  } catch (error) {
    console.error('Error storing connection:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to connect' }),
    };
  }
};