import { WebSocketService } from './websocketService';
import { RealTimeDeploymentMonitor } from './realTimeDeploymentMonitor';
import { FrontendDeploymentStatus, FrontendDeploymentLog } from '../types/frontend';
import { DeploymentLogger } from '../utils/deploymentLogger';
import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

/**
 * Deployment Notification Service
 * Manages all deployment notifications including WebSocket, email, and SNS notifications
 */
export class DeploymentNotificationService {
  private websocketService: WebSocketService;
  private sns: SNSClient;
  private ses: SESClient;
  private logger: DeploymentLogger;
  private region: string;

  constructor(
    websocketEndpoint: string,
    region: string = process.env.AWS_REGION!
  ) {
    this.region = region;
    this.websocketService = new WebSocketService(websocketEndpoint, region);
    this.sns = new SNSClient({ region });
    this.ses = new SESClient({ region });
    this.logger = new DeploymentLogger('notification-service', 'notifications');
  }

  /**
   * Send deployment started notification
   */
  async notifyDeploymentStarted(
    deploymentId: string,
    userId: string,
    environment: string,
    userEmail?: string
  ): Promise<void> {
    const notification = {
      type: 'deployment-started',
      deploymentId,
      environment,
      timestamp: new Date().toISOString(),
      message: `Frontend deployment started for ${environment} environment`
    };

    // Send WebSocket notification
    await this.websocketService.broadcastDeploymentUpdate(
      deploymentId,
      userId,
      {
        deploymentId,
        environment,
        status: 'pending',
        progress: {
          currentStep: 'Deployment started',
          completedSteps: [],
          totalSteps: 7,
          percentage: 0
        },
        logs: [],
        createdAt: notification.timestamp,
        updatedAt: notification.timestamp
      }
    );

    // Send email notification if email is provided
    if (userEmail) {
      await this.sendEmailNotification(
        userEmail,
        'Deployment Started',
        this.generateDeploymentStartedEmail(deploymentId, environment),
        notification
      );
    }

    this.logger.info('Deployment started notification sent', 'start', {
      deploymentId,
      userId,
      environment,
      userEmail: userEmail ? '[REDACTED]' : undefined
    });
  }

  /**
   * Send deployment completed notification
   */
  async notifyDeploymentCompleted(
    deploymentId: string,
    userId: string,
    result: any,
    userEmail?: string
  ): Promise<void> {
    const notification = {
      type: 'deployment-completed',
      deploymentId,
      result: this.sanitizeResult(result),
      timestamp: new Date().toISOString(),
      message: 'Frontend deployment completed successfully'
    };

    // Send WebSocket notification
    await this.websocketService.broadcastPhaseChange(
      deploymentId,
      userId,
      'completed',
      {
        description: 'Deployment completed successfully',
        result: notification.result,
        completedAt: notification.timestamp
      }
    );

    // Send email notification if email is provided
    if (userEmail) {
      await this.sendEmailNotification(
        userEmail,
        'Deployment Completed Successfully',
        this.generateDeploymentCompletedEmail(deploymentId, result),
        notification
      );
    }

    // Send SNS notification for monitoring
    await this.sendSNSNotification(
      'deployment-completed',
      `Deployment ${deploymentId} completed successfully`,
      notification
    );

    this.logger.info('Deployment completed notification sent', 'complete', {
      deploymentId,
      userId,
      result: notification.result,
      userEmail: userEmail ? '[REDACTED]' : undefined
    });
  }

  /**
   * Send deployment failed notification
   */
  async notifyDeploymentFailed(
    deploymentId: string,
    userId: string,
    error: Error,
    phase?: string,
    userEmail?: string
  ): Promise<void> {
    const notification = {
      type: 'deployment-failed',
      deploymentId,
      error: {
        name: error.name,
        message: error.message,
        phase
      },
      timestamp: new Date().toISOString(),
      message: `Frontend deployment failed: ${error.message}`
    };

    // Send WebSocket notification
    await this.websocketService.broadcastPhaseChange(
      deploymentId,
      userId,
      'failed',
      {
        description: `Deployment failed: ${error.message}`,
        failedPhase: phase,
        error: notification.error,
        failedAt: notification.timestamp
      }
    );

    // Send email notification if email is provided
    if (userEmail) {
      await this.sendEmailNotification(
        userEmail,
        'Deployment Failed',
        this.generateDeploymentFailedEmail(deploymentId, error, phase),
        notification
      );
    }

    // Send SNS notification for monitoring and alerting
    await this.sendSNSNotification(
      'deployment-failed',
      `Deployment ${deploymentId} failed: ${error.message}`,
      notification
    );

    this.logger.error('Deployment failed notification sent', 'failed', error, {
      deploymentId,
      userId,
      phase,
      userEmail: userEmail ? '[REDACTED]' : undefined
    });
  }

