import { EventBridgeEvent, Context } from 'aws-lambda';
import { WebSocketService } from '../services/websocketService';
import { DeploymentLogger } from '../utils/deploymentLogger';
import { WebSocketConnectionManager } from '../utils/websocketConnectionManager';
import { WebSocketBroadcaster } from '../utils/websocketBroadcaster';

/**
 * EventBridge event detail structure for deployment events
 */
interface DeploymentEventDetail {
  deploymentId: string;
  status?: string;
  message?: string;
  timestamp?: string;
  userId?: string;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * EventBridge deployment progress event
 */
interface DeploymentProgressEvent extends EventBridgeEvent<string, DeploymentEventDetail> {
  source: 'workflow-builder.deployment';
  'detail-type': 'Deployment Status Update';
}

/**
 * Step Functions state change event (for backward compatibility)
 */
interface StepFunctionsStateChangeEvent extends EventBridgeEvent<string, any> {
  source: 'aws.states';
  'detail-type': 'Step Functions Execution Status Change';
}

/**
 * WebSocket message for deployment progress
 */
interface DeploymentProgressMessage {
  type: 'deployment_progress';
  deploymentId: string;
  status: string;
  message: string;
  timestamp: string;
  step?: {
    name: string;
    completed: boolean;
  };
}

/**
 * Event status mapping configuration
 */
interface EventStatusMapping {
  [eventType: string]: {
    status: string;
    message: string;
  };
}

/**
 * EventBridge Handler for Deployment Progress Updates
 * Processes EventBridge events and sends WebSocket messages for real-time deployment updates
 */
class EventBridgeHandler {
  private websocketService: WebSocketService;
  private connectionManager: WebSocketConnectionManager;
  private broadcaster: WebSocketBroadcaster;
  private logger: DeploymentLogger;
  private eventMapping: EventStatusMapping;

  constructor(websocketEndpoint: string, region?: string) {
    const tableName = process.env.CONNECTIONS_TABLE_NAME || 'WebSocketConnections';
    this.websocketService = new WebSocketService(websocketEndpoint, region, tableName);
    this.connectionManager = new WebSocketConnectionManager(websocketEndpoint, region, tableName);
    this.broadcaster = new WebSocketBroadcaster(websocketEndpoint, region, tableName);
    this.logger = new DeploymentLogger('eventbridge', 'eventbridge-handler');
    
    // Initialize event status mapping based on requirements
    this.eventMapping = {
      'PublishTemplateGeneratedEvent': {
        status: 'template_generated',
        message: 'Workflow Template Generation'
      },
      'PublishStackDeploymentStartEvent': {
        status: 'deploying_infrastructure',
        message: 'Workflow Template Deployment Started'
      },
      'PublishStackCreationEvent': {
        status: 'stack_creating',
        message: 'Workflow Resources being deployed'
      },
      'PublishStackUpdateEvent': {
        status: 'stack_updating',
        message: 'Workflow Resources being updated'
      },
      'PublishDeploymentSuccessEvent': {
        status: 'completed',
        message: 'Workflow Deployed successfully'
      },
      'HandleDeploymentFailure': {
        status: 'failed',
        message: 'Workflow Deployment failed'
      }
    };
  }

  /**
   * Main EventBridge event handler
   * Routes events to appropriate processing functions with unified logging and monitoring
   */
  async handleEvent(
    event: EventBridgeEvent<string, any>,
    context: Context
  ): Promise<void> {
    const startTime = Date.now();
    const eventMetadata = {
      source: event.source,
      detailType: event['detail-type'],
      eventId: context.awsRequestId,
      region: event.region || 'unknown',
      account: event.account || 'unknown'
    };

    this.logger.info('Processing EventBridge event', 'handleEvent', eventMetadata);

    try {
      // Route to appropriate handler based on event source
      await this.routeEvent(event, eventMetadata);

      // Log successful processing
      const processingTime = Date.now() - startTime;
      this.logger.info('EventBridge event processed successfully', 'handleEvent', {
        ...eventMetadata,
        processingTimeMs: processingTime
      });

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error('Failed to process EventBridge event', 'handleEvent', error as Error, {
        ...eventMetadata,
        processingTimeMs: processingTime
      });
      
      // Re-throw error to ensure Lambda failure is recorded
      throw error;
    }
  }

