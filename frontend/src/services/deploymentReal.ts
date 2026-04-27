import { apiService } from './api';
import { DEPLOYMENT_CONFIG, shouldUseRealAPI } from './deploymentConfig';

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

// Mock deployment storage for demo purposes
const mockDeployments = new Map<string, DeploymentStatus>();

export class DeploymentService {
  /**
   * Deploy a workflow to AWS Step Functions
   */
  static async deployWorkflow(request: DeploymentRequest): Promise<DeploymentResponse> {
    if (shouldUseRealAPI()) {
      return this.deployWorkflowReal(request);
    } else {
      return this.deployWorkflowMock(request);
    }
  }

  /**
   * Real AWS deployment
   */
  private static async deployWorkflowReal(request: DeploymentRequest): Promise<DeploymentResponse> {
    try {
      console.log('🚀 Real deployment request:', request);
      
      // Debug: Check if we have auth tokens
      try {
        const authService = await import('./auth');
        const tokens = await authService.authService.getTokens();
        console.log('🔐 Auth tokens available:', !!tokens.accessToken);
        console.log('🔐 Token preview:', tokens.accessToken?.substring(0, 20) + '...');
      } catch (authError) {
        console.error('🔐 Auth token error:', authError);
      }
      
      console.log('📡 Making API call to /deployments...');
      
      // Add a timeout promise to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000);
      });
      
      const apiPromise = apiService.post<DeploymentResponse>('/deployments', request);
      
