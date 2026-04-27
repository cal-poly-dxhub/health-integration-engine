import { S3UploadService } from './s3UploadService';
import { CloudFrontService } from './cloudFrontService';
import { FrontendDeploymentDatabase, DeploymentHistoryTracker } from '../utils/frontendDeploymentDatabase';
import { DeploymentNotificationService } from './deploymentNotificationService';
import { DeploymentStatusTracker } from '../utils/deploymentStatusTracker';
import { DeploymentLoggerFactory } from '../utils/deploymentLogger';
import { 
  FrontendDeploymentStatus, 
  FrontendDeploymentResult,
  FrontendDeploymentLog,
  S3UploadConfig
} from '../types/frontend';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client, ListObjectsV2Command, CopyObjectCommand, ListObjectsV2CommandInput, CopyObjectCommandInput } from '@aws-sdk/client-s3';

/**
 * Deployment Rollback Service
 * Handles rollback of frontend deployments with comprehensive safety checks and status tracking
 */
export class DeploymentRollbackService {
  private s3Service: S3UploadService;
  private cloudFrontService: CloudFrontService;
  private database: FrontendDeploymentDatabase;
  private historyTracker: DeploymentHistoryTracker;
  private notificationService: DeploymentNotificationService;
  private s3: S3Client;
  private region: string;

  constructor(region?: string, websocketEndpoint?: string) {
    this.region = region || process.env.AWS_REGION!;
    const wsEndpoint = websocketEndpoint || process.env.WEBSOCKET_ENDPOINT || '';
    
    this.s3Service = new S3UploadService(this.region);
    this.cloudFrontService = new CloudFrontService(this.region);
    this.database = new FrontendDeploymentDatabase(this.region);
    this.historyTracker = new DeploymentHistoryTracker(this.region);
    this.notificationService = new DeploymentNotificationService(wsEndpoint, this.region);
    this.s3 = new S3Client({ region: this.region });
  }

  /**
   * Rollback frontend deployment to previous successful version
   */
  async rollbackDeployment(
    deploymentId: string,
    userId: string,
    userEmail?: string
  ): Promise<FrontendDeploymentResult> {
    const rollbackId = this.generateRollbackId(deploymentId);
    const startTime = new Date().toISOString();
    
    console.log(`Starting rollback for deployment: ${deploymentId} -> ${rollbackId}`);
    
    // Initialize status tracking and logging
    const statusTracker = new DeploymentStatusTracker(rollbackId);
    const logger = DeploymentLoggerFactory.createErrorLogger(rollbackId);
    
    try {
      // Step 1: Validate rollback request and get current deployment
      await statusTracker.initialize('rollback', userId, 5);
      await statusTracker.startStep('validation', 'Validating rollback request', 0, 5);
      
      const currentDeployment = await this.validateRollbackRequest(deploymentId, userId);
      const environment = currentDeployment.environment;
      
      await statusTracker.completeStep('validation', 'Rollback request validated', 0, 5, { currentDeployment });
      
      // Step 2: Find previous successful deployment
      await statusTracker.startStep('history', 'Finding previous successful deployment', 1, 5);
      
      const previousDeployment = await this.findPreviousSuccessfulDeployment(
        userId, 
        environment, 
        deploymentId
      );
      
      if (!previousDeployment) {
        throw new Error('No previous successful deployment found for rollback');
      }
      
      await statusTracker.completeStep('history', 'Previous deployment found', 1, 5, { previousDeployment });
      
      // Step 3: Create rollback deployment record
      await statusTracker.startStep('record', 'Creating rollback deployment record', 2, 5);
      
      const rollbackDeployment = await this.createRollbackDeploymentRecord(
        rollbackId,
        userId,
        environment,
        currentDeployment,
        previousDeployment,
        startTime
      );
      
      await statusTracker.completeStep('record', 'Rollback record created', 2, 5, { rollbackDeployment });
      
      // Step 4: Restore S3 content from previous deployment
      await statusTracker.startStep('restore', 'Restoring S3 content from previous deployment', 3, 5);
      
      await this.restorePreviousS3Content(
        currentDeployment.s3BucketName!,
        previousDeployment,
        rollbackId
      );
      
      await statusTracker.completeStep('restore', 'S3 content restored', 3, 5);
      
      // Step 5: Invalidate CloudFront cache
      await statusTracker.startStep('cache', 'Invalidating CloudFront cache', 4, 5);
      
      if (currentDeployment.distributionId) {
        await this.cloudFrontService.invalidateCache(currentDeployment.distributionId);
      }
      
      await statusTracker.completeStep('cache', 'Cache invalidation completed', 4, 5);
      
      // Complete rollback
      const completedAt = new Date().toISOString();
      const result: FrontendDeploymentResult = {
        deploymentId: rollbackId,
        environment,
        status: 'completed',
        s3BucketName: currentDeployment.s3BucketName!,
        cloudFrontUrl: currentDeployment.cloudFrontUrl,
        distributionId: currentDeployment.distributionId,
        customDomainUrl: currentDeployment.customDomainUrl,
        buildLogs: [`Rollback from ${deploymentId} to ${previousDeployment.deploymentId}`],
        deploymentLogs: [
          `Rollback initiated for deployment ${deploymentId}`,
          `Restored content from deployment ${previousDeployment.deploymentId}`,
          `Cache invalidated for distribution ${currentDeployment.distributionId}`,
          'Rollback completed successfully'
        ],
        createdAt: startTime,
        completedAt
      };
      
      await statusTracker.completeDeployment(result);
      await this.historyTracker.recordDeploymentCompletion(rollbackId, true, result);
      
      // Send rollback completion notification
      if (userEmail) {
        await this.notificationService.notifyRollbackCompleted(
          rollbackId,
          userId,
          environment,
          deploymentId,
          previousDeployment.deploymentId,
          userEmail
        );
      }
      
      console.log(`Rollback completed successfully: ${rollbackId}`);
      return result;
      
    } catch (error) {
      console.error(`Rollback failed: ${rollbackId}`, error);
      
      // Record rollback failure
      await statusTracker.failDeployment(error);
      await this.historyTracker.recordDeploymentError(rollbackId, 'rollback', error, { 
        originalDeploymentId: deploymentId 
      });
      
      const errorResult: FrontendDeploymentResult = {
        deploymentId: rollbackId,
        environment: 'unknown',
        status: 'failed',
        s3BucketName: '',
        buildLogs: [],
        deploymentLogs: [`Rollback failed: ${error.message}`],
        createdAt: startTime,
        error: {
          code: 'ROLLBACK_FAILED',
          message: error.message,
          details: error.stack
        }
      };
      
      await this.historyTracker.recordDeploymentCompletion(rollbackId, false, errorResult);
      
      throw error;
    }
  }

