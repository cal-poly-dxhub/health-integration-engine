import { z } from 'zod';

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

// Lambda event types
export interface APIGatewayEventWithAuth {
  httpMethod: string;
  path: string;
  pathParameters: Record<string, string> | null;
  queryStringParameters: Record<string, string> | null;
  headers: Record<string, string>;
  body: string | null;
  requestContext: {
    requestId: string;
    authorizer?: {
      claims: {
        sub: string;
        email: string;
        'cognito:username': string;
        [key: string]: string;
      };
    };
  };
}

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

// DynamoDB query parameters
export interface QueryParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  filters?: Record<string, any>;
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

export const QueryParamsSchema = z.object({
  page: z.number().min(1).optional(),
  limit: z.number().min(1).max(100).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  search: z.string().optional(),
  filters: z.record(z.any()).optional(),
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

export const isQueryParams = (obj: any): obj is QueryParams => {
  return QueryParamsSchema.safeParse(obj).success;
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

// HTTP status codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

// Error codes
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  WORKFLOW_NOT_FOUND: 'WORKFLOW_NOT_FOUND',
  WORKFLOW_ALREADY_EXISTS: 'WORKFLOW_ALREADY_EXISTS',
  INVALID_WORKFLOW_CONFIGURATION: 'INVALID_WORKFLOW_CONFIGURATION',
  DEPLOYMENT_IN_PROGRESS: 'DEPLOYMENT_IN_PROGRESS',
  DEPLOYMENT_FAILED: 'DEPLOYMENT_FAILED',
} as const;