      const response = await Promise.race([apiPromise, timeoutPromise]);
      console.log('✅ API call successful:', response);
      return response;
    } catch (error) {
      console.error('❌ Failed to deploy workflow to AWS:', error);
      
      // Log more details about the error
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }
      
      // Check if it's a network error
      if ((error as any).code === 'NETWORK_ERROR' || (error as any).message?.includes('Network Error')) {
        throw new Error('Network error: Unable to connect to AWS deployment service. Please check your internet connection.');
      }
      
      // Check if it's an authentication error
      if ((error as any).response?.status === 401 || (error as any).response?.status === 403) {
        throw new Error('Authentication error: Please sign in again to deploy workflows.');
      }
      
      // Check if it's a timeout
      if ((error as any).code === 'ECONNABORTED' || (error as any).message?.includes('timeout')) {
        throw new Error('Request timeout: The deployment service is taking too long to respond. Please try again.');
      }
      
      throw new Error(`Failed to start AWS deployment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Mock deployment for demo
   */
  private static async deployWorkflowMock(request: DeploymentRequest): Promise<DeploymentResponse> {
    try {
      console.log('🎭 Mock deployment request:', request);
      
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
    } catch (error) {
      console.error('Failed to start mock deployment:', error);
      throw new Error('Failed to start deployment. Please try again.');
    }
  }

  /**
   * Get deployment status
   */
  static async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
    if (shouldUseRealAPI()) {
      return this.getDeploymentStatusReal(deploymentId);
    } else {
      return this.getDeploymentStatusMock(deploymentId);
    }
  }

  /**
   * Real deployment status
   */
  private static async getDeploymentStatusReal(deploymentId: string): Promise<DeploymentStatus> {
    try {
      const response = await apiService.get<DeploymentStatus>(`/deployments/${deploymentId}/status`);
      return response;
    } catch (error) {
      console.error('Failed to get deployment status from AWS:', error);
      throw new Error('Failed to get deployment status. Please try again.');
    }
  }

  /**
   * Mock deployment status
   */
  private static async getDeploymentStatusMock(deploymentId: string): Promise<DeploymentStatus> {
    try {
      const mockStatus = mockDeployments.get(deploymentId);
      if (!mockStatus) {
        throw new Error('Deployment not found');
      }
      return mockStatus;
    } catch (error) {
      console.error('Failed to get mock deployment status:', error);
      throw new Error('Failed to get deployment status. Please try again.');
    }
  }

  /**
   * Simulate deployment process for demo
   */
  private static async simulateDeployment(deploymentId: string): Promise<void> {
    const deployment = mockDeployments.get(deploymentId);
    if (!deployment) return;

    // Simulate deployment steps with configured timing
    const steps = [
      { id: 'iam-roles', duration: DEPLOYMENT_CONFIG.MOCK_STEP_TIMINGS['iam-roles'] },
      { id: 'lambda-functions', duration: DEPLOYMENT_CONFIG.MOCK_STEP_TIMINGS['lambda-functions'] },
      { id: 'log-groups', duration: DEPLOYMENT_CONFIG.MOCK_STEP_TIMINGS['log-groups'] },
      { id: 'step-function', duration: DEPLOYMENT_CONFIG.MOCK_STEP_TIMINGS['step-function'] },
      { id: 'validation', duration: DEPLOYMENT_CONFIG.MOCK_STEP_TIMINGS['validation'] },
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
    const region = import.meta.env.VITE_AWS_REGION;
    if (!region) { throw new Error('VITE_AWS_REGION is not configured'); }
    deployment.stepFunctionArn = shouldUseRealAPI()
      ? `arn:aws:states:${region}:123456789012:stateMachine:workflow-${deployment.workflowId}-StateMachine`
      : `arn:aws:states:${region}:123456789012:stateMachine:workflow-${deployment.workflowId}-StateMachine-MOCK`;
    deployment.updatedAt = new Date().toISOString();

    mockDeployments.set(deploymentId, deployment);
  }

  /**
   * Poll deployment status until completion
   */
  static async pollDeploymentStatus(
    deploymentId: string,
    onUpdate?: (status: DeploymentStatus) => void,
    maxAttempts: number = DEPLOYMENT_CONFIG.POLLING.MAX_ATTEMPTS,
    intervalMs?: number
  ): Promise<DeploymentStatus> {
    const pollInterval = intervalMs || (shouldUseRealAPI() 
      ? DEPLOYMENT_CONFIG.POLLING.INTERVAL_MS 
      : DEPLOYMENT_CONFIG.POLLING.MOCK_INTERVAL_MS);
    
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
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        attempts++;
        
      } catch (error) {
        console.error('Error polling deployment status:', error);
        attempts++;
        
        if (attempts >= maxAttempts) {
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    
    throw new Error('Deployment status polling timed out');
  }

  /**
   * Cancel a deployment (if supported)
   */
  static async cancelDeployment(deploymentId: string): Promise<void> {
    if (shouldUseRealAPI()) {
      try {
        await apiService.post(`/deployments/${deploymentId}/cancel`);
      } catch (error) {
        console.error('Failed to cancel AWS deployment:', error);
        throw new Error('Failed to cancel deployment. Please try again.');
      }
    } else {
      // Mock implementation
      const deployment = mockDeployments.get(deploymentId);
      if (deployment) {
        deployment.status = 'cancelled';
        deployment.updatedAt = new Date().toISOString();
        mockDeployments.set(deploymentId, deployment);
      }
    }
  }

  /**
   * Get deployment history for a workflow
   */
  static async getWorkflowDeployments(workflowId: string): Promise<DeploymentStatus[]> {
    if (shouldUseRealAPI()) {
      try {
        const response = await apiService.get<DeploymentStatus[]>(`/workflows/${workflowId}/deployments`);
        return response;
      } catch (error) {
        console.error('Failed to get workflow deployments from AWS:', error);
        throw new Error('Failed to get deployment history. Please try again.');
      }
    } else {
      // Mock implementation
      const deployments = Array.from(mockDeployments.values())
        .filter(d => d.workflowId === workflowId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      return deployments;
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
        node.type !== 'start' && node.type !== 'end' && node.type !== 'opensearch' && !connectedNodeIds.has(node.id)
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

  /**
   * Get current deployment mode
   */
  static getDeploymentMode(): 'real' | 'mock' {
    return shouldUseRealAPI() ? 'real' : 'mock';
  }

  /**
   * Enable real AWS deployment
   */
  static enableRealDeployment(): void {
    (DEPLOYMENT_CONFIG as any).USE_REAL_API = true;
    console.log('🚀 Switched to REAL AWS deployment mode');
  }

  /**
   * Enable mock deployment
   */
  static enableMockDeployment(): void {
    (DEPLOYMENT_CONFIG as any).USE_REAL_API = false;
    console.log('🎭 Switched to MOCK deployment mode');
  }
}