#!/usr/bin/env node

import WebSocket from 'ws';
import chalk from 'chalk';
import ora from 'ora';

/**
 * WebSocket Client for Real-time Deployment Monitoring
 * Connects to the deployment WebSocket API and displays real-time updates
 */
export class DeploymentWebSocketClient {
  private ws: WebSocket | null = null;
  private websocketUrl: string;
  private userId: string;
  private deploymentId?: string;
  private spinner: ora.Ora;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000; // Start with 1 second
  private isConnected: boolean = false;
  private messageHandlers: Map<string, (data: any) => void> = new Map();

  constructor(websocketUrl: string, userId: string) {
    this.websocketUrl = websocketUrl;
    this.userId = userId;
    this.spinner = ora();
    this.setupMessageHandlers();
  }

  /**
   * Connect to WebSocket
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const url = `${this.websocketUrl}?userId=${encodeURIComponent(this.userId)}`;
        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          
          console.log(chalk.green('Connected to deployment monitoring service'));
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (error) {
            console.error(chalk.red('Failed to parse WebSocket message:'), error);
          }
        });

        this.ws.on('close', (code: number, reason: string) => {
          this.isConnected = false;
          console.log(chalk.yellow(`WebSocket connection closed: ${code} - ${reason}`));
          
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.attemptReconnect();
          } else {
            console.log(chalk.red('Max reconnection attempts reached. Please restart the monitoring.'));
          }
        });

        this.ws.on('error', (error: Error) => {
          console.error(chalk.red('WebSocket error:'), error.message);
          reject(error);
        });

        // Connection timeout
        setTimeout(() => {
          if (!this.isConnected) {
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000); // 10 seconds timeout

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  /**
   * Subscribe to deployment updates
   */
  async subscribeToDeployment(deploymentId: string): Promise<void> {
    this.deploymentId = deploymentId;
    
    if (!this.isConnected || !this.ws) {
      throw new Error('WebSocket not connected');
    }

    const message = {
      action: 'subscribe-deployment',
      deploymentId
    };

    this.ws.send(JSON.stringify(message));
    console.log(chalk.blue(`Subscribed to deployment: ${deploymentId}`));
  }

  /**
   * Unsubscribe from deployment updates
   */
  async unsubscribeFromDeployment(): Promise<void> {
    if (!this.isConnected || !this.ws) {
      return;
    }

    const message = {
      action: 'unsubscribe-deployment'
    };

    this.ws.send(JSON.stringify(message));
    this.deploymentId = undefined;
  }

