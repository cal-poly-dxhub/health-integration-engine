// Step Functions service for interacting with AWS Step Functions API
import { apiService } from './api';

export interface StepFunctionExecution {
  executionArn: string;
  name: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'ABORTED';
  startDate: string;
  stopDate?: string;
  input?: string;
  output?: string;
  stateMachineArn?: string;
  inputDetails?: {
    included: boolean;
    truncated?: boolean;
  };
  outputDetails?: {
    included: boolean;
    truncated?: boolean;
  };
  redriveCount?: number;
  redriveStatus?: string;
  redriveStatusReason?: string;
}

export interface ExecutionHistoryEvent {
  timestamp: string;
  type: string;
  id: number;
  previousEventId?: number;
  stateEnteredEventDetails?: {
    name: string;
    input?: string;
    inputDetails?: {
      truncated?: boolean;
    };
  };
  stateExitedEventDetails?: {
    name: string;
    output?: string;
    outputDetails?: {
      truncated?: boolean;
    };
  };
  taskStateEnteredEventDetails?: {
    name: string;
    input?: string;
    inputDetails?: {
      truncated?: boolean;
    };
  };
  taskSucceededEventDetails?: {
    output?: string;
    outputDetails?: {
      truncated?: boolean;
    };
  };
  taskFailedEventDetails?: {
    error?: string;
    cause?: string;
  };
  lambdaFunctionSucceededEventDetails?: {
    output?: string;
    outputDetails?: {
      truncated?: boolean;
    };
  };
  lambdaFunctionFailedEventDetails?: {
    error?: string;
    cause?: string;
  };
  // Additional event details for execution events
  executionStartedEventDetails?: {
    input?: string;
    inputDetails?: {
      truncated?: boolean;
    };
  };
  executionSucceededEventDetails?: {
    output?: string;
    outputDetails?: {
      truncated?: boolean;
    };
  };
  executionFailedEventDetails?: {
    error?: string;
    cause?: string;
  };
  taskScheduledEventDetails?: {
    resource?: string;
    region?: string;
    resourceType?: string;
  };
}

export interface StateMachineDetails {
  stateMachineArn: string;
  name: string;
  status?: string;
  definition: string;
  roleArn: string;
  type?: string;
  creationDate?: string;
  updateDate?: string;
  loggingConfiguration?: {
    level: string;
    includeExecutionData: boolean;
    destinations: Array<{
      cloudWatchLogsLogGroup: {
        logGroupArn: string;
      };
    }>;
  };
  tracingConfiguration?: {
    enabled: boolean;
  };
  encryptionConfiguration?: {
    type: string;
  };
}

export interface ListExecutionsResponse {
  executions: StepFunctionExecution[];
  nextToken?: string;
}

export interface StartExecutionResponse {
  executionArn: string;
  startDate: string;
}

export interface ExecutionHistoryResponse {
  events: ExecutionHistoryEvent[];
  nextToken?: string;
}

class StepFunctionsService {
  async listExecutions(stateMachineArn: string, maxResults: number = 100): Promise<StepFunctionExecution[]> {
    console.log('🔄 StepFunctionsService: Listing executions for state machine:', stateMachineArn);
    try {
      const data: ListExecutionsResponse = await apiService.post('/deployments/step-functions/list-executions', {
        stateMachineArn,
        maxResults
      });
      console.log('✅ StepFunctionsService: List executions response:', data);
      const executions = data.executions || [];
      console.log('✅ StepFunctionsService: Returning', executions.length, 'executions');
      return executions;
    } catch (error) {
      console.error('❌ StepFunctionsService: Error listing executions:', error);
      return [];
    }
  }

  async startExecution(
    stateMachineArn: string, 
    name?: string, 
    input: string = '{}'
  ): Promise<StartExecutionResponse | null> {
    try {
      return await apiService.post<StartExecutionResponse>('/deployments/step-functions/start-execution', {
        stateMachineArn,
        name: name || `execution-${Date.now()}`,
        input
      });
    } catch (error) {
      console.error('Error starting execution:', error);
      return null;
    }
  }

