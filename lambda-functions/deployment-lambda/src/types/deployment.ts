import { z } from 'zod';

// VPC configuration for workflow-deployed Lambdas
export interface VpcDeploymentConfig {
  mode: 'none' | 'existing' | 'new';
  existing?: {
    vpcId: string;
    subnetIds: string[];
    securityGroupIds: string[];
  };
  new?: {
    cidrBlock?: string; // defaults to 10.0.0.0/16
  };
}

// Deployment request
export interface DeploymentRequest {
  workflowId: string;
  workflowData?: any; // Include workflow data for localStorage-based workflows
  deploymentName?: string;
  environment?: 'development' | 'staging' | 'production';
  configuration?: {
    enableLogging?: boolean;
    enableXRay?: boolean;
    tags?: Record<string, string>;
    vpcConfig?: VpcDeploymentConfig;
  };
}

// Change analysis for CloudFormation updates
export interface ChangeAnalysis {
  stackExists: boolean;
  hasChanges: boolean;
  hasDrift: boolean;
  changeType: 'CREATE' | 'UPDATE' | 'NO_CHANGE';
  templateChanges: string[];
  driftDetails: StackDriftDetail[];
  previousTemplate?: string;
  driftAnalysis?: any; // Additional drift analysis from CloudFormationStackManager
}

// Stack drift detail
export interface StackDriftDetail {
  resourceId: string;
  resourceType: string;
  driftStatus: string;
  actualProperties?: any;
  expectedProperties?: any;
  propertyDifferences?: any[];
}

// Deployment history record
export interface DeploymentHistoryRecord {
  deploymentId: string;
  workflowId: string;
  userId: string;
  timestamp: string;
  changeType: 'CREATE' | 'UPDATE' | 'NO_CHANGE';
  hasChanges: boolean;
  hasDrift: boolean;
  templateChanges: string[];
  driftDetails: StackDriftDetail[];
  environment: string;
}

// Deployment status
export interface DeploymentStatus {
  deploymentId: string;
  workflowId: string;
  userId?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  stepFunctionArn?: string; // Actual workflow Step Functions ARN (alias ARN for new executions)
  stepFunctionVersionArn?: string; // Specific version ARN for this deployment
  deploymentExecutionArn?: string; // Deployment orchestration execution ARN
  cloudFormationStackArn?: string;
  changeAnalysis?: ChangeAnalysis; // Analysis of changes and drift
  deploymentHistory?: DeploymentHistoryRecord; // Historical record of this deployment
  createdAt: string;
  updatedAt: string;
  steps: DeploymentStep[];
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

// Individual deployment step
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

// DynamoDB item structure for deployments
export interface DeploymentDynamoDBItem {
  PK: string; // DEPLOYMENT#deploymentId
  SK: string; // WORKFLOW#workflowId
  GSI1PK: string; // WORKFLOW#workflowId
  GSI1SK: string; // DEPLOYMENT#deploymentId
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
  ttl?: number;
}

// AWS resource configurations
export interface LambdaFunctionConfig {
  functionName: string;
  runtime: string;
  handler: string;
  code: {
    zipFile?: Buffer;
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
    subnetIds: string[];
    securityGroupIds: string[];
  };
  deadLetterConfig?: {
    targetArn: string;
  };
  tracingConfig?: {
    mode: 'Active' | 'PassThrough';
  };
  tags?: Record<string, string>;
}

export interface IAMRoleConfig {
  roleName: string;
  assumeRolePolicyDocument: string;
  policies: IAMPolicyConfig[];
  tags?: Record<string, string>;
}

export interface IAMPolicyConfig {
  policyName: string;
  policyDocument: string;
}

export interface StepFunctionConfig {
  stateMachineName: string;
  definition: string;
  roleArn: string;
  loggingConfiguration?: {
    level: 'ALL' | 'ERROR' | 'FATAL' | 'OFF';
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
  tags?: Record<string, string>;
}

// Lambda code upload info
export interface LambdaCodeUpload {
  nodeId: string;
  code: string;
  s3Key: string;
  bucketName: string;
}

// Deployment context
export interface DeploymentContext {
  deploymentId: string;
  workflowId: string;
  userId: string;
  environment: 'development' | 'staging' | 'production';
  configuration: {
    enableLogging: boolean;
    enableXRay: boolean;
    tags: Record<string, string>;
    vpcConfig?: VpcDeploymentConfig;
  };
  resources: {
    lambdaFunctions: LambdaFunctionConfig[];
    iamRoles: IAMRoleConfig[];
    stepFunction: StepFunctionConfig;
  };
  lambdaCodeUploads?: LambdaCodeUpload[];
}

// Zod validation schemas
export const VpcDeploymentConfigSchema = z.object({
  mode: z.enum(['none', 'existing', 'new']),
  existing: z.object({
    vpcId: z.string().min(1),
    subnetIds: z.array(z.string().min(1)).min(1),
    securityGroupIds: z.array(z.string().min(1)).min(1),
  }).optional(),
  new: z.object({
    cidrBlock: z.string().optional(),
  }).optional(),
});

export const DeploymentRequestSchema = z.object({
  workflowId: z.string().min(1),
  workflowData: z.any().optional(), // Include workflow data for localStorage-based workflows
  deploymentName: z.string().min(1).max(100).optional(),
  environment: z.enum(['development', 'staging', 'production']).optional(),
  configuration: z.object({
    enableLogging: z.boolean().optional(),
    enableXRay: z.boolean().optional(),
    tags: z.record(z.string()).optional(),
    vpcConfig: VpcDeploymentConfigSchema.optional(),
  }).optional(),
});

export const DeploymentStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'skipped']),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  duration: z.number().min(0).optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }).optional(),
});

