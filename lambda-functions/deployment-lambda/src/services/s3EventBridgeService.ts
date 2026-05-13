import { S3Client, PutBucketNotificationConfigurationCommand, GetBucketNotificationConfigurationCommand } from '@aws-sdk/client-s3';

/**
 * Service to enable EventBridge notifications on S3 buckets
 */
export class S3EventBridgeService {
  private s3: S3Client;

  constructor(region?: string) {
    this.s3 = new S3Client({
      region: region || process.env.AWS_REGION,
    });
  }

  /**
   * Enable EventBridge notifications on an S3 bucket
   * This is required for EventBridge to receive S3 events
   */
  async enableEventBridgeNotifications(bucketName: string): Promise<void> {
    console.log(`🔔 Enabling EventBridge notifications on bucket: ${bucketName}`);

    try {
      // Get current notification configuration
      const currentConfig = await this.s3.send(
        new GetBucketNotificationConfigurationCommand({ Bucket: bucketName })
      );

      // Check if EventBridge is already enabled
      if (currentConfig.EventBridgeConfiguration) {
        console.log(`✅ EventBridge notifications already enabled on bucket: ${bucketName}`);
        return;
      }

      // Enable EventBridge while preserving existing configurations
      await this.s3.send(
        new PutBucketNotificationConfigurationCommand({
          Bucket: bucketName,
          NotificationConfiguration: {
            // Preserve existing configurations
            TopicConfigurations: currentConfig.TopicConfigurations,
            QueueConfigurations: currentConfig.QueueConfigurations,
            LambdaFunctionConfigurations: currentConfig.LambdaFunctionConfigurations,
            // Enable EventBridge
            EventBridgeConfiguration: {},
          },
        })
      );

      console.log(`✅ EventBridge notifications enabled on bucket: ${bucketName}`);
    } catch (error) {
      console.error(`❌ Failed to enable EventBridge notifications on bucket ${bucketName}:`, error);
      throw new Error(
        `Failed to enable EventBridge notifications on bucket ${bucketName}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }. Make sure the bucket exists and you have permission to modify its notification configuration.`
      );
    }
  }

  /**
   * Check if EventBridge notifications are enabled on a bucket
   */
  async isEventBridgeEnabled(bucketName: string): Promise<boolean> {
    try {
      const config = await this.s3.send(
        new GetBucketNotificationConfigurationCommand({ Bucket: bucketName })
      );
      return !!config.EventBridgeConfiguration;
    } catch (error) {
      console.error(`Failed to check EventBridge status for bucket ${bucketName}:`, error);
      return false;
    }
  }
}
