// Workflow types
export type {
  WorkflowNode,
  Connection,
  Workflow,
  WorkflowMetadata,
  WorkflowRequest,
} from './workflow';

// Node configuration types
export type {
  S3NodeConfig,
  DatabaseNodeConfig,
  LambdaNodeConfig,
  NodeConfig,
} from './nodes';

// API types
export type {
  ApiResponse,
  PaginatedResponse,
  WorkflowListResponse,
  WorkflowResponse,
  WorkflowCreateResponse,
  WorkflowUpdateResponse,
  WorkflowDeleteResponse,
  DeploymentRequest,
  DeploymentStatus,
  DeploymentStep,
  DeploymentResponse,
  DeploymentListResponse,
  AuthUser,
  AuthTokens,
  AuthResponse,
  RefreshTokenResponse,
  ValidationError,
  ApiError,
  RequestConfig,
  ResponseConfig,
} from './api';

// Export validation functions
export {
  isWorkflowNode,
  isConnection,
  isWorkflow,
} from './workflow';

export {
  isS3NodeConfig,
  isDatabaseNodeConfig,
  isLambdaNodeConfig,
  getDefaultNodeConfig,
} from './nodes';

export {
  isApiResponse,
  isPaginatedResponse,
  isApiError,
  isDeploymentRequest,
  isDeploymentStatus,
  createSuccessResponse,
  createErrorResponse,
  createPaginatedResponse,
} from './api';

// Additional utility types
export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// UI State types
export interface EditorState {
  selectedNodeIds: string[];
  selectedConnectionIds: string[];
  isConnecting: boolean;
  connectingFromNodeId?: string;
  connectingFromHandle?: string;
  canvasPosition: Position;
  canvasZoom: number;
  isDragging: boolean;
  draggedNodeId?: string;
}

export interface ModalState {
  isOpen: boolean;
  type?: 'node-config' | 'deployment' | 'confirmation' | 'error';
  data?: any;
}

export interface NotificationState {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
  isVisible: boolean;
}

// Theme types
export interface Theme {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
    success: string;
    warning: string;
    error: string;
    info: string;
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  borderRadius: {
    sm: string;
    md: string;
    lg: string;
  };
  shadows: {
    sm: string;
    md: string;
    lg: string;
  };
}

// Form types
export interface FormField<T = any> {
  name: string;
  label: string;
  type: 'text' | 'email' | 'password' | 'number' | 'select' | 'textarea' | 'checkbox' | 'radio';
  value: T;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  options?: Array<{ label: string; value: any }>;
  validation?: {
    min?: number;
    max?: number;
    pattern?: RegExp;
    custom?: (value: T) => string | null;
  };
  error?: string;
}

export interface FormState {
  fields: Record<string, FormField>;
  isValid: boolean;
  isSubmitting: boolean;
  errors: Record<string, string>;
}

// Loading states
export interface LoadingState {
  isLoading: boolean;
  error?: string;
  lastUpdated?: string;
}

export interface AsyncState<T = any> extends LoadingState {
  data?: T;
}

// Search and filter types
export interface SearchFilters {
  query?: string;
  tags?: string[];
  dateRange?: {
    start: string;
    end: string;
  };
  status?: string[];
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface SortOption {
  label: string;
  value: string;
  direction: 'asc' | 'desc';
}

// Export validation utilities
export { z } from 'zod';

// Re-export commonly used Zod schemas
export {
  WorkflowSchema,
  WorkflowNodeSchema,
  ConnectionSchema,
  WorkflowRequestSchema,
} from './workflow';

export {
  NodeConfigSchema,
  S3NodeConfigSchema,
  DatabaseNodeConfigSchema,
  LambdaNodeConfigSchema,
} from './nodes';

export {
  ApiResponseSchema,
  PaginatedResponseSchema,
  DeploymentRequestSchema,
  DeploymentStatusSchema,
  AuthUserSchema,
  AuthTokensSchema,
  ApiErrorSchema,
  ValidationErrorSchema,
} from './api';