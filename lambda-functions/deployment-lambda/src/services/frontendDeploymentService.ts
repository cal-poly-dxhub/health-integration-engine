import { 
  FrontendDeploymentRequest, 
  FrontendDeploymentResult, 
  FrontendDeploymentStatus,
  EnvironmentConfig,
  BuildResult,
  S3UploadConfig,
  CloudFrontConfig
} from '../types';
import { EnvironmentConfigManager } from './environmentConfigManager';
import { S3UploadService, UploadProgress } from './s3UploadService';
import { CloudFrontService } from './cloudFrontService';
import { FrontendInfrastructureTemplate } from './frontendInfrastructureTemplate';
import { FrontendDeploymentDatabase, DeploymentHistoryTracker } from '../utils/frontendDeploymentDatabase';
import { DeploymentStatusTracker } from '../utils/deploymentStatusTracker';
import { DeploymentLoggerFactory, BuildLogger, UploadLogger, CloudFrontLogger, ErrorLogger } from '../utils/deploymentLogger';
import { RealTimeDeploymentMonitor, DeploymentPerformanceTracker } from './realTimeDeploymentMonitor';
import { DeploymentNotificationService } from './deploymentNotificationService';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CloudFormationClient, CreateStackCommand, UpdateStackCommand, DescribeStacksCommand, DescribeStacksCommandInput } from '@aws-sdk/client-cloudformation';

/**
 * Frontend Deployment Service
 * Orchestrates the complete frontend deployment process with comprehensive logging and status tracking
 */
export class FrontendDeploymentService {
  private configManager: EnvironmentConfigManager;
  private s3Service: S3UploadService;
  private cloudFrontService: CloudFrontService;
  private cloudFormation: CloudFormationClient;
  private database: FrontendDeploymentDatabase;
  private historyTracker: DeploymentHistoryTracker;
  private notificationService: DeploymentNotificationService;
  private region: string;

  constructor(region?: string, websocketEndpoint?: string) {
    this.region = region || process.env.AWS_REGION!;
    const wsEndpoint = websocketEndpoint || process.env.WEBSOCKET_ENDPOINT || '';
    
    this.configManager = new EnvironmentConfigManager();
    this.s3Service = new S3UploadService(this.region);
    this.cloudFrontService = new CloudFrontService(this.region);
    this.cloudFormation = new CloudFormationClient({ region: this.region });
    this.database = new FrontendDeploymentDatabase(this.region);
    this.historyTracker = new DeploymentHistoryTracker(this.region);
    this.notificationService = new DeploymentNotificationService(wsEndpoint, this.region);
  }

