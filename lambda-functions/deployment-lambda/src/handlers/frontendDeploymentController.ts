import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { FrontendDeploymentService } from '../services/frontendDeploymentService';
import { 
  FrontendDeploymentRequest, 
  FrontendDeploymentResult, 
  FrontendDeploymentStatus,
  isFrontendDeploymentRequest 
} from '../types/frontend';

/**
 * Frontend Deployment Controller
 * Handles API Gateway requests for frontend deployment operations
 */

/**
 * Deploy frontend application
 */
export const deployFrontend = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Frontend deployment request received:', JSON.stringify(event, null, 2));
  
  try {
    // Extract user ID from JWT token
    const userId = event.requestContext?.authorizer?.claims?.sub;
    if (!userId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          success: false,
          error: 'Unauthorized: User ID not found in token'
        })
      };
    }

    // Parse request body
    let requestBody: any;
    try {
      requestBody = JSON.parse(event.body || '{}');
    } catch (error) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          success: false,
          error: 'Invalid JSON in request body'
        })
      };
    }

    // Add userId to request
    const deploymentRequest: FrontendDeploymentRequest = {
      ...requestBody,
      userId
    };

    // Validate request
    if (!isFrontendDeploymentRequest(deploymentRequest)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          success: false,
          error: 'Invalid deployment request format',
          details: 'Required fields: environment'
        })
      };
    }

    // Initialize deployment service
    const deploymentService = new FrontendDeploymentService();
    
    // Start deployment (async process)
    const result: FrontendDeploymentResult = await deploymentService.deployFrontend(deploymentRequest);
    
    console.log('Frontend deployment initiated:', result.deploymentId);
    
    return {
      statusCode: 202, // Accepted - async operation
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        success: true,
        data: result,
        message: 'Frontend deployment initiated successfully'
      })
    };

  } catch (error) {
    console.error('Frontend deployment error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};

/**
 * Get frontend deployment status
 */
export const getFrontendDeploymentStatus = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Frontend deployment status request received:', JSON.stringify(event, null, 2));
  
  try {
    // Extract user ID from JWT token
    const userId = event.requestContext?.authorizer?.claims?.sub;
    if (!userId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          success: false,
          error: 'Unauthorized: User ID not found in token'
        })
      };
    }

    // Extract deployment ID from path parameters
    const deploymentId = event.pathParameters?.deploymentId;
    if (!deploymentId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          success: false,
          error: 'Deployment ID is required'
        })
      };
    }

    // Initialize deployment service
    const deploymentService = new FrontendDeploymentService();
    
    // Get deployment status
    const status: FrontendDeploymentStatus = await deploymentService.getFrontendDeploymentStatus(deploymentId);
    
    console.log('Frontend deployment status retrieved:', deploymentId);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        success: true,
        data: status,
        message: 'Frontend deployment status retrieved successfully'
      })
    };

  } catch (error) {
    console.error('Frontend deployment status error:', error);
    
    // Handle not found errors
    if (error.message.includes('not found')) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          success: false,
          error: 'Deployment not found',
          message: error.message
        })
      };
    }
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};

/**
 * Rollback frontend deployment
 */
export const rollbackFrontendDeployment = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Frontend deployment rollback request received:', JSON.stringify(event, null, 2));
  
  try {
    // Extract user ID from JWT token
    const userId = event.requestContext?.authorizer?.claims?.sub;
    if (!userId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          success: false,
          error: 'Unauthorized: User ID not found in token'
        })
      };
    }

    // Extract deployment ID from path parameters
    const deploymentId = event.pathParameters?.deploymentId;
    if (!deploymentId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          success: false,
          error: 'Deployment ID is required'
        })
      };
    }

    // Initialize deployment service
    const deploymentService = new FrontendDeploymentService();
    
    // Perform rollback (userId was already extracted earlier in the function)
    await deploymentService.rollbackFrontendDeployment(deploymentId, userId!);
    
    console.log('Frontend deployment rollback completed:', deploymentId);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        success: true,
        message: 'Frontend deployment rollback completed successfully'
      })
    };

  } catch (error) {
    console.error('Frontend deployment rollback error:', error);
    
    // Handle not found errors
    if (error.message.includes('not found')) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          success: false,
          error: 'Deployment not found',
          message: error.message
        })
      };
    }
    
    // Handle invalid state errors
    if (error.message.includes('Cannot rollback')) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          success: false,
          error: 'Invalid rollback request',
          message: error.message
        })
      };
    }
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};

/**
 * List frontend deployments for a user
 */
export const listFrontendDeployments = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('List frontend deployments request received:', JSON.stringify(event, null, 2));
  
  try {
    // Extract user ID from JWT token
    const userId = event.requestContext?.authorizer?.claims?.sub;
    if (!userId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          success: false,
          error: 'Unauthorized: User ID not found in token'
        })
      };
    }

    // Extract query parameters
    const environment = event.queryStringParameters?.environment;
    const limit = parseInt(event.queryStringParameters?.limit || '10');
    const lastKey = event.queryStringParameters?.lastKey;

    // Initialize deployment service
    const deploymentService = new FrontendDeploymentService();
    
    // List deployments (this method needs to be implemented in the service)
    const deployments = await deploymentService.listFrontendDeployments(userId, {
      environment,
      limit,
      lastKey
    });
    
    console.log('Frontend deployments listed for user:', userId);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        success: true,
        data: deployments,
        message: 'Frontend deployments retrieved successfully'
      })
    };

  } catch (error) {
    console.error('List frontend deployments error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};

/**
 * Handle OPTIONS requests for CORS
 */
export const handleOptions = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    },
    body: ''
  };
};

// Export handlers for Lambda function routing
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const path = event.resource;
  
  console.log(`Frontend deployment handler - Method: ${method}, Path: ${path}`);
  
  try {
    // Handle CORS preflight requests
    if (method === 'OPTIONS') {
      return handleOptions(event);
    }
    
    // Route to appropriate handler based on method and path
    if (method === 'POST' && path === '/api/frontend/deploy') {
      return deployFrontend(event);
    }
    
    if (method === 'GET' && path === '/api/frontend/deploy/{deploymentId}') {
      return getFrontendDeploymentStatus(event);
    }
    
    if (method === 'POST' && path === '/api/frontend/deploy/{deploymentId}/rollback') {
      return rollbackFrontendDeployment(event);
    }
    
    if (method === 'GET' && path === '/api/frontend/deployments') {
      return listFrontendDeployments(event);
    }
    
    // Unknown route
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        success: false,
        error: 'Route not found',
        message: `No handler found for ${method} ${path}`
      })
    };
    
  } catch (error) {
    console.error('Frontend deployment handler error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};