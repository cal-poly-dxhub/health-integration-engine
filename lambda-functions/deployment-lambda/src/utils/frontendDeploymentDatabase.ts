import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand, 
  QueryCommand, 
  UpdateCommand, 
  DeleteCommand,
  QueryCommandInput,
  UpdateCommandInput,
  PutCommandInput,
  GetCommandInput,
  DeleteCommandInput
} from '@aws-sdk/lib-dynamodb';
import { 
  FrontendDeploymentDynamoDBItem, 
  FrontendDeploymentStatus, 
  FrontendDeploymentLog,
  EnvironmentConfigDynamoDBItem,
  EnvironmentConfig
} from '../types/frontend';

/**
 * Frontend Deployment Database Utility
 * Handles DynamoDB operations for frontend deployments with proper data modeling
 */
export class FrontendDeploymentDatabase {
  private dynamoDB: DynamoDBDocumentClient;
  private tableName: string;

  constructor(region?: string) {
    const client = new DynamoDBClient({
      region: region || process.env.AWS_REGION
    });
    this.dynamoDB = DynamoDBDocumentClient.from(client);
    this.tableName = process.env.DYNAMODB_TABLE_NAME!;
    
    if (!this.tableName) {
      throw new Error('DYNAMODB_TABLE_NAME environment variable is required');
    }
  }

  /**
   * Save frontend deployment status to DynamoDB
   */
  async saveFrontendDeploymentStatus(status: FrontendDeploymentStatus): Promise<void> {
    const item: FrontendDeploymentDynamoDBItem = {
      PK: `FRONTEND_DEPLOYMENT#${status.deploymentId}`,
      SK: 'STATUS',
      GSI1PK: `USER#${this.extractUserIdFromDeploymentId(status.deploymentId)}`,
      GSI1SK: `FRONTEND_DEPLOYMENT#${status.deploymentId}`,
      deploymentId: status.deploymentId,
      userId: this.extractUserIdFromDeploymentId(status.deploymentId),
      environment: status.environment,
      status: status.status,
      s3BucketName: status.s3BucketName,
      cloudFrontUrl: status.cloudFrontUrl,
      distributionId: status.distributionId,
      customDomainUrl: status.customDomainUrl,
      buildLogs: status.buildResult?.buildLogs || [],
      deploymentLogs: status.logs.map(log => log.message),
      environmentConfig: {
        environment: status.environment,
        apiGatewayUrl: '',
        cognitoUserPoolId: '',
        cognitoClientId: '',
        region: process.env.AWS_REGION!,
        customVariables: {}
      },
      createdAt: status.createdAt,
      updatedAt: status.updatedAt,
      completedAt: status.completedAt,
      error: status.error,
      ttl: this.calculateTTL(status.createdAt) // Auto-expire after 90 days
    };

    const params: PutCommandInput = {
      TableName: this.tableName,
      Item: item
    };
    
    const command = new PutCommand(params);

    try {
      await this.dynamoDB.send(command);
      console.log(`Saved frontend deployment status: ${status.deploymentId}`);
    } catch (error: any) {
      console.error(`Failed to save frontend deployment status: ${status.deploymentId}`, error);
      throw new Error(`Database save failed: ${error.message}`);
    }
  }

  /**
   * Get frontend deployment status from DynamoDB
   */
  async getFrontendDeploymentStatus(deploymentId: string): Promise<FrontendDeploymentStatus> {
    const params: GetCommandInput = {
      TableName: this.tableName,
      Key: {
        PK: `FRONTEND_DEPLOYMENT#${deploymentId}`,
        SK: 'STATUS'
      }
    };
    
    const command = new GetCommand(params);

    try {
      const result = await this.dynamoDB.send(command);
      
      if (!result.Item) {
        throw new Error(`Frontend deployment not found: ${deploymentId}`);
      }

      const item = result.Item as FrontendDeploymentDynamoDBItem;
      
      return this.mapDynamoDBItemToStatus(item);
    } catch (error) {
      console.error(`Failed to get frontend deployment status: ${deploymentId}`, error);
      throw error;
    }
  }

