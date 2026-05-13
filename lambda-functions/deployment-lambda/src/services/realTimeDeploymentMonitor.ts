import { WebSocketService } from './websocketService';
import { DeploymentStatusTracker } from '../utils/deploymentStatusTracker';
import { FrontendDeploymentStatus, FrontendDeploymentLog } from '../types/frontend';
import { DeploymentLogger } from '../utils/deploymentLogger';

/**
 * Real-time Deployment Monitor
 * Integrates deployment status tracking with WebSocket broadcasting for real-time updates
 */
export class RealTimeDeploymentMonitor {
  private websocketService: WebSocketService;
  private logger: DeploymentLogger;
  private deploymentId: string;
  private userId: string;
  private startTime: Date;
  private phaseTimings: Map<string, { start: Date; end?: Date }> = new Map();

  constructor(
    deploymentId: string,
    userId: string,
    websocketEndpoint: string,
    region?: string
  ) {
    this.deploymentId = deploymentId;
    this.userId = userId;
    this.websocketService = new WebSocketService(websocketEndpoint, region);
    this.logger = new DeploymentLogger(deploymentId, 'realtime-monitor');
    this.startTime = new Date();
  }

  /**
   * Initialize real-time monitoring
   */
  async initialize(environment: string, totalSteps: number = 7): Promise<void> {
    await this.broadcastPhaseChange('configuring', {
      environment,
      totalSteps,
      startTime: this.startTime.toISOString()
    });

    this.logger.info('Real-time monitoring initialized', 'initialization', {
      environment,
      totalSteps,
      userId: this.userId
    });
  }

  /**
   * Start monitoring a deployment phase
   */
  async startPhase(
    phase: 'configuring' | 'building' | 'uploading' | 'distributing',
    description: string,
    stepIndex: number,
    totalSteps: number,
    estimatedDuration?: number
  ): Promise<void> {
    const phaseStart = new Date();
    this.phaseTimings.set(phase, { start: phaseStart });

    // Broadcast phase change
    await this.broadcastPhaseChange(phase, {
      description,
      stepIndex,
      totalSteps,
      estimatedDuration,
      startTime: phaseStart.toISOString()
    });

    // Broadcast progress update
    await this.broadcastProgressUpdate({
      currentStep: description,
      completedSteps: Array.from(this.phaseTimings.keys()).filter(p => 
        this.phaseTimings.get(p)?.end
      ),
      totalSteps,
      percentage: Math.round((stepIndex / totalSteps) * 100),
      estimatedTimeRemaining: this.calculateEstimatedTimeRemaining(stepIndex, totalSteps)
    });

    this.logger.stepStart(phase, description, {
      stepIndex,
      totalSteps,
      estimatedDuration
    });
  }

  /**
   * Complete a deployment phase
   */
  async completePhase(
    phase: 'configuring' | 'building' | 'uploading' | 'distributing',
    description: string,
    stepIndex: number,
    totalSteps: number,
    result?: any
  ): Promise<void> {
    const phaseEnd = new Date();
    const phaseTiming = this.phaseTimings.get(phase);
    
    if (phaseTiming) {
      phaseTiming.end = phaseEnd;
    }

    const duration = phaseTiming ? phaseEnd.getTime() - phaseTiming.start.getTime() : 0;

    // Broadcast progress update
    await this.broadcastProgressUpdate({
      currentStep: `${description} completed`,
      completedSteps: Array.from(this.phaseTimings.keys()).filter(p => 
        this.phaseTimings.get(p)?.end
      ),
      totalSteps,
      percentage: Math.round(((stepIndex + 1) / totalSteps) * 100),
      estimatedTimeRemaining: this.calculateEstimatedTimeRemaining(stepIndex + 1, totalSteps)
    });

    // Broadcast phase completion
    await this.broadcastPhaseChange(phase, {
      description: `${description} completed`,
      stepIndex: stepIndex + 1,
      totalSteps,
      duration,
      result: this.sanitizeResult(result),
      completedAt: phaseEnd.toISOString()
    });

    this.logger.stepComplete(phase, description, duration, {
      stepIndex,
      totalSteps,
      result: this.sanitizeResult(result)
    });
  }

