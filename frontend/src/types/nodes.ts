import { z } from 'zod';

// S3 Node Configuration
export interface S3NodeConfig {
  type: 's3';
  operation: 'read' | 'write' | 'list' | 'delete';
  bucketName: string;
  objectKey?: string;
  prefix?: string;
  folderPrefix?: string;  // Folder to watch for new files (used with triggerOnUpload)
  triggerOnUpload?: boolean;  // Auto-trigger workflow when file is uploaded
  region?: string;
  encryption?: {
    enabled: boolean;
    kmsKeyId?: string;
  };
  versioning?: boolean;
  metadata?: Record<string, string>;
  iamRole?: {
    useExisting: boolean;
    existingRoleArn?: string; // ARN of existing IAM role for S3 access
  };
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
    password?: string; // Will be encrypted
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
  iamRole?: {
    useExisting: boolean;
    existingRoleArn?: string; // ARN of existing IAM role for database access
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
    content?: string; // For inline code
    zipFile?: string; // Base64 encoded zip
    s3Bucket?: string;
    s3Key?: string;
    s3ObjectVersion?: string;
  };
  iamRole?: {
    useExisting: boolean;
    existingRoleArn?: string; // ARN of existing IAM role
  };
  environment?: Record<string, string>;
  timeout?: number; // In seconds (1-900)
  memorySize?: number; // In MB (128-10240)
  description?: string;
  layers?: string[]; // Layer ARNs
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

// Union type for all node configurations
export type NodeConfig = S3NodeConfig | DatabaseNodeConfig | LambdaNodeConfig | OpenSearchNodeConfig;

// Zod validation schemas
export const S3NodeConfigSchema = z.object({
  type: z.literal('s3'),
  operation: z.enum(['read', 'write', 'list', 'delete']),
  bucketName: z.string().min(3).max(63).regex(/^[a-z0-9.-]*$/),
  objectKey: z.string().optional(),
  prefix: z.string().optional(),
  region: z.string().optional(),
  encryption: z.object({
    enabled: z.boolean(),
    kmsKeyId: z.string().optional(),
  }).optional(),
  versioning: z.boolean().optional(),
  metadata: z.record(z.string()).optional(),
});

export const DatabaseNodeConfigSchema = z.object({
  type: z.literal('database'),
  engine: z.enum(['mysql', 'postgresql', 'mongodb', 'dynamodb', 'redis']),
  operation: z.enum(['select', 'insert', 'update', 'delete', 'query']),
  connection: z.object({
    host: z.string().optional(),
    port: z.number().min(1).max(65535).optional(),
    database: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    ssl: z.boolean().optional(),
    connectionString: z.string().optional(),
  }),
  query: z.string().optional(),
  parameters: z.record(z.any()).optional(),
  timeout: z.number().min(1).max(300).optional(),
  retryConfig: z.object({
    maxRetries: z.number().min(0).max(10),
    backoffMultiplier: z.number().min(1).max(10),
  }).optional(),
});

export const LambdaNodeConfigSchema = z.object({
  type: z.literal('lambda'),
  functionName: z.string().min(1).max(64).regex(/^[a-zA-Z0-9-_]*$/).optional(),
  runtime: z.enum(['nodejs18.x', 'nodejs20.x', 'python3.9', 'python3.10', 'python3.11', 'java11', 'java17', 'dotnet6', 'dotnet8']),
  handler: z.string().min(1),
  code: z.object({
    source: z.enum(['inline', 'zip', 's3']),
    content: z.string().optional(),
    zipFile: z.string().optional(),
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
    mode: z.enum(['none', 'existing', 'new']),
    existing: z.object({
      vpcId: z.string(),
      subnetIds: z.array(z.string()),
      securityGroupIds: z.array(z.string()),
    }).optional(),
    new: z.object({
      cidrBlock: z.string().optional(),
    }).optional(),
  }).optional(),
  deadLetterConfig: z.object({
    targetArn: z.string(),
  }).optional(),
  tracingConfig: z.object({
    mode: z.enum(['Active', 'PassThrough']),
  }).optional(),
});

export const NodeConfigSchema = z.discriminatedUnion('type', [
  S3NodeConfigSchema,
  DatabaseNodeConfigSchema,
  LambdaNodeConfigSchema,
]);

// Type guards
export const isS3NodeConfig = (config: NodeConfig): config is S3NodeConfig => {
  return config.type === 's3';
};

export const isDatabaseNodeConfig = (config: NodeConfig): config is DatabaseNodeConfig => {
  return config.type === 'database';
};

export const isLambdaNodeConfig = (config: NodeConfig): config is LambdaNodeConfig => {
  return config.type === 'lambda';
};

export const isOpenSearchNodeConfig = (config: NodeConfig): config is OpenSearchNodeConfig => {
  return config.type === 'opensearch';
};

// Default configurations for new nodes
export const getDefaultNodeConfig = (nodeType: string): NodeConfig | undefined => {
  switch (nodeType) {
    case 's3':
      return {
        type: 's3',
        operation: 'read',
        bucketName: '',
        region: 'us-east-1',
        encryption: {
          enabled: false,
        },
        versioning: false,
      };
    case 'database':
      return {
        type: 'database',
        engine: 'mysql',
        operation: 'select',
        connection: {
          host: '',
          port: 3306,
          database: '',
          username: '',
          ssl: true,
        },
        timeout: 30,
        retryConfig: {
          maxRetries: 3,
          backoffMultiplier: 2,
        },
      };
    case 'lambda':
      return {
        type: 'lambda',
        runtime: 'nodejs20.x',
        handler: 'index.handler',
        code: {
          source: 'inline',
          content: 'exports.handler = async (event) => {\n  // Your code here\n  return { statusCode: 200, body: "Hello World" };\n};',
        },
        timeout: 30,
        memorySize: 128,
        environment: {},
        tracingConfig: {
          mode: 'PassThrough',
        },
      };
    case 'opensearch':
      return {
        type: 'opensearch',
        operation: 'index',
        collectionEndpoint: '',
        indexName: '',
        dateRangeField: 'ingestedAt',
        dateRangeDays: 2,
      };
    default:
      return undefined;
  }
};