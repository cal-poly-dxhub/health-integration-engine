import { useState, useEffect, useCallback, useRef } from 'react';
import { WorkflowMetadata, Workflow } from '../types/workflow';
import { WorkflowDeleteResponse } from '../types/api';
import { workflowApiService, ListWorkflowsParams } from '../services/workflowApi';
import { getWebSocketService, DeploymentUpdate } from '../services/webSocketService';

interface UseWorkflowsState {
  workflows: WorkflowMetadata[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  nextToken?: string;
  isRefreshingStatus?: boolean;
  statusRefreshError?: string;
}

export const useWorkflows = (params: ListWorkflowsParams = {}) => {
  const [state, setState] = useState<UseWorkflowsState>({
    workflows: [],
    loading: true,
    error: null,
    hasMore: false,
  });

  // Track active deployments for WebSocket subscriptions
  const [activeDeployments, setActiveDeployments] = useState<Set<string>>(new Set());
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  // Load workflows from API with localStorage fallback and Step Functions verification
  const loadWorkflows = useCallback(async (loadParams: ListWorkflowsParams = {}) => {
    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      
      const response = await workflowApiService.listWorkflows({
        limit: 20,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        ...params,
        ...loadParams,
      });

      // Convert full workflows to metadata
      const workflowMetadata: WorkflowMetadata[] = response.workflows.map(workflow => ({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        teamId: workflow.teamId,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        updatedBy: workflow.updatedBy,
        updatedByEmail: workflow.updatedByEmail,
        isDeployed: workflow.isDeployed || false,
        deploymentStatus: workflow.deploymentStatus,
        stepFunctionArn: workflow.stepFunctionArn,
        nodeCount: workflow.nodes?.length || 0,
      }));


      setState(prev => ({
        ...prev,
        workflows: workflowMetadata,
        loading: false,
        hasMore: response.pagination.hasMore,
        nextToken: response.pagination.nextToken,
      }));

    } catch (error) {
      console.error('Failed to load workflows from API, falling back to localStorage:', error);
      
      // Fallback to localStorage
      try {
        const savedWorkflows = localStorage.getItem('workflows');
        if (savedWorkflows) {
          const parsedWorkflows = JSON.parse(savedWorkflows);
          setState(prev => ({
            ...prev,
            workflows: parsedWorkflows,
            loading: false,
            hasMore: false,
            nextToken: undefined,
          }));
        } else {
          setState(prev => ({
            ...prev,
            workflows: [],
            loading: false,
            hasMore: false,
            nextToken: undefined,
          }));
        }
      } catch (localStorageError) {
        console.error('Failed to load from localStorage:', localStorageError);
        setState(prev => ({
          ...prev,
          workflows: [],
          loading: false,
          error: 'Failed to load workflows from both API and localStorage',
        }));
      }
    }
  }, []); // Remove params dependency to prevent infinite loops

  // Handle deployment status updates via WebSocket
  const handleDeploymentUpdate = useCallback((update: DeploymentUpdate) => {
    
    setState(prev => ({
      ...prev,
      workflows: prev.workflows.map(workflow => {
        // Find workflow by deployment ID (we'll need to track this relationship)
        // For now, we'll update based on status and refresh the list
        if (workflow.deploymentStatus === 'deploying' || workflow.deploymentStatus === 'pending') {
          // This is a simplified approach - in production, we'd track deployment-to-workflow mapping
          return {
            ...workflow,
            deploymentStatus: update.status.toLowerCase() as WorkflowMetadata['deploymentStatus'],
            updatedAt: update.timestamp,
          };
        }
        return workflow;
      }),
    }));

    // If deployment completed or failed, refresh the workflows to get accurate status
    if (update.status === 'COMPLETED' || update.status === 'FAILED') {
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = setTimeout(() => {
        loadWorkflows();
      }, 2000);
    }
  }, [loadWorkflows]);

  // Set up WebSocket connection and subscriptions
  useEffect(() => {
    const webSocketService = getWebSocketService();
    if (!webSocketService) {
      console.warn('WebSocket service not available - real-time updates disabled');
      return;
    }


    // Cleanup on unmount
    return () => {
      activeDeployments.forEach(deploymentId => {
        webSocketService.unsubscribeFromDeployment(deploymentId, handleDeploymentUpdate);
      });
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    };
  }, []); // Empty dependency array - only setup once

  // Handle active deployment subscriptions separately
  useEffect(() => {
    const webSocketService = getWebSocketService();
    if (!webSocketService) return;

    // Subscribe to new deployments
    activeDeployments.forEach(deploymentId => {
      webSocketService.subscribeToDeployment(deploymentId, handleDeploymentUpdate);
    });

    // No cleanup needed here as it's handled in the main WebSocket effect
  }, [activeDeployments, handleDeploymentUpdate]);