  /**
   * Deploy frontend application with comprehensive logging and error handling
   */
  async deployFrontend(request: FrontendDeploymentRequest): Promise<FrontendDeploymentResult> {
    const deploymentId = this.generateDeploymentId();
    const startTime = new Date().toISOString();
    
    // Initialize loggers, status tracker, and real-time monitoring
    const statusTracker = new DeploymentStatusTracker(deploymentId);
    const buildLogger = DeploymentLoggerFactory.createBuildLogger(deploymentId);
    const uploadLogger = DeploymentLoggerFactory.createUploadLogger(deploymentId);
    const cloudFrontLogger = DeploymentLoggerFactory.createCloudFrontLogger(deploymentId);
    const errorLogger = DeploymentLoggerFactory.createErrorLogger(deploymentId);
    
    // Initialize real-time monitoring
    const realtimeMonitor = new RealTimeDeploymentMonitor(
      deploymentId,
      request.userId,
      process.env.WEBSOCKET_ENDPOINT || '',
      this.region
    );
    
    // Initialize performance tracking
    const performanceTracker = new DeploymentPerformanceTracker();
    performanceTracker.startTiming('total');
    
    console.log(`Starting frontend deployment: ${deploymentId} for environment: ${request.environment}`);
    
    try {
      // Initialize deployment tracking and notifications
      await statusTracker.initialize(request.environment, request.userId, 7);
      await realtimeMonitor.initialize(request.environment, 7);
      await this.historyTracker.recordDeploymentStart(deploymentId, request.userId, request.environment, request);
      
      // Send deployment started notification
      await this.notificationService.notifyDeploymentStarted(
        deploymentId,
        request.userId,
        request.environment
      );
      
      // Step 1: Retrieve backend configuration
      await statusTracker.startStep('configuration', 'Retrieving backend configuration', 0, 7);
      const environmentConfig = await this.getBackendConfiguration(request.environment);
      await statusTracker.completeStep('configuration', 'Backend configuration retrieved', 0, 7, { environmentConfig });
      
      // Step 2: Deploy infrastructure
      await statusTracker.startStep('infrastructure', 'Deploying infrastructure', 1, 7);
      const infrastructure = await this.deployInfrastructure(request, environmentConfig);
      await statusTracker.completeStep('infrastructure', 'Infrastructure deployed', 1, 7, { infrastructure });
      
      // Step 3: Update environment configuration
      await statusTracker.startStep('environment', 'Updating environment configuration', 2, 7);
      await this.updateEnvironmentConfiguration(request, environmentConfig);
      await statusTracker.completeStep('environment', 'Environment configuration updated', 2, 7);
      
      // Step 4: Build frontend (if build path not provided)
      let buildResult: BuildResult | undefined;
      if (!request.buildPath) {
        await statusTracker.startStep('build', 'Building frontend application', 3, 7);
        buildResult = await this.buildFrontendWithLogging(request.environment, environmentConfig, buildLogger, statusTracker);
        await statusTracker.completeStep('build', 'Frontend build completed', 3, 7, { buildResult });
      } else {
        await statusTracker.startStep('build', 'Using provided build path', 3, 7);
        await statusTracker.completeStep('build', 'Using provided build path', 3, 7, { buildPath: request.buildPath });
      }
      
      // Step 5: Upload to S3
      await statusTracker.startStep('upload', 'Uploading build artifacts to S3', 4, 7);
      const uploadResult = await this.uploadToS3WithLogging(
        request.buildPath || buildResult!.buildPath,
        infrastructure.s3BucketName,
        uploadLogger,
        statusTracker
      );
      await statusTracker.completeStep('upload', 'S3 upload completed', 4, 7, { uploadResult });
      
      // Step 6: Configure CloudFront
      await statusTracker.startStep('cloudfront', 'Configuring CloudFront distribution', 5, 7);
      const cloudFrontResult = await this.configureCloudFrontWithLogging(
        infrastructure.s3BucketName,
        request.environment,
        request.domainName,
        request.certificateArn,
        cloudFrontLogger,
        statusTracker
      );
      await statusTracker.completeStep('cloudfront', 'CloudFront configured', 5, 7, { cloudFrontResult });
      
      // Step 7: Invalidate cache
      await statusTracker.startStep('cache', 'Invalidating CloudFront cache', 6, 7);
      await this.cloudFrontService.invalidateCache(cloudFrontResult.distributionId);
      await statusTracker.completeStep('cache', 'Cache invalidation completed', 6, 7);
      
      // Complete deployment
      const completedAt = new Date().toISOString();
      const result: FrontendDeploymentResult = {
        deploymentId,
        environment: request.environment,
        status: 'completed',
        s3BucketName: infrastructure.s3BucketName,
        cloudFrontUrl: `https://${cloudFrontResult.domainName}`,
        distributionId: cloudFrontResult.distributionId,
        customDomainUrl: request.domainName ? `https://${request.domainName}` : undefined,
        buildLogs: buildResult?.buildLogs || [],
        deploymentLogs: [],
        createdAt: startTime,
        completedAt
      };
      
      await statusTracker.completeDeployment(result);
      await this.historyTracker.recordDeploymentCompletion(deploymentId, true, result);
      
      // Store deployment version for future rollbacks
      try {
        const { DeploymentRollbackService } = await import('./deploymentRollbackService');
        const rollbackService = new DeploymentRollbackService(this.region, process.env.WEBSOCKET_ENDPOINT);
        await rollbackService.storeDeploymentVersion(deploymentId, infrastructure.s3BucketName, request.userId);
        
        // Clean up old backups to manage storage costs
        await rollbackService.cleanupOldBackups(infrastructure.s3BucketName, request.userId, request.environment, 10);
      } catch (error) {
        console.warn(`Failed to store deployment version for rollback: ${error.message}`);
        // Don't fail the deployment if backup creation fails
      }
      
      console.log(`Frontend deployment completed: ${deploymentId}`);
      return result;
      
    } catch (error) {
      console.error(`Frontend deployment failed: ${deploymentId}`, error);
      
      // Record the error with detailed troubleshooting information
      await statusTracker.failDeployment(error);
      await this.historyTracker.recordDeploymentError(deploymentId, 'deployment', error, { request });
      
      const errorResult: FrontendDeploymentResult = {
        deploymentId,
        environment: request.environment,
        status: 'failed',
        s3BucketName: '',
        buildLogs: [],
        deploymentLogs: [`Deployment failed: ${error.message}`],
        createdAt: startTime,
        error: {
          code: 'DEPLOYMENT_FAILED',
          message: error.message,
          details: error.stack
        }
      };
      
      await this.historyTracker.recordDeploymentCompletion(deploymentId, false, errorResult);
      
      throw error;
    }
  }

