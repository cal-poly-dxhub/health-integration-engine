import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/**
 * WebSocket disconnect handler - simplified following AWS sample pattern
 * Removes connection from DynamoDB when client disconnects
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('WebSocket Disconnect:', event.requestContext.connectionId);
  
  const connectionId = event.requestContext.connectionId!;
  const tableName = process.env.CONNECTIONS_TABLE_NAME!;
  
  try {
    // Remove connection from DynamoDB using correct table schema
    await docClient.send(new DeleteCommand({
      TableName: tableName,
      Key: {
        connectionId: connectionId,
      },
    }));
    
    console.log(`Connection ${connectionId} removed successfully`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Disconnected successfully' }),
    };
  } catch (error) {
    console.error('Error removing connection:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to disconnect' }),
    };
  }
};