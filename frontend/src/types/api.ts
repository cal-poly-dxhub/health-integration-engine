import { z } from 'zod';
import { Workflow, WorkflowMetadata } from './workflow';

// Generic API Response wrapper
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
  requestId?: string;
}

// Paginated response for list endpoints
export interface PaginatedResponse<T = any> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

// Workflow API responses
export interface WorkflowListResponse extends ApiResponse<PaginatedResponse<WorkflowMetadata>> {}
export interface WorkflowResponse extends ApiResponse<Workflow> {}
export interface WorkflowCreateResponse extends ApiResponse<Workflow> {}
export interface WorkflowUpdateResponse extends ApiResponse<Workflow> {}

// Workflow deletion response
export interface WorkflowDeleteResponse {
  success: boolean;
  message: string;
  workflowId: string;
  timestamp: string;
  deletionId?: string;
  status?: string;
  executionName?: string;
  details?: {
    workflowRemoved?: boolean;
    awsResourcesRemoved?: boolean;
    deploymentRecordsRemoved?: boolean;
    message?: string;
    realTimeUpdates?: boolean;
  };
}

// Deployment API responses
export interface DeploymentRequest {
  workflowId: string;
  deploymentName?: string;
  environment?: 'development' | 'staging' | 'production';
  configuration?: {
    enableLogging?: boolean;
    enableXRay?: boolean;
    tags?: Record<string, string>;
  };
}

export interface DeploymentStatus {
  deploymentId: string;
  workflowId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'delete_failed';
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

export interface DeploymentResponse extends ApiResponse<DeploymentStatus> {}
export interface DeploymentListResponse extends ApiResponse<PaginatedResponse<DeploymentStatus>> {}

// Authentication API responses
export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt?: string;
  attributes?: Record<string, string>;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthResponse extends ApiResponse<{
  user: AuthUser;
  tokens: AuthTokens;
}> {}

export interface RefreshTokenResponse extends ApiResponse<AuthTokens> {}

// Error types
export interface ValidationError {
  field: string;
  message: string;
  code: string;
  value?: any;
}

export interface ApiError {
  code: string;
  message: string;
  statusCode: number;
  details?: any;
  validationErrors?: ValidationError[];
  timestamp: string;
  requestId?: string;
  path?: string;
}

export interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
}

// Request/Response interceptor types
export interface RequestConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  params?: Record<string, any>;
  data?: any;
  timeout?: number;
  retries?: number;
}

export interface ResponseConfig<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  config: RequestConfig;
}

// Zod validation schemas
export const ApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }).optional(),
  timestamp: z.string(),
  requestId: z.string().optional(),
});

export const PaginatedResponseSchema = z.object({
  items: z.array(z.any()),
  pagination: z.object({
    page: z.number().min(1),
    limit: z.number().min(1).max(100),
    total: z.number().min(0),
    totalPages: z.number().min(0),
    hasNext: z.boolean(),
    hasPrevious: z.boolean(),
  }),
});

export const DeploymentRequestSchema = z.object({
  workflowId: z.string().min(1),
  deploymentName: z.string().min(1).max(100).optional(),
  environment: z.enum(['development', 'staging', 'production']).optional(),
  configuration: z.object({
    enableLogging: z.boolean().optional(),
    enableXRay: z.boolean().optional(),
    tags: z.record(z.string()).optional(),
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

export const DeploymentStatusSchema = z.object({
  deploymentId: z.string().min(1),
  workflowId: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'delete_failed']),
  stepFunctionArn: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  steps: z.array(DeploymentStepSchema),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }).optional(),
});

export const AuthUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().optional(),
  emailVerified: z.boolean(),
  createdAt: z.string(),
  lastLoginAt: z.string().optional(),
  attributes: z.record(z.string()).optional(),
});

export const AuthTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  idToken: z.string().min(1),
  expiresIn: z.number().min(1),
  tokenType: z.literal('Bearer'),
});

export const ValidationErrorSchema = z.object({
  field: z.string(),
  message: z.string(),
  code: z.string(),
  value: z.any().optional(),
});

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  statusCode: z.number().min(100).max(599),
  details: z.any().optional(),
  validationErrors: z.array(ValidationErrorSchema).optional(),
  timestamp: z.string(),
  requestId: z.string().optional(),
  path: z.string().optional(),
});

// Type guards
export const isApiResponse = (obj: any): obj is ApiResponse => {
  return ApiResponseSchema.safeParse(obj).success;
};

export const isPaginatedResponse = (obj: any): obj is PaginatedResponse => {
  return PaginatedResponseSchema.safeParse(obj).success;
};

export const isApiError = (obj: any): obj is ApiError => {
  return ApiErrorSchema.safeParse(obj).success;
};

export const isDeploymentRequest = (obj: any): obj is DeploymentRequest => {
  return DeploymentRequestSchema.safeParse(obj).success;
};

export const isDeploymentStatus = (obj: any): obj is DeploymentStatus => {
  return DeploymentStatusSchema.safeParse(obj).success;
};

// Utility functions
export const createSuccessResponse = <T>(data: T, requestId?: string): ApiResponse<T> => ({
  success: true,
  data,
  timestamp: new Date().toISOString(),
  requestId,
});

export const createErrorResponse = (
  code: string,
  message: string,
  details?: any,
  requestId?: string
): ApiResponse => ({
  success: false,
  error: {
    code,
    message,
    details,
  },
  timestamp: new Date().toISOString(),
  requestId,
});

export const createPaginatedResponse = <T>(
  items: T[],
  page: number,
  limit: number,
  total: number
): PaginatedResponse<T> => {
  const totalPages = Math.ceil(total / limit);
  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    },
  };
};