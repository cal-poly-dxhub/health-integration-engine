import { z } from 'zod';
import type { S3NodeConfig, LambdaNodeConfig, OpenSearchNodeConfig } from './nodes';

// Base node interface
export interface WorkflowNode {
  id: string;
  type: 'start' | 's3' | 'lambda' | 'opensearch' | 'end';
  name: string;
  position: {
    x: number;
    y: number;
  };
  config?: NodeConfig;
  isConfigured: boolean;
}

// Node configuration types
export type NodeConfig = S3NodeConfig | LambdaNodeConfig | OpenSearchNodeConfig;

// Connection between nodes
export interface Connection {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string;
  targetHandle?: string;
  condition?: string; // For conditional connections
}

// Main workflow interface
export interface Workflow {
  id: string;
  name: string;
  description?: string;
  userId: string;
  nodes: WorkflowNode[];
  connections: Connection[];
  createdAt: string;
  updatedAt: string;
  version: number;
  isDeployed: boolean;
  deploymentStatus?: 'draft' | 'pending' | 'deploying' | 'deployed' | 'failed' | 'delete_failed' | 'deleting';
  stepFunctionArn?: string;
  lastDeploymentId?: string;
  lastDeployment?: {
    id: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'delete_failed';
    createdAt: string;
    completedAt?: string;
    error?: string;
  };
}

// Workflow metadata for list views
export interface WorkflowMetadata {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  isDeployed: boolean;
  deploymentStatus?: 'draft' | 'pending' | 'deploying' | 'deployed' | 'failed' | 'delete_failed' | 'deleting';
  stepFunctionArn?: string;
  nodeCount: number;
  // Status checking fields
  statusLastChecked?: string;
  statusCheckError?: string;
  // Transient UI-only deletion state
  isDeleting?: boolean;
  deletionStage?: string;
}

// Workflow creation/update request
export interface WorkflowRequest {
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  connections: Connection[];
}

// Zod validation schemas
export const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['start', 's3', 'lambda', 'opensearch', 'end']),
  name: z.string().min(1).max(100),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  config: z.any().optional(),
  isConfigured: z.boolean(),
});

export const ConnectionSchema = z.object({
  id: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  condition: z.string().optional(),
});

export const WorkflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  userId: z.string().min(1),
  nodes: z.array(WorkflowNodeSchema).min(1),
  connections: z.array(ConnectionSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().min(1),
  isDeployed: z.boolean(),
  deploymentStatus: z.enum(['draft', 'pending', 'deploying', 'deployed', 'failed', 'delete_failed', 'deleting']).optional(),
  stepFunctionArn: z.string().optional(),
  lastDeploymentId: z.string().optional(),
});

export const WorkflowRequestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  nodes: z.array(WorkflowNodeSchema).min(1),
  connections: z.array(ConnectionSchema),
});

// Type guards
export const isWorkflowNode = (obj: any): obj is WorkflowNode => {
  return WorkflowNodeSchema.safeParse(obj).success;
};

export const isConnection = (obj: any): obj is Connection => {
  return ConnectionSchema.safeParse(obj).success;
};

export const isWorkflow = (obj: any): obj is Workflow => {
  return WorkflowSchema.safeParse(obj).success;
};

// Additional interfaces for workflow execution and deletion
export interface WorkflowExecution {
  executionArn: string;
  stateMachineArn: string;
  name: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'ABORTED';
  startDate: string;
  stopDate?: string;
  input?: string;
  output?: string;
  error?: string;
}

export interface DeletionStatus {
  id: string;
  workflowId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  message: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: {
    message: string;
    code?: string;
  };
  steps: {
    step: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    message?: string;
    completedAt?: string;
  }[];
}