  /**
   * Send deployment progress notification
   */
  async notifyDeploymentProgress(
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
    // Send WebSocket notification
    await this.websocketService.broadcastProgressUpdate(
      deploymentId,
      userId,
      progress
    );

    // Log progress for debugging
    this.logger.debug('Deployment progress notification sent', 'progress', {
      deploymentId,
      userId,
      progress
    });
  }

  /**
   * Send deployment phase change notification
   */
  async notifyPhaseChange(
    deploymentId: string,
    userId: string,
    phase: 'configuring' | 'building' | 'uploading' | 'distributing' | 'completed' | 'failed',
    phaseDetails?: any
  ): Promise<void> {
    // Send WebSocket notification
    await this.websocketService.broadcastPhaseChange(
      deploymentId,
      userId,
      phase,
      phaseDetails
    );

    this.logger.info(`Deployment phase changed to: ${phase}`, 'phase-change', {
      deploymentId,
      userId,
      phase,
      phaseDetails: this.sanitizeResult(phaseDetails)
    });
  }

  /**
   * Send deployment log notification
   */
  async notifyDeploymentLog(
    deploymentId: string,
    userId: string,
    log: FrontendDeploymentLog
  ): Promise<void> {
    // Send WebSocket notification
    await this.websocketService.broadcastDeploymentLog(
      deploymentId,
      userId,
      log
    );

    // Log high-priority messages
    if (log.level === 'error' || log.level === 'warn') {
      this.logger.info(`Deployment log notification: ${log.message}`, 'log', {
        deploymentId,
        userId,
        logLevel: log.level,
        logStep: log.step
      });
    }
  }

  /**
   * Send performance metrics notification
   */
  async notifyPerformanceMetrics(
    deploymentId: string,
    userId: string,
    metrics: {
      buildTime?: number;
      uploadTime?: number;
      distributionTime?: number;
      totalSize?: number;
      fileCount?: number;
      averageFileSize?: number;
    }
  ): Promise<void> {
    const notification = {
      type: 'performance-metrics',
      deploymentId,
      metrics,
      timestamp: new Date().toISOString()
    };

    // Send WebSocket notification
    await this.websocketService.broadcastDeploymentLog(
      deploymentId,
      userId,
      {
        timestamp: notification.timestamp,
        level: 'info',
        message: 'Performance metrics recorded',
        step: 'metrics',
        details: metrics
      }
    );

    this.logger.info('Performance metrics notification sent', 'metrics', {
      deploymentId,
      userId,
      metrics
    });
  }

  /**
   * Send troubleshooting notification
   */
  async notifyTroubleshooting(
    deploymentId: string,
    userId: string,
    issue: string,
    suggestions: string[],
    phase?: string,
    documentation?: string[]
  ): Promise<void> {
    const troubleshootingInfo = {
      issue,
      suggestions,
      phase,
      documentation,
      timestamp: new Date().toISOString()
    };

    // Send WebSocket notification
    await this.websocketService.broadcastDeploymentLog(
      deploymentId,
      userId,
      {
        timestamp: troubleshootingInfo.timestamp,
        level: 'warn',
        message: `Troubleshooting info: ${issue}`,
        step: phase || 'troubleshooting',
        details: troubleshootingInfo
      }
    );

    this.logger.warn('Troubleshooting notification sent', 'troubleshooting', {
      deploymentId,
      userId,
      issue,
      suggestions,
      phase
    });
  }