  /**
   * Get rollback status
   */
  async getRollbackStatus(rollbackId: string): Promise<FrontendDeploymentStatus> {
    return await this.database.getFrontendDeploymentStatus(rollbackId);
  }

  /**
   * List available rollback targets for a deployment
   */
  async getAvailableRollbackTargets(
    userId: string, 
    environment: string, 
    currentDeploymentId: string
  ): Promise<FrontendDeploymentStatus[]> {
    const history = await this.historyTracker.getDeploymentHistory(userId, environment);
    
    // Filter to only successful deployments that are not the current one
    return history.filter(deployment => 
      deployment.deploymentId !== currentDeploymentId &&
      deployment.status === 'completed' &&
      deployment.s3BucketName &&
      deployment.distributionId &&
      deployment.completedAt
    ).slice(0, 10); // Return last 10 successful deployments
  }

  /**
   * Validate rollback request
   */
  private async validateRollbackRequest(
    deploymentId: string, 
    userId: string
  ): Promise<FrontendDeploymentStatus> {
    const deployment = await this.database.getFrontendDeploymentStatus(deploymentId);
    
    // Verify ownership
    const deploymentUserId = this.extractUserIdFromDeploymentId(deploymentId);
    if (deploymentUserId !== userId) {
      throw new Error('Unauthorized: Cannot rollback deployment owned by another user');
    }
    
    // Verify deployment is in a rollback-eligible state
    if (deployment.status !== 'completed') {
      throw new Error(`Cannot rollback deployment in status: ${deployment.status}`);
    }
    
    // Verify required resources exist
    if (!deployment.s3BucketName) {
      throw new Error('Cannot rollback: S3 bucket information missing');
    }
    
    if (!deployment.distributionId) {
      throw new Error('Cannot rollback: CloudFront distribution information missing');
    }
    
    return deployment;
  }

  /**
   * Find previous successful deployment for rollback
   */
  private async findPreviousSuccessfulDeployment(
    userId: string,
    environment: string,
    currentDeploymentId: string
  ): Promise<FrontendDeploymentStatus | null> {
    return await this.historyTracker.findPreviousSuccessfulDeployment(
      userId,
      environment,
      currentDeploymentId
    );
  }