export const StackDriftDetailSchema = z.object({
  resourceId: z.string(),
  resourceType: z.string(),
  driftStatus: z.string(),
  actualProperties: z.any().optional(),
  expectedProperties: z.any().optional(),
  propertyDifferences: z.array(z.any()).optional(),
});

export const ChangeAnalysisSchema = z.object({
  stackExists: z.boolean(),
  hasChanges: z.boolean(),
  hasDrift: z.boolean(),
  changeType: z.enum(['CREATE', 'UPDATE', 'NO_CHANGE']),
  templateChanges: z.array(z.string()),
  driftDetails: z.array(StackDriftDetailSchema),
  previousTemplate: z.string().optional(),
  driftAnalysis: z.any().optional(),
});

export const DeploymentHistoryRecordSchema = z.object({
  deploymentId: z.string(),
  workflowId: z.string(),
  userId: z.string(),
  timestamp: z.string(),
  changeType: z.enum(['CREATE', 'UPDATE', 'NO_CHANGE']),
  hasChanges: z.boolean(),
  hasDrift: z.boolean(),
  templateChanges: z.array(z.string()),
  driftDetails: z.array(StackDriftDetailSchema),
  environment: z.string(),
});

export const DeploymentStatusSchema = z.object({
  deploymentId: z.string().min(1),
  workflowId: z.string().min(1),
  userId: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']),
  stepFunctionArn: z.string().optional(),
  stepFunctionVersionArn: z.string().optional(),
  deploymentExecutionArn: z.string().optional(),
  cloudFormationStackArn: z.string().optional(),
  changeAnalysis: ChangeAnalysisSchema.optional(),
  deploymentHistory: DeploymentHistoryRecordSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  steps: z.array(DeploymentStepSchema),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }).optional(),
});

export const LambdaFunctionConfigSchema = z.object({
  functionName: z.string().min(1).max(64),
  runtime: z.string(),
  handler: z.string(),
  code: z.object({
    zipFile: z.any().optional(),
    s3Bucket: z.string().optional(),
    s3Key: z.string().optional(),
    s3ObjectVersion: z.string().optional(),
  }),
  environment: z.record(z.string()).optional(),
  timeout: z.number().min(1).max(900).optional(),
  memorySize: z.number().min(128).max(10240).optional(),
  description: z.string().max(256).optional(),
  layers: z.array(z.string()).optional(),
  vpcConfig: z.object({
    subnetIds: z.array(z.string()),
    securityGroupIds: z.array(z.string()),
  }).optional(),
  deadLetterConfig: z.object({
    targetArn: z.string(),
  }).optional(),
  tracingConfig: z.object({
    mode: z.enum(['Active', 'PassThrough']),
  }).optional(),
  tags: z.record(z.string()).optional(),
});

export const IAMPolicyConfigSchema = z.object({
  policyName: z.string().min(1),
  policyDocument: z.string().min(1),
});

export const IAMRoleConfigSchema = z.object({
  roleName: z.string().min(1),
  assumeRolePolicyDocument: z.string().min(1),
  policies: z.array(IAMPolicyConfigSchema),
  tags: z.record(z.string()).optional(),
});

export const StepFunctionConfigSchema = z.object({
  stateMachineName: z.string().min(1),
  definition: z.string().min(1),
  roleArn: z.string().min(1),
  loggingConfiguration: z.object({
    level: z.enum(['ALL', 'ERROR', 'FATAL', 'OFF']),
    includeExecutionData: z.boolean(),
    destinations: z.array(z.object({
      cloudWatchLogsLogGroup: z.object({
        logGroupArn: z.string(),
      }),
    })),
  }).optional(),
  tracingConfiguration: z.object({
    enabled: z.boolean(),
  }).optional(),
  tags: z.record(z.string()).optional(),
});

// Type guards
export const isDeploymentRequest = (obj: any): obj is DeploymentRequest => {
  return DeploymentRequestSchema.safeParse(obj).success;
};

export const isDeploymentStatus = (obj: any): obj is DeploymentStatus => {
  return DeploymentStatusSchema.safeParse(obj).success;
};

export const isLambdaFunctionConfig = (obj: any): obj is LambdaFunctionConfig => {
  return LambdaFunctionConfigSchema.safeParse(obj).success;
};

export const isIAMRoleConfig = (obj: any): obj is IAMRoleConfig => {
  return IAMRoleConfigSchema.safeParse(obj).success;
};

export const isStepFunctionConfig = (obj: any): obj is StepFunctionConfig => {
  return StepFunctionConfigSchema.safeParse(obj).success;
};