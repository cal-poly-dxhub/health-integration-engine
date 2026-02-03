import { z } from 'zod';

// Frontend deployment types
export interface FrontendDeploymentRequest {
  environment: 'development' | 'staging' | 'production';
  userId: string;
  domainName?: string;
  certificateArn?: string;
  buildPath?: string;
  customVariables?: Record<string, string>;
}

export interface FrontendDeploymentResult {
  deploymentId: string;
  environment: string;
  status: 'pending' | 'building' | 'uploading' | 'configuring' | 'completed' | 'failed';
  s3BucketName: string;
  cloudFrontUrl?: string;
  distributionId?: string;
  customDomainUrl?: string;
  buildLogs: string[];
  deploymentLogs: string[];
  createdAt: string;
  completedAt?: string;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface EnvironmentConfig {
  environment: string;
  apiGatewayUrl: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  region: string;
  customVariables: Record<string, string>;
}

export interface BuildResult {
  success: boolean;
  buildPath: string;
  buildLogs: string[];
  buildTime: number;
  artifacts: string[];
  size: number;
}

export interface FrontendDeploymentStatus {
  deploymentId: string;
  environment: string;
  status: 'pending' | 'building' | 'uploading' | 'configuring' | 'completed' | 'failed';
  progress: {
    currentStep: string;
    completedSteps: string[];
    totalSteps: number;
    percentage: number;
  };
  s3BucketName?: string;
  cloudFrontUrl?: string;
  distributionId?: string;
  customDomainUrl?: string;
  buildResult?: BuildResult;
  uploadProgress?: {
    uploadedFiles: number;
    totalFiles: number;
    uploadedBytes: number;
    totalBytes: number;
  };
  logs: FrontendDeploymentLog[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface FrontendDeploymentLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  step?: string;
  details?: any;
}

// DynamoDB item structure for frontend deployments
export interface FrontendDeploymentDynamoDBItem {
  PK: string; // USER#userId
  SK: string; // FRONTEND_DEPLOYMENT#deploymentId
  GSI1PK: string; // ENVIRONMENT#environment
  GSI1SK: string; // FRONTEND_DEPLOYMENT#deploymentId
  deploymentId: string;
  userId: string;
  environment: string;
  status: 'pending' | 'building' | 'uploading' | 'configuring' | 'completed' | 'failed';
  s3BucketName?: string;
  cloudFrontUrl?: string;
  distributionId?: string;
  customDomainUrl?: string;
  buildLogs: string[];
  deploymentLogs: string[];
  environmentConfig: EnvironmentConfig;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  ttl?: number;
}

// Environment configuration DynamoDB item
export interface EnvironmentConfigDynamoDBItem {
  PK: string; // USER#userId
  SK: string; // ENV_CONFIG#environment
  userId: string;
  environment: string;
  apiGatewayUrl: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  region: string;
  customVariables: Record<string, string>;
  lastUpdated: string;
  isActive: boolean;
}

// S3 upload configuration
export interface S3UploadConfig {
  bucketName: string;
  prefix?: string;
  region: string;
  serverSideEncryption?: 'AES256' | 'aws:kms';
  kmsKeyId?: string;
  storageClass?: 'STANDARD' | 'REDUCED_REDUNDANCY' | 'STANDARD_IA' | 'ONEZONE_IA' | 'INTELLIGENT_TIERING';
  cacheControl?: string;
  contentEncoding?: string;
  metadata?: Record<string, string>;
}

// CloudFront configuration
export interface CloudFrontConfig {
  distributionId?: string;
  domainName?: string;
  certificateArn?: string;
  priceClass: 'PriceClass_100' | 'PriceClass_200' | 'PriceClass_All';
  enableLogging: boolean;
  logsBucketName?: string;
  customErrorResponses: Array<{
    errorCode: number;
    responseCode: number;
    responsePagePath: string;
    errorCachingMinTTL?: number;
  }>;
  cacheBehaviors: Array<{
    pathPattern: string;
    cachePolicyId: string;
    originRequestPolicyId?: string;
    responseHeadersPolicyId?: string;
  }>;
}

// Zod validation schemas
export const FrontendDeploymentRequestSchema = z.object({
  environment: z.enum(['development', 'staging', 'production']),
  userId: z.string().min(1),
  domainName: z.string().optional(),
  certificateArn: z.string().optional(),
  buildPath: z.string().optional(),
  customVariables: z.record(z.string()).optional(),
});

export const EnvironmentConfigSchema = z.object({
  environment: z.string().min(1),
  apiGatewayUrl: z.string().url(),
  cognitoUserPoolId: z.string().min(1),
  cognitoClientId: z.string().min(1),
  region: z.string().min(1),
  customVariables: z.record(z.string()),
});

export const BuildResultSchema = z.object({
  success: z.boolean(),
  buildPath: z.string(),
  buildLogs: z.array(z.string()),
  buildTime: z.number().min(0),
  artifacts: z.array(z.string()),
  size: z.number().min(0),
});

export const FrontendDeploymentLogSchema = z.object({
  timestamp: z.string(),
  level: z.enum(['info', 'warn', 'error', 'debug']),
  message: z.string(),
  step: z.string().optional(),
  details: z.any().optional(),
});

export const FrontendDeploymentStatusSchema = z.object({
  deploymentId: z.string().min(1),
  environment: z.string().min(1),
  status: z.enum(['pending', 'building', 'uploading', 'configuring', 'completed', 'failed']),
  progress: z.object({
    currentStep: z.string(),
    completedSteps: z.array(z.string()),
    totalSteps: z.number().min(1),
    percentage: z.number().min(0).max(100),
  }),
  s3BucketName: z.string().optional(),
  cloudFrontUrl: z.string().optional(),
  distributionId: z.string().optional(),
  customDomainUrl: z.string().optional(),
  buildResult: BuildResultSchema.optional(),
  uploadProgress: z.object({
    uploadedFiles: z.number().min(0),
    totalFiles: z.number().min(0),
    uploadedBytes: z.number().min(0),
    totalBytes: z.number().min(0),
  }).optional(),
  logs: z.array(FrontendDeploymentLogSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }).optional(),
});

export const S3UploadConfigSchema = z.object({
  bucketName: z.string().min(1),
  prefix: z.string().optional(),
  region: z.string().min(1),
  serverSideEncryption: z.enum(['AES256', 'aws:kms']).optional(),
  kmsKeyId: z.string().optional(),
  storageClass: z.enum(['STANDARD', 'REDUCED_REDUNDANCY', 'STANDARD_IA', 'ONEZONE_IA', 'INTELLIGENT_TIERING']).optional(),
  cacheControl: z.string().optional(),
  contentEncoding: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

export const CloudFrontConfigSchema = z.object({
  distributionId: z.string().optional(),
  domainName: z.string().optional(),
  certificateArn: z.string().optional(),
  priceClass: z.enum(['PriceClass_100', 'PriceClass_200', 'PriceClass_All']),
  enableLogging: z.boolean(),
  logsBucketName: z.string().optional(),
  customErrorResponses: z.array(z.object({
    errorCode: z.number(),
    responseCode: z.number(),
    responsePagePath: z.string(),
    errorCachingMinTTL: z.number().optional(),
  })),
  cacheBehaviors: z.array(z.object({
    pathPattern: z.string(),
    cachePolicyId: z.string(),
    originRequestPolicyId: z.string().optional(),
    responseHeadersPolicyId: z.string().optional(),
  })),
});

// Type guards
export const isFrontendDeploymentRequest = (obj: any): obj is FrontendDeploymentRequest => {
  return FrontendDeploymentRequestSchema.safeParse(obj).success;
};

export const isEnvironmentConfig = (obj: any): obj is EnvironmentConfig => {
  return EnvironmentConfigSchema.safeParse(obj).success;
};

export const isBuildResult = (obj: any): obj is BuildResult => {
  return BuildResultSchema.safeParse(obj).success;
};

export const isFrontendDeploymentStatus = (obj: any): obj is FrontendDeploymentStatus => {
  return FrontendDeploymentStatusSchema.safeParse(obj).success;
};

export const isS3UploadConfig = (obj: any): obj is S3UploadConfig => {
  return S3UploadConfigSchema.safeParse(obj).success;
};

export const isCloudFrontConfig = (obj: any): obj is CloudFrontConfig => {
  return CloudFrontConfigSchema.safeParse(obj).success;
};