  /**
   * Create rollback deployment record
   */
  private async createRollbackDeploymentRecord(
    rollbackId: string,
    userId: string,
    environment: string,
    currentDeployment: FrontendDeploymentStatus,
    previousDeployment: FrontendDeploymentStatus,
    startTime: string
  ): Promise<FrontendDeploymentStatus> {
    const rollbackRecord: FrontendDeploymentStatus = {
      deploymentId: rollbackId,
      environment,
      status: 'pending',
      progress: {
        currentStep: 'Initializing rollback',
        completedSteps: [],
        totalSteps: 5,
        percentage: 0
      },
      s3BucketName: currentDeployment.s3BucketName,
      cloudFrontUrl: currentDeployment.cloudFrontUrl,
      distributionId: currentDeployment.distributionId,
      customDomainUrl: currentDeployment.customDomainUrl,
      logs: [{
        timestamp: startTime,
        level: 'info',
        message: `Rollback initiated from ${currentDeployment.deploymentId} to ${previousDeployment.deploymentId}`,
        step: 'initialization',
        details: {
          rollbackId,
          originalDeploymentId: currentDeployment.deploymentId,
          targetDeploymentId: previousDeployment.deploymentId,
          environment
        }
      }],
      createdAt: startTime,
      updatedAt: startTime
    };
    
    await this.database.saveFrontendDeploymentStatus(rollbackRecord);
    return rollbackRecord;
  }

  /**
   * Restore S3 content from previous deployment
   */
  private async restorePreviousS3Content(
    bucketName: string,
    previousDeployment: FrontendDeploymentStatus,
    rollbackId: string
  ): Promise<void> {
    console.log(`Restoring S3 content for rollback: ${rollbackId}`);
    
    try {
      // Step 1: Create backup of current deployment before rollback
      const backupPrefix = `rollback-backups/${rollbackId}`;
      await this.createDeploymentBackup(bucketName, backupPrefix);
      
      // Step 2: Clear current bucket contents
      await this.s3Service.clearBucket(bucketName);
      
      // Step 3: Restore from previous deployment backup
      const previousBackupPrefix = `deployment-backups/${previousDeployment.deploymentId}`;
      await this.restoreFromBackup(bucketName, previousBackupPrefix, rollbackId);
      
      // Record the restoration in deployment history
      await this.historyTracker.recordStepCompletion(
        rollbackId,
        'restore',
        `Restored S3 content from deployment ${previousDeployment.deploymentId}`,
        {
          bucketName,
          previousDeploymentId: previousDeployment.deploymentId,
          backupPrefix: previousBackupPrefix,
          rollbackBackupPrefix: backupPrefix,
          restoredAt: new Date().toISOString()
        }
      );
      
    } catch (error) {
      console.error(`Failed to restore S3 content for rollback: ${rollbackId}`, error);
      throw new Error(`S3 content restoration failed: ${error.message}`);
    }
  }

  /**
   * Create backup of current deployment for safety
   */
  private async createDeploymentBackup(bucketName: string, backupPrefix: string): Promise<void> {
    console.log(`Creating deployment backup at s3://${bucketName}/${backupPrefix}`);
    
    try {
      // List all current objects in the bucket
      const listParams: ListObjectsV2CommandInput = {
        Bucket: bucketName
      };
      
      let continuationToken: string | undefined;
      let backedUpCount = 0;
      
      do {
        if (continuationToken) {
          listParams.ContinuationToken = continuationToken;
        }
        
        const listCommand = new ListObjectsV2Command(listParams);
        const listResult = await this.s3.send(listCommand);
        
        if (listResult.Contents && listResult.Contents.length > 0) {
          // Copy each object to backup location
          for (const obj of listResult.Contents) {
            if (obj.Key && !obj.Key.startsWith('deployment-backups/') && !obj.Key.startsWith('rollback-backups/')) {
              const copyParams: CopyObjectCommandInput = {
                Bucket: bucketName,
                CopySource: `${bucketName}/${obj.Key}`,
                Key: `${backupPrefix}/${obj.Key}`,
                MetadataDirective: 'COPY'
              };
              
              const copyCommand = new CopyObjectCommand(copyParams);
              await this.s3.send(copyCommand);
              backedUpCount++;
            }
          }
        }
        
        continuationToken = listResult.NextContinuationToken;
      } while (continuationToken);
      
      console.log(`Created backup of ${backedUpCount} objects at s3://${bucketName}/${backupPrefix}`);
      
    } catch (error) {
      console.error(`Failed to create deployment backup:`, error);
      throw new Error(`Backup creation failed: ${error.message}`);
    }
  }

