import { useState, useCallback, useEffect } from 'react';
import { DeploymentService, DeploymentRequest, DeploymentResponse, DeploymentStatus } from '../services/deploymentReal';
import { getWebSocketService, DeploymentUpdate } from '../services/webSocketService';

interface UseDeploymentState {
  isDeploying: boolean;
  deploymentId: string | null;
  deploymentStatus: DeploymentStatus | null;
  error: string | null;
}

export const useDeployment = () => {
  const [state, setState] = useState<UseDeploymentState>({
    isDeploying: false,
    deploymentId: null,
    deploymentStatus: null,
    error: null,
  });

  // Handle real-time deployment updates via WebSocket
  const handleDeploymentUpdate = useCallback((update: DeploymentUpdate) => {
    console.log('📡 Received deployment update:', update);
    
    setState(prev => {
      if (prev.deploymentId === update.deploymentId) {
        return {
          ...prev,
          deploymentStatus: {
            ...prev.deploymentStatus!,
            status: update.status.toLowerCase() as any,
            updatedAt: update.timestamp,
          },
          isDeploying: !['COMPLETED', 'FAILED'].includes(update.status),
          error: update.status === 'FAILED' ? update.message : null,
        };
      }
      return prev;
    });
  }, []);

  // Deploy workflow with real-time updates
  const deployWorkflow = useCallback(async (request: DeploymentRequest): Promise<DeploymentResponse> => {
    try {
      setState(prev => ({
        ...prev,
        isDeploying: true,
        error: null,
        deploymentId: null,
        deploymentStatus: null,
      }));

      console.log('🚀 Starting deployment for workflow:', request.workflowId);
      
      // Start deployment
      const response = await DeploymentService.deployWorkflow(request);
      
      console.log('✅ Deployment started:', response);
      
      // Update state with deployment ID
      setState(prev => ({
        ...prev,
        deploymentId: response.deploymentId,
        deploymentStatus: {
          deploymentId: response.deploymentId,
          workflowId: request.workflowId,
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          steps: [],
        },
      }));

      // Subscribe to WebSocket updates for this deployment
      const webSocketService = getWebSocketService();
      if (webSocketService) {
        console.log('🔔 Subscribing to deployment updates:', response.deploymentId);
        webSocketService.subscribeToDeployment(response.deploymentId, handleDeploymentUpdate);
      } else {
        console.warn('⚠️ WebSocket service not available - status updates will come from event-driven system');
        // Note: No longer polling for status - relying on event-driven updates from Step Functions
        // The deployment status will be updated automatically by the deployment Step Functions workflow
      }

      return response;
    } catch (error) {
      console.error('❌ Deployment failed:', error);
      
      setState(prev => ({
        ...prev,
        isDeploying: false,
        error: error instanceof Error ? error.message : 'Deployment failed',
      }));
      
      throw error;
    }
  }, [handleDeploymentUpdate]);

  // DISABLED: Polling is no longer needed with event-driven status updates
  // Status updates now come automatically from deployment Step Functions workflow
  // const startPolling = useCallback((deploymentId: string) => {
  //   console.log('ℹ️ Deployment status polling disabled - using event-driven updates from Step Functions');
  //   // No longer polling - status updates come from deployment Step Functions automatically
  // }, []);

  // Get deployment status
  const getDeploymentStatus = useCallback(async (deploymentId: string): Promise<DeploymentStatus> => {
    try {
      const status = await DeploymentService.getDeploymentStatus(deploymentId);
      
      setState(prev => ({
        ...prev,
        deploymentStatus: status,
        isDeploying: !['completed', 'failed', 'cancelled'].includes(status.status),
        error: status.status === 'failed' ? status.error?.message || 'Deployment failed' : null,
      }));

      return status;
    } catch (error) {
      console.error('❌ Failed to get deployment status:', error);
      throw error;
    }
  }, []);

  // Cancel deployment
  const cancelDeployment = useCallback(async (deploymentId: string): Promise<void> => {
    try {
      await DeploymentService.cancelDeployment(deploymentId);
      
      setState(prev => ({
        ...prev,
        isDeploying: false,
        deploymentStatus: prev.deploymentStatus ? {
          ...prev.deploymentStatus,
          status: 'cancelled',
          updatedAt: new Date().toISOString(),
        } : null,
      }));

      // Unsubscribe from WebSocket updates
      const webSocketService = getWebSocketService();
      if (webSocketService) {
        webSocketService.unsubscribeFromDeployment(deploymentId, handleDeploymentUpdate);
      }
    } catch (error) {
      console.error('❌ Failed to cancel deployment:', error);
      throw error;
    }
  }, [handleDeploymentUpdate]);

  // Reset deployment state
  const resetDeployment = useCallback(() => {
    // Unsubscribe from WebSocket updates if there's an active deployment
    if (state.deploymentId) {
      const webSocketService = getWebSocketService();
      if (webSocketService) {
        webSocketService.unsubscribeFromDeployment(state.deploymentId, handleDeploymentUpdate);
      }
    }

    setState({
      isDeploying: false,
      deploymentId: null,
      deploymentStatus: null,
      error: null,
    });
  }, [state.deploymentId, handleDeploymentUpdate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (state.deploymentId) {
        const webSocketService = getWebSocketService();
        if (webSocketService) {
          webSocketService.unsubscribeFromDeployment(state.deploymentId, handleDeploymentUpdate);
        }
      }
    };
  }, [state.deploymentId, handleDeploymentUpdate]);

  return {
    isDeploying: state.isDeploying,
    deploymentId: state.deploymentId,
    deploymentStatus: state.deploymentStatus,
    error: state.error,
    deployWorkflow,
    getDeploymentStatus,
    cancelDeployment,
    resetDeployment,
  };
};