  /**
   * Fail a deployment phase
   */
  async failPhase(
    phase: 'configuring' | 'building' | 'uploading' | 'distributing',
    description: string,
    error: Error,
    troubleshootingInfo?: any
  ): Promise<void> {
    const phaseEnd = new Date();
    const phaseTiming = this.phaseTimings.get(phase);
    
    if (phaseTiming) {
      phaseTiming.end = phaseEnd;
    }

    const duration = phaseTiming ? phaseEnd.getTime() - phaseTiming.start.getTime() : 0;

    // Broadcast failure
    await this.broadcastPhaseChange('failed', {
      failedPhase: phase,
      description: `${description} failed`,
      error: {
        name: error.name,
        message: error.message
      },
      duration,
      troubleshootingInfo,
      failedAt: phaseEnd.toISOString()
    });

    this.logger.stepFailed(phase, description, error, {
      duration,
      troubleshootingInfo
    });
  }

  /**
   * Update phase progress (for long-running phases)
   */
  async updatePhaseProgress(
    phase: 'configuring' | 'building' | 'uploading' | 'distributing',
    description: string,
    subProgress: number,
    details?: any
  ): Promise<void> {
    // Broadcast detailed progress update
    await this.websocketService.broadcastProgressUpdate(
      this.deploymentId,
      this.userId,
      {
        currentStep: `${description} (${subProgress}%)`,
        completedSteps: Array.from(this.phaseTimings.keys()).filter(p => 
          this.phaseTimings.get(p)?.end
        ),
        totalSteps: 7, // Default total steps
        percentage: this.calculateOverallProgress(phase, subProgress),
        estimatedTimeRemaining: this.calculateEstimatedTimeRemaining()
      }
    );

    // Broadcast log update
    const log = this.logger.progress(phase, description, subProgress, details);
    await this.websocketService.broadcastDeploymentLog(
      this.deploymentId,
      this.userId,
      log
    );
  }

  /**
   * Complete deployment successfully
   */
  async completeDeployment(result: any): Promise<void> {
    const completionTime = new Date();
    const totalDuration = completionTime.getTime() - this.startTime.getTime();

    // Broadcast completion
    await this.broadcastPhaseChange('completed', {
      description: 'Deployment completed successfully',
      totalDuration,
      result: this.sanitizeResult(result),
      phaseTimings: this.getPhaseTimingSummary(),
      completedAt: completionTime.toISOString()
    });

    // Final progress update
    await this.broadcastProgressUpdate({
      currentStep: 'Deployment completed successfully',
      completedSteps: Array.from(this.phaseTimings.keys()),
      totalSteps: 7,
      percentage: 100,
      estimatedTimeRemaining: 0
    });

    this.logger.info('Deployment completed successfully', 'completion', {
      totalDuration,
      result: this.sanitizeResult(result),
      phaseTimings: this.getPhaseTimingSummary()
    });
  }

  /**
   * Fail deployment
   */
  async failDeployment(error: Error, phase?: string): Promise<void> {
    const failureTime = new Date();
    const totalDuration = failureTime.getTime() - this.startTime.getTime();

    // Broadcast failure
    await this.broadcastPhaseChange('failed', {
      description: `Deployment failed: ${error.message}`,
      failedPhase: phase,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      totalDuration,
      phaseTimings: this.getPhaseTimingSummary(),
      failedAt: failureTime.toISOString()
    });

    this.logger.error('Deployment failed', phase || 'deployment', error, {
      totalDuration,
      phaseTimings: this.getPhaseTimingSummary()
    });
  }

  /**
   * Broadcast deployment status update
   */
  async broadcastStatusUpdate(status: FrontendDeploymentStatus): Promise<void> {
    await this.websocketService.broadcastDeploymentUpdate(
      this.deploymentId,
      this.userId,
      status
    );
  }

  /**
   * Broadcast log message
   */
  async broadcastLog(log: FrontendDeploymentLog): Promise<void> {
    await this.websocketService.broadcastDeploymentLog(
      this.deploymentId,
      this.userId,
      log
    );
  }

  /**
   * Add performance metrics
   */
  async addPerformanceMetrics(metrics: {
    buildTime?: number;
    uploadTime?: number;
    distributionTime?: number;
    totalSize?: number;
    fileCount?: number;
    averageFileSize?: number;
  }): Promise<void> {
    const log = this.logger.info('Performance metrics recorded', 'metrics', metrics);
    await this.broadcastLog(log);
  }

  /**
   * Add troubleshooting information
   */
  async addTroubleshootingInfo(
    phase: string,
    issue: string,
    suggestions: string[],
    documentation?: string[]
  ): Promise<void> {
    const troubleshootingInfo = {
      phase,
      issue,
      suggestions,
      documentation,
      timestamp: new Date().toISOString()
    };

    const log = this.logger.warn(`Troubleshooting info: ${issue}`, phase, troubleshootingInfo);
    await this.broadcastLog(log);
  }