  /**
   * Send rollback started notification
   */
  async notifyRollbackStarted(
    rollbackId: string,
    userId: string,
    environment: string,
    originalDeploymentId: string,
    targetDeploymentId: string,
    userEmail?: string
  ): Promise<void> {
    const notification = {
      type: 'rollback-started',
      rollbackId,
      originalDeploymentId,
      targetDeploymentId,
      environment,
      timestamp: new Date().toISOString(),
      message: `Rollback started from ${originalDeploymentId} to ${targetDeploymentId}`
    };

    // Send WebSocket notification
    await this.websocketService.broadcastDeploymentUpdate(
      rollbackId,
      userId,
      {
        deploymentId: rollbackId,
        environment,
        status: 'pending',
        progress: {
          currentStep: 'Rollback started',
          completedSteps: [],
          totalSteps: 5,
          percentage: 0
        },
        logs: [],
        createdAt: notification.timestamp,
        updatedAt: notification.timestamp
      }
    );

    // Send email notification if email is provided
    if (userEmail) {
      await this.sendEmailNotification(
        userEmail,
        'Deployment Rollback Started',
        this.generateRollbackStartedEmail(rollbackId, originalDeploymentId, targetDeploymentId, environment),
        notification
      );
    }

    this.logger.info('Rollback started notification sent', 'rollback-start', {
      rollbackId,
      userId,
      environment,
      originalDeploymentId,
      targetDeploymentId,
      userEmail: userEmail ? '[REDACTED]' : undefined
    });
  }

  /**
   * Send rollback completed notification
   */
  async notifyRollbackCompleted(
    rollbackId: string,
    userId: string,
    environment: string,
    originalDeploymentId: string,
    targetDeploymentId: string,
    userEmail?: string
  ): Promise<void> {
    const notification = {
      type: 'rollback-completed',
      rollbackId,
      originalDeploymentId,
      targetDeploymentId,
      environment,
      timestamp: new Date().toISOString(),
      message: `Rollback completed successfully from ${originalDeploymentId} to ${targetDeploymentId}`
    };

    // Send WebSocket notification
    await this.websocketService.broadcastPhaseChange(
      rollbackId,
      userId,
      'completed',
      {
        description: 'Rollback completed successfully',
        originalDeploymentId,
        targetDeploymentId,
        completedAt: notification.timestamp
      }
    );

    // Send email notification if email is provided
    if (userEmail) {
      await this.sendEmailNotification(
        userEmail,
        'Deployment Rollback Completed',
        this.generateRollbackCompletedEmail(rollbackId, originalDeploymentId, targetDeploymentId, environment),
        notification
      );
    }

    // Send SNS notification for monitoring
    await this.sendSNSNotification(
      'rollback-completed',
      `Rollback ${rollbackId} completed successfully`,
      notification
    );

    this.logger.info('Rollback completed notification sent', 'rollback-complete', {
      rollbackId,
      userId,
      environment,
      originalDeploymentId,
      targetDeploymentId,
      userEmail: userEmail ? '[REDACTED]' : undefined
    });
  }

