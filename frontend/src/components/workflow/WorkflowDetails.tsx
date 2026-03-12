import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Workflow } from '../../types/workflow';
import { useWorkflows } from '../../hooks/useWorkflows';
import { stepFunctionsService, StepFunctionExecution, StateMachineDetails } from '../../services/stepFunctions';
import { workflowApiService } from '../../services/workflowApi';
import ExecutionDetails from './ExecutionDetails';
import DeleteWorkflowModal from './DeleteWorkflowModal';
import DeploymentStatusModal from './DeploymentStatusModal';
import OpenSearchPanel from './OpenSearchPanel';
import './WorkflowDetails.css';

interface WorkflowDetailsProps {
  workflow?: Workflow;
}



const WorkflowDetails: React.FC<WorkflowDetailsProps> = ({ workflow: propWorkflow }) => {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const executionParam = searchParams.get('execution');
  const { workflows, getWorkflow, deleteWorkflow } = useWorkflows();
  const [activeTab, setActiveTab] = useState<'executions' | 'definition' | 'search'>('executions');
  const [workflow, setWorkflow] = useState<Workflow | null>(propWorkflow || null);
  const [stateMachineDetails, setStateMachineDetails] = useState<StateMachineDetails | null>(null);
  const [executions, setExecutions] = useState<StepFunctionExecution[]>([]);
  const [selectedExecution, setSelectedExecution] = useState<StepFunctionExecution | null>(null);
  const [loading, setLoading] = useState(!!workflowId);
  const [executionsLoading, setExecutionsLoading] = useState(false);
  const [filters, setFilters] = useState({
    name: '',
    status: '',
    startDate: '',
    endDate: '',
    error: ''
  });
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeploymentModal, setShowDeploymentModal] = useState(false);
  const [deploymentId, setDeploymentId] = useState<string>('');
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);
  const [colWidthsInitialized, setColWidthsInitialized] = useState(false);

  // Convert percentage widths to pixels on mount so resizing is stable
  useEffect(() => {
    const table = tableRef.current;
    if (!table || colWidthsInitialized) return;
    const cols = table.querySelectorAll('colgroup col') as NodeListOf<HTMLElement>;
    const ths = table.querySelectorAll('thead th') as NodeListOf<HTMLElement>;
    if (ths.length === 0) return;
    cols.forEach((col, i) => {
      col.style.width = `${ths[i].offsetWidth}px`;
    });
    table.style.width = `${table.offsetWidth}px`;
    setColWidthsInitialized(true);
  });

  const handleResizeStart = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const table = tableRef.current;
    if (!table) return;
    const cols = table.querySelectorAll('colgroup col') as NodeListOf<HTMLElement>;
    const th = table.querySelectorAll('thead th')[index] as HTMLElement;
    if (!cols[index] || !th) return;

    const startX = e.clientX;
    const startWidth = th.offsetWidth;
    const startTableWidth = table.offsetWidth;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      const diff = ev.clientX - startX;
      const newWidth = Math.max(60, startWidth + diff);
      cols[index].style.width = `${newWidth}px`;
      table.style.width = `${startTableWidth + (newWidth - startWidth)}px`;
    };

    const onMouseUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);




  useEffect(() => {
    console.log('🔍 WorkflowDetails: Initial useEffect triggered:', {
      workflowId,
      propWorkflow: !!propWorkflow,
      workflowsCount: workflows.length
    });
    
    if (workflowId && !propWorkflow) {
      loadWorkflowDetails(workflowId);
    }
  }, [workflowId, propWorkflow]);

  const loadWorkflowDetails = async (id: string) => {
    console.log('🔄 WorkflowDetails: Loading workflow details for ID:', id);
    setLoading(true);
    try {
      // First try to get workflow from API (database) to get the correct Step Functions ARN
      const apiWorkflow = await workflowApiService.getWorkflow(id);
      
      let workflowData: Workflow;
      let stepFunctionArn: string | null = null;
      
      if (apiWorkflow && apiWorkflow.isDeployed && apiWorkflow.stepFunctionArn) {
        // Use the API workflow data if it's deployed and has Step Functions ARN
        console.log('✅ Using workflow data from API with Step Functions ARN:', apiWorkflow.stepFunctionArn);
        stepFunctionArn = apiWorkflow.stepFunctionArn;
        
        // Convert API response to Workflow type
        workflowData = {
          ...apiWorkflow,
          nodes: apiWorkflow.nodes || [],
          connections: apiWorkflow.connections || [],
        } as Workflow;
      } else {
        // Fall back to local storage
        console.log('🔄 Falling back to local storage workflow data');
        workflowData = await getWorkflow(id);
        stepFunctionArn = workflowData.stepFunctionArn || null;
      }
      
      setWorkflow(workflowData);
      
      // Load Step Functions details if we have a Step Functions ARN
      if (stepFunctionArn) {
        console.log('🚀 Loading Step Functions details for ARN:', stepFunctionArn);
        await Promise.all([
          loadStateMachineDetails(stepFunctionArn),
          loadExecutions(stepFunctionArn)
        ]);
      } else {
        console.log('❌ No Step Functions ARN found, workflow may not be deployed');
      }
    } catch (error) {
      console.error('Failed to load workflow details:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStateMachineDetails = async (stateMachineArn: string) => {
    try {
      const details = await stepFunctionsService.describeStateMachine(stateMachineArn);
      setStateMachineDetails(details);
    } catch (error) {
      console.error('Failed to load state machine details:', error);
    }
  };

  const loadExecutions = async (stateMachineArn: string, silent: boolean = false) => {
    console.log('🔄 WorkflowDetails: Loading executions for state machine:', stateMachineArn);
    if (!silent) {
      setExecutionsLoading(true);
    }
    try {
      const executionsList = await stepFunctionsService.listExecutions(stateMachineArn, 100);
      console.log('✅ WorkflowDetails: Received', executionsList.length, 'executions');
      
      // Fetch error details for failed executions
      const executionsWithErrors = await Promise.all(
        executionsList.map(async (exec) => {
          if (exec.status === 'FAILED' && !exec.error) {
            const details = await stepFunctionsService.describeExecution(exec.executionArn);
            return details ? { ...exec, error: details.error, cause: details.cause } : exec;
          }
          return exec;
        })
      );
      
      setExecutions(executionsWithErrors);
    } catch (error) {
      console.error('Failed to load executions:', error);
      setExecutions([]);
    } finally {
      if (!silent) {
        setExecutionsLoading(false);
      }
    }
  };

  // Handle execution query param - auto-select execution from search results
  useEffect(() => {
    if (executionParam && executions.length > 0) {
      const exec = executions.find(e => e.executionArn === executionParam || e.executionArn.endsWith(executionParam.split(':').pop() || ''));
      if (exec) {
        setSelectedExecution(exec);
        setActiveTab('executions');
      }
    }
  }, [executionParam, executions]);

  // Auto-refresh when there are running executions
  useEffect(() => {
    const hasRunning = executions.some(e => e.status === 'RUNNING');
    if (!hasRunning || !workflow?.stepFunctionArn) return;

    const interval = setInterval(() => {
      loadExecutions(workflow.stepFunctionArn!, true);
    }, 5000);

    return () => clearInterval(interval);
  }, [executions, workflow?.stepFunctionArn]);

  const handleEditWorkflow = () => {
    if (workflow) {
      navigate(`/workflow/editor/${workflow.id}`);
    }
  };

  const handleDeleteWorkflow = () => {
    setShowDeleteModal(true);
  };

  const confirmDeleteWorkflow = async () => {
    if (!workflow || isDeleting) return;
    
    try {
      setIsDeleting(true);
      
      // Start deletion and get the deletion response
      const deletionResponse = await deleteWorkflow(workflow.id);
      
      console.log('🔍 Deletion response:', deletionResponse);
      console.log('🔍 Step 1: Got deletion response');
      
      // Close the delete confirmation modal
      setShowDeleteModal(false);
      console.log('🔍 Step 2: Closed delete modal');
      
      // Always open the deployment status modal to show deletion progress
      // Since WebSocket messages are being received, we should show the UI
      const deletionId = deletionResponse.deletionId || deletionResponse.workflowId || workflow.id;
      console.log('🔍 Step 3: Calculated deletion ID:', deletionId);
      console.log('✅ Opening deletion progress modal with ID:', deletionId);
      
      setDeploymentId(deletionId);
      console.log('🔍 Step 4: Set deployment ID');
      
      setShowDeploymentModal(true);
      console.log('🔍 Step 5: Set show modal to true');
      
      // Force a re-render to ensure state updates
      setTimeout(() => {
        console.log('🔍 Step 6: Modal state after timeout:', { 
          showDeploymentModal: true, 
          deploymentId: deletionId,
          workflow: !!workflow 
        });
      }, 100);
      
    } catch (error) {
      console.error('Failed to delete workflow:', error);
      // Error handling is done by the DeleteWorkflowModal
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCloseDeleteModal = () => {
    if (!isDeleting) {
      setShowDeleteModal(false);
    }
  };

  const handleStartExecution = async () => {
    if (!workflow?.stepFunctionArn) return;

    try {
      const result = await stepFunctionsService.startExecution(
        workflow.stepFunctionArn,
        `execution-${Date.now()}`,
        '{}'
      );

      if (result) {
        // Reload executions to show the new one and start polling
        await loadExecutions(workflow.stepFunctionArn);
        console.log('✅ Execution started:', result.executionArn);
      } else {
        alert('Failed to start execution. Please try again.');
      }
    } catch (error) {
      console.error('Failed to start execution:', error);
      alert('Failed to start execution. Please try again.');
    }
  };

  const formatDate = (dateString: string | undefined | null) => {
    if (!dateString) {
      console.log('formatDate: No date string provided:', dateString);
      return '-';
    }
    
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        console.log('formatDate: Invalid date:', dateString);
        return 'Invalid Date';
      }
      
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      });
    } catch (error) {
      console.error('formatDate error:', error, 'for date:', dateString);
      return 'Error';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'succeeded':
        return '#10b981';
      case 'failed':
        return '#ef4444';
      case 'running':
        return '#3b82f6';
      case 'aborted':
        return '#f59e0b';
      default:
        return '#6b7280';
    }
  };

  const handleRefreshExecutions = async () => {
    if (workflow?.stepFunctionArn) {
      await loadExecutions(workflow.stepFunctionArn);
    }
  };

  const formatDuration = (startDate: string, stopDate: string) => {
    const start = new Date(startDate).getTime();
    const stop = new Date(stopDate).getTime();
    const durationMs = stop - start;
    
    if (durationMs < 1000) {
      // Less than 1 second - show milliseconds
      return `${durationMs}ms`;
    } else if (durationMs < 60000) {
      // Less than 1 minute - show seconds with decimal
      return `${(durationMs / 1000).toFixed(1)}s`;
    } else if (durationMs < 3600000) {
      // Less than 1 hour - show minutes and seconds
      const minutes = Math.floor(durationMs / 60000);
      const seconds = Math.floor((durationMs % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    } else {
      // 1 hour or more - show hours, minutes, and seconds
      const hours = Math.floor(durationMs / 3600000);
      const minutes = Math.floor((durationMs % 3600000) / 60000);
      const seconds = Math.floor((durationMs % 60000) / 1000);
      return `${hours}h ${minutes}m ${seconds}s`;
    }
  };

  const filteredExecutions = executions.filter(exec => {
    if (filters.name && !exec.name.toLowerCase().includes(filters.name.toLowerCase())) return false;
    if (filters.status && exec.status !== filters.status) return false;
    if (filters.startDate && new Date(exec.startDate).toISOString().split('T')[0] !== filters.startDate) return false;
    if (filters.endDate && exec.stopDate && new Date(exec.stopDate).toISOString().split('T')[0] !== filters.endDate) return false;
    if (filters.error && exec.status === 'FAILED') {
      const errorText = `${exec.error || ''} ${exec.cause || ''}`.toLowerCase();
      if (!errorText.includes(filters.error.toLowerCase())) return false;
    }
    return true;
  });

  if (loading) {
    return (
      <div className="workflow-details-loading">
        <div className="loading-spinner"></div>
        <p>Loading workflow details...</p>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="workflow-details-error">
        <h3>Workflow not found</h3>
        <p>The requested workflow could not be found.</p>
        <button onClick={() => navigate('/dashboard')} className="back-btn">
          Back to Dashboard
        </button>
      </div>
    );
  }

  // Show execution details if an execution is selected
  if (selectedExecution) {
    return (
      <ExecutionDetails 
        execution={selectedExecution} 
        onClose={() => setSelectedExecution(null)} 
      />
    );
  }

  return (
    <div className="workflow-details-container">
      {/* Breadcrumb */}
      <div className="workflow-breadcrumb">
        <button onClick={() => navigate('/dashboard')} className="breadcrumb-link">
          Step Functions
        </button>
        <span className="breadcrumb-separator">›</span>
        <button onClick={() => navigate('/dashboard')} className="breadcrumb-link">
          State machines
        </button>
        <span className="breadcrumb-separator">›</span>
        <span className="breadcrumb-current">{workflow.name}</span>
      </div>

      {/* Banner */}
      <div className="workflow-banner">
        <h1 className="banner-title">Workflow Execution Details</h1>
        
        {/* Action Buttons - In banner */}
        <div className="workflow-actions">
          <button onClick={handleEditWorkflow} className="action-btn edit-btn">
            Edit
          </button>
          <button 
            onClick={handleDeleteWorkflow}
            className="action-btn delete-btn"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3,6 5,6 21,6" />
              <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            Delete Workflow
          </button>
          <button onClick={handleStartExecution} className="action-btn start-execution-btn">
            Start execution
          </button>
        </div>
      </div>

      {/* Header */}
      <div className={`workflow-details-header ${detailsCollapsed ? 'collapsed' : ''}`}>
        <div className="workflow-title-section">
          <h1 className="workflow-title">{workflow.name}</h1>
          <button
            className="toggle-details-btn"
            onClick={() => setDetailsCollapsed(prev => !prev)}
            aria-expanded={!detailsCollapsed}
          >
            {detailsCollapsed ? '▸ Show details' : '▾ Hide details'}
          </button>
        </div>

        {/* Workflow Info */}
        {!detailsCollapsed && (
        <div className="workflow-info-grid">
          <div className="info-item">
            <span className="info-label">Arn</span>
            <span className="info-value">{workflow.stepFunctionArn || 'Not deployed'}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Type</span>
            <span className="info-value">{stateMachineDetails?.type || 'Standard'}</span>
          </div>
          <div className="info-item">
            <span className="info-label">IAM role ARN</span>
            <span className="info-value">{stateMachineDetails?.roleArn || 'Not available'}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Status</span>
            <span className="info-value">{stateMachineDetails?.status || (workflow.isDeployed ? 'Active' : 'Draft')}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Creation date</span>
            <span className="info-value">{stateMachineDetails?.creationDate ? formatDate(stateMachineDetails.creationDate) : formatDate(workflow.createdAt)}</span>
          </div>
        </div>
        )}
      </div>

      {/* Tabs */}
      <div className="workflow-tabs">
        <button
          className={`tab-btn ${activeTab === 'executions' ? 'active' : ''}`}
          onClick={() => setActiveTab('executions')}
        >
          Executions
        </button>
        <button
          className={`tab-btn ${activeTab === 'definition' ? 'active' : ''}`}
          onClick={() => setActiveTab('definition')}
        >
          Definition
        </button>
        <button
          className={`tab-btn ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
        >
          Message Search
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'executions' && (
          <div className="executions-tab">
            <div className="executions-header">
              <h3>Executions ({filteredExecutions.length}{filteredExecutions.length !== executions.length ? ` of ${executions.length}` : ''})</h3>
              {workflow?.stepFunctionArn && (
                <button 
                  onClick={handleRefreshExecutions}
                  className="btn-secondary refresh-btn"
                  disabled={executionsLoading}
                  title="Refresh executions"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6" />
                    <path d="M2.5 22v-6h6" />
                    <path d="M2 11.5a10 10 0 0 1 18.8-4.3L21.5 8" />
                    <path d="M22 12.5a10 10 0 0 1-18.8 4.3L2.5 16" />
                  </svg>
                  {executionsLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              )}
            </div>

            {executionsLoading ? (
              <div className="executions-loading">
                <div className="loading-spinner"></div>
                <p>Loading executions...</p>
              </div>
            ) : executions.length === 0 ? (
              <div className="no-executions">
                {workflow?.isDeployed ? (
                  <p>No executions found</p>
                ) : (
                  <p>Deploy this workflow to see executions</p>
                )}
              </div>
            ) : (
              <div className="executions-table-container">
                <table className="executions-table" ref={tableRef}>
                  <colgroup>
                    <col style={{ width: '25%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '18%' }} />
                    <col style={{ width: '18%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '17%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      {['Name', 'Status', 'Start Time', 'End Time', 'Duration', 'Error'].map((label, i) => (
                        <th key={label}>
                          {label}
                          <span
                            className="col-resize-handle"
                            onMouseDown={(e) => handleResizeStart(i, e)}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="executions-filter-row">
                      <td>
                        <input
                          type="text"
                          placeholder="Filter name..."
                          value={filters.name}
                          onChange={(e) => setFilters(f => ({ ...f, name: e.target.value }))}
                          className="filter-input"
                        />
                      </td>
                      <td>
                        <select
                          value={filters.status}
                          onChange={(e) => setFilters(f => ({ ...f, status: e.target.value }))}
                          className="filter-select"
                        >
                          <option value="">All</option>
                          <option value="RUNNING">Running</option>
                          <option value="SUCCEEDED">Succeeded</option>
                          <option value="FAILED">Failed</option>
                          <option value="TIMED_OUT">Timed Out</option>
                          <option value="ABORTED">Aborted</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="date"
                          value={filters.startDate}
                          onChange={(e) => setFilters(f => ({ ...f, startDate: e.target.value }))}
                          className="filter-input"
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          value={filters.endDate}
                          onChange={(e) => setFilters(f => ({ ...f, endDate: e.target.value }))}
                          className="filter-input"
                        />
                      </td>
                      <td></td>
                      <td>
                        <input
                          type="text"
                          placeholder="Filter error..."
                          value={filters.error}
                          onChange={(e) => setFilters(f => ({ ...f, error: e.target.value }))}
                          className="filter-input"
                        />
                      </td>
                    </tr>
                    {filteredExecutions.map((execution, index) => {
                      // Debug logging for execution object
                      if (index === 0) {
                        console.log('🔍 First execution object:', execution);
                        console.log('🔍 Available fields:', Object.keys(execution));
                        console.log('🔍 startDate field:', execution.startDate, typeof execution.startDate);
                        console.log('🔍 stopDate field:', execution.stopDate, typeof execution.stopDate);
                      }
                      
                      return (
                        <tr key={execution.executionArn} className="execution-row">
                          <td className="execution-name">
                            <button 
                              className="execution-link"
                              onClick={() => setSelectedExecution(execution)}
                            >
                              {execution.name}
                            </button>
                          </td>
                          <td>
                            <span className={`status-badge status-${execution.status.toLowerCase()}`}>
                              <span className="status-icon">
                                {execution.status === 'SUCCEEDED' ? '✓' :
                                  execution.status === 'FAILED' ? '✗' :
                                    execution.status === 'RUNNING' ? '' :
                                      execution.status === 'TIMED_OUT' ? '⏱' :
                                        execution.status === 'ABORTED' ? '⏹' :
                                          execution.status === 'STOPPED' ? '⏹' :
                                            execution.status === 'CANCELLED' ? '⏹' : '○'}
                              </span>
                              <span className="status-text">
                                {execution.status}
                              </span>
                            </span>
                          </td>
                          <td>{formatDate(execution.startDate)}</td>
                          <td>{execution.stopDate ? formatDate(execution.stopDate) : '-'}</td>
                          <td>
                            {execution.stopDate && execution.startDate
                              ? formatDuration(execution.startDate, execution.stopDate)
                              : '-'
                            }
                          </td>
                          <td className="error-cell">
                            {execution.status === 'FAILED' && (execution.error || execution.cause) ? (
                              <div className="error-content" title={execution.cause || execution.error}>
                                <span className="error-type">{execution.error || 'Error'}</span>
                                {execution.cause && (
                                  <span className="error-cause">
                                    {execution.cause.length > 50 
                                      ? `${execution.cause.substring(0, 50)}...` 
                                      : execution.cause}
                                  </span>
                                )}
                              </div>
                            ) : execution.status === 'FAILED' ? (
                              <span className="error-unknown">View details</span>
                            ) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'definition' && (
          <div className="definition-tab">
            <h3>State Machine Definition</h3>
            {stateMachineDetails ? (
              <div className="definition-content">
                <div className="definition-info">
                  <p><strong>Name:</strong> {stateMachineDetails.name}</p>
                  <p><strong>Type:</strong> {stateMachineDetails.type}</p>
                  <p><strong>Status:</strong> {stateMachineDetails.status}</p>
                  <p><strong>Role ARN:</strong> {stateMachineDetails.roleArn}</p>
                </div>
                <div className="definition-json">
                  <h4>Step Functions Definition (JSON)</h4>
                  <pre className="json-display">
                    {stateMachineDetails.definition}
                  </pre>
                </div>
              </div>
            ) : workflow?.isDeployed ? (
              <p>Loading state machine definition...</p>
            ) : (
              <div className="definition-content">
                <p>This workflow is not deployed yet. Deploy it to see the Step Functions definition.</p>
                <button onClick={handleEditWorkflow} className="deploy-workflow-btn">
                  Edit and Deploy Workflow
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'search' && (
          <div className="search-tab">
            <OpenSearchPanel 
              workflowId={workflowId} 
              indexName={workflow?.nodes?.find(n => n.type === 'opensearch')?.config?.indexName}
            />
          </div>
        )}
      </div>

      {/* Delete Workflow Modal */}
      {showDeleteModal && workflow && (
        <DeleteWorkflowModal
          workflow={{
            id: workflow.id,
            name: workflow.name,
            description: workflow.description,
            createdAt: workflow.createdAt,
            updatedAt: workflow.updatedAt,
            isDeployed: workflow.isDeployed || false,
            deploymentStatus: workflow.deploymentStatus,
            nodeCount: workflow.nodes?.length || 0,
          }}
          isOpen={showDeleteModal}
          onClose={handleCloseDeleteModal}
          onConfirm={confirmDeleteWorkflow}
          isDeleting={isDeleting}
        />
      )}

      {/* Deployment Status Modal for Deletion Progress */}
      {console.log('🔍 Modal render check:', { showDeploymentModal, deploymentId: !!deploymentId, workflow: !!workflow })}
      {showDeploymentModal && deploymentId && workflow && (
        <>
          {console.log('🎯 Rendering DeploymentStatusModal for deletion')}
          <DeploymentStatusModal
            isOpen={showDeploymentModal}
            deploymentId={deploymentId}
            workflowName={`${workflow.name} (Deletion)`}
            onClose={() => {
              console.log('🔍 Modal close called');
              setShowDeploymentModal(false);
              setDeploymentId('');
            }}
            onComplete={(status) => {
              console.log('🔍 Modal complete called:', status);
              // When deletion completes, navigate to dashboard
              if (status.status === 'completed') {
                navigate('/dashboard');
              }
            }}
          />
        </>
      )}
    </div>
  );
};

export default WorkflowDetails;