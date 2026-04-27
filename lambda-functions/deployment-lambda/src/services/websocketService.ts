import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, QueryCommand, UpdateCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { FrontendDeploymentStatus, FrontendDeploymentLog } from '../types/frontend';

/**
 * WebSocket Service for Real-time Deployment Updates
 * Manages WebSocket connections and broadcasts deployment status updates
 */
export class WebSocketService {
  private apiGatewayManagement: ApiGatewayManagementApiClient;
  private dynamodb: DynamoDBDocumentClient;
  private tableName: string;

  constructor(
    websocketEndpoint: string,
    region: string = process.env.AWS_REGION!,
    tableName: string = 'WebSocketConnections'
  ) {
    this.apiGatewayManagement = new ApiGatewayManagementApiClient({
      endpoint: websocketEndpoint,
      region
    });
    const client = new DynamoDBClient({ region });
    this.dynamodb = DynamoDBDocumentClient.from(client);
    this.tableName = tableName;
  }

  /**
   * Store WebSocket connection
   */
  async storeConnection(
    connectionId: string,
    userId: string,
    deploymentId?: string
  ): Promise<void> {
    const params = {
      TableName: this.tableName,
      Item: {
        connectionId,
        userId,
        deploymentId,
        connectedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours TTL
      }
    };

    const command = new PutCommand(params);
    await this.dynamodb.send(command);
    console.log(`WebSocket connection stored: ${connectionId} for user: ${userId}`);
  }

  /**
   * Remove WebSocket connection
   */
  async removeConnection(connectionId: string): Promise<void> {
    const params = {
      TableName: this.tableName,
      Key: { connectionId }
    };

    const command = new DeleteCommand(params);
    await this.dynamodb.send(command);
    console.log(`WebSocket connection removed: ${connectionId}`);
  }

  /**
   * Get connections for a specific user
   */
  async getUserConnections(userId: string): Promise<string[]> {
    const params = {
      TableName: this.tableName,
      IndexName: 'UserIdIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      }
    };

    const command = new QueryCommand(params);
    const result = await this.dynamodb.send(command);
    return result.Items?.map(item => item.connectionId) || [];
  }

  /**
   * Get connections for a specific deployment
   */
  async getDeploymentConnections(deploymentId: string): Promise<string[]> {
    const params = {
      TableName: this.tableName,
      IndexName: 'DeploymentIdIndex',
      KeyConditionExpression: 'deploymentId = :deploymentId',
      ExpressionAttributeValues: {
        ':deploymentId': deploymentId
      }
    };

    const command = new QueryCommand(params);
    const result = await this.dynamodb.send(command);
    return result.Items?.map(item => item.connectionId) || [];
  }

  /**
   * Broadcast deployment status update to all relevant connections
   */
  async broadcastDeploymentUpdate(
    deploymentId: string,
    userId: string,
    status: FrontendDeploymentStatus
  ): Promise<void> {
    // Get connections for both user and deployment
    const [userConnections, deploymentConnections] = await Promise.all([
      this.getUserConnections(userId),
      this.getDeploymentConnections(deploymentId)
    ]);

    // Combine and deduplicate connections
    const allConnections = [...new Set([...userConnections, ...deploymentConnections])];

    if (allConnections.length === 0) {
      console.log(`No WebSocket connections found for deployment: ${deploymentId}`);
      return;
    }

    const message = {
      type: 'deployment-status-update',
      deploymentId,
      status,
      timestamp: new Date().toISOString()
    };

    await this.broadcastToConnections(allConnections, message);
  }

  /**
   * Broadcast deployment log update
   */
  async broadcastDeploymentLog(
    deploymentId: string,
    userId: string,
    log: FrontendDeploymentLog
  ): Promise<void> {
    const [userConnections, deploymentConnections] = await Promise.all([
      this.getUserConnections(userId),
      this.getDeploymentConnections(deploymentId)
    ]);

    const allConnections = [...new Set([...userConnections, ...deploymentConnections])];

    if (allConnections.length === 0) {
      return;
    }

    const message = {
      type: 'deployment-log-update',
      deploymentId,
      log,
      timestamp: new Date().toISOString()
    };

    await this.broadcastToConnections(allConnections, message);
  }

  /**
   * Broadcast deployment progress update
   */
  async broadcastProgressUpdate(
    deploymentId: string,
    userId: string,
    progress: {
      currentStep: string;
      completedSteps: string[];
      totalSteps: number;
      percentage: number;
      estimatedTimeRemaining?: number;
    }
  ): Promise<void> {
    const [userConnections, deploymentConnections] = await Promise.all([
      this.getUserConnections(userId),
      this.getDeploymentConnections(deploymentId)
    ]);

    const allConnections = [...new Set([...userConnections, ...deploymentConnections])];

    if (allConnections.length === 0) {
      return;
    }

    const message = {
      type: 'deployment-progress-update',
      deploymentId,
      progress,
      timestamp: new Date().toISOString()
    };

    await this.broadcastToConnections(allConnections, message);
  }

