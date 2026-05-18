import { APIGatewayProxyEvent } from 'aws-lambda';

interface AuthResult {
  isValid: boolean;
  userId?: string;
  email?: string;
  error?: string;
}

/**
 * Validate authentication using API Gateway authorizer claims
 * Since we're using Cognito authorizer, JWT validation is already done by API Gateway
 */
export async function validateJWTToken(event: APIGatewayProxyEvent): Promise<AuthResult> {
  try {
    // Get user ID from API Gateway Cognito authorizer claims
    const userId = extractUserIdFromEvent(event);
    
    if (!userId) {
      return {
        isValid: false,
        error: 'User not authenticated or missing user ID in authorizer claims'
      };
    }

    // Get email from authorizer claims if available
    const email = event.requestContext.authorizer?.claims?.email;

    return {
      isValid: true,
      userId,
      email
    };

  } catch (error) {
    console.error('Auth validation error:', error);
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Authentication validation failed'
    };
  }
}



/**
 * Extract user ID from API Gateway event using Cognito authorizer claims
 * This function should be used in all Lambda handlers
 */
export function extractUserIdFromEvent(event: APIGatewayProxyEvent): string | null {
  // Get user ID from Cognito authorizer claims (set by API Gateway)
  const cognitoUserId = event.requestContext.authorizer?.claims?.sub;
  
  if (cognitoUserId && cognitoUserId !== 'demo-user') {
    console.log('Extracted user ID from authorizer claims:', cognitoUserId);
    return cognitoUserId;
  }

  // Also try alternative claim fields
  const username = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (username) {
    console.log('Extracted user ID from cognito:username:', username);
    return username;
  }

  console.warn('No valid user ID found in authorizer claims');
  return null;
}

/**
 * Create standardized error response for authentication failures
 */
export function createAuthErrorResponse(message: string = 'Authentication required'): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  return {
    statusCode: 401,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    },
    body: JSON.stringify({
      error: 'Unauthorized',
      message
    }),
  };
}

/**
 * Create standardized success response headers
 */
export function createSuccessHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  };
}