  /**
   * Restore deployment from backup location
   */
  private async restoreFromBackup(bucketName: string, backupPrefix: string, rollbackId: string): Promise<void> {
    console.log(`Restoring deployment from backup at s3://${bucketName}/${backupPrefix}`);
    
    try {
      // List all objects in the backup location
      const listParams: ListObjectsV2CommandInput = {
        Bucket: bucketName,
        Prefix: backupPrefix
      };
      
      let continuationToken: string | undefined;
      let restoredCount = 0;
      
      do {
        if (continuationToken) {
          listParams.ContinuationToken = continuationToken;
        }
        
        const listCommand = new ListObjectsV2Command(listParams);
        const listResult = await this.s3.send(listCommand);
        
        if (listResult.Contents && listResult.Contents.length > 0) {
          // Copy each backup object back to its original location
          for (const obj of listResult.Contents) {
            if (obj.Key) {
              // Remove the backup prefix to get the original key
              const originalKey = obj.Key.replace(`${backupPrefix}/`, '');
              
              if (originalKey && originalKey !== obj.Key) {
                const copyParams: CopyObjectCommandInput = {
                  Bucket: bucketName,
                  CopySource: `${bucketName}/${obj.Key}`,
                  Key: originalKey,
                  MetadataDirective: 'COPY'
                };
                
                const copyCommand = new CopyObjectCommand(copyParams);
                await this.s3.send(copyCommand);
                restoredCount++;
              }
            }
          }
        }
        
        continuationToken = listResult.NextContinuationToken;
      } while (continuationToken);
      
      if (restoredCount === 0) {
        throw new Error(`No backup found at s3://${bucketName}/${backupPrefix}. Cannot restore previous deployment.`);
      }
      
      console.log(`Restored ${restoredCount} objects from backup s3://${bucketName}/${backupPrefix}`);
      
    } catch (error) {
      console.error(`Failed to restore from backup:`, error);
      throw new Error(`Backup restoration failed: ${error.message}`);
    }
  }

  /**
   * Store deployment version for future rollbacks
   */
  async storeDeploymentVersion(
    deploymentId: string,
    bucketName: string,
    userId: string
  ): Promise<void> {
    console.log(`Storing deployment version for rollback: ${deploymentId}`);
    
    try {
      const backupPrefix = `deployment-backups/${deploymentId}`;
      await this.createDeploymentBackup(bucketName, backupPrefix);
      
      // Record the backup in deployment history
      await this.historyTracker.recordStepCompletion(
        deploymentId,
        'backup',
        `Created deployment backup for future rollbacks`,
        {
          bucketName,
          backupPrefix,
          backedUpAt: new Date().toISOString()
        }
      );
      
      console.log(`Deployment version stored successfully: ${deploymentId}`);
      
    } catch (error) {
      console.error(`Failed to store deployment version: ${deploymentId}`, error);
      // Don't throw error here as this is not critical for deployment success
      console.warn(`Rollback capability may be limited for deployment: ${deploymentId}`);
    }
  }

  /**
   * Clean up old deployment backups to save storage costs
   */
  async cleanupOldBackups(
    bucketName: string,
    userId: string,
    environment: string,
    retainCount: number = 10
  ): Promise<void> {
    console.log(`Cleaning up old deployment backups, retaining ${retainCount} versions`);
    
    try {
      // Get deployment history to identify old backups
      const history = await this.historyTracker.getDeploymentHistory(userId, environment);
      
      // Sort by creation date (newest first) and keep only the specified number
      const sortedDeployments = history
        .filter(d => d.status === 'completed')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      const deploymentsToCleanup = sortedDeployments.slice(retainCount);
      
      for (const deployment of deploymentsToCleanup) {
        const backupPrefix = `deployment-backups/${deployment.deploymentId}`;
        
        try {
          await this.s3Service.clearBucket(bucketName, backupPrefix);
          console.log(`Cleaned up backup for deployment: ${deployment.deploymentId}`);
        } catch (error) {
          console.warn(`Failed to cleanup backup for ${deployment.deploymentId}:`, error);
        }
      }
      
      console.log(`Cleanup completed, removed ${deploymentsToCleanup.length} old backups`);
      
    } catch (error) {
      console.error(`Failed to cleanup old backups:`, error);
      // Don't throw error as this is a maintenance operation
    }
  }

  /**
   * Generate rollback deployment ID
   */
  private generateRollbackId(originalDeploymentId: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `rollback-${originalDeploymentId}-${timestamp}-${random}`;
  }

  /**
   * Extract user ID from deployment ID
   */
  private extractUserIdFromDeploymentId(deploymentId: string): string {
    // This is a simplified implementation
    // In a real system, you'd store the user ID in the deployment record
    return 'demo-user'; // Placeholder - should be extracted from deployment record
  }
}