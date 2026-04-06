import { z } from 'zod';

// Base node interface
export interface WorkflowNode {
  id: string;
  type: 'start' | 's3' | 'database' | 'lambda' | 'opensearch' | 'end';
  name: string;
  position: {
    x: number;
    y: number;
  };
  config?: NodeConfig;
  isConfigured: boolean;
}

// Node configuration types
export type NodeConfig = S3NodeConfig | DatabaseNodeConfig | LambdaNodeConfig | OpenSearchNodeConfig;

// S3 Node Configuration
export interface S3NodeConfig {
  type: 's3';
  operation: 'read' | 'write' | 'list' | 'delete';
  bucketName: string;
  objectKey?: string;
  prefix?: string;
  region?: string;
  encryption?: {
    enabled: boolean;
    kmsKeyId?: string;
  };
  versioning?: boolean;
  metadata?: Record<string, string>;
}

// Database Node Configuration
export interface DatabaseNodeConfig {
  type: 'database';
  engine: 'mysql' | 'postgresql' | 'mongodb' | 'dynamodb' | 'redis';
  operation: 'select' | 'insert' | 'update' | 'delete' | 'query';
  connection: {
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    ssl?: boolean;
    connectionString?: string;
  };
  query?: string;
  parameters?: Record<string, any>;
  timeout?: number;
  retryConfig?: {
    maxRetries: number;
    backoffMultiplier: number;
  };
}

// Lambda Function Configuration
export interface LambdaNodeConfig {
  type: 'lambda';
  functionName?: string;
  runtime: 'nodejs18.x' | 'nodejs20.x' | 'python3.9' | 'python3.10' | 'python3.11' | 'java11' | 'java17' | 'dotnet6' | 'dotnet8';
  handler: string;
  code: {
    source: 'inline' | 'zip' | 's3';
    content?: string;
    zipFile?: string;
    s3Bucket?: string;
    s3Key?: string;
    s3ObjectVersion?: string;
  };
  environment?: Record<string, string>;
  timeout?: number;
  memorySize?: number;
  description?: string;
  layers?: string[];
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
  deadLetterConfig?: {
    targetArn: string;
  };
  tracingConfig?: {
    mode: 'Active' | 'PassThrough';
  };
}

// OpenSearch Serverless Node Configuration
export interface OpenSearchNodeConfig {
  type: 'opensearch';
  operation: 'index';
  collectionEndpoint: string;
  indexName: string;
  iamRole?: {
    useExisting: boolean;
    existingRoleArn?: string;
  };
}

// Connection between nodes
export interface Connection {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string;
  targetHandle?: string;
  condition?: string;
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
  deploymentStatus?: 'pending' | 'deploying' | 'deployed' | 'failed';
  stepFunctionArn?: string;
}

// DynamoDB item structure
export interface WorkflowDynamoDBItem {
  PK: string; // USER#userId
  SK: string; // WORKFLOW#workflowId
  GSI1PK: string; // WORKFLOW#workflowId
  GSI1SK: string; // USER#userId
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
  deploymentStatus?: 'pending' | 'deploying' | 'deployed' | 'failed';
  stepFunctionArn?: string;
  ttl?: number; // For automatic cleanup if needed
}

// Workflow metadata for list views
export interface WorkflowMetadata {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  isDeployed: boolean;
  deploymentStatus?: 'pending' | 'deploying' | 'deployed' | 'failed';
  nodeCount: number;
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
  type: z.enum(['start', 's3', 'database', 'lambda', 'opensearch', 'end']),
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
  deploymentStatus: z.enum(['pending', 'deploying', 'deployed', 'failed']).optional(),
  stepFunctionArn: z.string().optional(),
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

export const isWorkflowRequest = (obj: any): obj is WorkflowRequest => {
  return WorkflowRequestSchema.safeParse(obj).success;
};