  /**
   * Route events to appropriate processing functions
   */
  private async routeEvent(
    event: EventBridgeEvent<string, any>,
    metadata: any
  ): Promise<void> {
    switch (event.source) {
      case 'workflow-builder.deployment':
        this.logger.info('Routing to deployment event handler', 'routeEvent', metadata);
        await this.handleDeploymentEvent(event as DeploymentProgressEvent);
        break;

      case 'workflow-builder.deletion':
        this.logger.info('Routing to deletion event handler', 'routeEvent', metadata);
        await this.handleDeletionEvent(event);
        break;

      case 'aws.states':
        this.logger.info('Routing to Step Functions event handler', 'routeEvent', metadata);
        await this.handleStepFunctionsEvent(event as StepFunctionsStateChangeEvent);
        break;

      default:
        this.logger.warn(`Unknown event source: ${event.source}`, 'routeEvent', {
          ...metadata,
          supportedSources: ['workflow-builder.deployment', 'workflow-builder.deletion', 'aws.states']
        });
        
        // Don't throw error for unknown sources to maintain resilience
        // Just log and continue
        break;
    }
  }

  /**
   * Handle deletion events from workflow-builder.deletion source
   */
  private async handleDeletionEvent(event: EventBridgeEvent<string, any>): Promise<void> {
    const { detail } = event;
    
    if (!detail.workflowId && !detail.deploymentId) {
      this.logger.error('Missing workflowId/deploymentId in deletion event', 'handleDeletionEvent', new Error('Missing workflowId/deploymentId in deletion event'), {
        detail
      });
      return;
    }

    const workflowId = detail.workflowId || detail.deploymentId;
    const status = detail.status || 'deleting';
    const message = detail.message || this.getDeletionMessage(status);

    await this.sendDeploymentProgressMessage({
      deploymentId: workflowId,
      status,
      message,
      timestamp: detail.timestamp || new Date().toISOString(),
      error: detail.error
    });

    this.logger.info('Deletion event processed successfully', 'handleDeletionEvent', {
      workflowId,
      status,
      message
    });
  }

  /**
   * Get user-friendly message for deletion status
   */
  private getDeletionMessage(status: string): string {
    switch (status) {
      case 'deleting':
        return 'Workflow deletion in progress';
      case 'deleted':
        return 'Workflow deleted successfully';
      case 'failed':
        return 'Workflow deletion failed';
      default:
        return `Workflow deletion status: ${status}`;
    }
  }

  /**
   * Handle deployment progress events from workflow-builder.deployment
   */
  private async handleDeploymentEvent(event: DeploymentProgressEvent): Promise<void> {
    const { detail } = event;
    
    if (!detail.deploymentId) {
      this.logger.error('Missing deploymentId in deployment event', 'handleDeploymentEvent', undefined, {
        detail
      });
      return;
    }

    // Extract event type from the event detail or use a default mapping
    const eventType = this.extractEventType(event);
    const mapping = this.eventMapping[eventType];
    
    if (!mapping) {
      this.logger.warn(`Unknown deployment event type: ${eventType}`, 'handleDeploymentEvent', {
        eventType,
        detail
      });
      // Use fallback mapping for unknown events
      await this.sendDeploymentProgressMessage({
        deploymentId: detail.deploymentId,
        status: detail.status || 'unknown',
        message: detail.message || 'Deployment progress update',
        timestamp: detail.timestamp || new Date().toISOString(),
        userId: detail.userId
      });
      return;
    }

    // Send WebSocket message with mapped status and message
    await this.sendDeploymentProgressMessage({
      deploymentId: detail.deploymentId,
      status: mapping.status,
      message: mapping.message,
      timestamp: detail.timestamp || new Date().toISOString(),
      userId: detail.userId,
      error: detail.error
    });

    this.logger.info('Deployment event processed successfully', 'handleDeploymentEvent', {
      deploymentId: detail.deploymentId,
      eventType,
      status: mapping.status,
      message: mapping.message
    });
  }

