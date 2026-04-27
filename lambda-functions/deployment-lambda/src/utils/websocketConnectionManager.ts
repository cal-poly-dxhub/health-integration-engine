import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { DeploymentLogger } from './deploymentLogger';

/**
 * WebSocket Connection Information
 */
export interface WebSocketConnection {
  connectionId: string;
  userId?: string;
  deploymentId?: string;
  connectedAt: string;
  ttl: number;
  lastActivity?: string;
}

/**
 * Connection validation result
 */
export interface ConnectionValidationResult {
  isValid: boolean;
  connectionId: string;
  error?: string;
  shouldRemove?: boolean;
}

/**
 * WebSocket Connection Manager
 * Handles connection lifecycle, validation, and cleanup operations
 */
export class WebSocketConnectionManager {
  private dynamodb: DynamoDBDocumentClient;
  private apiGatewayManagement: ApiGatewayManagementApiClient;
  private tableName: string;
  private logger: DeploymentLogger;

  constructor(
    websocketEndpoint: string,
    region: string = process.env.AWS_REGION!,
    tableName: string = 'WebSocketConnections'
  ) {
    const client = new DynamoDBClient({ region });
    this.dynamodb = DynamoDBDocumentClient.from(client);
    this.apiGatewayManagement = new ApiGatewayManagementApiClient({
      endpoint: websocketEndpoint,
      region
    });
    this.tableName = tableName;
    this.logger = new DeploymentLogger('websocket', 'connection-manager');
  }

  /**
   * Get all active WebSocket connections from DynamoDB
   * Filters out expired connections based on TTL
   */
  async getAllActiveConnections(): Promise<WebSocketConnection[]> {
    try {
      const currentTime = Math.floor(Date.now() / 1000);
      
      const params = {
        TableName: this.tableName,
        FilterExpression: 'attribute_not_exists(#ttl) OR #ttl > :currentTime',
        ExpressionAttributeNames: {
          '#ttl': 'ttl'
        },
        ExpressionAttributeValues: {
          ':currentTime': currentTime
        }
      };

      const command = new ScanCommand(params);
      const result = await this.dynamodb.send(command);

      const connections = (result.Items || []).map(item => ({
        connectionId: item.connectionId,
        userId: item.userId,
        deploymentId: item.deploymentId,
        connectedAt: item.connectedAt,
        ttl: item.ttl,
        lastActivity: item.lastActivity
      })) as WebSocketConnection[];

      this.logger.info(`Retrieved ${connections.length} active connections`, 'getAllActiveConnections');
      return connections;
    } catch (error) {
      this.logger.error('Failed to get active connections', 'getAllActiveConnections', error as Error);
      throw error;
    }
  }

  /**
   * Get active connections for a specific deployment
   */
  async getDeploymentConnections(deploymentId: string): Promise<WebSocketConnection[]> {
    try {
      const currentTime = Math.floor(Date.now() / 1000);
      
      const params = {
        TableName: this.tableName,
        IndexName: 'DeploymentIdIndex',
        KeyConditionExpression: 'deploymentId = :deploymentId',
        FilterExpression: 'attribute_not_exists(#ttl) OR #ttl > :currentTime',
        ExpressionAttributeNames: {
          '#ttl': 'ttl'
        },
        ExpressionAttributeValues: {
          ':deploymentId': deploymentId,
          ':currentTime': currentTime
        }
      };

      const command = new QueryCommand(params);
      const result = await this.dynamodb.send(command);

      const connections = (result.Items || []).map(item => ({
        connectionId: item.connectionId,
        userId: item.userId,
        deploymentId: item.deploymentId,
        connectedAt: item.connectedAt,
        ttl: item.ttl,
        lastActivity: item.lastActivity
      })) as WebSocketConnection[];

      this.logger.info(`Retrieved ${connections.length} active connections for deployment ${deploymentId}`, 'getDeploymentConnections');
      return connections;
    } catch (error) {
      this.logger.error(`Failed to get connections for deployment ${deploymentId}`, 'getDeploymentConnections', error as Error);
      throw error;
    }
  }