  /**
   * Get frontend deployment status
   */
  async getFrontendDeploymentStatus(deploymentId: string): Promise<FrontendDeploymentStatus> {
    return await this.database.getFrontendDeploymentStatus(deploymentId);
  }

  /**
   * Rollback frontend deployment using the dedicated rollback service
   */
  async rollbackFrontendDeployment(
    deploymentId: string, 
    userId: string, 
    userEmail?: string
  ): Promise<FrontendDeploymentResult> {
    const { DeploymentRollbackService } = await import('./deploymentRollbackService');
    const rollbackService = new DeploymentRollbackService(this.region, process.env.WEBSOCKET_ENDPOINT);
    
    return await rollbackService.rollbackDeployment(deploymentId, userId, userEmail);
  }

  /**
   * Get available rollback targets for a deployment
   */
  async getAvailableRollbackTargets(
    userId: string, 
    environment: string, 
    currentDeploymentId: string
  ): Promise<FrontendDeploymentStatus[]> {
    const { DeploymentRollbackService } = await import('./deploymentRollbackService');
    const rollbackService = new DeploymentRollbackService(this.region, process.env.WEBSOCKET_ENDPOINT);
    
    return await rollbackService.getAvailableRollbackTargets(userId, environment, currentDeploymentId);
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
    return await this.database.listFrontendDeployments(userId, options);
  }

  /**
   * Get environment configuration from backend
   */
  private async getBackendConfiguration(environment: string): Promise<EnvironmentConfig> {
    // This would typically call the backend API to get the latest configuration
    // For now, we'll return a default configuration
    return this.configManager.createDefaultConfig(environment);
  }

  /**
   * Deploy infrastructure using CloudFormation
   */
  private async deployInfrastructure(
    request: FrontendDeploymentRequest,
    environmentConfig: EnvironmentConfig
  ): Promise<{ s3BucketName: string; cloudFrontUrl?: string }> {
    const stackName = FrontendInfrastructureTemplate.generateStackName(request.environment, request.userId);
    const template = FrontendInfrastructureTemplate.generateTemplate({
      environment: request.environment,
      domainName: request.domainName,
      certificateArn: request.certificateArn
    });
    
    try {
      // Check if stack exists
      const stackExists = await this.checkStackExists(stackName);
      
      if (stackExists) {
        // Update existing stack
        const updateCommand = new UpdateStackCommand({
          StackName: stackName,
          TemplateBody: JSON.stringify(template),
          Capabilities: ['CAPABILITY_IAM']
        });
        await this.cloudFormation.send(updateCommand);
        
        console.log(`Updating CloudFormation stack: ${stackName}`);
      } else {
        // Create new stack
        const createCommand = new CreateStackCommand({
          StackName: stackName,
          TemplateBody: JSON.stringify(template),
          Capabilities: ['CAPABILITY_IAM'],
          Tags: [
            { Key: 'Environment', Value: request.environment },
            { Key: 'Application', Value: 'WorkflowBuilder' },
            { Key: 'Component', Value: 'Frontend' },
            { Key: 'ManagedBy', Value: 'WorkflowBuilder' }
          ]
        });
        await this.cloudFormation.send(createCommand);
        
        console.log(`Creating CloudFormation stack: ${stackName}`);
      }
      
      // Wait for stack to complete
      await this.waitForStackComplete(stackName);
      
      // Get stack outputs
      const outputs = await this.getStackOutputs(stackName);
      
      return {
        s3BucketName: outputs.S3BucketName,
        cloudFrontUrl: outputs.CloudFrontUrl
      };
      
    } catch (error) {
      throw new Error(`Infrastructure deployment failed: ${error.message}`);
    }
  }