  /**
   * Handle Step Functions state change events (backward compatibility)
   */
  private async handleStepFunctionsEvent(event: StepFunctionsStateChangeEvent): Promise<void> {
    const { detail } = event;
    
    this.logger.info('Processing Step Functions state change event', 'handleStepFunctionsEvent', {
      status: detail.status,
      stateMachineArn: detail.stateMachineArn,
      executionArn: detail.executionArn
    });

    // Extract deployment ID from Step Functions execution name or input
    const deploymentId = this.extractDeploymentIdFromStepFunctions(detail);
    
    if (!deploymentId) {
      this.logger.warn('Could not extract deploymentId from Step Functions event', 'handleStepFunctionsEvent', {
        detail
      });
      return;
    }

    // Determine if this is a deletion event based on state machine ARN
    const isDeletionEvent = this.isDeletionStateMachine(detail.stateMachineArn);
    
    // Map Step Functions status to deployment status
    const status = this.mapStepFunctionsStatus(detail.status, isDeletionEvent);
    const message = this.getStepFunctionsMessage(detail.status, detail.stateMachineArn, isDeletionEvent);

    // Preserve existing error handling patterns
    const errorInfo = this.extractStepFunctionsError(detail);

    await this.sendDeploymentProgressMessage({
      deploymentId,
      status,
      message,
      timestamp: new Date().toISOString(),
      error: errorInfo
    });

    this.logger.info('Step Functions event processed successfully', 'handleStepFunctionsEvent', {
      deploymentId,
      status: detail.status,
      mappedStatus: status,
      message,
      isDeletionEvent
    });
  }

  /**
   * Send deployment progress message via WebSocket with monitoring
   */
  private async sendDeploymentProgressMessage(params: {
    deploymentId: string;
    status: string;
    message: string;
    timestamp: string;
    userId?: string;
    error?: any;
  }): Promise<void> {
    const { deploymentId, status, message, timestamp, userId, error } = params;
    const startTime = Date.now();

    // Create WebSocket message
    const websocketMessage: DeploymentProgressMessage = {
      type: 'deployment_progress',
      deploymentId,
      status,
      message,
      timestamp,
      step: {
        name: message,
        completed: status === 'completed' || status === 'deleted'
      }
    };

    // Add error information if present
    if (error) {
      (websocketMessage as any).error = error;
    }

    try {
      if (userId) {
        // Send to specific user if userId is available
        await this.websocketService.broadcastDeploymentUpdate(
          deploymentId,
          userId,
          {
            deploymentId,
            environment: 'unknown', // This might need to be extracted from the event
            status: status as any,
            progress: {
              currentStep: message,
              completedSteps: [],
              totalSteps: 1,
              percentage: this.calculateProgressPercentage(status)
            },
            logs: [],
            createdAt: timestamp,
            updatedAt: timestamp,
            ...(status === 'completed' && { completedAt: timestamp }),
            ...(status === 'deleted' && { deletedAt: timestamp }),
            ...(error && { error })
          }
        );
      } else {
        // Broadcast to all connections for this deployment
        await this.broadcastToAllConnections(websocketMessage);
      }

      const processingTime = Date.now() - startTime;
      this.logger.info('WebSocket message sent successfully', 'sendDeploymentProgressMessage', {
        deploymentId,
        status,
        message,
        hasUserId: !!userId,
        processingTimeMs: processingTime
      });

      // Emit success metric
      this.emitMetric('WebSocketMessageSent', 1, { status, hasUserId: !!userId });

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error('Failed to send WebSocket message', 'sendDeploymentProgressMessage', error as Error, {
        deploymentId,
        status,
        message,
        processingTimeMs: processingTime
      });

      // Emit failure metric
      this.emitMetric('WebSocketMessageFailed', 1, { status, hasUserId: !!userId });
      
      // Don't re-throw to maintain resilience - log and continue
    }
  }