  /**
   * Broadcast deployment phase change
   */
  async broadcastPhaseChange(
    deploymentId: string,
    userId: string,
    phase: 'configuring' | 'building' | 'uploading' | 'distributing' | 'completed' | 'failed',
    phaseDetails?: any
  ): Promise<void> {
    const [userConnections, deploymentConnections] = await Promise.all([
      this.getUserConnections(userId),
      this.getDeploymentConnections(deploymentId)
    ]);

    const allConnections = [...new Set([...userConnections, ...deploymentConnections])];

    if (allConnections.length === 0) {
      return;
    }

    const message = {
      type: 'deployment-phase-change',
      deploymentId,
      phase,
      phaseDetails,
      timestamp: new Date().toISOString()
    };

    await this.broadcastToConnections(allConnections, message);
  }

  /**
   * Send message to specific connection
   */
  async sendToConnection(connectionId: string, message: any): Promise<boolean> {
    try {
      const command = new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify(message)
      });
      await this.apiGatewayManagement.send(command);

      return true;
    } catch (error: any) {
      console.error(`Failed to send message to connection ${connectionId}:`, error);
      
      // Remove stale connection if it's gone
      if (error.statusCode === 410) {
        await this.removeConnection(connectionId);
      }
      
      return false;
    }
  }

  /**
   * Broadcast message to multiple connections
   */
  private async broadcastToConnections(
    connectionIds: string[],
    message: any
  ): Promise<{ successful: number; failed: number }> {
    const results = await Promise.allSettled(
      connectionIds.map(connectionId => this.sendToConnection(connectionId, message))
    );

    const successful = results.filter(result => 
      result.status === 'fulfilled' && result.value === true
    ).length;
    
    const failed = results.length - successful;

    console.log(`Broadcast complete: ${successful} successful, ${failed} failed`);
    
    return { successful, failed };
  }

  /**
   * Subscribe connection to deployment updates
   */
  async subscribeToDeployment(
    connectionId: string,
    deploymentId: string
  ): Promise<void> {
    const params = {
      TableName: this.tableName,
      Key: { connectionId },
      UpdateExpression: 'SET deploymentId = :deploymentId',
      ExpressionAttributeValues: {
        ':deploymentId': deploymentId
      }
    };

    const command = new UpdateCommand(params);
    await this.dynamodb.send(command);
    console.log(`Connection ${connectionId} subscribed to deployment: ${deploymentId}`);
  }

  /**
   * Unsubscribe connection from deployment updates
   */
  async unsubscribeFromDeployment(connectionId: string): Promise<void> {
    const params = {
      TableName: this.tableName,
      Key: { connectionId },
      UpdateExpression: 'REMOVE deploymentId'
    };

    const command = new UpdateCommand(params);
    await this.dynamodb.send(command);
    console.log(`Connection ${connectionId} unsubscribed from deployment updates`);
  }

  /**
   * Get connection info
   */
  async getConnectionInfo(connectionId: string): Promise<{
    userId?: string;
    deploymentId?: string;
    connectedAt?: string;
  } | null> {
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
      userId: result.Item.userId,
      deploymentId: result.Item.deploymentId,
      connectedAt: result.Item.connectedAt
    };
  }

  /**
   * Clean up stale connections
   */
  async cleanupStaleConnections(): Promise<number> {
    const params = {
      TableName: this.tableName,
      FilterExpression: 'attribute_exists(ttl) AND ttl < :now',
      ExpressionAttributeValues: {
        ':now': Math.floor(Date.now() / 1000)
      }
    };

    const command = new ScanCommand(params);
    const result = await this.dynamodb.send(command);
    
    if (!result.Items || result.Items.length === 0) {
      return 0;
    }

    // Delete stale connections in batches
    const deletePromises = result.Items.map(item => {
      const deleteCommand = new DeleteCommand({
        TableName: this.tableName,
        Key: { connectionId: item.connectionId }
      });
      return this.dynamodb.send(deleteCommand);
    });

    await Promise.all(deletePromises);
    
    console.log(`Cleaned up ${result.Items.length} stale WebSocket connections`);
    return result.Items.length;
  }
}

/**
 * WebSocket Message Types
 */
export interface WebSocketMessage {
  type: 'deployment-status-update' | 'deployment-log-update' | 'deployment-progress-update' | 'deployment-phase-change';
  deploymentId: string;
  timestamp: string;
}

export interface DeploymentStatusMessage extends WebSocketMessage {
  type: 'deployment-status-update';
  status: FrontendDeploymentStatus;
}

export interface DeploymentLogMessage extends WebSocketMessage {
  type: 'deployment-log-update';
  log: FrontendDeploymentLog;
}

export interface DeploymentProgressMessage extends WebSocketMessage {
  type: 'deployment-progress-update';
  progress: {
    currentStep: string;
    completedSteps: string[];
    totalSteps: number;
    percentage: number;
    estimatedTimeRemaining?: number;
  };
}

export interface DeploymentPhaseMessage extends WebSocketMessage {
  type: 'deployment-phase-change';
  phase: 'configuring' | 'building' | 'uploading' | 'distributing' | 'completed' | 'failed';
  phaseDetails?: any;
}