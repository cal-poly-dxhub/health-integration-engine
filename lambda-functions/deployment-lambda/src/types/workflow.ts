// Workflow types for deployment lambda
export interface WorkflowNode {
  id: string;
  type: 'start' | 'end' | 's3' | 'lambda' | 'opensearch';
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

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  // teamId — the team that owns this workflow. All access checks key off this.
  teamId: string;
  // Audit fields. createdBy/updatedBy are Cognito user IDs (sub);
  // *Email fields snapshot the email at the time of write so the UI can render
  // "last edited by alice@..." without an extra Cognito lookup.
  createdBy?: string;
  createdByEmail?: string;
  updatedBy?: string;
  updatedByEmail?: string;
  nodes: WorkflowNode[];
  connections: Connection[];
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