  /**
   * Calculate progress percentage based on status
   */
  private calculateProgressPercentage(status: string): number {
    switch (status) {
      case 'template_generated':
        return 20;
      case 'deploying_infrastructure':
        return 40;
      case 'stack_creating':
      case 'stack_updating':
        return 70;
      case 'in_progress':
      case 'deleting':
        return 50;
      case 'completed':
      case 'deleted':
        return 100;
      case 'failed':
        return 0;
      default:
        return 25;
    }
  }

  /**
   * Emit custom metrics for monitoring
   */
  private emitMetric(metricName: string, value: number, dimensions?: Record<string, any>): void {
    try {
      const dimensionStr = dimensions ? 
        Object.entries(dimensions).map(([k, v]) => `${k}=${v}`).join('|') : '';
      console.log(`METRIC|${metricName}|${value}|Count${dimensionStr ? '|' + dimensionStr : ''}`);
    } catch (error) {
      this.logger.warn('Failed to emit metric', 'emitMetric', {
        metricName,
        value,
        dimensions,
        error: (error as Error).message
      });
    }
  }

  /**
   * Broadcast message to all active WebSocket connections
   */
  private async broadcastToAllConnections(message: DeploymentProgressMessage): Promise<void> {
    try {
      const result = await this.broadcaster.broadcastToDeploymentConnections(
        message.deploymentId,
        message
      );

      this.logger.info('Broadcast completed using new broadcaster', 'broadcastToAllConnections', {
        deploymentId: message.deploymentId,
        totalConnections: result.totalConnections,
        successful: result.successful,
        failed: result.failed,
        retried: result.retried,
        staleConnectionsRemoved: result.staleConnectionsRemoved
      });
    } catch (error) {
      this.logger.error('Failed to broadcast message using new broadcaster', 'broadcastToAllConnections', error as Error, {
        deploymentId: message.deploymentId
      });
      
      // Fallback to original method if new broadcaster fails
      await this.fallbackBroadcast(message);
    }
  }

  /**
   * Fallback broadcast method using original WebSocketService
   */
  private async fallbackBroadcast(message: DeploymentProgressMessage): Promise<void> {
    try {
      this.logger.info('Using fallback broadcast method', 'fallbackBroadcast', {
        deploymentId: message.deploymentId
      });

      // Get all active connections for this deployment
      const connections = await this.websocketService.getDeploymentConnections(message.deploymentId);
      
      if (connections.length === 0) {
        this.logger.info('No active connections found for deployment', 'fallbackBroadcast', {
          deploymentId: message.deploymentId
        });
        return;
      }

      // Send message to all connections
      const results = await Promise.allSettled(
        connections.map(connectionId => 
          this.websocketService.sendToConnection(connectionId, message)
        )
      );

      const successful = results.filter(result => 
        result.status === 'fulfilled' && result.value === true
      ).length;
      
      const failed = results.length - successful;

      this.logger.info('Fallback broadcast completed', 'fallbackBroadcast', {
        deploymentId: message.deploymentId,
        totalConnections: connections.length,
        successful,
        failed
      });
    } catch (error) {
      this.logger.error('Fallback broadcast also failed', 'fallbackBroadcast', error as Error, {
        deploymentId: message.deploymentId
      });
    }
  }

