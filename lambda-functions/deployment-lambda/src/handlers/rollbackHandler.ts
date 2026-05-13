import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DeploymentRollbackService } from '../services/deploymentRollbackService';
import { FrontendDeploymentService } from '../services/frontendDeploymentService';

/**
 * Lambda handler for deployment rollback operations
 */
export const rollbackHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Rollback handler invoked:', JSON.stringify(event, null, 2));

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  };

  try {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers,
        body: ''
      };
    }

    // Extract user ID from JWT token (this would be set by API Gateway authorizer)
    const userId = event.requestContext.authorizer?.claims?.sub || 'demo-user';
    const userEmail = event.requestContext.authorizer?.claims?.email;

    const rollbackService = new DeploymentRollbackService(
      process.env.AWS_REGION,
      process.env.WEBSOCKET_ENDPOINT
    );

    const frontendService = new FrontendDeploymentService(
      process.env.AWS_REGION,
      process.env.WEBSOCKET_ENDPOINT
    );

    // Route based on HTTP method and path
    const { httpMethod, pathParameters, queryStringParameters } = event;
    const deploymentId = pathParameters?.deploymentId;

    switch (httpMethod) {
      case 'POST':
        // POST /api/deployments/{deploymentId}/rollback - Initiate rollback
        if (!deploymentId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
              success: false,
              error: 'Deployment ID is required'
            })
          };
        }

        console.log(`Initiating rollback for deployment: ${deploymentId}`);
        
        const rollbackResult = await rollbackService.rollbackDeployment(
          deploymentId,
          userId,
          userEmail
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            data: rollbackResult,
            message: 'Rollback initiated successfully'
          })
        };

      case 'GET':
        if (pathParameters?.rollbackId) {
          // GET /api/deployments/rollback/{rollbackId}/status - Get rollback status
          const rollbackId = pathParameters.rollbackId;
          console.log(`Getting rollback status: ${rollbackId}`);
          
          const rollbackStatus = await rollbackService.getRollbackStatus(rollbackId);

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              data: rollbackStatus
            })
          };
        } else if (deploymentId && event.path.includes('/rollback-targets')) {
          // GET /api/deployments/{deploymentId}/rollback-targets - Get available rollback targets
          const environment = queryStringParameters?.environment || 'production';
          console.log(`Getting rollback targets for deployment: ${deploymentId}, environment: ${environment}`);
          
          const targets = await frontendService.getAvailableRollbackTargets(
            userId,
            environment,
            deploymentId
          );

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              data: targets,
              message: `Found ${targets.length} available rollback targets`
            })
          };
        } else {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
              success: false,
              error: 'Invalid rollback request path'
            })
          };
        }

      default:
        return {
          statusCode: 405,
          headers,
          body: JSON.stringify({
            success: false,
            error: `Method ${httpMethod} not allowed`
          })
        };
    }

  } catch (error) {
    console.error('Rollback handler error:', error);

    // Determine appropriate status code based on error type
    let statusCode = 500;
    let errorMessage = 'Internal server error';

    if (error.message.includes('not found')) {
      statusCode = 404;
      errorMessage = error.message;
    } else if (error.message.includes('Cannot rollback') || error.message.includes('Unauthorized')) {
      statusCode = 400;
      errorMessage = error.message;
    } else if (error.message.includes('No previous successful deployment')) {
      statusCode = 422;
      errorMessage = error.message;
    }

    return {
      statusCode,
      headers,
      body: JSON.stringify({
        success: false,
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};

/**
 * Handler for rollback webhook/callback events
 */
export const rollbackWebhookHandler = async (
  event: any
): Promise<void> => {
  console.log('Rollback webhook handler invoked:', JSON.stringify(event, null, 2));

  try {
    // This handler would process rollback status updates from external systems
    // For example, CloudFormation stack events, S3 events, etc.
    
    const { source, detail } = event;
    
    if (source === 'aws.s3' && detail.eventName?.startsWith('ObjectCreated')) {
      // Handle S3 backup creation events
      console.log('S3 backup creation event received:', detail);
    } else if (source === 'aws.cloudfront' && detail.eventName?.includes('InvalidationCompleted')) {
      // Handle CloudFront invalidation completion events
      console.log('CloudFront invalidation completed:', detail);
    }

  } catch (error) {
    console.error('Rollback webhook handler error:', error);
    // Don't throw error for webhook handlers to avoid retries
  }
};