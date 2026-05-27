import { apiService } from './api';

// Polling configuration for deployment status checks.
const POLLING_MAX_ATTEMPTS = 60;
const POLLING_INTERVAL_MS = 5000;
const REQUEST_TIMEOUT_MS = 30000;

export interface DeploymentRequest {
  workflowId: string;
  workflowData?: any; // Include workflow data for localStorage-based workflows
  deploymentName?: string;
  environment?: 'development' | 'staging' | 'production';
  configuration?: {
    enableLogging?: boolean;
    enableXRay?: boolean;
    tags?: Record<string, string>;
    vpcConfig?: {
      mode: 'none' | 'existing' | 'new';
      existing?: {
        vpcId: string;
        subnetIds: string[];
        securityGroupIds: string[];
      };
      new?: {
        cidrBlock?: string;
      };
    };
  };
}

export interface DeploymentStep {
  id: string;
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  startTime?: string;
  endTime?: string;
  duration?: number;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface DeploymentStatus {
  deploymentId: string;
  workflowId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  stepFunctionArn?: string;
  createdAt: string;
  updatedAt: string;
  steps: DeploymentStep[];
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface DeploymentResponse {
  deploymentId: string;
  status: string;
  message: string;
  statusUrl: string;
}

export class DeploymentService {
  /**
   * Deploy a workflow to AWS Step Functions via the backend API.
   */
  static async deployWorkflow(request: DeploymentRequest): Promise<DeploymentResponse> {
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Request timeout after ${REQUEST_TIMEOUT_MS / 1000} seconds`)),
          REQUEST_TIMEOUT_MS,
        );
      });

      const apiPromise = apiService.post<DeploymentResponse>('/deployments', request);
      const response = await Promise.race([apiPromise, timeoutPromise]);
      return response;
    } catch (error) {
      console.error('Failed to deploy workflow to AWS:', error);

      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }

      if ((error as any).code === 'NETWORK_ERROR' || (error as any).message?.includes('Network Error')) {
        throw new Error(
          'Network error: Unable to connect to AWS deployment service. Please check your internet connection.',
        );
      }
      if ((error as any).response?.status === 401 || (error as any).response?.status === 403) {
        throw new Error('Authentication error: Please sign in again to deploy workflows.');
      }
      if ((error as any).code === 'ECONNABORTED' || (error as any).message?.includes('timeout')) {
        throw new Error('Request timeout: The deployment service is taking too long to respond. Please try again.');
      }

      throw new Error(
        `Failed to start AWS deployment: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get the current status of a deployment from the backend.
   */
  static async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
    try {
      return await apiService.get<DeploymentStatus>(`/deployments/${deploymentId}/status`);
    } catch (error) {
      console.error('Failed to get deployment status from AWS:', error);
      throw new Error('Failed to get deployment status. Please try again.');
    }
  }

  /**
   * Poll deployment status until it reaches a terminal state or times out.
   */
  static async pollDeploymentStatus(
    deploymentId: string,
    onUpdate?: (status: DeploymentStatus) => void,
    maxAttempts: number = POLLING_MAX_ATTEMPTS,
    intervalMs: number = POLLING_INTERVAL_MS,
  ): Promise<DeploymentStatus> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const status = await this.getDeploymentStatus(deploymentId);

        if (onUpdate) {
          onUpdate(status);
        }

        if (['completed', 'failed', 'cancelled'].includes(status.status)) {
          return status;
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        attempts++;
      } catch (error) {
        console.error('Error polling deployment status:', error);
        attempts++;

        if (attempts >= maxAttempts) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    throw new Error('Deployment status polling timed out');
  }

  /**
   * Cancel an in-progress deployment.
   */
  static async cancelDeployment(deploymentId: string): Promise<void> {
    try {
      await apiService.post(`/deployments/${deploymentId}/cancel`);
    } catch (error) {
      console.error('Failed to cancel AWS deployment:', error);
      throw new Error('Failed to cancel deployment. Please try again.');
    }
  }

  /**
   * Get deployment history for a workflow.
   */
  static async getWorkflowDeployments(workflowId: string): Promise<DeploymentStatus[]> {
    try {
      return await apiService.get<DeploymentStatus[]>(`/workflows/${workflowId}/deployments`);
    } catch (error) {
      console.error('Failed to get workflow deployments from AWS:', error);
      throw new Error('Failed to get deployment history. Please try again.');
    }
  }

  /**
   * Validate a workflow's structural requirements before deployment.
   * Does not hit AWS; this is a pure client-side check.
   */
  static validateWorkflowForDeployment(workflow: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!workflow.nodes || workflow.nodes.length === 0) {
      errors.push('Workflow must have at least one node');
    }

    const hasStartNode = workflow.nodes.some((node: any) => node.type === 'start');
    if (!hasStartNode) {
      errors.push('Workflow must have a start node');
    }

    const hasEndNode = workflow.nodes.some((node: any) => node.type === 'end');
    if (!hasEndNode) {
      errors.push('Workflow must have an end node');
    }

    const unconfiguredNodes = workflow.nodes.filter((node: any) => !node.isConfigured);
    if (unconfiguredNodes.length > 0) {
      errors.push(
        `The following nodes are not configured: ${unconfiguredNodes.map((n: any) => n.name).join(', ')}`,
      );
    }

    if (!workflow.connections || workflow.connections.length === 0) {
      if (workflow.nodes.length > 1) {
        errors.push('Workflow nodes must be connected');
      }
    }

    if (workflow.nodes.length > 2) {
      const connectedNodeIds = new Set();
      workflow.connections.forEach((conn: any) => {
        connectedNodeIds.add(conn.sourceNodeId);
        connectedNodeIds.add(conn.targetNodeId);
      });

      const isolatedNodes = workflow.nodes.filter(
        (node: any) =>
          node.type !== 'start' &&
          node.type !== 'end' &&
          node.type !== 'opensearch' &&
          !connectedNodeIds.has(node.id),
      );

      if (isolatedNodes.length > 0) {
        errors.push(
          `The following nodes are not connected: ${isolatedNodes.map((n: any) => n.name).join(', ')}`,
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