  /**
   * List frontend deployments for a user
   */
  async listFrontendDeployments(userId: string, options: {
    environment?: string;
    limit?: number;
    lastKey?: string;
  } = {}): Promise<{
    deployments: FrontendDeploymentStatus[];
    lastKey?: string;
  }> {
    const { environment, limit = 10, lastKey } = options;
    
    // Use proper QueryCommandInput type with flexible typing for dynamic properties
    const params: QueryCommandInput & Record<string, any> = {
      TableName: this.tableName,
      IndexName: 'GSI1', // Assuming GSI1 exists for user-based queries
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'FRONTEND_DEPLOYMENT#'
      },
      ScanIndexForward: false, // Sort by GSI1SK in descending order (newest first)
      Limit: limit
    };
    
    // Add environment filter if specified - using proper FilterExpression typing
    if (environment) {
      params.FilterExpression = 'environment = :env';
      if (params.ExpressionAttributeValues) {
        params.ExpressionAttributeValues[':env'] = environment;
      }
    }
    
    // Add pagination if lastKey provided - using proper ExclusiveStartKey typing
    if (lastKey) {
      try {
        const decodedKey = JSON.parse(Buffer.from(lastKey, 'base64').toString());
        params.ExclusiveStartKey = decodedKey;
      } catch (error) {
        throw new Error('Invalid lastKey format');
      }
    }

