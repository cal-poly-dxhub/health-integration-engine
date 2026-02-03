import { useState, useEffect, useCallback } from 'react';
import { stepFunctionsService } from '../services/stepFunctions';

export interface DeployedWorkflow {
  id: string;
  name: string;
  stateMachineArn: string;
  status: string;
  creationDate: string;
  definition: any;
  executions: Array<{
    executionArn: string;
    name: string;
    status: string;
    startDate: string;
    stopDate?: string;
  }>;
}

interface UseDeployedWorkflowsState {
  workflows: DeployedWorkflow[];
  loading: boolean;
  error: string | null;
}

/**
 * Hook for managing deployed workflows using Step Functions APIs only
 * This is for Tab 2 - shows only real deployed workflows from AWS
 */
export const useDeployedWorkflows = () => {
  const [state, setState] = useState<UseDeployedWorkflowsState>({
    workflows: [],
    loading: true,
    error: null,
  });

  // Load deployed workflows from Step Functions APIs
  const loadDeployedWorkflows = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      
      console.log('🔍 Loading deployed workflows from Step Functions APIs...');
      
      // TODO: Implement actual Step Functions API calls to list state machines
      // For now, we'll return empty array since we need to implement the list state machines API
      
      // This would be the actual implementation:
      // 1. Call Step Functions ListStateMachines API
      // 2. Filter for workflow-builder created state machines
      // 3. Get executions for each state machine
      // 4. Format the data for the UI
      
      const deployedWorkflows: DeployedWorkflow[] = [];
      
      setState(prev => ({
        ...prev,
        workflows: deployedWorkflows,
        loading: false,
      }));

      console.log(`✅ Loaded ${deployedWorkflows.length} deployed workflows from Step Functions`);
    } catch (error) {
      console.error('❌ Failed to load deployed workflows:', error);
      setState(prev => ({
        ...prev,
        workflows: [],
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load deployed workflows',
      }));
    }
  }, []);

  // Get executions for a specific workflow
  const getWorkflowExecutions = useCallback(async (stateMachineArn: string) => {
    try {
      console.log(`🔍 Loading executions for ${stateMachineArn}`);
      const executions = await stepFunctionsService.listExecutions(stateMachineArn, 20);
      console.log(`✅ Loaded ${executions.length} executions`);
      return executions;
    } catch (error) {
      console.error('❌ Failed to load executions:', error);
      return [];
    }
  }, []);

  // Start a new execution
  const startExecution = useCallback(async (stateMachineArn: string, input: string = '{}') => {
    try {
      console.log(`🚀 Starting execution for ${stateMachineArn}`);
      const result = await stepFunctionsService.startExecution(stateMachineArn, undefined, input);
      
      if (result) {
        console.log(`✅ Started execution: ${result.executionArn}`);
        // Refresh the workflows to show the new execution
        await loadDeployedWorkflows();
        return result;
      }
      
      throw new Error('Failed to start execution');
    } catch (error) {
      console.error('❌ Failed to start execution:', error);
      throw error;
    }
  }, [loadDeployedWorkflows]);

  // Stop an execution
  const stopExecution = useCallback(async (executionArn: string) => {
    try {
      console.log(`🛑 Stopping execution ${executionArn}`);
      const success = await stepFunctionsService.stopExecution(executionArn);
      
      if (success) {
        console.log(`✅ Stopped execution: ${executionArn}`);
        // Refresh the workflows to show the updated status
        await loadDeployedWorkflows();
        return true;
      }
      
      throw new Error('Failed to stop execution');
    } catch (error) {
      console.error('❌ Failed to stop execution:', error);
      throw error;
    }
  }, [loadDeployedWorkflows]);

  // Get execution details
  const getExecutionDetails = useCallback(async (executionArn: string) => {
    try {
      console.log(`🔍 Getting execution details for ${executionArn}`);
      const details = await stepFunctionsService.describeExecution(executionArn);
      console.log(`✅ Got execution details`);
      return details;
    } catch (error) {
      console.error('❌ Failed to get execution details:', error);
      throw error;
    }
  }, []);

  // Get execution history
  const getExecutionHistory = useCallback(async (executionArn: string) => {
    try {
      console.log(`🔍 Getting execution history for ${executionArn}`);
      const history = await stepFunctionsService.getExecutionHistory(executionArn);
      console.log(`✅ Got ${history.length} history events`);
      return history;
    } catch (error) {
      console.error('❌ Failed to get execution history:', error);
      throw error;
    }
  }, []);

  // Refresh deployed workflows
  const refreshDeployedWorkflows = useCallback(() => {
    return loadDeployedWorkflows();
  }, [loadDeployedWorkflows]);

  // Initial load
  useEffect(() => {
    loadDeployedWorkflows();
  }, []); // Empty dependency array to prevent infinite loops

  return {
    workflows: state.workflows,
    loading: state.loading,
    error: state.error,
    refreshDeployedWorkflows,
    getWorkflowExecutions,
    startExecution,
    stopExecution,
    getExecutionDetails,
    getExecutionHistory,
  };
};