  async stopExecution(executionArn: string, error?: string, cause?: string): Promise<boolean> {
    try {
      await apiService.post('/deployments/step-functions/stop-execution', {
        executionArn,
        error,
        cause
      });
      return true;
    } catch (error) {
      console.error('Error stopping execution:', error);
      return false;
    }
  }

  async describeExecution(executionArn: string): Promise<StepFunctionExecution | null> {
    console.log('🔄 StepFunctionsService: Describing execution for:', executionArn);
    try {
      const result = await apiService.post<StepFunctionExecution>('/deployments/step-functions/describe-execution', {
        executionArn
      });
      console.log('✅ StepFunctionsService: Describe execution response:', result);
      return result;
    } catch (error) {
      console.error('❌ StepFunctionsService: Error describing execution:', error);
      return null;
    }
  }

  async getExecutionHistory(executionArn: string): Promise<ExecutionHistoryEvent[]> {
    console.log('🔄 StepFunctionsService: Getting execution history for:', executionArn);
    try {
      const data: ExecutionHistoryResponse = await apiService.post('/deployments/step-functions/execution-history', {
        executionArn,
        includeExecutionData: true,
        reverseOrder: false
      });
      console.log('✅ StepFunctionsService: Execution history response:', data);
      const events = data.events || [];
      console.log('✅ StepFunctionsService: Returning', events.length, 'events');
      return events;
    } catch (error) {
      console.error('❌ StepFunctionsService: Error getting execution history:', error);
      return [];
    }
  }

  async describeStateMachine(stateMachineArn: string): Promise<StateMachineDetails | null> {
    try {
      return await apiService.post<StateMachineDetails>('/deployments/step-functions/describe-state-machine', {
        stateMachineArn
      });
    } catch (error) {
      console.error('Error describing state machine:', error);
      return null;
    }
  }

  async describeStateMachineForExecution(executionArn: string): Promise<StateMachineDetails | null> {
    console.log('🔄 StepFunctionsService: Describing state machine for execution:', executionArn);
    try {
      const result = await apiService.post<StateMachineDetails>('/deployments/step-functions/describe-state-machine-for-execution', {
        executionArn
      });
      console.log('✅ StepFunctionsService: Describe state machine response:', result);
      return result;
    } catch (error) {
      console.error('❌ StepFunctionsService: Error describing state machine for execution:', error);
      return null;
    }
  }
}

export const stepFunctionsService = new StepFunctionsService();

// Deployment status checking interfaces and utilities
export interface DeploymentStatusCheck {
  workflowId: string;
  status: 'draft' | 'pending' | 'deploying' | 'deployed' | 'failed';
  isDeployed: boolean;
  stepFunctionStatus?: string;
  lastChecked: string;
  error?: string;
}

export interface BatchStatusCheckResult {
  workflowId: string;
  originalStatus: string;
  verifiedStatus: 'draft' | 'pending' | 'deploying' | 'deployed' | 'failed';
  isDeployed: boolean;
  statusChanged: boolean;
  error?: string;
}

// Enhanced StepFunctions service with deployment status checking
class DeploymentStatusService {
  /**
   * Check deployment status for a single workflow
   */
  async checkWorkflowDeploymentStatus(
    workflowId: string, 
    stepFunctionArn: string,
    currentStatus: string
  ): Promise<DeploymentStatusCheck> {
    const result: DeploymentStatusCheck = {
      workflowId,
      status: currentStatus as any,
      isDeployed: false,
      lastChecked: new Date().toISOString(),
    };

    if (!stepFunctionArn) {
      // No Step Function ARN means it's definitely not deployed
      result.status = 'draft';
      result.isDeployed = false;
      return result;
    }

    try {
      console.log(`🔍 Checking deployment status for workflow ${workflowId} with ARN: ${stepFunctionArn}`);
      
      const stateMachineDetails = await stepFunctionsService.describeStateMachine(stepFunctionArn);
      
      if (stateMachineDetails) {
        // Step Function exists and is active
        result.status = 'deployed';
        result.isDeployed = true;
        result.stepFunctionStatus = stateMachineDetails.status;
        console.log(`✅ Workflow ${workflowId} is deployed (Step Function status: ${stateMachineDetails.status})`);
      } else {
        // Step Function doesn't exist or was deleted - mark as pending (not deployed)
        result.status = 'pending';
        result.isDeployed = false;
        console.log(`❌ Workflow ${workflowId} Step Function not found - marking as pending`);
      }
    } catch (error) {
      console.error(`❌ Error checking deployment status for workflow ${workflowId}:`, error);
      
      // Check if it's a 404 (not found) vs other errors
      if (error && typeof error === 'object' && 'message' in error) {
        const errorMessage = (error as any).message || '';
        if (errorMessage.includes('404') || errorMessage.includes('not found')) {
          // Step Function was deleted
          result.status = 'pending';
          result.isDeployed = false;
        } else {
          // Other error - keep current status but log error
          result.error = errorMessage;
        }
      } else {
        result.error = 'Unknown error checking deployment status';
      }
    }

    return result;
  }

