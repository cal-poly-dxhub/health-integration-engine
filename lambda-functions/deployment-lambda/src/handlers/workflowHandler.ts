import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createAuthErrorResponse, createSuccessHeaders } from '../utils/auth';

// Import the individual handlers
import { handler as deployWorkflowHandler } from './deployWorkflow';
import { handler as deleteWorkflowHandler } from './deleteWorkflow';

/**
 * Unified workflow handler that routes requests based on HTTP method
 * This allows a single Lambda function to handle multiple workflow operations
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('🔀 UNIFIED WORKFLOW HANDLER INVOKED');
  console.log('📋 HTTP Method:', event.httpMethod);
  console.log('📋 Path:', event.path);

  try {
    // Route based on HTTP method
    switch (event.httpMethod) {
      case 'POST':
        // Handle deployment requests
        console.log('🚀 Routing to deployment handler');
        return await deployWorkflowHandler(event);
        
      case 'DELETE':
        // Handle deletion requests
        console.log('🗑️ Routing to deletion handler');
        return await deleteWorkflowHandler(event);
        
      default:
        console.error('❌ Unsupported HTTP method:', event.httpMethod);
        return {
          statusCode: 405,
          headers: createSuccessHeaders(),
          body: JSON.stringify({
            error: 'Method Not Allowed',
            message: `HTTP method ${event.httpMethod} is not supported for this endpoint`,
            supportedMethods: ['POST', 'DELETE'],
          }),
        };
    }
  } catch (error) {
    console.error('❌ Unified workflow handler error:', error);
    
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