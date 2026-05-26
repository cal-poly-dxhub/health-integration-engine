import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Workflow Lambda function initialized');
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
    },
    body: JSON.stringify({
      message: 'Workflow Lambda function is ready',
      event: event.httpMethod,
    }),
  };
};