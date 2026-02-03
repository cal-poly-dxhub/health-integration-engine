import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { WebSocketConnectionManager, WebSocketConnection } from './websocketConnectionManager';
import { DeploymentLogger } from './deploymentLogger';

/**
 * Message delivery result for a single connection
 */
export interface MessageDeliveryResult {
  connectionId: string;
  success: boolean;
  error?: string;
  statusCode?: number;
  retryAttempt?: number;
}

/**
 * Broadcast result summary
 */
export interface BroadcastResult {
  totalConnections: number;
  successful: number;
  failed: number;
  retried: number;
  staleConnectionsRemoved: number;
  deliveryResults: MessageDeliveryResult[];
}

/**
 * Retry configuration for message delivery
 */
export interface RetryConfig {
  maxRetries: number;
  retryDelayMs: number;
  exponentialBackoff: boolean;
  retryableStatusCodes: number[];
}

/**
 * WebSocket Message Broadcaster
 * Handles broadcasting messages to WebSocket connections with retry logic and error handling
 */
export class WebSocketBroadcaster {
  private apiGatewayManagement: ApiGatewayManagementApiClient;
  private connectionManager: WebSocketConnectionManager;
  private logger: DeploymentLogger;
  private defaultRetryConfig: RetryConfig;

  constructor(
    websocketEndpoint: string,
    region: string = 'us-east-1',
    tableName: string = 'WebSocketConnections'
  ) {
    this.apiGatewayManagement = new ApiGatewayManagementApiClient({
      endpoint: websocketEndpoint,
      region
    });
    this.connectionManager = new WebSocketConnectionManager(websocketEndpoint, region, tableName);
    this.logger = new DeploymentLogger('websocket', 'broadcaster');
    
    // Default retry configuration
    this.defaultRetryConfig = {
      maxRetries: 3,
      retryDelayMs: 1000,
      exponentialBackoff: true,
      retryableStatusCodes: [429, 500, 502, 503, 504] // Rate limit and server errors
    };
  }

  /**
   * Broadcast message to all active WebSocket connections
   */
  async broadcastToAllConnections(
    message: any,
    retryConfig?: Partial<RetryConfig>
  ): Promise<BroadcastResult> {
    try {
      this.logger.info('Starting broadcast to all connections', 'broadcastToAllConnections', {
        messageType: message.type || 'unknown'
      });

      const connections = await this.connectionManager.getAllActiveConnections();
      
      if (connections.length === 0) {
        this.logger.info('No active connections found for broadcast', 'broadcastToAllConnections');
        return {
          totalConnections: 0,
          successful: 0,
          failed: 0,
          retried: 0,
          staleConnectionsRemoved: 0,
          deliveryResults: []
        };
      }

      return await this.broadcastToConnections(connections, message, retryConfig);
    } catch (error) {
      this.logger.error('Failed to broadcast to all connections', 'broadcastToAllConnections', error as Error);
      throw error;
    }
  }

  /**
   * Broadcast message to connections for a specific deployment
   */
  async broadcastToDeploymentConnections(
    deploymentId: string,
    message: any,
    retryConfig?: Partial<RetryConfig>
  ): Promise<BroadcastResult> {
    try {
      this.logger.info(`Starting broadcast to deployment ${deploymentId} connections`, 'broadcastToDeploymentConnections', {
        deploymentId,
        messageType: message.type || 'unknown'
      });

      const connections = await this.connectionManager.getDeploymentConnections(deploymentId);
      
      if (connections.length === 0) {
        this.logger.info(`No active connections found for deployment ${deploymentId}`, 'broadcastToDeploymentConnections');
        return {
          totalConnections: 0,
          successful: 0,
          failed: 0,
          retried: 0,
          staleConnectionsRemoved: 0,
          deliveryResults: []
        };
      }

      return await this.broadcastToConnections(connections, message, retryConfig);
    } catch (error) {
      this.logger.error(`Failed to broadcast to deployment ${deploymentId} connections`, 'broadcastToDeploymentConnections', error as Error);
      throw error;
    }
  }

  /**
   * Broadcast message to connections for a specific user
   */
  async broadcastToUserConnections(
    userId: string,
    message: any,
    retryConfig?: Partial<RetryConfig>
  ): Promise<BroadcastResult> {
    try {
      this.logger.info(`Starting broadcast to user ${userId} connections`, 'broadcastToUserConnections', {
        userId,
        messageType: message.type || 'unknown'
      });

      const connections = await this.connectionManager.getUserConnections(userId);
      
      if (connections.length === 0) {
        this.logger.info(`No active connections found for user ${userId}`, 'broadcastToUserConnections');
        return {
          totalConnections: 0,
          successful: 0,
          failed: 0,
          retried: 0,
          staleConnectionsRemoved: 0,
          deliveryResults: []
        };
      }

      return await this.broadcastToConnections(connections, message, retryConfig);
    } catch (error) {
      this.logger.error(`Failed to broadcast to user ${userId} connections`, 'broadcastToUserConnections', error as Error);
      throw error;
    }
  }

