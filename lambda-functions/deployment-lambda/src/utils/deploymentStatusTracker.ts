import { FrontendDeploymentStatus, FrontendDeploymentLog } from '../types/frontend';
import { FrontendDeploymentDatabase } from './frontendDeploymentDatabase';
import { DeploymentLogger } from './deploymentLogger';

/**
 * Deployment Status Tracker
 * Tracks deployment progress with detailed status updates and real-time progress tracking
 */
export class DeploymentStatusTracker {
  private database: FrontendDeploymentDatabase;
  private logger: DeploymentLogger;
  private deploymentId: string;
  private startTime: Date;
  private stepTimings: Map<string, { start: Date; end?: Date }> = new Map();

  constructor(deploymentId: string, region?: string) {
    this.deploymentId = deploymentId;
    this.database = new FrontendDeploymentDatabase(region);
    this.logger = new DeploymentLogger(deploymentId, 'status-tracker');
    this.startTime = new Date();
  }

  /**
   * Initialize deployment tracking
   */
  async initialize(
    environment: string,
    userId: string,
    totalSteps: number = 7
  ): Promise<FrontendDeploymentStatus> {
    const status: FrontendDeploymentStatus = {
      deploymentId: this.deploymentId,
      environment,
      status: 'pending',
      progress: {
        currentStep: 'Initializing deployment',
        completedSteps: [],
        totalSteps,
        percentage: 0
      },
      logs: [this.logger.info('Deployment tracking initialized', 'initialization', {
        userId,
        environment,
        totalSteps
      })],
      createdAt: this.startTime.toISOString(),
      updatedAt: this.startTime.toISOString()
    };

    await this.database.saveFrontendDeploymentStatus(status);
    return status;
  }

  /**
   * Start a deployment step
   */
  async startStep(
    stepName: string,
    description: string,
    stepIndex: number,
    totalSteps: number
  ): Promise<void> {
    const stepStart = new Date();
    this.stepTimings.set(stepName, { start: stepStart });

    const log = this.logger.stepStart(stepName, description, {
      stepIndex,
      totalSteps,
      estimatedDuration: this.getEstimatedStepDuration(stepName)
    });

    const percentage = Math.round((stepIndex / totalSteps) * 100);

    await this.updateProgress(
      stepName,
      description,
      stepIndex,
      totalSteps,
      percentage,
      [log]
    );
  }

  /**
   * Complete a deployment step
   */
  async completeStep(
    stepName: string,
    description: string,
    stepIndex: number,
    totalSteps: number,
    result?: any
  ): Promise<void> {
    const stepEnd = new Date();
    const stepTiming = this.stepTimings.get(stepName);
    
    if (stepTiming) {
      stepTiming.end = stepEnd;
    }

    const duration = stepTiming ? stepEnd.getTime() - stepTiming.start.getTime() : 0;
    
    const log = this.logger.stepComplete(stepName, description, duration, {
      stepIndex,
      totalSteps,
      result: result ? this.sanitizeResult(result) : undefined
    });

    const percentage = Math.round(((stepIndex + 1) / totalSteps) * 100);

    await this.updateProgress(
      `${stepName} completed`,
      description,
      stepIndex + 1,
      totalSteps,
      percentage,
      [log],
      [stepName]
    );
  }

  /**
   * Fail a deployment step
   */
  async failStep(
    stepName: string,
    description: string,
    error: Error,
    troubleshootingInfo?: any
  ): Promise<void> {
    const stepEnd = new Date();
    const stepTiming = this.stepTimings.get(stepName);
    
    if (stepTiming) {
      stepTiming.end = stepEnd;
    }

    const duration = stepTiming ? stepEnd.getTime() - stepTiming.start.getTime() : 0;
    
    const log = this.logger.stepFailed(stepName, description, error, {
      duration,
      troubleshootingInfo
    });

    await this.updateStatus('failed', `Failed: ${description}`, [log], {
      code: error.name || 'STEP_FAILED',
      message: error.message,
      details: {
        step: stepName,
        duration,
        troubleshootingInfo,
        stack: error.stack
      }
    });
  }

  /**
   * Update step progress (for long-running steps)
   */
  async updateStepProgress(
    stepName: string,
    description: string,
    subProgress: number,
    details?: any
  ): Promise<void> {
    const log = this.logger.progress(stepName, description, subProgress, details);

    const currentStatus = await this.database.getFrontendDeploymentStatus(this.deploymentId);
    
    // Update the current step description with progress
    const updatedDescription = `${description} (${subProgress}%)`;
    
    await this.updateProgress(
      updatedDescription,
      description,
      currentStatus.progress.completedSteps.length,
      currentStatus.progress.totalSteps,
      currentStatus.progress.percentage,
      [log]
    );
  }

  /**
   * Complete deployment successfully
   */
  async completeDeployment(result: any): Promise<void> {
    const completionTime = new Date();
    const totalDuration = completionTime.getTime() - this.startTime.getTime();

    const log = this.logger.info('Deployment completed successfully', 'completion', {
      totalDuration,
      result: this.sanitizeResult(result),
      stepTimings: this.getStepTimingSummary()
    });

    await this.updateStatus('completed', 'Deployment completed successfully', [log], undefined, {
      completedAt: completionTime.toISOString(),
      ...result
    });
  }

  /**
   * Fail deployment
   */
  async failDeployment(error: Error, step?: string): Promise<void> {
    const failureTime = new Date();
    const totalDuration = failureTime.getTime() - this.startTime.getTime();

    const log = this.logger.error('Deployment failed', step || 'deployment', error, {
      totalDuration,
      stepTimings: this.getStepTimingSummary()
    });

    await this.updateStatus('failed', `Deployment failed: ${error.message}`, [log], {
      code: error.name || 'DEPLOYMENT_FAILED',
      message: error.message,
      details: {
        step,
        totalDuration,
        stepTimings: this.getStepTimingSummary(),
        stack: error.stack
      }
    });
  }

