import { useState, useEffect, useCallback } from 'react';
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

  // Cache for optimistic updates (currently unused but kept for future enhancements)
  // const [optimisticUpdates, setOptimisticUpdates] = useState<Map<string, Partial<WorkflowMetadata>>>(new Map());

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
      let workflowMetadata: WorkflowMetadata[] = response.workflows.map(workflow => ({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        isDeployed: workflow.isDeployed || false,
        deploymentStatus: workflow.deploymentStatus,
        stepFunctionArn: workflow.stepFunctionArn,
        nodeCount: workflow.nodes?.length || 0,
      }));

      console.log('✅ Loaded workflows from API:', workflowMetadata.length);

      // Note: For the simplified two-tab approach, we don't verify deployment status here
      // Tab 1 (Workflows) shows data from DynamoDB as-is
      // Tab 2 (Deployed Workflows) will use Step Functions APIs directly
      console.log('✅ Loaded workflows from database (no status verification for draft workflows)');

      setState(prev => ({
        ...prev,
        workflows: workflowMetadata,
        loading: false,
        hasMore: response.pagination.hasMore,
        nextToken: response.pagination.nextToken,
      }));

    } catch (error) {
      console.error('❌ Failed to load workflows from API, falling back to localStorage:', error);
      
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
          console.log('✅ Loaded workflows from localStorage:', parsedWorkflows.length);
        } else {
          setState(prev => ({
            ...prev,
            workflows: [],
            loading: false,
            hasMore: false,
            nextToken: undefined,
          }));
          console.log('✅ No workflows found in localStorage');
        }
      } catch (localStorageError) {
        console.error('❌ Failed to load from localStorage:', localStorageError);
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
    console.log('📡 Received deployment update:', update);
    
    setState(prev => ({
      ...prev,
      workflows: prev.workflows.map(workflow => {
        // Find workflow by deployment ID (we'll need to track this relationship)
        // For now, we'll update based on status and refresh the list
        if (workflow.deploymentStatus === 'deploying' || workflow.deploymentStatus === 'pending') {
          // This is a simplified approach - in production, we'd track deployment-to-workflow mapping
          return {
            ...workflow,
            deploymentStatus: update.status.toLowerCase() as any,
            updatedAt: update.timestamp,
          };
        }
        return workflow;
      }),
    }));

    // If deployment completed or failed, refresh the workflows to get accurate status
    if (update.status === 'COMPLETED' || update.status === 'FAILED') {
      // Use a longer delay and debounce to prevent multiple rapid refreshes
      const timeoutId = setTimeout(() => {
        console.log('🔄 Deployment completed, refreshing workflows...');
        loadWorkflows();
      }, 2000); // Longer delay to ensure backend has updated
      
      // Store timeout ID to allow cleanup if needed
      return () => clearTimeout(timeoutId);
    }
  }, [loadWorkflows]);

  // Set up WebSocket connection and subscriptions
  useEffect(() => {
    const webSocketService = getWebSocketService();
    if (!webSocketService) {
      console.warn('WebSocket service not available - real-time updates disabled');
      return;
    }

    console.log('✅ WebSocket service initialized (auto-connects)');

    // Cleanup on unmount
    return () => {
      activeDeployments.forEach(deploymentId => {
        webSocketService.unsubscribeFromDeployment(deploymentId, handleDeploymentUpdate);
      });
      console.log('🔌 WebSocket subscriptions cleaned up');
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

  // Initial load
  useEffect(() => {
    loadWorkflows();
  }, []); // Empty dependency array - only run once on mount

  // Auto refresh disabled - removed visibility change and focus refresh
  // useEffect(() => {
  //   let refreshTimeout: NodeJS.Timeout;
  //   
  //   const handleVisibilityChange = () => {
  //     if (!document.hidden) {
  //       // Page became visible, refresh workflows after a short delay to avoid rapid calls
  //       console.log('🔄 Page became visible, scheduling workflow refresh...');
  //       clearTimeout(refreshTimeout);
  //       refreshTimeout = setTimeout(() => {
  //         loadWorkflows();
  //       }, 500); // 500ms delay to debounce
  //     }
  //   };

  //   const handleFocus = () => {
  //     // Window gained focus, refresh workflows after a delay to avoid duplicate calls
  //     console.log('🔄 Window gained focus, scheduling workflow refresh...');
  //     clearTimeout(refreshTimeout);
  //     refreshTimeout = setTimeout(() => {
  //       loadWorkflows();
  //     }, 500); // 500ms delay to debounce
  //   };

  //   document.addEventListener('visibilitychange', handleVisibilityChange);
  //   window.addEventListener('focus', handleFocus);

  //   return () => {
  //     clearTimeout(refreshTimeout);
  //     document.removeEventListener('visibilitychange', handleVisibilityChange);
  //     window.removeEventListener('focus', handleFocus);
  //   };
  // }, []); // Empty dependency array to prevent recreation

  // Create workflow with optimistic update
  const createWorkflow = useCallback(async (name: string, description?: string) => {
    try {
      // Optimistic update
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

      // Save to backend
      const response = await workflowApiService.saveWorkflow({
        name,
        description,
        nodes: [],
        connections: [],
      });
      
      // Replace optimistic update with real data
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
        workflows: prev.workflows.map(w => 
          w.id === tempId ? realWorkflowMetadata : w
        ),
      }));

      console.log('✅ Created workflow:', response.workflow.id);
      return realWorkflowMetadata;
    } catch (error) {
      // Remove optimistic update on error
      setState(prev => ({
        ...prev,
        workflows: prev.workflows.filter(w => !w.id.startsWith('temp-')),
      }));
      
      console.error('❌ Failed to create workflow:', error);
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

      console.log('✅ Updated workflow:', response.workflow.id);
      return realWorkflowMetadata;
    } catch (error) {
      // Rollback optimistic update on error
      // setOptimisticUpdates(prev => {
      //   const newMap = new Map(prev);
      //   newMap.delete(workflowId);
      //   return newMap;
      // });

      // Reload workflows to get current state
      await loadWorkflows();
      
      console.error('❌ Failed to update workflow:', error);
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
      // First, mark workflow as deleting (like deployment does)
      console.log('🔄 Marking workflow as deleting:', workflowId);
      setState(prev => ({
        ...prev,
        workflows: prev.workflows.map(w => 
          w.id === workflowId 
            ? { ...w, status: 'deleting' as any, isDeleting: true }
            : w
        ),
      }));
      
      console.log('✅ Workflow marked as deleting, state updated');

      // Start deletion process
      const response = await workflowApiService.deleteWorkflow(workflowId);
      
      console.log('✅ Deletion response:', response);
      
      // If deletion is async, keep showing progress
      if (response.status === 'DELETION_IN_PROGRESS') {
        // Subscribe to WebSocket updates for deletion progress
        const webSocketService = getWebSocketService();
        if (webSocketService) {
          webSocketService.subscribeToDeletion(workflowId, (update) => {
            console.log('🔄 Deletion WebSocket update received:', update);
            
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
      console.error('❌ Failed to delete workflow:', error);
      
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
  const duplicateWorkflow = useCallback(async (workflowId: string) => {
    try {
      // Get the full workflow
      const originalWorkflow = await workflowApiService.getWorkflow(workflowId);
      
      // Create a copy
      const response = await workflowApiService.saveWorkflow({
        name: `${originalWorkflow.name} (Copy)`,
        description: originalWorkflow.description,
        nodes: originalWorkflow.nodes,
        connections: originalWorkflow.connections,
      });

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

      console.log('✅ Duplicated workflow:', response.workflow.id);
      return duplicatedMetadata;
    } catch (error) {
      console.error('❌ Failed to duplicate workflow:', error);
      throw error;
    }
  }, []);

  // Get full workflow data
  const getWorkflow = useCallback(async (workflowId: string): Promise<Workflow> => {
    try {
      return await workflowApiService.getWorkflow(workflowId);
    } catch (error) {
      console.error('❌ Failed to get workflow:', error);
      throw error;
    }
  }, []);

  // Subscribe to deployment updates
  const subscribeToDeployment = useCallback((deploymentId: string) => {
    console.log('🔔 Subscribing to deployment:', deploymentId);
    setActiveDeployments(prev => new Set([...prev, deploymentId]));
    
    const webSocketService = getWebSocketService();
    if (webSocketService && webSocketService.isConnected()) {
      webSocketService.subscribeToDeployment(deploymentId, handleDeploymentUpdate);
    }
  }, [handleDeploymentUpdate]);

  // Unsubscribe from deployment updates
  const unsubscribeFromDeployment = useCallback((deploymentId: string) => {
    console.log('🔕 Unsubscribing from deployment:', deploymentId);
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

  // DISABLED: Deployment status verification no longer needed with event-driven updates
  const refreshDeploymentStatus = useCallback(async () => {
    console.log('ℹ️ Deployment status verification disabled - using event-driven updates from Step Functions');
    // No longer verifying status manually - status is maintained automatically by deployment events
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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (workflowId) {
      loadWorkflow(workflowId);
    }
  }, [workflowId]);

  const loadWorkflow = async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      
      const workflowData = await workflowApiService.getWorkflow(id);
      setWorkflow(workflowData);
      
      console.log('✅ Loaded workflow:', workflowData.id, workflowData.name);
    } catch (err) {
      console.error('❌ Failed to load workflow:', err);
      setError(err instanceof Error ? err.message : 'Failed to load workflow');
    } finally {
      setLoading(false);
    }
  };

  const saveWorkflow = async (workflowData: Partial<Workflow>) => {
    if (!workflow) return;

    try {
      setSaving(true);
      setError(null);

      const updatedWorkflowData = {
        ...workflow,
        ...workflowData,
      };

      // Validate before saving
      const validation = workflowApiService.validateWorkflow(updatedWorkflowData);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      // Optimistic update
      setWorkflow(updatedWorkflowData);

      // Save to backend - remove version to avoid conflicts
      const { version, ...workflowDataToSave } = updatedWorkflowData;
      const response = await workflowApiService.saveWorkflow(workflowDataToSave);
      
      // Apply real data from backend
      setWorkflow(response.workflow);
      
      console.log('✅ Saved workflow:', response.workflow.id);
      return response.workflow;
    } catch (err) {
      console.error('❌ Failed to save workflow:', err);
      
      // Rollback optimistic update on error
      if (workflowId) {
        await loadWorkflow(workflowId);
      }
      
      setError(err instanceof Error ? err.message : 'Failed to save workflow');
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

  return {
    workflow,
    loading,
    saving,
    error,
    saveWorkflow,
    refreshWorkflow,
  };
};
