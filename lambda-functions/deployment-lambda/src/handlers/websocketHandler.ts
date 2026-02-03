import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { WebSocketService } from '../services/websocketService';
import { DeploymentLogger } from '../utils/deploymentLogger';

/**
 * WebSocket Connection Handler
 * Handles WebSocket connection lifecycle events
 */
export class WebSocketHandler {
  private websocketService: WebSocketService;
  private logger: DeploymentLogger;

  constructor(websocketEndpoint: string, region?: string) {
    this.websocketService = new WebSocketService(websocketEndpoint, region);
    this.logger = new DeploymentLogger('websocket', 'websocket-handler');
  }

  /**
   * Handle WebSocket connection
   */
  async handleConnect(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const connectionId = event.requestContext.connectionId!;
    const userId = this.extractUserIdFromEvent(event);

    try {
      if (!userId) {
        this.logger.error('Missing user ID in connection request', 'connect');
        return {
          statusCode: 401,
          body: JSON.stringify({ message: 'Unauthorized: Missing user ID' })
        };
      }

      await this.websocketService.storeConnection(connectionId, userId);
      
      this.logger.info('WebSocket connection established', 'connect', {
        connectionId,
        userId
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Connected successfully' })
      };
    } catch (error) {
      this.logger.error('Failed to handle WebSocket connection', 'connect', error as Error, {
        connectionId,
        userId
      });

      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'Internal server error' })
      };
    }
  }

  /**
   * Handle WebSocket disconnection
   */
  async handleDisconnect(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const connectionId = event.requestContext.connectionId!;

    try {
      await this.websocketService.removeConnection(connectionId);
      
      this.logger.info('WebSocket connection closed', 'disconnect', {
        connectionId
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Disconnected successfully' })
      };
    } catch (error) {
      this.logger.error('Failed to handle WebSocket disconnection', 'disconnect', error as Error, {
        connectionId
      });

      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'Internal server error' })
      };
    }
  }

  /**
   * Handle WebSocket messages
   */
  async handleMessage(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const connectionId = event.requestContext.connectionId!;
    const body = event.body ? JSON.parse(event.body) : {};

    try {
      const { action, deploymentId } = body;

      switch (action) {
        case 'subscribe-deployment':
          await this.handleSubscribeDeployment(connectionId, deploymentId);
          break;
        
        case 'unsubscribe-deployment':
          await this.handleUnsubscribeDeployment(connectionId);
          break;
        
        case 'get-deployment-status':
          await this.handleGetDeploymentStatus(connectionId, deploymentId);
          break;
        
        case 'ping':
          await this.handlePing(connectionId);
          break;
        
        default:
          this.logger.warn(`Unknown WebSocket action: ${action}`, 'message', {
            connectionId,
            action,
            body
          });
          
          await this.websocketService.sendToConnection(connectionId, {
            type: 'error',
            message: `Unknown action: ${action}`
          });
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Message processed' })
      };
    } catch (error) {
      this.logger.error('Failed to handle WebSocket message', 'message', error as Error, {
        connectionId,
        body
      });

      await this.websocketService.sendToConnection(connectionId, {
        type: 'error',
        message: 'Failed to process message'
      });

      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'Internal server error' })
      };
    }
  }

  /**
   * Handle deployment subscription
   */
  private async handleSubscribeDeployment(
    connectionId: string,
    deploymentId: string
  ): Promise<void> {
    if (!deploymentId) {
      await this.websocketService.sendToConnection(connectionId, {
        type: 'error',
        message: 'Missing deployment ID'
      });
      return;
    }

    await this.websocketService.subscribeToDeployment(connectionId, deploymentId);
    
    await this.websocketService.sendToConnection(connectionId, {
      type: 'subscription-confirmed',
      deploymentId,
      message: `Subscribed to deployment: ${deploymentId}`
    });

    this.logger.info('Connection subscribed to deployment', 'subscribe', {
      connectionId,
      deploymentId
    });
  }

  /**
   * Handle deployment unsubscription
   */
  private async handleUnsubscribeDeployment(connectionId: string): Promise<void> {
    await this.websocketService.unsubscribeFromDeployment(connectionId);
    
    await this.websocketService.sendToConnection(connectionId, {
      type: 'unsubscription-confirmed',
      message: 'Unsubscribed from deployment updates'
    });

    this.logger.info('Connection unsubscribed from deployment', 'unsubscribe', {
      connectionId
    });
  }

  /**
   * Handle deployment status request
   */
  private async handleGetDeploymentStatus(
    connectionId: string,
    deploymentId: string
  ): Promise<void> {
    if (!deploymentId) {
      await this.websocketService.sendToConnection(connectionId, {
        type: 'error',
        message: 'Missing deployment ID'
      });
      return;
    }

    try {
      // This would typically fetch the current deployment status from the database
      // For now, we'll send a placeholder response
      await this.websocketService.sendToConnection(connectionId, {
        type: 'deployment-status-response',
        deploymentId,
        status: 'Status request received - implement database lookup'
      });
    } catch (error) {
      await this.websocketService.sendToConnection(connectionId, {
        type: 'error',
        message: 'Failed to get deployment status'
      });
    }
  }

  /**
   * Handle ping message
   */
  private async handlePing(connectionId: string): Promise<void> {
    await this.websocketService.sendToConnection(connectionId, {
      type: 'pong',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Extract user ID from event (from JWT token or query parameters)
   */
  private extractUserIdFromEvent(event: APIGatewayProxyEvent): string | null {
    // Try to get user ID from authorizer context (if JWT authorizer is used)
    if (event.requestContext.authorizer?.userId) {
      return event.requestContext.authorizer.userId;
    }

    // Try to get user ID from query parameters
    if (event.queryStringParameters?.userId) {
      return event.queryStringParameters.userId;
    }

    // Try to get user ID from headers
    if (event.headers?.['x-user-id']) {
      return event.headers['x-user-id'];
    }

    return null;
  }
}

/**
 * Lambda function handlers
 */
const websocketEndpoint = process.env.WEBSOCKET_ENDPOINT || '';
const region = process.env.AWS_REGION || 'us-east-1';
const handler = new WebSocketHandler(websocketEndpoint, region);

/**
 * WebSocket connect handler
 */
export const connectHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  return await handler.handleConnect(event);
};

/**
 * WebSocket disconnect handler
 */
export const disconnectHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  return await handler.handleDisconnect(event);
};

/**
 * WebSocket message handler
 */
export const messageHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  return await handler.handleMessage(event);
};

/**
 * WebSocket cleanup handler (for scheduled cleanup of stale connections)
 */
export const cleanupHandler = async (): Promise<void> => {
  const websocketService = new WebSocketService(websocketEndpoint, region);
  const cleanedCount = await websocketService.cleanupStaleConnections();
  
  console.log(`WebSocket cleanup completed: ${cleanedCount} stale connections removed`);
};