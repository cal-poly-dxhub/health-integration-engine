import { FrontendDeploymentLog } from '../types/frontend';

/**
 * Deployment Logger Utility
 * Provides structured logging for frontend deployments with different log levels and contexts
 */
export class DeploymentLogger {
  private deploymentId: string;
  private context: string;

  constructor(deploymentId: string, context: string = 'deployment') {
    this.deploymentId = deploymentId;
    this.context = context;
  }

  /**
   * Create a log entry
   */
  private createLogEntry(
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    step?: string,
    details?: any
  ): FrontendDeploymentLog {
    return {
      timestamp: new Date().toISOString(),
      level,
      message: `[${this.context}] ${message}`,
      step,
      details: {
        deploymentId: this.deploymentId,
        context: this.context,
        ...details
      }
    };
  }

  /**
   * Log info message
   */
  info(message: string, step?: string, details?: any): FrontendDeploymentLog {
    const log = this.createLogEntry('info', message, step, details);
    console.log(`[${this.deploymentId}] INFO: ${log.message}`, details ? JSON.stringify(details, null, 2) : '');
    return log;
  }

  /**
   * Log warning message
   */
  warn(message: string, step?: string, details?: any): FrontendDeploymentLog {
    const log = this.createLogEntry('warn', message, step, details);
    console.warn(`[${this.deploymentId}] WARN: ${log.message}`, details ? JSON.stringify(details, null, 2) : '');
    return log;
  }

  /**
   * Log error message
   */
  error(message: string, step?: string, error?: Error, details?: any): FrontendDeploymentLog {
    const errorDetails = error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...details
    } : details;

    const log = this.createLogEntry('error', message, step, errorDetails);
    console.error(`[${this.deploymentId}] ERROR: ${log.message}`, errorDetails ? JSON.stringify(errorDetails, null, 2) : '');
    return log;
  }

  /**
   * Log debug message
   */
  debug(message: string, step?: string, details?: any): FrontendDeploymentLog {
    const log = this.createLogEntry('debug', message, step, details);
    
    // Only log debug messages if debug logging is enabled
    if (process.env.DEBUG_LOGGING === 'true' || process.env.NODE_ENV === 'development') {
      console.debug(`[${this.deploymentId}] DEBUG: ${log.message}`, details ? JSON.stringify(details, null, 2) : '');
    }
    
    return log;
  }

  /**
   * Log step start
   */
  stepStart(step: string, message: string, details?: any): FrontendDeploymentLog {
    return this.info(`Starting: ${message}`, step, { stepType: 'start', ...details });
  }

  /**
   * Log step completion
   */
  stepComplete(step: string, message: string, duration?: number, details?: any): FrontendDeploymentLog {
    const logDetails = duration ? { duration: `${duration}ms`, ...details } : details;
    return this.info(`Completed: ${message}`, step, { stepType: 'complete', ...logDetails });
  }

  /**
   * Log step failure
   */
  stepFailed(step: string, message: string, error?: Error, details?: any): FrontendDeploymentLog {
    return this.error(`Failed: ${message}`, step, error, { stepType: 'failed', ...details });
  }

  /**
   * Log progress update
   */
  progress(step: string, message: string, percentage: number, details?: any): FrontendDeploymentLog {
    return this.info(`Progress: ${message} (${percentage}%)`, step, { 
      stepType: 'progress', 
      percentage, 
      ...details 
    });
  }

  /**
   * Create a child logger for a specific step
   */
  forStep(step: string): DeploymentLogger {
    return new DeploymentLogger(this.deploymentId, `${this.context}:${step}`);
  }

  /**
   * Create a child logger for a specific component
   */
  forComponent(component: string): DeploymentLogger {
    return new DeploymentLogger(this.deploymentId, component);
  }
}

/**
 * Build Process Logger
 * Specialized logger for build processes with build-specific methods
 */
export class BuildLogger extends DeploymentLogger {
  constructor(deploymentId: string) {
    super(deploymentId, 'build');
  }

  /**
   * Log build start
   */
  buildStart(environment: string, buildPath?: string): FrontendDeploymentLog {
    return this.stepStart('build', `Starting build for ${environment}`, { 
      environment, 
      buildPath,
      buildStartTime: new Date().toISOString()
    });
  }

  /**
   * Log build completion
   */
  buildComplete(duration: number, artifacts: string[], size: number): FrontendDeploymentLog {
    return this.stepComplete('build', `Build completed successfully`, duration, {
      artifacts,
      size: this.formatBytes(size),
      artifactCount: artifacts.length
    });
  }

  /**
   * Log build command execution
   */
  buildCommand(command: string, output?: string): FrontendDeploymentLog {
    return this.debug(`Executing build command: ${command}`, 'build', { command, output });
  }