  /**
   * Broadcast message to a specific list of connections
   */
  async broadcastToConnections(
    connections: WebSocketConnection[],
    message: any,
    retryConfig?: Partial<RetryConfig>
  ): Promise<BroadcastResult> {
    const config = { ...this.defaultRetryConfig, ...retryConfig };
    const connectionIds = connections.map(conn => conn.connectionId);
    
    this.logger.info(`Broadcasting message to ${connectionIds.length} connections`, 'broadcastToConnections', {
      connectionCount: connectionIds.length,
      messageType: message.type || 'unknown',
      retryConfig: config
    });

    const deliveryResults: MessageDeliveryResult[] = [];
    let staleConnectionsRemoved = 0;

    // Send messages to all connections in parallel
    const deliveryPromises = connectionIds.map(connectionId => 
      this.sendMessageWithRetry(connectionId, message, config)
    );

    const results = await Promise.allSettled(deliveryPromises);
    
    // Process results and handle stale connections
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const connectionId = connectionIds[i];
      
      if (result.status === 'fulfilled') {
        deliveryResults.push(result.value);
        
        // Remove stale connections
        if (!result.value.success && this.shouldRemoveConnection(result.value)) {
          try {
            await this.connectionManager.removeConnection(connectionId);
            staleConnectionsRemoved++;
            this.logger.debug(`Removed stale connection: ${connectionId}`, 'broadcastToConnections');
          } catch (error) {
            this.logger.warn(`Failed to remove stale connection ${connectionId}`, 'broadcastToConnections', {
              error: (error as Error).message
            });
          }
        }
      } else {
        // Handle unexpected errors
        deliveryResults.push({
          connectionId,
          success: false,
          error: result.reason?.message || 'Unexpected error during message delivery'
        });
      }
    }

    const successful = deliveryResults.filter(r => r.success).length;
    const failed = deliveryResults.length - successful;
    const retried = deliveryResults.filter(r => r.retryAttempt && r.retryAttempt > 0).length;

    const broadcastResult: BroadcastResult = {
      totalConnections: connectionIds.length,
      successful,
      failed,
      retried,
      staleConnectionsRemoved,
      deliveryResults
    };

    this.logger.info('Broadcast completed', 'broadcastToConnections', {
      totalConnections: broadcastResult.totalConnections,
      successful: broadcastResult.successful,
      failed: broadcastResult.failed,
      retried: broadcastResult.retried,
      staleConnectionsRemoved: broadcastResult.staleConnectionsRemoved
    });

    return broadcastResult;
  }

  /**
   * Send message to a single connection with retry logic
   */
  async sendMessageWithRetry(
    connectionId: string,
    message: any,
    retryConfig: RetryConfig
  ): Promise<MessageDeliveryResult> {
    let lastError: any;
    let retryAttempt = 0;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        const success = await this.sendToConnection(connectionId, message);
        
        return {
          connectionId,
          success,
          retryAttempt: attempt > 0 ? attempt : undefined
        };
      } catch (error: any) {
        lastError = error;
        retryAttempt = attempt;
        
        // Check if this error is retryable
        const isRetryable = this.isRetryableError(error, retryConfig);
        const isLastAttempt = attempt === retryConfig.maxRetries;
        
        if (!isRetryable || isLastAttempt) {
          break;
        }

        // Calculate delay for next retry
        const delay = this.calculateRetryDelay(attempt, retryConfig);
        
        this.logger.debug(`Retrying message delivery to ${connectionId} in ${delay}ms`, 'sendMessageWithRetry', {
          attempt: attempt + 1,
          maxRetries: retryConfig.maxRetries,
          error: error.message,
          statusCode: error.statusCode
        });

        await this.sleep(delay);
      }
    }

    // All retries failed
    return {
      connectionId,
      success: false,
      error: lastError?.message || 'Unknown error',
      statusCode: lastError?.statusCode,
      retryAttempt
    };
  }

  /**
   * Send message to a single connection
   */
  private async sendToConnection(connectionId: string, message: any): Promise<boolean> {
    try {
      const command = new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify(message)
      });

      await this.apiGatewayManagement.send(command);
      this.logger.debug(`Message sent successfully to connection ${connectionId}`, 'sendToConnection');
      return true;
    } catch (error: any) {
      this.logger.warn(`Failed to send message to connection ${connectionId}`, 'sendToConnection', {
        error: error.message,
        statusCode: error.statusCode,
        errorName: error.name,
        connectionId: connectionId
      });
      throw error;
    }
  }

  /**
   * Check if an error is retryable based on configuration
   */
  private isRetryableError(error: any, retryConfig: RetryConfig): boolean {
    if (!error.statusCode) {
      return false;
    }
    
    return retryConfig.retryableStatusCodes.includes(error.statusCode);
  }

  /**
   * Check if a connection should be removed based on the delivery result
   */
  private shouldRemoveConnection(result: MessageDeliveryResult): boolean {
    // Remove connections that are gone (410) or forbidden (403)
    return result.statusCode === 410 || result.statusCode === 403;
  }

  /**
   * Calculate retry delay with optional exponential backoff
   */
  private calculateRetryDelay(attempt: number, retryConfig: RetryConfig): number {
    if (!retryConfig.exponentialBackoff) {
      return retryConfig.retryDelayMs;
    }
    
    // Exponential backoff: delay * (2 ^ attempt)
    return retryConfig.retryDelayMs * Math.pow(2, attempt);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Send a simple message to all connections (convenience method)
   */
  async broadcastSimpleMessage(
    type: string,
    data: any,
    deploymentId?: string,
    userId?: string
  ): Promise<BroadcastResult> {
    const message = {
      type,
      data,
      timestamp: new Date().toISOString(),
      ...(deploymentId && { deploymentId }),
      ...(userId && { userId })
    };

    if (deploymentId) {
      return await this.broadcastToDeploymentConnections(deploymentId, message);
    } else if (userId) {
      return await this.broadcastToUserConnections(userId, message);
    } else {
      return await this.broadcastToAllConnections(message);
    }
  }

  /**
   * Get broadcaster statistics
   */
  async getBroadcasterStats(): Promise<{
    connectionStats: any;
    defaultRetryConfig: RetryConfig;
  }> {
    const connectionStats = await this.connectionManager.getConnectionStats();
    
    return {
      connectionStats,
      defaultRetryConfig: this.defaultRetryConfig
    };
  }
}