// Workflow types for deployment lambda
export interface WorkflowNode {
  id: string;
  type: 'start' | 'end' | 's3' | 'database' | 'lambda' | 'opensearch';
  name: string;
  position: { x: number; y: number };
  isConfigured: boolean;
  config?: any;
}

export interface Connection {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle: string;
  targetHandle: string;
}

export interface WorkflowVpcConfig {
  mode: 'none' | 'existing' | 'new';
  existing?: {
    vpcId: string;
    subnetIds: string[];
    securityGroupIds: string[];
  };
  new?: {
    cidrBlock?: string;
  };
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  userId: string;
  nodes: WorkflowNode[];
  connections: Connection[];
  vpcConfig?: WorkflowVpcConfig;
  stepFunctionDefinition?: any;
  createdAt: string;
  updatedAt: string;
  version: number;
  isDeployed?: boolean;
  deploymentStatus?: 'draft' | 'pending' | 'deploying' | 'deployed' | 'failed' | 'deleting' | 'not_deployed' | 'partial';
  stepFunctionArn?: string;
  stateMachineArn?: string;
  stackName?: string;
  lastDeploymentId?: string;
}