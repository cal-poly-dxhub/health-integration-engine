import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * Default WebSocket message handler - simplified following AWS sample pattern
 * Just acknowledges any messages sent to the WebSocket
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('WebSocket Default Message:', JSON.stringify(event, null, 2));
  
  const connectionId = event.requestContext.connectionId!;
  
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    console.log(`Received message from ${connectionId}:`, body);
    
    // Simple acknowledgment - following AWS sample pattern
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Message received' }),
    };
    
  } catch (error) {
    console.error('Error processing WebSocket message:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to process message' }),
    };
  }
};