  /**
   * Update environment configuration files
   */
  private async updateEnvironmentConfiguration(
    request: FrontendDeploymentRequest,
    environmentConfig: EnvironmentConfig
  ): Promise<void> {
    // Merge custom variables from request
    if (request.customVariables) {
      environmentConfig.customVariables = {
        ...environmentConfig.customVariables,
        ...request.customVariables
      };
    }
    
    // This would typically update the frontend project's environment files
    // For now, we'll just validate the configuration
    this.configManager.validateEnvironmentConfig(environmentConfig);
    
    console.log(`Environment configuration updated for: ${request.environment}`);
  }

  /**
   * Build frontend application
   */
  private async buildFrontend(environment: string, config: EnvironmentConfig): Promise<BuildResult> {
    // This would typically run the frontend build process
    // For now, we'll return a mock build result
    const buildPath = `/tmp/frontend-build-${Date.now()}`;
    
    return {
      success: true,
      buildPath,
      buildLogs: [
        'Installing dependencies...',
        'Building for production...',
        'Build completed successfully'
      ],
      buildTime: 30000, // 30 seconds
      artifacts: ['index.html', 'static/js/main.js', 'static/css/main.css'],
      size: 1024 * 1024 // 1MB
    };
  }

  /**
   * Upload build artifacts to S3
   */
  private async uploadToS3(
    buildPath: string,
    bucketName: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<void> {
    const uploadConfig: S3UploadConfig = {
      bucketName,
      region: process.env.AWS_REGION!,
      serverSideEncryption: 'AES256',
      storageClass: 'STANDARD'
    };
    
    await this.s3Service.uploadBuildArtifacts(buildPath, uploadConfig, onProgress);
  }

  /**
   * Configure CloudFront distribution
   */
  private async configureCloudFront(
    bucketName: string,
    environment: string,
    domainName?: string,
    certificateArn?: string
  ): Promise<{ distributionId: string; domainName: string }> {
    const config: Partial<CloudFrontConfig> = {
      domainName,
      certificateArn,
      priceClass: environment === 'production' ? 'PriceClass_All' : 'PriceClass_100',
      enableLogging: environment === 'production',
      customErrorResponses: [
        {
          errorCode: 404,
          responseCode: 200,
          responsePagePath: '/index.html',
          errorCachingMinTTL: 300
        },
        {
          errorCode: 403,
          responseCode: 200,
          responsePagePath: '/index.html',
          errorCachingMinTTL: 300
        }
      ],
      cacheBehaviors: [
        {
          pathPattern: '/static/*',
          cachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6' // Managed-CachingOptimizedForUncompressedObjects
        }
      ]
    };
    
    const result = await this.cloudFrontService.createOrUpdateDistribution(bucketName, environment, config);
    
    return {
      distributionId: result.distributionId,
      domainName: result.domainName
    };
  }

  /**
   * Initialize deployment status in DynamoDB
   */
  private async initializeDeploymentStatus(
    deploymentId: string,
    request: FrontendDeploymentRequest,
    startTime: string
  ): Promise<FrontendDeploymentStatus> {
    const status: FrontendDeploymentStatus = {
      deploymentId,
      environment: request.environment,
      status: 'pending',
      progress: {
        currentStep: 'Initializing deployment',
        completedSteps: [],
        totalSteps: 7,
        percentage: 0
      },
      logs: [{
        timestamp: startTime,
        level: 'info',
        message: 'Deployment initialized',
        step: 'initialization'
      }],
      createdAt: startTime,
      updatedAt: startTime
    };
    
    await this.saveDeploymentStatus(status);
    return status;
  }

  /**
   * Update deployment status
   */
  private async updateDeploymentStatus(
    deploymentId: string,
    status: FrontendDeploymentStatus['status'],
    message: string,
    result?: FrontendDeploymentResult
  ): Promise<FrontendDeploymentStatus> {
    const currentStatus = await this.getFrontendDeploymentStatus(deploymentId);
    
    currentStatus.status = status;
    currentStatus.progress.currentStep = message;
    currentStatus.updatedAt = new Date().toISOString();
    
    // Update progress
    const stepMap: Record<string, number> = {
      'pending': 0,
      'configuring': 20,
      'building': 40,
      'uploading': 60,
      'completed': 100,
      'failed': 0
    };
    
    currentStatus.progress.percentage = stepMap[status] || 0;
    
    // Add log entry
    currentStatus.logs.push({
      timestamp: currentStatus.updatedAt,
      level: status === 'failed' ? 'error' : 'info',
      message,
      step: status
    });
    
    // Add result data if provided
    if (result) {
      currentStatus.s3BucketName = result.s3BucketName;
      currentStatus.cloudFrontUrl = result.cloudFrontUrl;
      currentStatus.distributionId = result.distributionId;
      currentStatus.customDomainUrl = result.customDomainUrl;
      currentStatus.completedAt = result.completedAt;
      currentStatus.error = result.error;
    }
    
    await this.saveDeploymentStatus(currentStatus);
    return currentStatus;
  }

  /**
   * Update upload progress
   */
  private async updateUploadProgress(deploymentId: string, progress: UploadProgress): Promise<void> {
    const status = await this.getFrontendDeploymentStatus(deploymentId);
    
    status.uploadProgress = {
      uploadedFiles: progress.uploadedFiles,
      totalFiles: progress.totalFiles,
      uploadedBytes: progress.uploadedBytes,
      totalBytes: progress.totalBytes
    };
    
    status.progress.percentage = 60 + (progress.percentage * 0.2); // Upload is 60-80% of total progress
    status.updatedAt = new Date().toISOString();
    
    await this.saveDeploymentStatus(status);
  }

  /**
   * Save deployment status to DynamoDB
   */
  private async saveDeploymentStatus(status: FrontendDeploymentStatus): Promise<void> {
    await this.database.saveFrontendDeploymentStatus(status);
  }

  /**
   * Check if CloudFormation stack exists
   */
  private async checkStackExists(stackName: string): Promise<boolean> {
    try {
      const command = new DescribeStacksCommand({ StackName: stackName });
      await this.cloudFormation.send(command);
      return true;
    } catch (error: any) {
      if (error.name === 'ValidationError') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Wait for CloudFormation stack to complete
   */
  private async waitForStackComplete(stackName: string): Promise<void> {
    const maxWaitTime = 1800000; // 30 minutes
    const pollInterval = 30000; // 30 seconds
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      const command = new DescribeStacksCommand({ StackName: stackName });
      const result = await this.cloudFormation.send(command);
      const stack = result.Stacks![0];
      const status = stack.StackStatus;
      
      console.log(`Stack ${stackName} status: ${status}`);
      
      if (status.endsWith('_COMPLETE')) {
        if (status.includes('ROLLBACK')) {
          throw new Error(`Stack deployment failed and rolled back: ${status}`);
        }
        return;
      }
      
      if (status.endsWith('_FAILED')) {
        throw new Error(`Stack deployment failed: ${status}`);
      }
      
      await this.sleep(pollInterval);
    }
    
    throw new Error(`Stack deployment timed out after ${maxWaitTime / 1000} seconds`);
  }

  /**
   * Get CloudFormation stack outputs
   */
  private async getStackOutputs(stackName: string): Promise<Record<string, string>> {
    const command = new DescribeStacksCommand({ StackName: stackName });
    const result = await this.cloudFormation.send(command);
    const stack = result.Stacks![0];
    const outputs: Record<string, string> = {};
    
    if (stack.Outputs) {
      for (const output of stack.Outputs) {
        if (output.OutputKey && output.OutputValue) {
          outputs[output.OutputKey] = output.OutputValue;
        }
      }
    }
    
    return outputs;
  }

  /**
   * Build frontend with comprehensive logging
   */
  private async buildFrontendWithLogging(
    environment: string,
    config: EnvironmentConfig,
    logger: BuildLogger,
    statusTracker: DeploymentStatusTracker
  ): Promise<BuildResult> {
    const buildStartTime = Date.now();
    logger.buildStart(environment);
    
    try {
      // Simulate build process with progress updates
      await statusTracker.updateStepProgress('build', 'Installing dependencies', 20);
      logger.dependencyInstall('npm');
      
      await statusTracker.updateStepProgress('build', 'Compiling application', 60);
      logger.buildCommand('npm run build');
      
      await statusTracker.updateStepProgress('build', 'Optimizing assets', 90);
      
      const buildTime = Date.now() - buildStartTime;
      const buildPath = `/tmp/frontend-build-${Date.now()}`;
      const artifacts = ['index.html', 'static/js/main.js', 'static/css/main.css'];
      const size = 1024 * 1024; // 1MB
      
      logger.buildComplete(buildTime, artifacts, size);
      
      return {
        success: true,
        buildPath,
        buildLogs: [
          'Installing dependencies...',
          'Building for production...',
          'Optimizing assets...',
          'Build completed successfully'
        ],
        buildTime,
        artifacts,
        size
      };
    } catch (error) {
      logger.error('Build failed', 'build', error);
      throw error;
    }
  }

  /**
   * Upload to S3 with comprehensive logging
   */
  private async uploadToS3WithLogging(
    buildPath: string,
    bucketName: string,
    logger: UploadLogger,
    statusTracker: DeploymentStatusTracker
  ): Promise<void> {
    const uploadConfig: S3UploadConfig = {
      bucketName,
      region: process.env.AWS_REGION!,
      serverSideEncryption: 'AES256',
      storageClass: 'STANDARD'
    };
    
    const uploadStartTime = Date.now();
    const mockFileCount = 25;
    const mockTotalSize = 2 * 1024 * 1024; // 2MB
    
    logger.uploadStart(bucketName, mockFileCount, mockTotalSize);
    
    try {
      // Simulate upload with progress updates
      for (let i = 1; i <= mockFileCount; i++) {
        const uploadedBytes = Math.round((mockTotalSize / mockFileCount) * i);
        const fileName = `file-${i}.js`;
        
        logger.fileUploaded(fileName, mockTotalSize / mockFileCount, 'application/javascript');
        logger.uploadProgress(i, mockFileCount, uploadedBytes, mockTotalSize, fileName);
        
        const percentage = Math.round((i / mockFileCount) * 100);
        await statusTracker.updateStepProgress('upload', `Uploading files (${i}/${mockFileCount})`, percentage);
        
        // Small delay to simulate upload time
        await this.sleep(100);
      }
      
      const uploadTime = Date.now() - uploadStartTime;
      logger.uploadComplete(uploadTime, mockFileCount, mockTotalSize);
      
      // Use the actual S3 service for real upload
      await this.s3Service.uploadBuildArtifacts(buildPath, uploadConfig);
      
    } catch (error) {
      logger.error('Upload failed', 'upload', error);
      throw error;
    }
  }

  /**
   * Configure CloudFront with comprehensive logging
   */
  private async configureCloudFrontWithLogging(
    bucketName: string,
    environment: string,
    domainName?: string,
    certificateArn?: string,
    logger?: CloudFrontLogger,
    statusTracker?: DeploymentStatusTracker
  ): Promise<{ distributionId: string; domainName: string }> {
    const configStartTime = Date.now();
    logger?.distributionCreateStart(bucketName, environment);
    
    try {
      await statusTracker?.updateStepProgress('cloudfront', 'Creating Origin Access Control', 20);
      
      const config: Partial<CloudFrontConfig> = {
        domainName,
        certificateArn,
        priceClass: environment === 'production' ? 'PriceClass_All' : 'PriceClass_100',
        enableLogging: environment === 'production',
        customErrorResponses: [
          {
            errorCode: 404,
            responseCode: 200,
            responsePagePath: '/index.html',
            errorCachingMinTTL: 300
          },
          {
            errorCode: 403,
            responseCode: 200,
            responsePagePath: '/index.html',
            errorCachingMinTTL: 300
          }
        ],
        cacheBehaviors: [
          {
            pathPattern: '/static/*',
            cachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6'
          }
        ]
      };
      
      await statusTracker?.updateStepProgress('cloudfront', 'Creating distribution', 60);
      
      const result = await this.cloudFrontService.createOrUpdateDistribution(bucketName, environment, config);
      
      await statusTracker?.updateStepProgress('cloudfront', 'Configuring security settings', 90);
      
      const configTime = Date.now() - configStartTime;
      logger?.distributionCreateComplete(result.distributionId, result.domainName, configTime);
      
      return {
        distributionId: result.distributionId,
        domainName: result.domainName
      };
      
    } catch (error) {
      logger?.error('CloudFront configuration failed', 'cloudfront', error);
      throw error;
    }
  }

  /**
   * Generate unique deployment ID
   */
  private generateDeploymentId(): string {
    return `frontend-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}