  /**
   * Log dependency installation
   */
  dependencyInstall(packageManager: string, duration?: number): FrontendDeploymentLog {
    return this.info(`Dependencies installed using ${packageManager}`, 'dependencies', { 
      packageManager, 
      duration: duration ? `${duration}ms` : undefined 
    });
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

/**
 * Upload Process Logger
 * Specialized logger for S3 upload processes
 */
export class UploadLogger extends DeploymentLogger {
  constructor(deploymentId: string) {
    super(deploymentId, 'upload');
  }

  /**
   * Log upload start
   */
  uploadStart(bucketName: string, fileCount: number, totalSize: number): FrontendDeploymentLog {
    return this.stepStart('upload', `Starting upload to s3://${bucketName}`, {
      bucketName,
      fileCount,
      totalSize: this.formatBytes(totalSize)
    });
  }

  /**
   * Log upload progress
   */
  uploadProgress(
    uploadedFiles: number, 
    totalFiles: number, 
    uploadedBytes: number, 
    totalBytes: number,
    currentFile?: string
  ): FrontendDeploymentLog {
    const percentage = Math.round((uploadedBytes / totalBytes) * 100);
    return this.progress('upload', `Uploaded ${uploadedFiles}/${totalFiles} files`, percentage, {
      uploadedFiles,
      totalFiles,
      uploadedBytes: this.formatBytes(uploadedBytes),
      totalBytes: this.formatBytes(totalBytes),
      currentFile
    });
  }

  /**
   * Log upload completion
   */
  uploadComplete(duration: number, fileCount: number, totalSize: number): FrontendDeploymentLog {
    const speed = totalSize / (duration / 1000); // bytes per second
    return this.stepComplete('upload', `Upload completed successfully`, duration, {
      fileCount,
      totalSize: this.formatBytes(totalSize),
      averageSpeed: this.formatBytes(speed) + '/s'
    });
  }

  /**
   * Log file upload
   */
  fileUploaded(fileName: string, size: number, contentType: string): FrontendDeploymentLog {
    return this.debug(`Uploaded file: ${fileName}`, 'upload', {
      fileName,
      size: this.formatBytes(size),
      contentType
    });
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

/**
 * CloudFront Logger
 * Specialized logger for CloudFront operations
 */
export class CloudFrontLogger extends DeploymentLogger {
  constructor(deploymentId: string) {
    super(deploymentId, 'cloudfront');
  }

  /**
   * Log distribution creation start
   */
  distributionCreateStart(bucketName: string, environment: string): FrontendDeploymentLog {
    return this.stepStart('distribution', `Creating CloudFront distribution for ${environment}`, {
      bucketName,
      environment
    });
  }

  /**
   * Log distribution creation completion
   */
  distributionCreateComplete(
    distributionId: string, 
    domainName: string, 
    duration: number
  ): FrontendDeploymentLog {
    return this.stepComplete('distribution', `Distribution created successfully`, duration, {
      distributionId,
      domainName,
      url: `https://${domainName}`
    });
  }

  /**
   * Log cache invalidation
   */
  cacheInvalidation(distributionId: string, paths: string[]): FrontendDeploymentLog {
    return this.info(`Cache invalidation initiated`, 'invalidation', {
      distributionId,
      paths,
      pathCount: paths.length
    });
  }

  /**
   * Log distribution deployment wait
   */
  distributionDeploymentWait(distributionId: string, status: string): FrontendDeploymentLog {
    return this.info(`Waiting for distribution deployment: ${status}`, 'deployment', {
      distributionId,
      status
    });
  }

  /**
   * Log Origin Access Control creation
   */
  oacCreated(oacId: string, bucketName: string): FrontendDeploymentLog {
    return this.info(`Origin Access Control created`, 'oac', {
      oacId,
      bucketName
    });
  }
}

/**
 * Error Logger
 * Specialized logger for error tracking and troubleshooting
 */
export class ErrorLogger extends DeploymentLogger {
  constructor(deploymentId: string) {
    super(deploymentId, 'error');
  }

  /**
   * Log deployment failure with troubleshooting information
   */
  deploymentFailed(
    step: string, 
    error: Error, 
    troubleshootingInfo?: TroubleshootingInfo
  ): FrontendDeploymentLog {
    return this.error(`Deployment failed at step: ${step}`, step, error, {
      troubleshooting: troubleshootingInfo,
      failureTime: new Date().toISOString()
    });
  }

  /**
   * Log AWS service error with additional context
   */
  awsServiceError(
    service: string, 
    operation: string, 
    error: any, 
    requestId?: string
  ): FrontendDeploymentLog {
    return this.error(`AWS ${service} ${operation} failed`, service, error, {
      service,
      operation,
      requestId,
      statusCode: error.statusCode,
      code: error.code,
      retryable: error.retryable
    });
  }

  /**
   * Log validation error
   */
  validationError(field: string, value: any, expectedFormat: string): FrontendDeploymentLog {
    return this.error(`Validation failed for field: ${field}`, 'validation', undefined, {
      field,
      value,
      expectedFormat
    });
  }

  /**
   * Log timeout error
   */
  timeoutError(operation: string, timeoutMs: number): FrontendDeploymentLog {
    return this.error(`Operation timed out: ${operation}`, 'timeout', undefined, {
      operation,
      timeoutMs,
      timeoutSeconds: timeoutMs / 1000
    });
  }
}

/**
 * Troubleshooting information for failed deployments
 */
export interface TroubleshootingInfo {
  possibleCauses: string[];
  suggestedActions: string[];
  relatedDocumentation?: string[];
  supportContact?: string;
}

/**
 * Create deployment logger factory
 */
export class DeploymentLoggerFactory {
  /**
   * Create a deployment logger
   */
  static createDeploymentLogger(deploymentId: string): DeploymentLogger {
    return new DeploymentLogger(deploymentId);
  }

  /**
   * Create a build logger
   */
  static createBuildLogger(deploymentId: string): BuildLogger {
    return new BuildLogger(deploymentId);
  }

  /**
   * Create an upload logger
   */
  static createUploadLogger(deploymentId: string): UploadLogger {
    return new UploadLogger(deploymentId);
  }

  /**
   * Create a CloudFront logger
   */
  static createCloudFrontLogger(deploymentId: string): CloudFrontLogger {
    return new CloudFrontLogger(deploymentId);
  }

  /**
   * Create an error logger
   */
  static createErrorLogger(deploymentId: string): ErrorLogger {
    return new ErrorLogger(deploymentId);
  }
}