  /**
   * Get current deployment status
   */
  async getCurrentStatus(): Promise<FrontendDeploymentStatus> {
    return await this.database.getFrontendDeploymentStatus(this.deploymentId);
  }

  /**
   * Add custom log entry
   */
  async addLog(log: FrontendDeploymentLog): Promise<void> {
    await this.database.addDeploymentLog(this.deploymentId, log);
  }

  /**
   * Update deployment progress
   */
  private async updateProgress(
    currentStep: string,
    description: string,
    completedStepCount: number,
    totalSteps: number,
    percentage: number,
    logs: FrontendDeploymentLog[],
    newCompletedSteps: string[] = []
  ): Promise<void> {
    const currentStatus = await this.database.getFrontendDeploymentStatus(this.deploymentId);
    
    const updatedCompletedSteps = [
      ...currentStatus.progress.completedSteps,
      ...newCompletedSteps
    ];

    const progress = {
      currentStep,
      completedSteps: updatedCompletedSteps,
      totalSteps,
      percentage: Math.min(percentage, 100)
    };

    await this.database.updateDeploymentProgress(this.deploymentId, progress);

    // Add logs
    for (const log of logs) {
      await this.database.addDeploymentLog(this.deploymentId, log);
    }
  }

  /**
   * Update deployment status
   */
  private async updateStatus(
    status: FrontendDeploymentStatus['status'],
    currentStep: string,
    logs: FrontendDeploymentLog[],
    error?: { code: string; message: string; details?: any },
    additionalData?: any
  ): Promise<void> {
    const currentStatus = await this.database.getFrontendDeploymentStatus(this.deploymentId);
    
    const updatedStatus: FrontendDeploymentStatus = {
      ...currentStatus,
      status,
      progress: {
        ...currentStatus.progress,
        currentStep
      },
      updatedAt: new Date().toISOString(),
      error,
      ...additionalData
    };

    await this.database.saveFrontendDeploymentStatus(updatedStatus);

    // Add logs
    for (const log of logs) {
      await this.database.addDeploymentLog(this.deploymentId, log);
    }
  }

  /**
   * Get estimated duration for a step (in milliseconds)
   */
  private getEstimatedStepDuration(stepName: string): number {
    const estimations: Record<string, number> = {
      'configuration': 30000,    // 30 seconds
      'infrastructure': 300000,  // 5 minutes
      'environment': 15000,      // 15 seconds
      'build': 120000,          // 2 minutes
      'upload': 60000,          // 1 minute
      'cloudfront': 180000,     // 3 minutes
      'cache': 30000            // 30 seconds
    };

    return estimations[stepName] || 60000; // Default 1 minute
  }

  /**
   * Get step timing summary
   */
  private getStepTimingSummary(): Record<string, { duration: number; status: string }> {
    const summary: Record<string, { duration: number; status: string }> = {};

    for (const [stepName, timing] of this.stepTimings.entries()) {
      const duration = timing.end 
        ? timing.end.getTime() - timing.start.getTime()
        : new Date().getTime() - timing.start.getTime();
      
      summary[stepName] = {
        duration,
        status: timing.end ? 'completed' : 'in-progress'
      };
    }

    return summary;
  }

  /**
   * Sanitize result object for logging (remove sensitive data)
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

/**
 * Deployment Progress Calculator
 * Calculates deployment progress based on step completion and estimated durations
 */
export class DeploymentProgressCalculator {
  private stepWeights: Map<string, number> = new Map([
    ['configuration', 10],
    ['infrastructure', 25],
    ['environment', 5],
    ['build', 20],
    ['upload', 15],
    ['cloudfront', 20],
    ['cache', 5]
  ]);

  /**
   * Calculate overall progress percentage
   */
  calculateProgress(
    completedSteps: string[],
    currentStep: string,
    currentStepProgress: number = 0
  ): number {
    let totalWeight = 0;
    let completedWeight = 0;

    // Calculate total weight
    for (const weight of this.stepWeights.values()) {
      totalWeight += weight;
    }

    // Calculate completed weight
    for (const step of completedSteps) {
      const weight = this.stepWeights.get(step) || 0;
      completedWeight += weight;
    }

    // Add current step progress
    const currentStepWeight = this.stepWeights.get(currentStep) || 0;
    completedWeight += (currentStepWeight * currentStepProgress / 100);

    return Math.round((completedWeight / totalWeight) * 100);
  }

  /**
   * Get estimated time remaining
   */
  getEstimatedTimeRemaining(
    completedSteps: string[],
    currentStep: string,
    currentStepProgress: number,
    averageStepDuration: number
  ): number {
    const remainingSteps = Array.from(this.stepWeights.keys()).filter(
      step => !completedSteps.includes(step) && step !== currentStep
    );

    // Time for remaining part of current step
    const currentStepRemaining = (100 - currentStepProgress) / 100 * averageStepDuration;
    
    // Time for remaining steps
    const remainingStepsTime = remainingSteps.length * averageStepDuration;

    return Math.round(currentStepRemaining + remainingStepsTime);
  }

  /**
   * Set custom step weights
   */
  setStepWeights(weights: Record<string, number>): void {
    this.stepWeights.clear();
    for (const [step, weight] of Object.entries(weights)) {
      this.stepWeights.set(step, weight);
    }
  }
}