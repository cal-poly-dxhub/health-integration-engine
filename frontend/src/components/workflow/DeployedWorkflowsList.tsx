import React, { useState, useEffect } from 'react';
import { Workflow } from '../../types/workflow';
// import { workflowApiService } from '../../services/workflowApi';
import './DeployedWorkflowsList.css';

interface DeployedWorkflowsListProps {
  workflows: Workflow[];
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onViewWorkflow: (workflowId: string) => void;
}

interface WorkflowExecution {
  executionArn: string;
  name: string;
  status: string;
  startDate: string;
  stopDate?: string;
  duration?: number;
}

interface WorkflowWithExecutions extends Workflow {
  executions?: WorkflowExecution[];
  executionCount?: number;
}

const DeployedWorkflowsList: React.FC<DeployedWorkflowsListProps> = ({
  workflows,
  loading,
  error,
  onRefresh,
  onViewWorkflow,
}) => {
  const [workflowsWithExecutions, setWorkflowsWithExecutions] = useState<WorkflowWithExecutions[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<string | null>(null);
  const [loadingExecutions, setLoadingExecutions] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadDeploymentStatuses();
  }, [workflows]);

  const loadDeploymentStatuses = async () => {
    // DISABLED: No longer fetching deployment status separately
    // Status is now maintained in real-time by event-driven updates from Step Functions
    console.log('ℹ️ Deployment status loading disabled - using event-driven updates');
    
    // Just use the workflows as-is since their status is already up-to-date
    setWorkflowsWithExecutions(workflows as WorkflowWithExecutions[]);
  };

  const loadExecutions = async (workflow: WorkflowWithExecutions) => {
    if (!workflow.stepFunctionArn) return;
    
    setLoadingExecutions(prev => new Set(prev).add(workflow.id));
    
    try {
      // TODO: Implement Step Functions execution listing
      // For now, create mock executions based on deployment history
      const mockExecutions: WorkflowExecution[] = [
        {
          executionArn: `${workflow.stepFunctionArn}:execution:${workflow.lastDeploymentId}`,
          name: workflow.lastDeploymentId || 'deployment-execution',
          status: workflow.deploymentStatus === 'deployed' ? 'SUCCEEDED' : 
                 workflow.deploymentStatus === 'failed' ? 'FAILED' : 
                 (workflow.deploymentStatus as any) === 'delete_failed' ? 'FAILED' : 'RUNNING',
          startDate: workflow.updatedAt,
          stopDate: workflow.updatedAt,
          duration: 0,
        }
      ];

      setWorkflowsWithExecutions(prev => 
        prev.map(w => 
          w.id === workflow.id 
            ? { ...w, executions: mockExecutions, executionCount: mockExecutions.length }
            : w
        )
      );
    } catch (error) {
      console.error('Failed to load executions:', error);
    } finally {
      setLoadingExecutions(prev => {
        const newSet = new Set(prev);
        newSet.delete(workflow.id);
        return newSet;
      });
    }
  };

  const formatDuration = (duration?: number) => {
    if (!duration) return 'N/A';
    
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${remainingSeconds}s`;
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'succeeded':
      case 'completed':
        return '#10b981';
      case 'failed':
        return '#ef4444';
      case 'running':
      case 'in_progress':
        return '#3b82f6';
      default:
        return '#6b7280';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'succeeded':
      case 'completed':
        return '✅';
      case 'failed':
        return '❌';
      case 'running':
      case 'in_progress':
        return '⏳';
      default:
        return '⏸️';
    }
  };

  if (loading) {
    return (
      <div className="deployed-workflows-container">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading deployed workflows...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="deployed-workflows-container">
        <div className="error-state">
          <h3>Error Loading Workflows</h3>
          <p>{error}</p>
          <button onClick={onRefresh} className="retry-btn">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (workflowsWithExecutions.length === 0) {
    return (
      <div className="deployed-workflows-container">
        <div className="empty-state">
          <h3>No Deployed Workflows</h3>
          <p>Deploy a workflow to see it here with execution details.</p>
          <button onClick={onRefresh} className="refresh-btn">
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="deployed-workflows-container">
      <div className="deployed-workflows-header">
        <h2>Deployed Workflows</h2>
        <button onClick={onRefresh} className="refresh-btn">
          🔄 Refresh
        </button>
      </div>

      <div className="deployed-workflows-content">
        {/* Workflows List */}
        <div className="workflows-panel">
          <div className="workflows-list">
            {workflowsWithExecutions.map((workflow) => (
              <div
                key={workflow.id}
                className={`workflow-item ${selectedWorkflow === workflow.id ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedWorkflow(workflow.id);
                  setSelectedExecution(null);
                  if (!workflow.executions) {
                    loadExecutions(workflow);
                  }
                }}
              >
                <div className="workflow-header">
                  <div className="workflow-info">
                    <h3>{workflow.name}</h3>
                    <p className="workflow-id">ID: {workflow.id}</p>
                  </div>
                  <div className="workflow-status">
                    <span 
                      className="status-badge"
                      style={{ 
                        backgroundColor: getStatusColor(workflow.deploymentStatus || 'pending'),
                        color: 'white'
                      }}
                    >
                      {getStatusIcon(workflow.deploymentStatus || 'pending')}
                      {workflow.deploymentStatus?.toUpperCase() || 'PENDING'}
                    </span>
                  </div>
                </div>
                
                <div className="workflow-metadata">
                  <div className="metadata-row">
                    <span>Created: {new Date(workflow.createdAt).toLocaleDateString()}</span>
                    <span>Updated: {new Date(workflow.updatedAt).toLocaleDateString()}</span>
                  </div>
                  {workflow.deploymentStatus && (
                    <div className="metadata-row">
                      <span>Deployed: {new Date(workflow.updatedAt).toLocaleDateString()}</span>
                      <span>Executions: {workflow.executionCount || 0}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Workflow Details Panel */}
        {selectedWorkflow && (
          <div className="workflow-details-panel">
            {(() => {
              const workflow = workflowsWithExecutions.find(w => w.id === selectedWorkflow);
              if (!workflow) return null;

              return (
                <div className="workflow-details">
                  {/* Workflow Header */}
                  <div className="workflow-details-header">
                    <div className="workflow-title">
                      <h2>{workflow.name}</h2>
                      <button
                        onClick={() => onViewWorkflow(workflow.id)}
                        className="edit-workflow-btn"
                      >
                        Edit Workflow
                      </button>
                    </div>
                    
                    <div className="workflow-summary">
                      <div className="summary-grid">
                        <div className="summary-item">
                          <span className="summary-label">Status:</span>
                          <span 
                            className="summary-value status"
                            style={{ color: getStatusColor(workflow.deploymentStatus || 'pending') }}
                          >
                            {getStatusIcon(workflow.deploymentStatus || 'pending')}
                            {workflow.deploymentStatus?.toUpperCase() || 'PENDING'}
                          </span>
                        </div>
                        <div className="summary-item">
                          <span className="summary-label">Created:</span>
                          <span className="summary-value">
                            {new Date(workflow.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="summary-item">
                          <span className="summary-label">Last Deployed:</span>
                          <span className="summary-value">
                            {workflow.deploymentStatus 
                              ? new Date(workflow.updatedAt).toLocaleString()
                              : 'Never'
                            }
                          </span>
                        </div>
                        <div className="summary-item">
                          <span className="summary-label">Total Executions:</span>
                          <span className="summary-value">{workflow.executionCount || 0}</span>
                        </div>
                      </div>
                    </div>

                    {workflow.stepFunctionArn && (
                      <div className="step-function-details">
                        <div className="summary-item">
                          <span className="summary-label">Step Function ARN:</span>
                          <code className="arn-display">{workflow.stepFunctionArn}</code>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Executions List */}
                  <div className="executions-section">
                    <div className="executions-header">
                      <h3>Executions</h3>
                      {loadingExecutions.has(workflow.id) && (
                        <div className="loading-spinner small"></div>
                      )}
                    </div>

                    {workflow.executions && workflow.executions.length > 0 ? (
                      <div className="executions-list">
                        {workflow.executions.map((execution) => (
                          <div
                            key={execution.executionArn}
                            className={`execution-item ${selectedExecution === execution.executionArn ? 'selected' : ''}`}
                            onClick={() => setSelectedExecution(execution.executionArn)}
                          >
                            <div className="execution-header">
                              <div className="execution-info">
                                <h4>{execution.name}</h4>
                                <p className="execution-arn">{execution.executionArn}</p>
                              </div>
                              <div className="execution-status">
                                <span 
                                  className="status-badge small"
                                  style={{ 
                                    backgroundColor: getStatusColor(execution.status),
                                    color: 'white'
                                  }}
                                >
                                  {getStatusIcon(execution.status)}
                                  {execution.status}
                                </span>
                              </div>
                            </div>
                            
                            <div className="execution-metadata">
                              <span>Started: {new Date(execution.startDate).toLocaleString()}</span>
                              {execution.stopDate && (
                                <span>Ended: {new Date(execution.stopDate).toLocaleString()}</span>
                              )}
                              <span>Duration: {formatDuration(execution.duration)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="no-executions">
                        <p>No executions found for this workflow.</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
};

export default DeployedWorkflowsList;