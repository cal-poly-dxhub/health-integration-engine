import { apiService } from './api';
import { Workflow } from '../types/workflow';
import { WorkflowDeleteResponse } from '../types/api';

export interface ListWorkflowsParams {
  limit?: number;
  nextToken?: string;
  search?: string;
  deploymentStatus?: 'draft' | 'pending' | 'deploying' | 'deployed' | 'failed';
  sortBy?: 'updatedAt' | 'createdAt' | 'name';
  sortOrder?: 'asc' | 'desc';
  teamId?: string;
}

export interface ListWorkflowsResponse {
  workflows: Workflow[];
  pagination: {
    nextToken?: string;
    hasMore: boolean;
    total: number;
  };
}

export interface SaveWorkflowResponse {
  message: string;
  workflow: Workflow;
}

class WorkflowApiService {
  /**
   * List workflows for the authenticated user
   */
  async listWorkflows(params: ListWorkflowsParams = {}): Promise<ListWorkflowsResponse> {
    const queryParams = new URLSearchParams();
    
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.nextToken) queryParams.append('nextToken', params.nextToken);
    if (params.search) queryParams.append('search', params.search);
    if (params.deploymentStatus) queryParams.append('deploymentStatus', params.deploymentStatus);
    if (params.sortBy) queryParams.append('sortBy', params.sortBy);
    if (params.sortOrder) queryParams.append('sortOrder', params.sortOrder);
    if (params.teamId) queryParams.append('teamId', params.teamId);

    const url = `/workflows${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    
    try {
      const response = await apiService.get<ListWorkflowsResponse>(url);
      console.log('Listed workflows:', response.workflows.length, 'workflows');
      return response;
    } catch (error) {
      console.error('Failed to list workflows:', error);
      throw new Error('Failed to load workflows');
    }
  }

  /**
   * Get a specific workflow by ID
   */
  async getWorkflow(workflowId: string): Promise<Workflow> {
    try {
      const workflow = await apiService.get<Workflow>(`/workflows/${workflowId}`);
      console.log('Retrieved workflow:', workflow.id, workflow.name);
      return workflow;
    } catch (error) {
      console.error('Failed to get workflow:', error);
      if ((error as any)?.response?.status === 404) {
        throw new Error('Workflow not found');
      }
      throw new Error('Failed to load workflow');
    }
  }

  /**
   * Save a workflow (create or update)
   */
  async saveWorkflow(workflow: Partial<Workflow>): Promise<SaveWorkflowResponse> {
    try {
      let response: SaveWorkflowResponse;
      
      if (workflow.id) {
        // Update existing workflow
        response = await apiService.put<SaveWorkflowResponse>(`/workflows/${workflow.id}`, workflow);
        console.log('Updated workflow:', workflow.id, workflow.name);
      } else {
        // Create new workflow
        response = await apiService.post<SaveWorkflowResponse>('/workflows', workflow);
        console.log('Created workflow:', response.workflow.id, response.workflow.name);
      }
      
      return response;
    } catch (error) {
      console.error('Failed to save workflow:', error);
      
      if ((error as any)?.response?.status === 409) {
        throw new Error('Workflow has been modified by another user. Please refresh and try again.');
      }
      
      throw new Error('Failed to save workflow');
    }
  }

  /**
   * Delete a workflow
   */
  async deleteWorkflow(workflowId: string): Promise<WorkflowDeleteResponse> {
    try {
      const response = await apiService.delete<{
        message: string;
        workflowId: string;
        status?: string;
        executionName?: string;
        details?: {
          workflowRemoved?: boolean;
          awsResourcesRemoved?: boolean;
          deploymentRecordsRemoved?: boolean;
          message?: string;
          realTimeUpdates?: boolean;
        };
      }>(`/workflows/${workflowId}`);
      
      console.log('Workflow deletion initiated:', workflowId);
      
      // Handle async deletion (202 response)
      if (response.status === 'DELETION_IN_PROGRESS') {
        console.log('Deletion is processing asynchronously with real-time updates');
      }
      
      return {
        success: true,
        message: response.message || 'Workflow deletion initiated',
        workflowId: response.workflowId || workflowId,
        timestamp: new Date().toISOString(),
        status: response.status,
        deletionId: workflowId, // Use workflowId as deletionId for tracking,
        executionName: response.executionName,
        details: response.details
      };
    } catch (error) {
      console.error('Failed to delete workflow:', error);
      
      // Enhanced error handling
      if ((error as any)?.response?.status === 404) {
        throw new Error('Workflow not found');
      } else if ((error as any)?.response?.status === 403) {
        throw new Error('You do not have permission to delete this workflow');
      } else if ((error as any)?.response?.status === 409) {
        throw new Error('Workflow cannot be deleted - it may be currently deploying');
      } else if ((error as any)?.response?.status === 504 || (error as any)?.code === 'ECONNABORTED') {
        // Handle timeout - deletion may have succeeded
        console.log('Deletion request timed out - checking if workflow was actually deleted...');
        throw new Error('Deletion request timed out - please refresh to check if the workflow was deleted');
      } else {
        throw new Error('Failed to delete workflow');
      }
    }
  }

  /**
   * Search workflows by name or description
   */
  async searchWorkflows(query: string, limit = 20): Promise<Workflow[]> {
    try {
      const response = await this.listWorkflows({
        search: query,
        limit,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      });
      
      console.log('Search results:', response.workflows.length, 'workflows found');
      return response.workflows;
    } catch (error) {
      console.error('Failed to search workflows:', error);
      throw new Error('Failed to search workflows');
    }
  }

  /**
   * Get workflows by deployment status
   */
  async getWorkflowsByStatus(
    status: 'draft' | 'pending' | 'deploying' | 'deployed' | 'failed',
    limit = 20
  ): Promise<Workflow[]> {
    try {
      const response = await this.listWorkflows({
        deploymentStatus: status,
        limit,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      });
      
      console.log('Workflows by status:', status, response.workflows.length, 'workflows found');
      return response.workflows;
    } catch (error) {
      console.error('Failed to get workflows by status:', error);
      throw new Error('Failed to load workflows');
    }
  }

  /**
   * Get recently updated workflows
   */
  async getRecentWorkflows(limit = 10): Promise<Workflow[]> {
    try {
      const response = await this.listWorkflows({
        limit,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      });
      
      console.log('Recent workflows:', response.workflows.length, 'workflows found');
      return response.workflows;
    } catch (error) {
      console.error('Failed to get recent workflows:', error);
      throw new Error('Failed to load recent workflows');
    }
  }

  /**
   * Validate workflow data before saving
   */
  validateWorkflow(workflow: Partial<Workflow>): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!workflow.name || workflow.name.trim().length === 0) {
      errors.push('Workflow name is required');
    }

    if (workflow.name && workflow.name.length > 100) {
      errors.push('Workflow name must be less than 100 characters');
    }

    if (workflow.description && workflow.description.length > 500) {
      errors.push('Workflow description must be less than 500 characters');
    }

    if (!workflow.nodes || workflow.nodes.length === 0) {
      errors.push('Workflow must have at least one node');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

export const workflowApiService = new WorkflowApiService();
export default workflowApiService;