  /**
   * Check deployment status for multiple workflows in parallel
   */
  async batchCheckDeploymentStatus(
    workflows: Array<{
      id: string;
      stepFunctionArn?: string;
      deploymentStatus?: string;
      isDeployed?: boolean;
    }>
  ): Promise<BatchStatusCheckResult[]> {
    console.log(`🔄 Batch checking deployment status for ${workflows.length} workflows`);
    
    // Filter workflows that have Step Function ARNs and might be deployed
    const workflowsToCheck = workflows.filter(w => 
      w.stepFunctionArn && 
      (w.deploymentStatus === 'deployed' || w.isDeployed)
    );

    if (workflowsToCheck.length === 0) {
      console.log('📝 No workflows need status verification');
      return workflows.map(w => ({
        workflowId: w.id,
        originalStatus: w.deploymentStatus || 'pending',
        verifiedStatus: (w.deploymentStatus as any) || 'pending',
        isDeployed: w.isDeployed || false,
        statusChanged: false,
      }));
    }

    console.log(`🔍 Checking ${workflowsToCheck.length} workflows with Step Function ARNs`);

    // Check status in parallel with concurrency limit
    const CONCURRENCY_LIMIT = 3;
    const results: BatchStatusCheckResult[] = [];
    
    for (let i = 0; i < workflowsToCheck.length; i += CONCURRENCY_LIMIT) {
      const batch = workflowsToCheck.slice(i, i + CONCURRENCY_LIMIT);
      
      const batchPromises = batch.map(async (workflow) => {
        const statusCheck = await this.checkWorkflowDeploymentStatus(
          workflow.id,
          workflow.stepFunctionArn!,
          workflow.deploymentStatus || 'pending'
        );

        const originalStatus = workflow.deploymentStatus || 'pending';
        const statusChanged = statusCheck.status !== originalStatus || 
                            statusCheck.isDeployed !== workflow.isDeployed;

        return {
          workflowId: workflow.id,
          originalStatus,
          verifiedStatus: statusCheck.status,
          isDeployed: statusCheck.isDeployed,
          statusChanged,
          error: statusCheck.error,
        };
      });

      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          const workflow = batch[index];
          results.push({
            workflowId: workflow.id,
            originalStatus: workflow.deploymentStatus || 'pending',
            verifiedStatus: 'pending', // Default to pending on error
            isDeployed: false,
            statusChanged: true,
            error: `Failed to check status: ${result.reason}`,
          });
        }
      });
    }

    // Add results for workflows that weren't checked
    workflows.forEach(workflow => {
      if (!workflowsToCheck.find(w => w.id === workflow.id)) {
        results.push({
          workflowId: workflow.id,
          originalStatus: workflow.deploymentStatus || 'pending',
          verifiedStatus: (workflow.deploymentStatus as any) || 'pending',
          isDeployed: workflow.isDeployed || false,
          statusChanged: false,
        });
      }
    });

    const changedCount = results.filter(r => r.statusChanged).length;
    console.log(`✅ Batch status check complete: ${changedCount} workflows had status changes`);

    return results;
  }
}

export const deploymentStatusService = new DeploymentStatusService();