    try {
      const command = new QueryCommand(params);
      const result = await this.dynamoDB.send(command);
      
      const deployments: FrontendDeploymentStatus[] = (result.Items || []).map(item => 
        this.mapDynamoDBItemToStatus(item as FrontendDeploymentDynamoDBItem)
      );
      
      // Encode lastKey for pagination
      let nextLastKey: string | undefined;
      if (result.LastEvaluatedKey) {
        nextLastKey = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
      }
      
      console.log(`Found ${deployments.length} frontend deployments for user: ${userId}`);
      
      return {
        deployments,
        lastKey: nextLastKey
      };
    } catch (error: any) {
      console.error(`Failed to list frontend deployments for user ${userId}:`, error);
      throw new Error(`Failed to list frontend deployments: ${error.message}`);
    }
  }

  /**
   * Add log entry to frontend deployment
   */
  async addDeploymentLog(
    deploymentId: string, 
    log: FrontendDeploymentLog
  ): Promise<void> {
    const params: UpdateCommandInput = {
      TableName: this.tableName,
      Key: {
        PK: `FRONTEND_DEPLOYMENT#${deploymentId}`,
        SK: 'STATUS'
      },
      UpdateExpression: 'SET logs = list_append(if_not_exists(logs, :empty_list), :new_log), updatedAt = :updated',
      ExpressionAttributeValues: {
        ':empty_list': [],
        ':new_log': [log],
        ':updated': new Date().toISOString()
      }
    };

    try {
      const command = new UpdateCommand(params);
      await this.dynamoDB.send(command);
      console.log(`Added log entry to deployment: ${deploymentId}`);
    } catch (error: any) {
      console.error(`Failed to add log entry to deployment: ${deploymentId}`, error);
      throw new Error(`Failed to add log entry: ${error.message}`);
    }
  }

  /**
   * Update deployment progress
   */
  async updateDeploymentProgress(
    deploymentId: string,
    progress: {
      currentStep: string;
      completedSteps: string[];
      totalSteps: number;
      percentage: number;
    }
  ): Promise<void> {
    const params: UpdateCommandInput = {
      TableName: this.tableName,
      Key: {
        PK: `FRONTEND_DEPLOYMENT#${deploymentId}`,
        SK: 'STATUS'
      },
      UpdateExpression: 'SET progress = :progress, updatedAt = :updated',
      ExpressionAttributeValues: {
        ':progress': progress,
        ':updated': new Date().toISOString()
      }
    };

    try {
      const command = new UpdateCommand(params);
      await this.dynamoDB.send(command);
      console.log(`Updated deployment progress: ${deploymentId} - ${progress.percentage}%`);
    } catch (error: any) {
      console.error(`Failed to update deployment progress: ${deploymentId}`, error);
      throw new Error(`Failed to update progress: ${error.message}`);
    }
  }

  /**
   * Save environment configuration
   */
  async saveEnvironmentConfig(userId: string, config: EnvironmentConfig): Promise<void> {
    const item: EnvironmentConfigDynamoDBItem = {
      PK: `USER#${userId}`,
      SK: `ENV_CONFIG#${config.environment}`,
      userId,
      environment: config.environment,
      apiGatewayUrl: config.apiGatewayUrl,
      cognitoUserPoolId: config.cognitoUserPoolId,
      cognitoClientId: config.cognitoClientId,
      region: config.region,
      customVariables: config.customVariables,
      lastUpdated: new Date().toISOString(),
      isActive: true
    };

    const params: PutCommandInput = {
      TableName: this.tableName,
      Item: item
    };

    try {
      const command = new PutCommand(params);
      await this.dynamoDB.send(command);
      console.log(`Saved environment config: ${userId}/${config.environment}`);
    } catch (error: any) {
      console.error(`Failed to save environment config: ${userId}/${config.environment}`, error);
      throw new Error(`Failed to save environment config: ${error.message}`);
    }
  }

  /**
   * Get environment configuration
   */
  async getEnvironmentConfig(userId: string, environment: string): Promise<EnvironmentConfig | null> {
    const params: GetCommandInput = {
      TableName: this.tableName,
      Key: {
        PK: `USER#${userId}`,
        SK: `ENV_CONFIG#${environment}`
      }
    };
    
    const command = new GetCommand(params);

    try {
      const result = await this.dynamoDB.send(command);
      
      if (!result.Item) {
        return null;
      }

      const item = result.Item as EnvironmentConfigDynamoDBItem;
      
      return {
        environment: item.environment,
        apiGatewayUrl: item.apiGatewayUrl,
        cognitoUserPoolId: item.cognitoUserPoolId,
        cognitoClientId: item.cognitoClientId,
        region: item.region,
        customVariables: item.customVariables
      };
    } catch (error: any) {
      console.error(`Failed to get environment config: ${userId}/${environment}`, error);
      throw new Error(`Failed to get environment config: ${error.message}`);
    }
  }

  /**
   * Delete frontend deployment record
   */
  async deleteFrontendDeployment(deploymentId: string): Promise<void> {
    const params: DeleteCommandInput = {
      TableName: this.tableName,
      Key: {
        PK: `FRONTEND_DEPLOYMENT#${deploymentId}`,
        SK: 'STATUS'
      }
    };
    
    const command = new DeleteCommand(params);

    try {
      await this.dynamoDB.send(command);
      console.log(`Deleted frontend deployment record: ${deploymentId}`);
    } catch (error: any) {
      console.error(`Failed to delete frontend deployment record: ${deploymentId}`, error);
      throw new Error(`Failed to delete deployment record: ${error.message}`);
    }
  }

  /**
   * Map DynamoDB item to FrontendDeploymentStatus
   */
  private mapDynamoDBItemToStatus(item: FrontendDeploymentDynamoDBItem): FrontendDeploymentStatus {
    return {
      deploymentId: item.deploymentId,
      environment: item.environment,
      status: item.status,
      progress: {
        currentStep: 'Unknown',
        completedSteps: [],
        totalSteps: 0,
        percentage: 0
      },
      s3BucketName: item.s3BucketName,
      cloudFrontUrl: item.cloudFrontUrl,
      distributionId: item.distributionId,
      customDomainUrl: item.customDomainUrl,
      buildResult: item.buildLogs.length > 0 ? {
        success: true,
        buildPath: '',
        buildLogs: item.buildLogs,
        buildTime: 0,
        artifacts: [],
        size: 0
      } : undefined,
      logs: item.deploymentLogs.map((message, index) => ({
        timestamp: item.createdAt,
        level: 'info' as const,
        message,
        step: item.status
      })),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      completedAt: item.completedAt,
      error: item.error
    };
  }

  /**
   * Extract user ID from deployment ID
   * Assumes deployment ID format includes user ID
   */
  private extractUserIdFromDeploymentId(deploymentId: string): string {
    // This is a placeholder - in a real implementation, you'd need to
    // either store the user ID separately or encode it in the deployment ID
    // For now, we'll return a default value
    return 'unknown-user';
  }

  /**
   * Calculate TTL for auto-expiration (90 days from creation)
   */
  private calculateTTL(createdAt: string): number {
    const createdDate = new Date(createdAt);
    const ttlDate = new Date(createdDate.getTime() + (90 * 24 * 60 * 60 * 1000)); // 90 days
    return Math.floor(ttlDate.getTime() / 1000); // DynamoDB TTL expects Unix timestamp
  }
}