  /**
   * Get active connections for a specific user
   */
  async getUserConnections(userId: string): Promise<WebSocketConnection[]> {
    try {
      const currentTime = Math.floor(Date.now() / 1000);
      
      const params = {
        TableName: this.tableName,
        IndexName: 'UserIdIndex',
        KeyConditionExpression: 'userId = :userId',
        FilterExpression: 'attribute_not_exists(#ttl) OR #ttl > :currentTime',
        ExpressionAttributeNames: {
          '#ttl': 'ttl'
        },
        ExpressionAttributeValues: {
          ':userId': userId,
          ':currentTime': currentTime
        }
      };

      const command = new QueryCommand(params);
      const result = await this.dynamodb.send(command);

      const connections = (result.Items || []).map(item => ({
        connectionId: item.connectionId,
        userId: item.userId,
        deploymentId: item.deploymentId,
        connectedAt: item.connectedAt,
        ttl: item.ttl,
        lastActivity: item.lastActivity
      })) as WebSocketConnection[];

      this.logger.info(`Retrieved ${connections.length} active connections for user ${userId}`, 'getUserConnections');
      return connections;
    } catch (error) {
      this.logger.error(`Failed to get connections for user ${userId}`, 'getUserConnections', error as Error);
      throw error;
    }
  }

  /**
   * Validate a WebSocket connection by attempting to send a ping message
   */
  async validateConnection(connectionId: string): Promise<ConnectionValidationResult> {
    try {
      // First check if connection exists in database
      const connectionInfo = await this.getConnectionInfo(connectionId);
      if (!connectionInfo) {
        return {
          isValid: false,
          connectionId,
          error: 'Connection not found in database',
          shouldRemove: true
        };
      }

      // Check if connection is expired
      const currentTime = Math.floor(Date.now() / 1000);
      if (connectionInfo.ttl && connectionInfo.ttl < currentTime) {
        return {
          isValid: false,
          connectionId,
          error: 'Connection expired',
          shouldRemove: true
        };
      }

      // Test connection by sending a ping message
      const pingMessage = {
        type: 'ping',
        timestamp: new Date().toISOString()
      };

      const command = new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify(pingMessage)
      });

      await this.apiGatewayManagement.send(command);