  // Initial load + reload when team filter changes.
  // Pass teamId explicitly so loadWorkflows doesn't use a stale closure.
  useEffect(() => {
    loadWorkflows({ teamId: params.teamId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.teamId]);


  // Create workflow with optimistic update.
  // teamId is required when the caller belongs to multiple writer-teams; the
  // backend defaults to the caller's only team if there's just one.
  const createWorkflow = useCallback(async (name: string, description?: string, teamId?: string) => {
    try {
      const tempId = `temp-${Date.now()}`;
      const optimisticWorkflow: WorkflowMetadata = {
        id: tempId,
        name,
        description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeployed: false,
        nodeCount: 0,
      };

      setState(prev => ({
        ...prev,
        workflows: [optimisticWorkflow, ...prev.workflows],
      }));

      const response = await workflowApiService.saveWorkflow({
        name,
        description,
        nodes: [],
        connections: [],
        ...(teamId ? { teamId } : {}),
      } as any, { autoResolveName: true });
      
      // Replace optimistic update with real data
      const realWorkflowMetadata: WorkflowMetadata = {
        id: response.workflow.id,
        name: response.workflow.name,
        description: response.workflow.description,
        teamId: response.workflow.teamId,
        createdAt: response.workflow.createdAt,
        updatedAt: response.workflow.updatedAt,
        updatedBy: response.workflow.updatedBy,
        updatedByEmail: response.workflow.updatedByEmail,
        isDeployed: response.workflow.isDeployed || false,
        deploymentStatus: response.workflow.deploymentStatus,
        nodeCount: response.workflow.nodes?.length || 0,
      };

      setState(prev => ({
        ...prev,
        workflows: prev.workflows.map(w =>
          w.id === tempId ? realWorkflowMetadata : w
        ),
      }));

      return realWorkflowMetadata;
    } catch (error) {
      setState(prev => ({
        ...prev,
        workflows: prev.workflows.filter(w => !w.id.startsWith('temp-')),
      }));
      console.error('Failed to create workflow:', error);
      throw error;
    }
  }, []);

  // Update workflow metadata
  const updateWorkflow = useCallback(async (workflowId: string, updates: Partial<WorkflowMetadata>) => {
    try {
      // Optimistic update (UI state updated directly below)
      // setOptimisticUpdates(prev => new Map(prev.set(workflowId, updates)));
      setState(prev => ({
        ...prev,
        workflows: prev.workflows.map(workflow => 
          workflow.id === workflowId 
            ? { ...workflow, ...updates, updatedAt: new Date().toISOString() }
            : workflow
        ),
      }));

      // Get full workflow and update it
      const fullWorkflow = await workflowApiService.getWorkflow(workflowId);
      const response = await workflowApiService.saveWorkflow({
        ...fullWorkflow,
        name: updates.name || fullWorkflow.name,
        description: updates.description !== undefined ? updates.description : fullWorkflow.description,
      });

      // Clear optimistic update and apply real data
      // setOptimisticUpdates(prev => {
      //   const newMap = new Map(prev);
      //   newMap.delete(workflowId);
      //   return newMap;
      // });

      const realWorkflowMetadata: WorkflowMetadata = {
        id: response.workflow.id,
        name: response.workflow.name,
        description: response.workflow.description,
        createdAt: response.workflow.createdAt,
        updatedAt: response.workflow.updatedAt,
        isDeployed: response.workflow.isDeployed || false,
        deploymentStatus: response.workflow.deploymentStatus,
        nodeCount: response.workflow.nodes?.length || 0,
      };

      setState(prev => ({
        ...prev,
        workflows: prev.workflows.map(workflow => 
          workflow.id === workflowId ? realWorkflowMetadata : workflow
        ),
      }));

      return realWorkflowMetadata;
    } catch (error) {
      await loadWorkflows();
      console.error('Failed to update workflow:', error);
      throw error;
    }
  }, [loadWorkflows]);

  // Delete workflow with optimistic update and enhanced error handling
  const deleteWorkflow = useCallback(async (workflowId: string): Promise<WorkflowDeleteResponse> => {
    // Store the workflow to delete before removing it
    const workflowToDelete = state.workflows.find(w => w.id === workflowId);
    
    if (!workflowToDelete) {
      throw new Error('Workflow not found');
    }
    
    try {
      setState(prev => ({
        ...prev,
        workflows: prev.workflows.map(w =>
          w.id === workflowId
            ? { ...w, deploymentStatus: 'deleting' as const, isDeleting: true }
            : w
        ),
      }));

      const response = await workflowApiService.deleteWorkflow(workflowId);
      
      // If deletion is async, keep showing progress
      if (response.status === 'DELETION_IN_PROGRESS') {
        // Subscribe to WebSocket updates for deletion progress
        const webSocketService = getWebSocketService();
        if (webSocketService) {
          webSocketService.subscribeToDeletion(workflowId, (update) => {
            
            if (update.status === 'completed') {
              // Deletion completed - remove workflow from UI
              setState(prev => ({
                ...prev,
                workflows: prev.workflows.filter(w => w.id !== workflowId),
              }));
              
              // Unsubscribe from further updates
              webSocketService.unsubscribeFromDeletion(workflowId);
            } else if (update.status === 'failed') {
              // Deletion failed - restore workflow to original state
              setState(prev => ({
                ...prev,
                workflows: prev.workflows.map(w => 
                  w.id === workflowId 
                    ? { ...workflowToDelete, isDeleting: false }
                    : w
                ),
              }));
              
              // Unsubscribe from further updates
              webSocketService.unsubscribeFromDeletion(workflowId);
            } else {
              // Update deletion progress
              setState(prev => ({
                ...prev,
                workflows: prev.workflows.map(w => 
                  w.id === workflowId 
                    ? { ...w, deletionStage: update.message || 'Deleting...' }
                    : w
                ),
              }));
            }
          });
        }
        
        return {
          success: true,
          message: `Workflow "${workflowToDelete.name}" deletion initiated - you'll see real-time updates`,
          workflowId: response?.workflowId || workflowId,
          timestamp: new Date().toISOString(),
          status: response?.status,
          deletionId: workflowId, // Use workflowId for tracking
          details: response?.details,
        };
      } else {
        // Deletion response was not async — keep workflow as "deleting" until confirmed
        return {
          success: true,
          message: `Workflow "${workflowToDelete.name}" deletion initiated`,
          workflowId: workflowId,
          timestamp: new Date().toISOString(),
          deletionId: workflowId,
          details: response?.details,
        };
      }
    } catch (error) {
      console.error('Failed to delete workflow:', error);
      
      // Restore workflow to original state (remove deleting status)
      setState(prev => ({
        ...prev,
        workflows: prev.workflows.map(w => 
          w.id === workflowId 
            ? { ...workflowToDelete, isDeleting: false }
            : w
        ),
      }));
      
      // Enhanced error handling
      if (error instanceof Error) {
        if (error.message.includes('404')) {
          throw new Error('Workflow not found - it may have been deleted already');
        } else if (error.message.includes('403')) {
          throw new Error('You do not have permission to delete this workflow');
        } else if (error.message.includes('409')) {
          throw new Error('Workflow cannot be deleted - it may be currently deploying');
        } else if (error.message.includes('timed out')) {
          // For timeout errors, check if the workflow was actually deleted after refresh
          const stillExists = state.workflows.some(w => w.id === workflowId);
          if (!stillExists) {
            // Workflow was successfully deleted despite timeout
            return {
              success: true,
              message: `Workflow "${workflowToDelete.name}" was deleted successfully (request timed out but deletion completed)`,
              workflowId: workflowId,
              timestamp: new Date().toISOString(),
            };
          } else {
            throw new Error('Deletion request timed out - please try again or check AWS console');
          }
        } else {
          throw new Error(`Failed to delete workflow: ${error.message}`);
        }
      } else {
        throw new Error('Failed to delete workflow due to an unknown error');
      }
    }
  }, [state.workflows]);

  // Duplicate workflow
  const duplicateWorkflow = useCallback(async (workflowId: string, teamId?: string) => {
    try {
      // Get the full workflow
      const originalWorkflow = await workflowApiService.getWorkflow(workflowId);

      // Create a copy. teamId determines which team the copy belongs to;
      // defaults to the source workflow's team when not explicitly chosen.
      const response = await workflowApiService.saveWorkflow({
        name: `${originalWorkflow.name} (Copy)`,
        description: originalWorkflow.description,
        teamId: teamId || originalWorkflow.teamId,
        nodes: originalWorkflow.nodes,
        connections: originalWorkflow.connections,
      }, { autoResolveName: true });

      const duplicatedMetadata: WorkflowMetadata = {
        id: response.workflow.id,
        name: response.workflow.name,
        description: response.workflow.description,
        createdAt: response.workflow.createdAt,
        updatedAt: response.workflow.updatedAt,
        isDeployed: false,
        deploymentStatus: 'pending',
        nodeCount: response.workflow.nodes?.length || 0,
      };

      setState(prev => ({
        ...prev,
        workflows: [duplicatedMetadata, ...prev.workflows],
      }));

      return duplicatedMetadata;
    } catch (error) {
      console.error('Failed to duplicate workflow:', error);
      throw error;
    }
  }, []);

  // Get full workflow data
  const getWorkflow = useCallback(async (workflowId: string): Promise<Workflow> => {
    try {
      return await workflowApiService.getWorkflow(workflowId);
    } catch (error) {
      console.error('Failed to get workflow:', error);
      throw error;
    }
  }, []);

  const subscribeToDeployment = useCallback((deploymentId: string) => {
    setActiveDeployments(prev => new Set([...prev, deploymentId]));
    
    const webSocketService = getWebSocketService();
    if (webSocketService && webSocketService.isConnected()) {
      webSocketService.subscribeToDeployment(deploymentId, handleDeploymentUpdate);
    }
  }, [handleDeploymentUpdate]);

  const unsubscribeFromDeployment = useCallback((deploymentId: string) => {
    setActiveDeployments(prev => {
      const newSet = new Set(prev);
      newSet.delete(deploymentId);
      return newSet;
    });
    
    const webSocketService = getWebSocketService();
    if (webSocketService) {
      webSocketService.unsubscribeFromDeployment(deploymentId, handleDeploymentUpdate);
    }
  }, [handleDeploymentUpdate]);

  // Refresh workflows
  const refreshWorkflows = useCallback(() => {
    // setOptimisticUpdates(new Map());
    return loadWorkflows();
  }, [loadWorkflows]);

  const refreshDeploymentStatus = useCallback(async () => {
    // Status is maintained by deployment events; manual refresh is a no-op.
  }, []);

  return {
    workflows: state.workflows,
    loading: state.loading,
    error: state.error,
    hasMore: state.hasMore,
    createWorkflow,
    updateWorkflow,
    deleteWorkflow,
    duplicateWorkflow,
    refreshWorkflows,
    refreshDeploymentStatus,
    getWorkflow,
    subscribeToDeployment,
    unsubscribeFromDeployment,
  };
};

// Hook for managing individual workflow data
export const useWorkflow = (workflowId?: string) => {
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(!!workflowId);
  // loadError: workflow couldn't be fetched at all — render a full-page state.
  // saveError: a save attempt failed but the page is still usable — show inline.
  // Mixing them as one `error` field caused failed saves to blank the canvas
  // out as if the workflow no longer existed.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (workflowId) {
      loadWorkflow(workflowId);
    }
  }, [workflowId]);

  const loadWorkflow = async (id: string) => {
    try {
      setLoading(true);
      setLoadError(null);

      const workflowData = await workflowApiService.getWorkflow(id);
      setWorkflow(workflowData);
    } catch (err) {
      console.error('Failed to load workflow:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to load workflow');
    } finally {
      setLoading(false);
    }
  };

  const saveWorkflow = async (workflowData: Partial<Workflow>) => {
    if (!workflow) return;

    try {
      setSaving(true);
      setSaveError(null);

      const updatedWorkflowData = {
        ...workflow,
        ...workflowData,
      };

      const validation = workflowApiService.validateWorkflow(updatedWorkflowData);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      setWorkflow(updatedWorkflowData);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { version, ...workflowDataToSave } = updatedWorkflowData;
      const response = await workflowApiService.saveWorkflow(workflowDataToSave);

      setWorkflow(response.workflow);
      return response.workflow;
    } catch (err) {
      console.error('Failed to save workflow:', err);

      // Rollback optimistic update — but DO NOT set loadError here. A failed
      // save (e.g. 403 for a reader) shouldn't replace the whole canvas with
      // a "Failed to load workflow" screen.
      if (workflowId) {
        try {
          const fresh = await workflowApiService.getWorkflow(workflowId);
          setWorkflow(fresh);
        } catch {
          // Reload itself failed — leave the optimistic copy in place rather
          // than blanking out the page. Saving is what the user cares about.
        }
      }

      setSaveError(err instanceof Error ? err.message : 'Failed to save workflow');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const refreshWorkflow = useCallback(() => {
    if (workflowId) {
      return loadWorkflow(workflowId);
    }
  }, [workflowId]);

  const clearSaveError = useCallback(() => setSaveError(null), []);

  return {
    workflow,
    loading,
    saving,
    // Backwards-compat: existing consumers expect `error`. Keep it as a
    // load-error alias; new code should distinguish via loadError/saveError.
    error: loadError,
    loadError,
    saveError,
    clearSaveError,
    saveWorkflow,
    refreshWorkflow,
  };
};