/**
 * Deployment History Tracker
 * Tracks deployment history and provides rollback capabilities
 */
export class DeploymentHistoryTracker {
  private database: FrontendDeploymentDatabase;

  constructor(region?: string) {
    this.database = new FrontendDeploymentDatabase(region);
  }

  /**
   * Record deployment start
   */
  async recordDeploymentStart(
    deploymentId: string,
    userId: string,
    environment: string,
    config?: any
  ): Promise<void> {
    const log: FrontendDeploymentLog = {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'Deployment started',
      step: 'initialization',
      details: {
        deploymentId,
        userId,
        environment,
        config
      }
    };

    await this.database.addDeploymentLog(deploymentId, log);
  }

  /**
   * Record deployment step completion
   */
  async recordStepCompletion(
    deploymentId: string,
    step: string,
    message: string,
    details?: any
  ): Promise<void> {
    const log: FrontendDeploymentLog = {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: `${step}: ${message}`,
      step,
      details
    };

    await this.database.addDeploymentLog(deploymentId, log);
  }

  /**
   * Record deployment error
   */
  async recordDeploymentError(
    deploymentId: string,
    step: string,
    error: Error,
    details?: any
  ): Promise<void> {
    const log: FrontendDeploymentLog = {
      timestamp: new Date().toISOString(),
      level: 'error',
      message: `${step} failed: ${error.message}`,
      step,
      details: {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        },
        ...details
      }
    };

    await this.database.addDeploymentLog(deploymentId, log);
  }

  /**
   * Record deployment completion
   */
  async recordDeploymentCompletion(
    deploymentId: string,
    success: boolean,
    result?: any
  ): Promise<void> {
    const log: FrontendDeploymentLog = {
      timestamp: new Date().toISOString(),
      level: success ? 'info' : 'error',
      message: success ? 'Deployment completed successfully' : 'Deployment failed',
      step: 'completion',
      details: result
    };

    await this.database.addDeploymentLog(deploymentId, log);
  }

  /**
   * Get deployment history for rollback analysis
   */
  async getDeploymentHistory(userId: string, environment: string): Promise<FrontendDeploymentStatus[]> {
    const result = await this.database.listFrontendDeployments(userId, {
      environment,
      limit: 50 // Get last 50 deployments for history
    });

    return result.deployments.filter(deployment => 
      deployment.status === 'completed' // Only successful deployments can be used for rollback
    );
  }

  /**
   * Find previous successful deployment for rollback
   */
  async findPreviousSuccessfulDeployment(
    userId: string, 
    environment: string, 
    currentDeploymentId: string
  ): Promise<FrontendDeploymentStatus | null> {
    const history = await this.getDeploymentHistory(userId, environment);
    
    // Find the most recent successful deployment that's not the current one
    const previousDeployment = history.find(deployment => 
      deployment.deploymentId !== currentDeploymentId &&
      deployment.status === 'completed' &&
      deployment.s3BucketName &&
      deployment.distributionId
    );

    return previousDeployment || null;
  }
}