      this.logger.debug(`Connection ${connectionId} is valid`, 'validateConnection');
      return {
        isValid: true,
        connectionId
      };
    } catch (error: any) {
      this.logger.warn(`Connection ${connectionId} validation failed`, 'validateConnection', {
        error: error.message,
        statusCode: error.statusCode
      });

      // Connection is gone (410) or forbidden (403) - should be removed
      const shouldRemove = error.statusCode === 410 || error.statusCode === 403;
      
      return {
        isValid: false,
        connectionId,
        error: error.message,
        shouldRemove
      };
    }
  }

  /**
   * Validate multiple connections in parallel
   */
  async validateConnections(connectionIds: string[]): Promise<ConnectionValidationResult[]> {
    if (connectionIds.length === 0) {
      return [];
    }

    this.logger.info(`Validating ${connectionIds.length} connections`, 'validateConnections');

    const validationPromises = connectionIds.map(connectionId => 
      this.validateConnection(connectionId)
    );

    const results = await Promise.allSettled(validationPromises);
    
    const validationResults = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          isValid: false,
          connectionId: connectionIds[index],
          error: result.reason?.message || 'Validation failed',
          shouldRemove: true
        };
      }
    });

    const validCount = validationResults.filter(r => r.isValid).length;
    const invalidCount = validationResults.length - validCount;
    
    this.logger.info(`Connection validation complete: ${validCount} valid, ${invalidCount} invalid`, 'validateConnections');
    
    return validationResults;
  }

  /**
   * Clean up stale connections based on TTL and validation
   */
  async cleanupStaleConnections(validateConnections: boolean = false): Promise<{
    removedByTtl: number;
    removedByValidation: number;
    totalRemoved: number;
  }> {
    try {
      let removedByTtl = 0;
      let removedByValidation = 0;

      // First, remove connections that are expired by TTL
      const currentTime = Math.floor(Date.now() / 1000);
      const expiredParams = {
        TableName: this.tableName,
        FilterExpression: 'attribute_exists(ttl) AND ttl < :currentTime',
        ExpressionAttributeValues: {
          ':currentTime': currentTime
        }
      };

      const expiredCommand = new ScanCommand(expiredParams);
      const expiredResult = await this.dynamodb.send(expiredCommand);

      if (expiredResult.Items && expiredResult.Items.length > 0) {
        const deletePromises = expiredResult.Items.map(item => {
          const deleteCommand = new DeleteCommand({
            TableName: this.tableName,
            Key: { connectionId: item.connectionId }
          });
          return this.dynamodb.send(deleteCommand);
        });

        await Promise.all(deletePromises);
        removedByTtl = expiredResult.Items.length;
        
        this.logger.info(`Removed ${removedByTtl} connections expired by TTL`, 'cleanupStaleConnections');
      }

      // Optionally validate remaining connections
      if (validateConnections) {
        const activeConnections = await this.getAllActiveConnections();
        const connectionIds = activeConnections.map(conn => conn.connectionId);
        
        if (connectionIds.length > 0) {
          const validationResults = await this.validateConnections(connectionIds);
          const invalidConnections = validationResults.filter(result => 
            !result.isValid && result.shouldRemove
          );

          if (invalidConnections.length > 0) {
            const deletePromises = invalidConnections.map(result => {
              const deleteCommand = new DeleteCommand({
                TableName: this.tableName,
                Key: { connectionId: result.connectionId }
              });
              return this.dynamodb.send(deleteCommand);
            });

            await Promise.all(deletePromises);
            removedByValidation = invalidConnections.length;
            
            this.logger.info(`Removed ${removedByValidation} connections by validation`, 'cleanupStaleConnections');
          }
        }
      }

      const totalRemoved = removedByTtl + removedByValidation;
      
      this.logger.info(`Stale connection cleanup complete: ${totalRemoved} total removed`, 'cleanupStaleConnections', {
        removedByTtl,
        removedByValidation,
        totalRemoved
      });

      return {
        removedByTtl,
        removedByValidation,
        totalRemoved
      };
    } catch (error) {
      this.logger.error('Failed to cleanup stale connections', 'cleanupStaleConnections', error as Error);
      throw error;
    }
  }

  /**
   * Get connection information from database
   */
  private async getConnectionInfo(connectionId: string): Promise<WebSocketConnection | null> {
    try {
      const params = {
        TableName: this.tableName,
        Key: { connectionId }
      };

      const command = new GetCommand(params);
      const result = await this.dynamodb.send(command);
      
      if (!result.Item) {
        return null;
      }

      return {
        connectionId: result.Item.connectionId,
        userId: result.Item.userId,
        deploymentId: result.Item.deploymentId,
        connectedAt: result.Item.connectedAt,
        ttl: result.Item.ttl,
        lastActivity: result.Item.lastActivity
      };
    } catch (error) {
      this.logger.error(`Failed to get connection info for ${connectionId}`, 'getConnectionInfo', error as Error);
      return null;
    }
  }

  /**
   * Remove a specific connection from the database
   */
  async removeConnection(connectionId: string): Promise<void> {
    try {
      const params = {
        TableName: this.tableName,
        Key: { connectionId }
      };

      const command = new DeleteCommand(params);
      await this.dynamodb.send(command);
      
      this.logger.info(`Connection ${connectionId} removed from database`, 'removeConnection');
    } catch (error) {
      this.logger.error(`Failed to remove connection ${connectionId}`, 'removeConnection', error as Error);
      throw error;
    }
  }

  /**
   * Get connection statistics
   */
  async getConnectionStats(): Promise<{
    totalConnections: number;
    activeConnections: number;
    expiredConnections: number;
    connectionsWithDeployment: number;
    connectionsWithUser: number;
  }> {
    try {
      // Get all connections (including expired)
      const allParams = {
        TableName: this.tableName
      };
      const allCommand = new ScanCommand(allParams);
      const allResult = await this.dynamodb.send(allCommand);
      const totalConnections = allResult.Items?.length || 0;

      // Get active connections
      const activeConnections = await this.getAllActiveConnections();
      const activeCount = activeConnections.length;
      const expiredCount = totalConnections - activeCount;

      // Count connections with deployment and user info
      const connectionsWithDeployment = activeConnections.filter(conn => conn.deploymentId).length;
      const connectionsWithUser = activeConnections.filter(conn => conn.userId).length;

      const stats = {
        totalConnections,
        activeConnections: activeCount,
        expiredConnections: expiredCount,
        connectionsWithDeployment,
        connectionsWithUser
      };

      this.logger.info('Connection statistics retrieved', 'getConnectionStats', stats);
      return stats;
    } catch (error) {
      this.logger.error('Failed to get connection statistics', 'getConnectionStats', error as Error);
      throw error;
    }
  }
}