  /**
   * Send rollback failed notification
   */
  async notifyRollbackFailed(
    rollbackId: string,
    userId: string,
    originalDeploymentId: string,
    error: Error,
    phase?: string,
    userEmail?: string
  ): Promise<void> {
    const notification = {
      type: 'rollback-failed',
      rollbackId,
      originalDeploymentId,
      error: {
        name: error.name,
        message: error.message,
        phase
      },
      timestamp: new Date().toISOString(),
      message: `Rollback failed: ${error.message}`
    };

    // Send WebSocket notification
    await this.websocketService.broadcastPhaseChange(
      rollbackId,
      userId,
      'failed',
      {
        description: `Rollback failed: ${error.message}`,
        failedPhase: phase,
        error: notification.error,
        failedAt: notification.timestamp
      }
    );

    // Send email notification if email is provided
    if (userEmail) {
      await this.sendEmailNotification(
        userEmail,
        'Deployment Rollback Failed',
        this.generateRollbackFailedEmail(rollbackId, originalDeploymentId, error, phase),
        notification
      );
    }

    // Send SNS notification for monitoring and alerting
    await this.sendSNSNotification(
      'rollback-failed',
      `Rollback ${rollbackId} failed: ${error.message}`,
      notification
    );

    this.logger.error('Rollback failed notification sent', 'rollback-failed', error, {
      rollbackId,
      userId,
      originalDeploymentId,
      phase,
      userEmail: userEmail ? '[REDACTED]' : undefined
    });
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(
    email: string,
    subject: string,
    htmlBody: string,
    notification: any
  ): Promise<void> {
    try {
      const params = {
        Source: process.env.FROM_EMAIL || 'noreply@workflowbuilder.com',
        Destination: {
          ToAddresses: [email]
        },
        Message: {
          Subject: {
            Data: subject,
            Charset: 'UTF-8'
          },
          Body: {
            Html: {
              Data: htmlBody,
              Charset: 'UTF-8'
            },
            Text: {
              Data: this.htmlToText(htmlBody),
              Charset: 'UTF-8'
            }
          }
        }
      };

      const command = new SendEmailCommand(params);
      await this.ses.send(command);
      
      this.logger.info('Email notification sent', 'email', {
        email: '[REDACTED]',
        subject,
        notificationType: notification.type
      });
    } catch (error) {
      this.logger.error('Failed to send email notification', 'email', error as Error, {
        email: '[REDACTED]',
        subject,
        notificationType: notification.type
      });
    }
  }

  /**
   * Send SNS notification
   */
  private async sendSNSNotification(
    type: string,
    message: string,
    notification: any
  ): Promise<void> {
    try {
      const topicArn = process.env.SNS_TOPIC_ARN;
      
      if (!topicArn) {
        return; // SNS notifications are optional
      }

      const params = {
        TopicArn: topicArn,
        Subject: `Deployment Notification: ${type}`,
        Message: JSON.stringify({
          type,
          message,
          notification,
          timestamp: new Date().toISOString()
        }, null, 2)
      };

      const command = new PublishCommand(params);
      await this.sns.send(command);
      
      this.logger.info('SNS notification sent', 'sns', {
        type,
        message,
        topicArn
      });
    } catch (error) {
      this.logger.error('Failed to send SNS notification', 'sns', error as Error, {
        type,
        message
      });
    }
  }

  /**
   * Generate deployment started email
   */
  private generateDeploymentStartedEmail(deploymentId: string, environment: string): string {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2196F3;">🚀 Deployment Started</h2>
            <p>Your frontend deployment has been initiated.</p>
            
            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <strong>Deployment Details:</strong><br>
              Deployment ID: <code>${deploymentId}</code><br>
              Environment: <strong>${environment}</strong><br>
              Started: ${new Date().toLocaleString()}
            </div>
            
            <p>You will receive another notification when the deployment completes.</p>
            
            <p style="color: #666; font-size: 12px;">
              This is an automated message from the Workflow Builder deployment system.
            </p>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Generate deployment completed email
   */
  private generateDeploymentCompletedEmail(deploymentId: string, result: any): string {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #4CAF50;">✅ Deployment Completed Successfully</h2>
            <p>Your frontend deployment has been completed successfully!</p>
            
            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <strong>Deployment Details:</strong><br>
              Deployment ID: <code>${deploymentId}</code><br>
              Environment: <strong>${result.environment}</strong><br>
              Completed: ${new Date().toLocaleString()}
            </div>
            
            ${result.cloudFrontUrl ? `
              <div style="background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <strong>🌐 Your application is now live:</strong><br>
                <a href="${result.cloudFrontUrl}" style="color: #2196F3; text-decoration: none;">
                  ${result.cloudFrontUrl}
                </a>
              </div>
            ` : ''}
            
            <p style="color: #666; font-size: 12px;">
              This is an automated message from the Workflow Builder deployment system.
            </p>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Generate deployment failed email
   */
  private generateDeploymentFailedEmail(deploymentId: string, error: Error, phase?: string): string {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #f44336;">❌ Deployment Failed</h2>
            <p>Unfortunately, your frontend deployment has failed.</p>
            
            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <strong>Deployment Details:</strong><br>
              Deployment ID: <code>${deploymentId}</code><br>
              ${phase ? `Failed Phase: <strong>${phase}</strong><br>` : ''}
              Failed: ${new Date().toLocaleString()}
            </div>
            
            <div style="background-color: #ffebee; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <strong>Error Details:</strong><br>
              ${error.message}
            </div>
            
            <p>Please check the deployment logs for more details and try again.</p>
            
            <p style="color: #666; font-size: 12px;">
              This is an automated message from the Workflow Builder deployment system.
            </p>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Generate rollback started email
   */
  private generateRollbackStartedEmail(
    rollbackId: string, 
    originalDeploymentId: string, 
    targetDeploymentId: string, 
    environment: string
  ): string {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #FF9800;">🔄 Deployment Rollback Started</h2>
            <p>A rollback of your frontend deployment has been initiated.</p>
            
            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <strong>Rollback Details:</strong><br>
              Rollback ID: <code>${rollbackId}</code><br>
              Environment: <strong>${environment}</strong><br>
              Rolling back from: <code>${originalDeploymentId}</code><br>
              Rolling back to: <code>${targetDeploymentId}</code><br>
              Started: ${new Date().toLocaleString()}
            </div>
            
            <div style="background-color: #fff3e0; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <strong>⚠️ Important:</strong><br>
              Your application will be temporarily unavailable during the rollback process.
              You will receive another notification when the rollback completes.
            </div>
            
            <p style="color: #666; font-size: 12px;">
              This is an automated message from the Workflow Builder deployment system.
            </p>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Generate rollback completed email
   */
  private generateRollbackCompletedEmail(
    rollbackId: string, 
    originalDeploymentId: string, 
    targetDeploymentId: string, 
    environment: string
  ): string {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #4CAF50;">✅ Deployment Rollback Completed</h2>
            <p>Your frontend deployment rollback has been completed successfully!</p>
            
            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <strong>Rollback Details:</strong><br>
              Rollback ID: <code>${rollbackId}</code><br>
              Environment: <strong>${environment}</strong><br>
              Rolled back from: <code>${originalDeploymentId}</code><br>
              Rolled back to: <code>${targetDeploymentId}</code><br>
              Completed: ${new Date().toLocaleString()}
            </div>
            
            <div style="background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <strong>🎉 Success:</strong><br>
              Your application has been successfully restored to the previous version.
              All changes from the problematic deployment have been reverted.
            </div>
            
            <p style="color: #666; font-size: 12px;">
              This is an automated message from the Workflow Builder deployment system.
            </p>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Generate rollback failed email
   */
  private generateRollbackFailedEmail(
    rollbackId: string, 
    originalDeploymentId: string, 
    error: Error, 
    phase?: string
  ): string {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #f44336;">❌ Deployment Rollback Failed</h2>
            <p>Unfortunately, the rollback of your frontend deployment has failed.</p>
            
            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <strong>Rollback Details:</strong><br>
              Rollback ID: <code>${rollbackId}</code><br>
              Original Deployment: <code>${originalDeploymentId}</code><br>
              ${phase ? `Failed Phase: <strong>${phase}</strong><br>` : ''}
              Failed: ${new Date().toLocaleString()}
            </div>
            
            <div style="background-color: #ffebee; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <strong>Error Details:</strong><br>
              ${error.message}
            </div>
            
            <div style="background-color: #fff3e0; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <strong>⚠️ Next Steps:</strong><br>
              • Check the rollback logs for detailed error information<br>
              • Verify that the target deployment is still available<br>
              • Contact support if the issue persists<br>
              • Consider manual intervention if automatic rollback continues to fail
            </div>
            
            <p style="color: #666; font-size: 12px;">
              This is an automated message from the Workflow Builder deployment system.
            </p>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Convert HTML to plain text
   */
  private htmlToText(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
  }

  /**
   * Sanitize result object for notifications
   */
  private sanitizeResult(result: any): any {
    if (!result || typeof result !== 'object') {
      return result;
    }

    const sanitized = { ...result };
    
    // Remove sensitive fields
    const sensitiveFields = [
      'password', 'secret', 'key', 'token', 'credential',
      'accessKey', 'secretKey', 'privateKey', 'certificate'
    ];

    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }

    // Recursively sanitize nested objects
    for (const [key, value] of Object.entries(sanitized)) {
      if (value && typeof value === 'object') {
        sanitized[key] = this.sanitizeResult(value);
      }
    }

    return sanitized;
  }
}