import { apiService } from './api';

export interface DeploymentRequest {
  workflowId: string;
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

// Mock deployment storage for demo purposes
const mockDeployments = new Map<string, DeploymentStatus>();

export class DeploymentService {
  /**
   * Deploy a workflow to AWS Step Functions
   */
  static async deployWorkflow(request: DeploymentRequest): Promise<DeploymentResponse> {
    try {
      // Temporary mock implementation until API endpoint is available
      console.log('Mock deployment request:', request);
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const deploymentId = `deploy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Create mock deployment status
      const mockDeploymentStatus: DeploymentStatus = {
        deploymentId,
        workflowId: request.workflowId,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: [
          { id: 'iam-roles', name: 'Create IAM Roles', status: 'pending' },
          { id: 'lambda-functions', name: 'Deploy Lambda Functions', status: 'pending' },
          { id: 'log-groups', name: 'Create Log Groups', status: 'pending' },
          { id: 'step-function', name: 'Create Step Function', status: 'pending' },
          { id: 'validation', name: 'Validate Deployment', status: 'pending' },
        ],
      };
      
      // Store mock deployment
      mockDeployments.set(deploymentId, mockDeploymentStatus);
      
      // Start mock deployment process
      this.simulateDeployment(deploymentId);
      
      const mockResponse: DeploymentResponse = {
        deploymentId,
        status: 'pending',
        message: 'Deployment started successfully (Mock)',
        statusUrl: `/api/deployments/${deploymentId}/status`,
      };
      
      return mockResponse;
      
      // Real implementation (commented out until endpoint is available)
      // const response = await apiService.post<DeploymentResponse>('/deployments', request);
      // return response;
    } catch (error) {
      console.error('Failed to deploy workflow:', error);
      throw new Error('Failed to start deployment. Please try again.');
    }
  }

  /**
   * Get deployment status
   */
  static async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
    try {
      // Real implementation
      const response = await apiService.get<DeploymentStatus>(`/deployments/${deploymentId}/status`);
      return response;
      
      // Mock implementation (fallback)
      // const mockStatus = mockDeployments.get(deploymentId);
      // if (!mockStatus) {
      //   throw new Error('Deployment not found');
      // }
      // return mockStatus;
    } catch (error) {
      console.error('Failed to get deployment status:', error);
      throw new Error('Failed to get deployment status. Please try again.');
    }
  }

  /**
   * Simulate deployment process for demo
   */
  private static async simulateDeployment(deploymentId: string): Promise<void> {
    const deployment = mockDeployments.get(deploymentId);
    if (!deployment) return;

    // Simulate deployment steps
    const steps = [
      { id: 'iam-roles', duration: 3000 },
      { id: 'lambda-functions', duration: 5000 },
      { id: 'log-groups', duration: 2000 },
      { id: 'step-function', duration: 4000 },
      { id: 'validation', duration: 2000 },
    ];

    deployment.status = 'in_progress';
    deployment.updatedAt = new Date().toISOString();

    for (const stepConfig of steps) {
      const step = deployment.steps.find(s => s.id === stepConfig.id);
      if (!step) continue;

      // Start step
      step.status = 'in_progress';
      step.startTime = new Date().toISOString();
      deployment.updatedAt = new Date().toISOString();

      // Simulate step duration
      await new Promise(resolve => setTimeout(resolve, stepConfig.duration));

      // Complete step
      step.status = 'completed';
      step.endTime = new Date().toISOString();
      step.duration = stepConfig.duration;
      deployment.updatedAt = new Date().toISOString();
    }

    // Complete deployment
    deployment.status = 'completed';
    deployment.stepFunctionArn = `arn:aws:states:us-east-1:123456789012:stateMachine:workflow-${deployment.workflowId}-StateMachine`;
    deployment.updatedAt = new Date().toISOString();

    mockDeployments.set(deploymentId, deployment);
  }

  /**
   * Poll deployment status until completion
   */
  static async pollDeploymentStatus(
    deploymentId: string,
    onUpdate?: (status: DeploymentStatus) => void,
    maxAttempts: number = 60,
    intervalMs: number = 2000 // Reduced for demo
  ): Promise<DeploymentStatus> {
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        const status = await this.getDeploymentStatus(deploymentId);
        
        if (onUpdate) {
          onUpdate(status);
        }
        
        // Check if deployment is complete
        if (['completed', 'failed', 'cancelled'].includes(status.status)) {
          return status;
        }
        
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        attempts++;
        
      } catch (error) {
        console.error('Error polling deployment status:', error);
        attempts++;
        
        if (attempts >= maxAttempts) {
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }
    
    throw new Error('Deployment status polling timed out');
  }

  /**
   * Cancel a deployment (if supported)
   */
  static async cancelDeployment(deploymentId: string): Promise<void> {
    try {
      // Mock implementation
      const deployment = mockDeployments.get(deploymentId);
      if (deployment) {
        deployment.status = 'cancelled';
        deployment.updatedAt = new Date().toISOString();
        mockDeployments.set(deploymentId, deployment);
      }
      
      // Real implementation (commented out until endpoint is available)
      // await apiService.post(`/deployments/${deploymentId}/cancel`);
    } catch (error) {
      console.error('Failed to cancel deployment:', error);
      throw new Error('Failed to cancel deployment. Please try again.');
    }
  }

  /**
   * Get deployment history for a workflow
   */
  static async getWorkflowDeployments(workflowId: string): Promise<DeploymentStatus[]> {
    try {
      // Mock implementation
      const deployments = Array.from(mockDeployments.values())
        .filter(d => d.workflowId === workflowId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      return deployments;
      
      // Real implementation (commented out until endpoint is available)
      // const response = await apiService.get<DeploymentStatus[]>(`/workflows/${workflowId}/deployments`);
      // return response;
    } catch (error) {
      console.error('Failed to get workflow deployments:', error);
      throw new Error('Failed to get deployment history. Please try again.');
    }
  }

  /**
   * Validate workflow for deployment
   */
  static validateWorkflowForDeployment(workflow: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check if workflow has nodes
    if (!workflow.nodes || workflow.nodes.length === 0) {
      errors.push('Workflow must have at least one node');
    }

    // Check for start node
    const hasStartNode = workflow.nodes.some((node: any) => node.type === 'start');
    if (!hasStartNode) {
      errors.push('Workflow must have a start node');
    }

    // Check for end node
    const hasEndNode = workflow.nodes.some((node: any) => node.type === 'end');
    if (!hasEndNode) {
      errors.push('Workflow must have an end node');
    }

    // Check all nodes are configured
    const unconfiguredNodes = workflow.nodes.filter((node: any) => !node.isConfigured);
    if (unconfiguredNodes.length > 0) {
      errors.push(`The following nodes are not configured: ${unconfiguredNodes.map((n: any) => n.name).join(', ')}`);
    }

    // Check connections
    if (!workflow.connections || workflow.connections.length === 0) {
      if (workflow.nodes.length > 1) {
        errors.push('Workflow nodes must be connected');
      }
    }

    // Check for isolated nodes (nodes without connections)
    if (workflow.nodes.length > 2) { // More than just start and end
      const connectedNodeIds = new Set();
      workflow.connections.forEach((conn: any) => {
        connectedNodeIds.add(conn.sourceNodeId);
        connectedNodeIds.add(conn.targetNodeId);
      });

      const isolatedNodes = workflow.nodes.filter((node: any) => 
        node.type !== 'start' && node.type !== 'end' && !connectedNodeIds.has(node.id)
      );

      if (isolatedNodes.length > 0) {
        errors.push(`The following nodes are not connected: ${isolatedNodes.map((n: any) => n.name).join(', ')}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}