  /**
   * Send ping to keep connection alive
   */
  ping(): void {
    if (!this.isConnected || !this.ws) {
      return;
    }

    const message = {
      action: 'ping'
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Setup message handlers
   */
  private setupMessageHandlers(): void {
    this.messageHandlers.set('deployment-status-update', this.handleStatusUpdate.bind(this));
    this.messageHandlers.set('deployment-log-update', this.handleLogUpdate.bind(this));
    this.messageHandlers.set('deployment-progress-update', this.handleProgressUpdate.bind(this));
    this.messageHandlers.set('deployment-phase-change', this.handlePhaseChange.bind(this));
    this.messageHandlers.set('subscription-confirmed', this.handleSubscriptionConfirmed.bind(this));
    this.messageHandlers.set('error', this.handleError.bind(this));
    this.messageHandlers.set('pong', this.handlePong.bind(this));
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(message: any): void {
    const handler = this.messageHandlers.get(message.type);
    
    if (handler) {
      handler(message);
    } else {
      console.log(chalk.gray(`Unknown message type: ${message.type}`));
    }
  }

  /**
   * Handle deployment status update
   */
  private handleStatusUpdate(message: any): void {
    const { status } = message;
    
    console.log('');
    console.log(chalk.cyan.bold('Deployment Status Update'));
    console.log(`Status: ${this.getStatusIcon(status.status)} ${status.status}`);
    console.log(`Progress: ${status.progress.percentage}%`);
    console.log(`Current Step: ${status.progress.currentStep}`);
    
    if (status.progress.estimatedTimeRemaining) {
      const minutes = Math.ceil(status.progress.estimatedTimeRemaining / 60000);
      console.log(`Estimated Time Remaining: ${minutes} minutes`);
    }
  }

  /**
   * Handle deployment log update
   */
  private handleLogUpdate(message: any): void {
    const { log } = message;
    const timestamp = new Date(log.timestamp).toLocaleTimeString();
    
    let logColor = chalk.white;
    let logIcon = 'i';
    
    switch (log.level) {
      case 'error':
        logColor = chalk.red;
        logIcon = '';
        break;
      case 'warn':
        logColor = chalk.yellow;
        logIcon = '';
        break;
      case 'info':
        logColor = chalk.blue;
        logIcon = 'i';
        break;
      case 'debug':
        logColor = chalk.gray;
        logIcon = '';
        break;
    }
    
    console.log(logColor(`${logIcon} [${timestamp}] ${log.message}`));
    
    if (log.details && process.env.VERBOSE === 'true') {
      console.log(chalk.gray('   Details:'), JSON.stringify(log.details, null, 2));
    }
  }

  /**
   * Handle deployment progress update
   */
  private handleProgressUpdate(message: any): void {
    const { progress } = message;
    
    // Update spinner with current progress
    if (this.spinner.isSpinning) {
      this.spinner.text = `${progress.currentStep} (${progress.percentage}%)`;
    } else {
      this.spinner.start(`${progress.currentStep} (${progress.percentage}%)`);
    }
    
    // Show completed steps
    if (progress.completedSteps.length > 0) {
      console.log(chalk.green(`Completed: ${progress.completedSteps.join(', ')}`));
    }
  }

  /**
   * Handle deployment phase change
   */
  private handlePhaseChange(message: any): void {
    const { phase, phaseDetails } = message;
    
    // Stop current spinner
    if (this.spinner.isSpinning) {
      this.spinner.stop();
    }
    
    console.log('');
    
    switch (phase) {
      case 'configuring':
        console.log(chalk.blue.bold('Configuration Phase Started'));
        this.spinner.start('Configuring deployment environment...');
        break;
        
      case 'building':
        console.log(chalk.blue.bold(' Build Phase Started'));
        this.spinner.start('Building frontend application...');
        break;
        
      case 'uploading':
        console.log(chalk.blue.bold('Upload Phase Started'));
        this.spinner.start('Uploading build artifacts to S3...');
        break;
        
      case 'distributing':
        console.log(chalk.blue.bold('Distribution Phase Started'));
        this.spinner.start('Configuring CloudFront distribution...');
        break;
        
      case 'completed':
        this.spinner.succeed(chalk.green.bold('Deployment Completed Successfully!'));
        console.log('');
        
        if (phaseDetails?.result?.cloudFrontUrl) {
          console.log(chalk.green.bold('Your application is now live:'));
          console.log(chalk.cyan(`   ${phaseDetails.result.cloudFrontUrl}`));
        }
        
        if (phaseDetails?.totalDuration) {
          const minutes = Math.ceil(phaseDetails.totalDuration / 60000);
          console.log(chalk.gray(`   Total deployment time: ${minutes} minutes`));
        }
        break;
        
      case 'failed':
        this.spinner.fail(chalk.red.bold('Deployment Failed'));
        console.log('');
        console.log(chalk.red(`Error: ${phaseDetails?.error?.message || 'Unknown error'}`));
        
        if (phaseDetails?.troubleshootingInfo) {
          console.log('');
          console.log(chalk.yellow.bold('Troubleshooting Information:'));
          
          if (phaseDetails.troubleshootingInfo.suggestions) {
            console.log(chalk.yellow('Suggested actions:'));
            phaseDetails.troubleshootingInfo.suggestions.forEach((suggestion: string, index: number) => {
              console.log(chalk.yellow(`  ${index + 1}. ${suggestion}`));
            });
          }
        }
        break;
    }
    
    if (phaseDetails?.description) {
      console.log(chalk.gray(`   ${phaseDetails.description}`));
    }
  }

  /**
   * Handle subscription confirmation
   */
  private handleSubscriptionConfirmed(message: any): void {
    console.log(chalk.green(`${message.message}`));
  }

  /**
   * Handle error message
   */
  private handleError(message: any): void {
    console.error(chalk.red(`Error: ${message.message}`));
  }

  /**
   * Handle pong response
   */
  private handlePong(message: any): void {
    // Silent handling of pong messages
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnect(): void {
    this.reconnectAttempts++;
    
    console.log(chalk.yellow(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`));
    
    setTimeout(async () => {
      try {
        await this.connect();
        
        // Re-subscribe to deployment if we were subscribed
        if (this.deploymentId) {
          await this.subscribeToDeployment(this.deploymentId);
        }
      } catch (error) {
        console.error(chalk.red('Reconnection failed:'), error.message);
      }
    }, this.reconnectDelay);
    
    // Exponential backoff
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000); // Max 30 seconds
  }

  /**
   * Get status icon
   */
  private getStatusIcon(status: string): string {
    switch (status) {
      case 'pending':
        return '';
      case 'configuring':
        return '';
      case 'building':
        return '';
      case 'uploading':
        return '';
      case 'distributing':
        return '';
      case 'completed':
        return '';
      case 'failed':
        return '';
      default:
        return 'i';
    }
  }

  /**
   * Start keep-alive ping
   */
  startKeepAlive(intervalMs: number = 30000): void {
    setInterval(() => {
      if (this.isConnected) {
        this.ping();
      }
    }, intervalMs);
  }

  /**
   * Get connection status
   */
  isConnectionActive(): boolean {
    return this.isConnected;
  }
}

/**
 * Deployment Monitor CLI
 * Command-line interface for monitoring deployments in real-time
 */
export class DeploymentMonitorCLI {
  private client: DeploymentWebSocketClient;
  private deploymentId?: string;

  constructor(websocketUrl: string, userId: string) {
    this.client = new DeploymentWebSocketClient(websocketUrl, userId);
  }

  /**
   * Start monitoring a deployment
   */
  async startMonitoring(deploymentId?: string): Promise<void> {
    console.log(chalk.blue.bold('Starting Deployment Monitor'));
    console.log('');

    try {
      // Connect to WebSocket
      await this.client.connect();
      
      // Start keep-alive
      this.client.startKeepAlive();
      
      // Subscribe to deployment if provided
      if (deploymentId) {
        await this.client.subscribeToDeployment(deploymentId);
        this.deploymentId = deploymentId;
      }
      
      // Setup graceful shutdown
      this.setupGracefulShutdown();
      
      console.log(chalk.green('Monitoring started. Press Ctrl+C to stop.'));
      console.log('');
      
      // Keep the process alive
      await this.waitForShutdown();
      
    } catch (error) {
      console.error(chalk.red('Failed to start monitoring:'), error.message);
      process.exit(1);
    }
  }

  /**
   * Setup graceful shutdown
   */
  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      console.log('');
      console.log(chalk.yellow('Shutting down deployment monitor...'));
      
      if (this.deploymentId) {
        await this.client.unsubscribeFromDeployment();
      }
      
      this.client.disconnect();
      console.log(chalk.green('Monitor stopped successfully'));
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  /**
   * Wait for shutdown signal
   */
  private waitForShutdown(): Promise<void> {
    return new Promise(() => {
      // This promise never resolves, keeping the process alive
      // until a shutdown signal is received
    });
  }
}

// Export for use in other modules
export { DeploymentWebSocketClient, DeploymentMonitorCLI };