  /**
   * Extract event type from deployment event
   */
  private extractEventType(event: DeploymentProgressEvent): string {
    // Try to extract from detail-type or detail
    if (event['detail-type']) {
      return event['detail-type'];
    }
    
    // Try to extract from detail.eventType or detail.type
    if (event.detail && typeof event.detail === 'object') {
      const detail = event.detail as any;
      if (detail.eventType) return detail.eventType;
      if (detail.type) return detail.type;
      if (detail.status) return detail.status;
    }
    
    return 'UnknownEvent';
  }

  /**
   * Extract deployment ID from Step Functions event (enhanced for backward compatibility)
   */
  private extractDeploymentIdFromStepFunctions(detail: any): string | null {
    // Try to extract from execution name (multiple patterns for backward compatibility)
    if (detail.name && typeof detail.name === 'string') {
      // Pattern 1: deployment-{id} or deployment_{id}
      let match = detail.name.match(/deployment[_-]([a-zA-Z0-9-]+)/i);
      if (match) return match[1];
      
      // Pattern 2: workflow-{id} (for older executions)
      match = detail.name.match(/workflow[_-]([a-zA-Z0-9-]+)/i);
      if (match) return match[1];
      
      // Pattern 3: {workflowId}-deployment or {workflowId}-deletion
      match = detail.name.match(/^([a-zA-Z0-9-]+)-(deployment|deletion)/i);
      if (match) return match[1];
      
      // Pattern 4: Direct UUID/ID format (fallback)
      match = detail.name.match(/^([a-zA-Z0-9-]{8,})/);
      if (match) return match[1];
    }

    // Try to extract from input (preserve existing logic)
    if (detail.input) {
      try {
        const input = typeof detail.input === 'string' ? JSON.parse(detail.input) : detail.input;
        if (input.deploymentId) return input.deploymentId;
        if (input.workflowId) return input.workflowId; // Fallback to workflowId
        if (input.id) return input.id; // Additional fallback
      } catch (error) {
        this.logger.warn('Failed to parse Step Functions input', 'extractDeploymentIdFromStepFunctions', {
          input: detail.input,
          error: (error as Error).message
        });
      }
    }

    // Try to extract from output (preserve existing logic)
    if (detail.output) {
      try {
        const output = typeof detail.output === 'string' ? JSON.parse(detail.output) : detail.output;
        if (output.deploymentId) return output.deploymentId;
        if (output.workflowId) return output.workflowId;
        if (output.id) return output.id; // Additional fallback
      } catch (error) {
        this.logger.warn('Failed to parse Step Functions output', 'extractDeploymentIdFromStepFunctions', {
          output: detail.output,
          error: (error as Error).message
        });
      }
    }

    // Try to extract from executionArn as last resort
    if (detail.executionArn) {
      const match = detail.executionArn.match(/:execution:([^:]+):([^:]+)$/);
      if (match && match[2]) {
        // Extract ID from execution name in ARN
        const executionName = match[2];
        const idMatch = executionName.match(/([a-zA-Z0-9-]{8,})/);
        if (idMatch) return idMatch[1];
      }
    }

    this.logger.warn('Could not extract deployment ID from Step Functions event', 'extractDeploymentIdFromStepFunctions', {
      name: detail.name,
      executionArn: detail.executionArn,
      hasInput: !!detail.input,
      hasOutput: !!detail.output
    });

    return null;
  }

  /**
   * Check if the state machine is a deletion state machine
   */
  private isDeletionStateMachine(stateMachineArn?: string): boolean {
    if (!stateMachineArn) return false;
    return stateMachineArn.includes('workflow-builder-deletion');
  }

  /**
   * Extract error information from Step Functions event detail
   */
  private extractStepFunctionsError(detail: any): any {
    if (detail.status === 'FAILED' || detail.status === 'TIMED_OUT' || detail.status === 'ABORTED') {
      return {
        code: 'STEP_FUNCTIONS_FAILURE',
        message: detail.cause || detail.error || `Step Functions execution ${detail.status.toLowerCase()}`,
        details: {
          status: detail.status,
          cause: detail.cause,
          error: detail.error,
          executionArn: detail.executionArn,
          stateMachineArn: detail.stateMachineArn
        }
      };
    }
    return undefined;
  }