  /**
   * Private helper methods
   */
  private async broadcastPhaseChange(
    phase: 'configuring' | 'building' | 'uploading' | 'distributing' | 'completed' | 'failed',
    phaseDetails?: any
  ): Promise<void> {
    await this.websocketService.broadcastPhaseChange(
      this.deploymentId,
      this.userId,
      phase,
      phaseDetails
    );
  }

  private async broadcastProgressUpdate(progress: {
    currentStep: string;
    completedSteps: string[];
    totalSteps: number;
    percentage: number;
    estimatedTimeRemaining?: number;
  }): Promise<void> {
    await this.websocketService.broadcastProgressUpdate(
      this.deploymentId,
      this.userId,
      progress
    );
  }

  private calculateOverallProgress(currentPhase: string, subProgress: number): number {
    const phaseWeights = {
      'configuring': 10,
      'building': 30,
      'uploading': 25,
      'distributing': 35
    };

    let completedWeight = 0;
    const totalWeight = Object.values(phaseWeights).reduce((sum, weight) => sum + weight, 0);

    // Add weight for completed phases
    for (const [phase, timing] of this.phaseTimings.entries()) {
      if (timing.end && phase !== currentPhase) {
        completedWeight += phaseWeights[phase as keyof typeof phaseWeights] || 0;
      }
    }

    // Add partial weight for current phase
    const currentPhaseWeight = phaseWeights[currentPhase as keyof typeof phaseWeights] || 0;
    completedWeight += (currentPhaseWeight * subProgress / 100);

    return Math.round((completedWeight / totalWeight) * 100);
  }

  private calculateEstimatedTimeRemaining(
    currentStep?: number,
    totalSteps?: number
  ): number {
    if (!currentStep || !totalSteps) {
      return 0;
    }

    const elapsedTime = new Date().getTime() - this.startTime.getTime();
    const averageTimePerStep = elapsedTime / Math.max(currentStep, 1);
    const remainingSteps = totalSteps - currentStep;

    return Math.round(remainingSteps * averageTimePerStep);
  }

  private getPhaseTimingSummary(): Record<string, { duration: number; status: string }> {
    const summary: Record<string, { duration: number; status: string }> = {};

    for (const [phase, timing] of this.phaseTimings.entries()) {
      const duration = timing.end 
        ? timing.end.getTime() - timing.start.getTime()
        : new Date().getTime() - timing.start.getTime();
      
      summary[phase] = {
        duration,
        status: timing.end ? 'completed' : 'in-progress'
      };
    }

    return summary;
  }

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
 * Deployment Performance Tracker
 * Tracks and analyzes deployment performance metrics
 */
export class DeploymentPerformanceTracker {
  private metrics: Map<string, number> = new Map();
  private startTimes: Map<string, number> = new Map();

  /**
   * Start timing an operation
   */
  startTiming(operation: string): void {
    this.startTimes.set(operation, Date.now());
  }

  /**
   * End timing an operation
   */
  endTiming(operation: string): number {
    const startTime = this.startTimes.get(operation);
    if (!startTime) {
      return 0;
    }

    const duration = Date.now() - startTime;
    this.metrics.set(operation, duration);
    this.startTimes.delete(operation);
    
    return duration;
  }

  /**
   * Add custom metric
   */
  addMetric(name: string, value: number): void {
    this.metrics.set(name, value);
  }

  /**
   * Get all metrics
   */
  getMetrics(): Record<string, number> {
    return Object.fromEntries(this.metrics);
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): {
    totalTime: number;
    buildTime: number;
    uploadTime: number;
    distributionTime: number;
    efficiency: string;
  } {
    const buildTime = this.metrics.get('build') || 0;
    const uploadTime = this.metrics.get('upload') || 0;
    const distributionTime = this.metrics.get('distribution') || 0;
    const totalTime = buildTime + uploadTime + distributionTime;

    let efficiency = 'good';
    if (totalTime > 600000) { // 10 minutes
      efficiency = 'slow';
    } else if (totalTime > 300000) { // 5 minutes
      efficiency = 'moderate';
    }

    return {
      totalTime,
      buildTime,
      uploadTime,
      distributionTime,
      efficiency
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
    this.startTimes.clear();
  }
}