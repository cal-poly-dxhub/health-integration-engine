import {
  WorkflowSchema,
  WorkflowNodeSchema,
  ConnectionSchema,
  isWorkflow,
  isWorkflowNode,
  isConnection,
} from '../types/workflow';
import { createSuccessResponse, createErrorResponse } from '../types/api';

describe('Type Validation', () => {
  describe('WorkflowNode validation', () => {
    it('should validate a valid workflow node', () => {
      const validNode = {
        id: 'node-1',
        type: 'lambda',
        name: 'Test Lambda',
        position: { x: 100, y: 200 },
        isConfigured: false,
      };

      const result = WorkflowNodeSchema.safeParse(validNode);
      expect(result.success).toBe(true);
      expect(isWorkflowNode(validNode)).toBe(true);
    });

    it('should reject invalid workflow node', () => {
      const invalidNode = {
        id: '',
        type: 'invalid-type',
        name: '',
        position: { x: 'invalid', y: 200 },
        isConfigured: 'not-boolean',
      };

      const result = WorkflowNodeSchema.safeParse(invalidNode);
      expect(result.success).toBe(false);
      expect(isWorkflowNode(invalidNode)).toBe(false);
    });
  });

  describe('Connection validation', () => {
    it('should validate a valid connection', () => {
      const validConnection = {
        id: 'conn-1',
        sourceNodeId: 'node-1',
        targetNodeId: 'node-2',
      };

      const result = ConnectionSchema.safeParse(validConnection);
      expect(result.success).toBe(true);
      expect(isConnection(validConnection)).toBe(true);
    });

    it('should reject invalid connection', () => {
      const invalidConnection = {
        id: '',
        sourceNodeId: '',
        targetNodeId: '',
      };

      const result = ConnectionSchema.safeParse(invalidConnection);
      expect(result.success).toBe(false);
      expect(isConnection(invalidConnection)).toBe(false);
    });
  });

  describe('Workflow validation', () => {
    it('should validate a valid workflow', () => {
      const validWorkflow = {
        id: 'workflow-1',
        name: 'Test Workflow',
        userId: 'user-1',
        nodes: [
          {
            id: 'node-1',
            type: 'start',
            name: 'Start',
            position: { x: 0, y: 0 },
            isConfigured: true,
          },
        ],
        connections: [],
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
        version: 1,
        isDeployed: false,
      };

      const result = WorkflowSchema.safeParse(validWorkflow);
      expect(result.success).toBe(true);
      expect(isWorkflow(validWorkflow)).toBe(true);
    });
  });

  describe('API Response utilities', () => {
    it('should create success response', () => {
      const data = { message: 'Success' };
      const response = createSuccessResponse(data, 'req-123');

      expect(response.success).toBe(true);
      expect(response.data).toEqual(data);
      expect(response.requestId).toBe('req-123');
      expect(response.timestamp).toBeDefined();
    });

    it('should create error response', () => {
      const response = createErrorResponse('TEST_ERROR', 'Test error message', null, 'req-123');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('TEST_ERROR');
      expect(response.error?.message).toBe('Test error message');
      expect(response.requestId).toBe('req-123');
      expect(response.timestamp).toBeDefined();
    });
  });
});