  /**
   * Map Step Functions status to deployment status (with deletion support)
   */
  private mapStepFunctionsStatus(status: string, isDeletionEvent: boolean = false): string {
    switch (status) {
      case 'RUNNING':
        return isDeletionEvent ? 'deleting' : 'in_progress';
      case 'SUCCEEDED':
        return isDeletionEvent ? 'deleted' : 'completed';
      case 'FAILED':
      case 'TIMED_OUT':
      case 'ABORTED':
        return 'failed';
      default:
        return 'unknown';
    }
  }

  /**
   * Get user-friendly message for Step Functions status (with deletion support)
   */
  private getStepFunctionsMessage(status: string, stateMachineArn?: string, isDeletionEvent: boolean = false): string {
    const stateMachineName = stateMachineArn ? 
      stateMachineArn.split(':').pop()?.split('/').pop() || 'Unknown' : 'Unknown';

    const operationType = isDeletionEvent ? 'deletion' : 'deployment';

    switch (status) {
      case 'RUNNING':
        return isDeletionEvent ? 
          `Workflow deletion in progress` : 
          `Workflow deployment in progress`;
      case 'SUCCEEDED':
        return isDeletionEvent ? 
          `Workflow deleted successfully` : 
          `Workflow deployment completed successfully`;
      case 'FAILED':
        return isDeletionEvent ? 
          `Workflow deletion failed` : 
          `Workflow deployment failed`;
      case 'TIMED_OUT':
        return `Workflow ${operationType} timed out`;
      case 'ABORTED':
        return `Workflow ${operationType} was aborted`;
      default:
        return `Workflow ${operationType} status: ${status}`;
    }
  }
}

/**
 * Lambda function handler for EventBridge events
 */
const websocketEndpoint = process.env.WEBSOCKET_ENDPOINT || '';
const region = process.env.AWS_REGION!;
const eventBridgeHandlerInstance = new EventBridgeHandler(websocketEndpoint, region);

/**
 * Main EventBridge handler function with comprehensive error handling and monitoring
 */
export const handler = async (
  event: EventBridgeEvent<string, any>,
  context: Context
): Promise<void> => {
  // Set up context logging
  const logger = new DeploymentLogger('eventbridge', 'main-handler');
  
  try {
    // Log incoming event (without sensitive data)
    logger.info('EventBridge handler invoked', 'handler', {
      source: event.source,
      detailType: event['detail-type'],
      region: event.region,
      account: event.account,
      requestId: context.awsRequestId,
      functionName: context.functionName,
      functionVersion: context.functionVersion,
      remainingTimeMs: context.getRemainingTimeInMillis()
    });

    // Process the event
    await eventBridgeHandlerInstance.handleEvent(event, context);

    logger.info('EventBridge handler completed successfully', 'handler', {
      requestId: context.awsRequestId,
      remainingTimeMs: context.getRemainingTimeInMillis()
    });

  } catch (error) {
    logger.error('EventBridge handler failed', 'handler', error as Error, {
      source: event.source,
      detailType: event['detail-type'],
      requestId: context.awsRequestId,
      remainingTimeMs: context.getRemainingTimeInMillis()
    });

    // Emit custom metric for monitoring (if CloudWatch metrics are available)
    try {
      // This would typically integrate with CloudWatch metrics
      console.log(`METRIC|EventBridgeHandlerError|1|Count|Source=${event.source}`);
    } catch (metricError) {
      logger.warn('Failed to emit error metric', 'handler', {
        metricError: (metricError as Error).message
      });
    }

    // Re-throw to ensure Lambda failure is recorded
    throw error;
  }
};

/**
 * Legacy export for backward compatibility
 */
export const eventBridgeHandler = handler;

/**
 * Export handler class for testing
 */
export { EventBridgeHandler };