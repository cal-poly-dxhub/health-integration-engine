import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Workflow } from '../../types/workflow';
import { useWorkflows } from '../../hooks/useWorkflows';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useMe } from '../../contexts/MeContext';
import {
  stepFunctionsService,
  StepFunctionExecution,
  StateMachineDetails,
} from '../../services/stepFunctions';
import { workflowApiService } from '../../services/workflowApi';
import ExecutionDetails from './ExecutionDetails';
import DeleteWorkflowModal from './DeleteWorkflowModal';
import DeploymentStatusModal from './DeploymentStatusModal';
import OpenSearchPanel from './OpenSearchPanel';
import { teamApiService, WorkflowChangeEntry, ChangeAction } from '../../services/teamApi';
import ChangeDiffView from '../ChangeDiffView';
import './WorkflowDetails.css';

interface WorkflowDetailsProps {
  workflow?: Workflow;
}

interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  running: boolean;
}

type TabKey = 'executions' | 'definition' | 'details' | 'search' | 'changelog';

const WorkflowDetails: React.FC<WorkflowDetailsProps> = ({
  workflow: propWorkflow,
}) => {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const executionParam = searchParams.get('execution');
  const { getWorkflow, deleteWorkflow } = useWorkflows();
  const { me, teamsById } = useMe();

  const [activeTab, setActiveTab] = useState<TabKey>('executions');
  const [workflow, setWorkflow] = useState<Workflow | null>(
    propWorkflow || null
  );

  // Reader-only on this workflow's team? Hide Edit / Delete / Deploy actions.
  const isReadOnly = (() => {
    if (!workflow) return false;
    if (!me) return false;
    if (me.isAdmin) return false;
    const membership = teamsById[workflow.teamId];
    if (!membership) return true;
    return membership.role !== 'writer';
  })();
  const [stateMachineDetails, setStateMachineDetails] =
    useState<StateMachineDetails | null>(null);
  const [executions, setExecutions] = useState<StepFunctionExecution[]>([]);
  const [selectedExecution, setSelectedExecution] =
    useState<StepFunctionExecution | null>(null);
  const [loading, setLoading] = useState(!!workflowId);
  const [executionsLoading, setExecutionsLoading] = useState(false);
  const [filters, setFilters] = useState({
    name: '',
    status: '',
    startDate: '',
    endDate: '',
    error: '',
  });
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeploymentModal, setShowDeploymentModal] = useState(false);
  const [deploymentId, setDeploymentId] = useState<string>('');
  const [deletionStatus, setDeletionStatus] = useState<string>('');

  const [changelogEntries, setChangelogEntries] = useState<WorkflowChangeEntry[]>([]);
  const [changelogLoading, setChangelogLoading] = useState(false);

  const [selectedExecutions, setSelectedExecutions] = useState<Set<string>>(
    new Set()
  );
  const [showBatchConfirmModal, setShowBatchConfirmModal] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress>({
    total: 0,
    completed: 0,
    failed: 0,
    running: false,
  });

  useDocumentTitle(workflow?.name || 'Workflow');

  useEffect(() => {
    if (workflowId && !propWorkflow) {
      loadWorkflowDetails(workflowId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, propWorkflow]);

  const loadWorkflowDetails = async (id: string) => {
    setLoading(true);
    try {
      const apiWorkflow = await workflowApiService.getWorkflow(id);

      let workflowData: Workflow;
      let stepFunctionArn: string | null = null;

      if (
        apiWorkflow &&
        apiWorkflow.isDeployed &&
        apiWorkflow.stepFunctionArn
      ) {
        stepFunctionArn = apiWorkflow.stepFunctionArn;
        workflowData = {
          ...apiWorkflow,
          nodes: apiWorkflow.nodes || [],
          connections: apiWorkflow.connections || [],
        } as Workflow;
      } else {
        workflowData = await getWorkflow(id);
        stepFunctionArn = workflowData.stepFunctionArn || null;
      }

      setWorkflow(workflowData);

      if (stepFunctionArn) {
        await Promise.all([
          loadStateMachineDetails(stepFunctionArn),
          loadExecutions(stepFunctionArn),
        ]);
      }
    } catch (error) {
      console.error('Failed to load workflow details:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStateMachineDetails = async (stateMachineArn: string) => {
    try {
      const details =
        await stepFunctionsService.describeStateMachine(stateMachineArn);
      setStateMachineDetails(details);
    } catch (error) {
      console.error('Failed to load state machine details:', error);
    }
  };

  const loadExecutions = async (
    stateMachineArn: string,
    silent = false
  ) => {
    if (!silent) setExecutionsLoading(true);

    try {
      const executionsList = await stepFunctionsService.listExecutions(
        stateMachineArn,
        100
      );

      const executionsWithErrors = await Promise.all(
        executionsList.map(async (exec) => {
          if (exec.status === 'FAILED' && !exec.error) {
            const details = await stepFunctionsService.describeExecution(
              exec.executionArn
            );
            return details
              ? { ...exec, error: details.error, cause: details.cause }
              : exec;
          }
          return exec;
        })
      );

      setExecutions(executionsWithErrors);
    } catch (error) {
      console.error('Failed to load executions:', error);
      setExecutions([]);
    } finally {
      if (!silent) setExecutionsLoading(false);
    }
  };

  // Auto-select execution from query param (e.g. linked from search results)
  useEffect(() => {
    if (executionParam && executions.length > 0) {
      const exec = executions.find(
        (e) =>
          e.executionArn === executionParam ||
          e.executionArn.endsWith(executionParam.split(':').pop() || '')
      );
      if (exec) {
        setSelectedExecution(exec);
        setActiveTab('executions');
        setSearchParams({}, { replace: true });
      }
    }
  }, [executionParam, executions, setSearchParams]);

  // Auto-refresh while there are running executions
  useEffect(() => {
    const hasRunning = executions.some((e) => e.status === 'RUNNING');
    if (!hasRunning || !workflow?.stepFunctionArn) return;

    const interval = setInterval(() => {
      loadExecutions(workflow.stepFunctionArn!, true);
    }, 5000);

    return () => clearInterval(interval);
  }, [executions, workflow?.stepFunctionArn]);

  const handleEditWorkflow = () => {
    if (workflow) navigate(`/workflow/editor/${workflow.id}`);
  };

  const handleDeleteWorkflow = () => setShowDeleteModal(true);

  const confirmDeleteWorkflow = async () => {
    if (!workflow || isDeleting) return;

    try {
      setIsDeleting(true);
      setDeletionStatus('Initiating deletion...');

      await deleteWorkflow(workflow.id);

      setShowDeleteModal(false);
      setIsDeleting(false);
      setDeletionStatus('');
      setDeploymentId(workflow.id);
      setShowDeploymentModal(true);
    } catch (error) {
      console.error('Failed to delete workflow:', error);
      setDeletionStatus('Deletion failed. Please try again.');
      setIsDeleting(false);
    }
  };

  const handleCloseDeleteModal = () => {
    if (!isDeleting) setShowDeleteModal(false);
  };

  const handleRefreshExecutions = async () => {
    if (workflow?.stepFunctionArn) {
      await loadExecutions(workflow.stepFunctionArn);
    }
  };

  const toggleExecutionSelection = (executionArn: string) => {
    setSelectedExecutions((prev) => {
      const next = new Set(prev);
      if (next.has(executionArn)) next.delete(executionArn);
      else next.add(executionArn);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedExecutions.size === filteredExecutions.length) {
      setSelectedExecutions(new Set());
    } else {
      setSelectedExecutions(
        new Set(filteredExecutions.map((e) => e.executionArn))
      );
    }
  };

  const handleBatchNewExecution = async () => {
    if (!workflow?.stepFunctionArn || selectedExecutions.size === 0) return;

    setShowBatchConfirmModal(false);
    const selected = Array.from(selectedExecutions);
    setBatchProgress({
      total: selected.length,
      completed: 0,
      failed: 0,
      running: true,
    });

    const BATCH_SIZE = 25;
    for (let i = 0; i < selected.length; i++) {
      if (i > 0 && i % BATCH_SIZE === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      try {
        const details = await stepFunctionsService.describeExecution(
          selected[i]
        );
        const input = details?.input || '{}';

        await stepFunctionsService.startExecution(
          workflow.stepFunctionArn,
          `reexec-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
          input
        );

        setBatchProgress((prev) => ({
          ...prev,
          completed: prev.completed + 1,
        }));
      } catch (err) {
        console.error('Failed to re-execute:', selected[i], err);
        setBatchProgress((prev) => ({ ...prev, failed: prev.failed + 1 }));
      }
    }

    setBatchProgress((prev) => ({ ...prev, running: false }));
    setSelectedExecutions(new Set());

    if (workflow.stepFunctionArn) {
      await loadExecutions(workflow.stepFunctionArn);
    }
  };

  const formatDate = (dateString: string | undefined | null) => {
    if (!dateString) return '—';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Invalid date';
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return 'Error';
    }
  };

  const formatDuration = (startDate: string, stopDate: string) => {
    const start = new Date(startDate).getTime();
    const stop = new Date(stopDate).getTime();
    const durationMs = stop - start;

    if (durationMs < 1000) return `${durationMs}ms`;
    if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
    if (durationMs < 3600000) {
      const minutes = Math.floor(durationMs / 60000);
      const seconds = Math.floor((durationMs % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    }
    const hours = Math.floor(durationMs / 3600000);
    const minutes = Math.floor((durationMs % 3600000) / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${hours}h ${minutes}m ${seconds}s`;
  };

  const filteredExecutions = executions.filter((exec) => {
    if (
      filters.name &&
      !exec.name.toLowerCase().includes(filters.name.toLowerCase())
    )
      return false;
    if (filters.status && exec.status !== filters.status) return false;
    if (
      filters.startDate &&
      new Date(exec.startDate).toISOString().split('T')[0] !==
        filters.startDate
    )
      return false;
    if (
      filters.endDate &&
      exec.stopDate &&
      new Date(exec.stopDate).toISOString().split('T')[0] !== filters.endDate
    )
      return false;
    if (filters.error && exec.status === 'FAILED') {
      const errorText = `${exec.error || ''} ${exec.cause || ''}`.toLowerCase();
      if (!errorText.includes(filters.error.toLowerCase())) return false;
    }
    return true;
  });

  if (loading) {
    return (
      <div className="wfd-root">
        <div className="wfd-body">
          <div className="wfd-state">
            <span className="wfd-state-spinner" aria-hidden="true" />
            <p className="wfd-state-sub">Loading workflow…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="wfd-root">
        <div className="wfd-body">
          <div className="wfd-state">
            <span className="wfd-state-icon" aria-hidden="true">
              <AlertIcon />
            </span>
            <h3 className="wfd-state-title">Workflow not found</h3>
            <p className="wfd-state-sub">
              The requested workflow could not be found.
            </p>
            <button
              onClick={() => navigate('/dashboard')}
              className="wfd-btn wfd-btn--primary"
            >
              Back to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show execution details if an execution is selected
  if (selectedExecution) {
    return (
      <ExecutionDetails
        execution={selectedExecution}
        onClose={() => setSelectedExecution(null)}
        isReadOnly={isReadOnly}
      />
    );
  }

  const tabsList: Array<{ key: TabKey; label: string; enabled: boolean }> = [
    { key: 'executions', label: 'Executions', enabled: true },
    { key: 'definition', label: 'Definition', enabled: true },
    { key: 'details', label: 'Details', enabled: true },
    {
      key: 'search',
      label: 'Message Search',
      enabled: import.meta.env.VITE_ENABLE_OPENSEARCH !== 'false',
    },
    { key: 'changelog', label: 'Changelog', enabled: true },
  ];

  const handleTabChange = (key: TabKey) => {
    setActiveTab(key);
    if (key === 'changelog' && workflowId && changelogEntries.length === 0) {
      setChangelogLoading(true);
      teamApiService
        .getWorkflowChangelog(workflowId)
        .then(setChangelogEntries)
        .catch(console.error)
        .finally(() => setChangelogLoading(false));
    }
  };

  const allChecked =
    filteredExecutions.length > 0 &&
    selectedExecutions.size === filteredExecutions.length;

  return (
    <div className="wfd-root">
      {/* ---------- Top nav ---------- */}
      <nav className="wfd-nav">
        <div className="wfd-nav-left">
          <button
            type="button"
            className="wfd-back"
            onClick={() => navigate('/dashboard')}
          >
            <ArrowLeftIcon />
            Dashboard
          </button>
          <div className="wfd-nav-title">
            <div className="wfd-nav-title-row">
              <h1 className="wfd-name">{workflow.name}</h1>
              <DeploymentBadge workflow={workflow} />
            </div>
            {workflow.description && (
              <p className="wfd-description">{workflow.description}</p>
            )}
            {workflow.updatedByEmail && (
              <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
                Last edited by {workflow.updatedByEmail} · {formatDate(workflow.updatedAt)}
              </p>
            )}
          </div>
        </div>

        <div className="wfd-nav-right">
          {isReadOnly ? (
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                padding: '4px 10px',
                borderRadius: 999,
                background: '#f3f4f6',
                color: '#4b5563',
              }}
              title="You have read-only access on this team. Ask an admin for writer access."
            >
              Read-only
            </span>
          ) : (
            <>
              <button
                type="button"
                className="wfd-btn wfd-btn--danger"
                onClick={handleDeleteWorkflow}
              >
                <TrashIcon />
                Delete
              </button>
              <button
                type="button"
                className="wfd-btn wfd-btn--primary"
                onClick={handleEditWorkflow}
              >
                <EditIcon />
                Edit
              </button>
            </>
          )}
        </div>
      </nav>

      {/* ---------- Body ---------- */}
      <div className="wfd-body">
        <div className="wfd-page">
          {/* Tabs */}
          <div className="wfd-tabs" role="tablist">
            {tabsList
              .filter((t) => t.enabled)
              .map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  onClick={() => handleTabChange(tab.key)}
                  className={`wfd-tab${
                    activeTab === tab.key ? ' wfd-tab--active' : ''
                  }`}
                >
                  {tab.label}
                </button>
              ))}
          </div>

          {/* ---------- Executions tab ---------- */}
          {activeTab === 'executions' && (
            <div className="wfd-pane">
              <div className="wfd-pane-head">
                <h3 className="wfd-pane-title">
                  Executions{' '}
                  <span className="wfd-pane-title-count">
                    ({filteredExecutions.length}
                    {filteredExecutions.length !== executions.length
                      ? ` of ${executions.length}`
                      : ''}
                    )
                  </span>
                </h3>
                <div className="wfd-pane-actions">
                  {!isReadOnly && selectedExecutions.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowBatchConfirmModal(true)}
                      className="wfd-btn wfd-btn--primary"
                      disabled={batchProgress.running}
                    >
                      <PlayIcon />
                      New execution ({selectedExecutions.size} selected)
                    </button>
                  )}
                  {workflow.stepFunctionArn && (
                    <button
                      type="button"
                      onClick={handleRefreshExecutions}
                      className="wfd-btn"
                      disabled={executionsLoading}
                      title="Refresh executions"
                    >
                      <RefreshIcon />
                      {executionsLoading ? 'Refreshing…' : 'Refresh'}
                    </button>
                  )}
                </div>
              </div>

              {executionsLoading ? (
                <div className="wfd-state">
                  <span
                    className="wfd-state-spinner"
                    aria-hidden="true"
                  />
                  <p className="wfd-state-sub">Loading executions…</p>
                </div>
              ) : executions.length === 0 ? (
                <div className="wfd-state">
                  <span className="wfd-state-icon" aria-hidden="true">
                    <PlayIcon />
                  </span>
                  <h3 className="wfd-state-title">
                    {workflow.isDeployed
                      ? 'No executions yet'
                      : 'Workflow not deployed'}
                  </h3>
                  <p className="wfd-state-sub">
                    {workflow.isDeployed
                      ? 'Start an execution to see it appear here.'
                      : 'Deploy this workflow to start executing it.'}
                  </p>
                </div>
              ) : (
                <div className="wfd-table-wrap">
                  <table className="wfd-table">
                    <thead>
                      <tr>
                        <th className="wfd-checkbox-col">
                          <input
                            type="checkbox"
                            className="wfd-checkbox"
                            checked={allChecked}
                            onChange={toggleSelectAll}
                            aria-label="Select all"
                          />
                        </th>
                        <th>Name</th>
                        <th>Status</th>
                        <th>Start time</th>
                        <th>End time</th>
                        <th>Duration</th>
                        <th>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="wfd-filter-row">
                        <td></td>
                        <td>
                          <input
                            type="text"
                            placeholder="Filter name…"
                            value={filters.name}
                            onChange={(e) =>
                              setFilters((f) => ({
                                ...f,
                                name: e.target.value,
                              }))
                            }
                            className="wfd-filter-input"
                          />
                        </td>
                        <td>
                          <select
                            value={filters.status}
                            onChange={(e) =>
                              setFilters((f) => ({
                                ...f,
                                status: e.target.value,
                              }))
                            }
                            className="wfd-filter-select"
                          >
                            <option value="">All</option>
                            <option value="RUNNING">Running</option>
                            <option value="SUCCEEDED">Succeeded</option>
                            <option value="FAILED">Failed</option>
                            <option value="TIMED_OUT">Timed out</option>
                            <option value="ABORTED">Aborted</option>
                          </select>
                        </td>
                        <td>
                          <input
                            type="date"
                            value={filters.startDate}
                            onChange={(e) =>
                              setFilters((f) => ({
                                ...f,
                                startDate: e.target.value,
                              }))
                            }
                            className="wfd-filter-input"
                          />
                        </td>
                        <td>
                          <input
                            type="date"
                            value={filters.endDate}
                            onChange={(e) =>
                              setFilters((f) => ({
                                ...f,
                                endDate: e.target.value,
                              }))
                            }
                            className="wfd-filter-input"
                          />
                        </td>
                        <td></td>
                        <td>
                          <input
                            type="text"
                            placeholder="Filter error…"
                            value={filters.error}
                            onChange={(e) =>
                              setFilters((f) => ({
                                ...f,
                                error: e.target.value,
                              }))
                            }
                            className="wfd-filter-input"
                          />
                        </td>
                      </tr>

                      {filteredExecutions.map((execution) => {
                        const isSelected = selectedExecutions.has(
                          execution.executionArn
                        );
                        return (
                          <tr
                            key={execution.executionArn}
                            className={
                              isSelected ? 'wfd-row--selected' : undefined
                            }
                          >
                            <td className="wfd-checkbox-col">
                              <input
                                type="checkbox"
                                className="wfd-checkbox"
                                checked={isSelected}
                                onChange={() =>
                                  toggleExecutionSelection(
                                    execution.executionArn
                                  )
                                }
                                aria-label={`Select ${execution.name}`}
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="wfd-execution-link"
                                onClick={() =>
                                  setSelectedExecution(execution)
                                }
                              >
                                {execution.name}
                              </button>
                            </td>
                            <td>
                              <ExecutionStatusBadge
                                status={execution.status}
                              />
                            </td>
                            <td className="wfd-cell-date">
                              {formatDate(execution.startDate)}
                            </td>
                            <td className="wfd-cell-date">
                              {execution.stopDate
                                ? formatDate(execution.stopDate)
                                : '—'}
                            </td>
                            <td className="wfd-cell-duration">
                              {execution.stopDate && execution.startDate
                                ? formatDuration(
                                    execution.startDate,
                                    execution.stopDate
                                  )
                                : '—'}
                            </td>
                            <td className="wfd-error-cell">
                              {execution.status === 'FAILED' &&
                              (execution.error || execution.cause) ? (
                                <div
                                  className="wfd-error-content"
                                  title={execution.cause || execution.error}
                                >
                                  <span className="wfd-error-type">
                                    {execution.error || 'Error'}
                                  </span>
                                  {execution.cause && (
                                    <span className="wfd-error-cause">
                                      {execution.cause.length > 80
                                        ? `${execution.cause.substring(0, 80)}…`
                                        : execution.cause}
                                    </span>
                                  )}
                                </div>
                              ) : execution.status === 'FAILED' ? (
                                <span className="wfd-error-unknown">
                                  View details
                                </span>
                              ) : (
                                '—'
                              )}
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

          {/* ---------- Definition tab ---------- */}
          {activeTab === 'definition' && (
            <div className="wfd-pane">
              <div className="wfd-pane-head">
                <h3 className="wfd-pane-title">State machine definition</h3>
              </div>
              {stateMachineDetails ? (
                <div className="wfd-def-grid">
                  <div className="wfd-def-block">
                    <div className="wfd-def-block-head">
                      Step Functions definition (JSON)
                    </div>
                    <pre className="wfd-def-pre">
                      {stateMachineDetails.definition}
                    </pre>
                  </div>
                </div>
              ) : workflow.isDeployed ? (
                <div className="wfd-state">
                  <span
                    className="wfd-state-spinner"
                    aria-hidden="true"
                  />
                  <p className="wfd-state-sub">
                    Loading state machine definition…
                  </p>
                </div>
              ) : (
                <div className="wfd-state">
                  <span className="wfd-state-icon" aria-hidden="true">
                    <CodeIcon />
                  </span>
                  <h3 className="wfd-state-title">Not deployed</h3>
                  <p className="wfd-state-sub">
                    Deploy this workflow to see the Step Functions definition.
                  </p>
                  <button
                    onClick={handleEditWorkflow}
                    className="wfd-btn wfd-btn--primary"
                  >
                    <EditIcon />
                    Edit and deploy
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ---------- Details tab ---------- */}
          {activeTab === 'details' && (
            <div className="wfd-pane">
              <div className="wfd-pane-head">
                <h3 className="wfd-pane-title">Workflow details</h3>
              </div>
              <div className="wfd-summary-grid">
                <div>
                  <span className="wfd-info-label">Status</span>
                  <span className="wfd-info-value">
                    {stateMachineDetails?.status ||
                      (workflow.isDeployed ? 'Active' : 'Draft')}
                  </span>
                </div>
                <div>
                  <span className="wfd-info-label">Type</span>
                  <span className="wfd-info-value">
                    {stateMachineDetails?.type || 'Standard'}
                  </span>
                </div>
                <div>
                  <span className="wfd-info-label">Created</span>
                  <span className="wfd-info-value">
                    {stateMachineDetails?.creationDate
                      ? formatDate(stateMachineDetails.creationDate)
                      : formatDate(workflow.createdAt)}
                  </span>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <span className="wfd-info-label">
                    State machine ARN
                  </span>
                  <span className="wfd-info-value wfd-info-mono">
                    {workflow.stepFunctionArn || 'Not deployed'}
                  </span>
                </div>
                {stateMachineDetails?.roleArn && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span className="wfd-info-label">IAM role ARN</span>
                    <span className="wfd-info-value wfd-info-mono">
                      {stateMachineDetails.roleArn}
                    </span>
                  </div>
                )}
                {workflow.description && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span className="wfd-info-label">Description</span>
                    <span className="wfd-info-value">
                      {workflow.description}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---------- Search tab ---------- */}
          {activeTab === 'search' &&
            import.meta.env.VITE_ENABLE_OPENSEARCH !== 'false' && (
              <OpenSearchPanel
                workflowId={workflowId}
                indexName={
                  (
                    workflow.nodes?.find(
                      (n: any) => n.type === 'opensearch'
                    )?.config as { indexName?: string } | undefined
                  )?.indexName
                }
              />
            )}

          {activeTab === 'changelog' && (
            <div className="wfd-pane">
              <div className="wfd-pane-header">
                <h3 className="wfd-pane-title">Workflow changelog</h3>
                <button
                  type="button"
                  className="wfd-btn"
                  disabled={changelogLoading}
                  onClick={() => {
                    if (!workflowId) return;
                    setChangelogLoading(true);
                    teamApiService
                      .getWorkflowChangelog(workflowId)
                      .then(setChangelogEntries)
                      .catch(console.error)
                      .finally(() => setChangelogLoading(false));
                  }}
                >
                  Refresh
                </button>
              </div>
              {changelogLoading ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>Loading…</div>
              ) : changelogEntries.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af', fontStyle: 'italic' }}>
                  No changes recorded yet.
                </div>
              ) : (
                <ChangelogTable entries={changelogEntries} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---------- Batch confirm modal ---------- */}
      {showBatchConfirmModal && (
        <div
          className="wfd-modal-overlay"
          onClick={() => setShowBatchConfirmModal(false)}
        >
          <div className="wfd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="wfd-modal-head">
              <h3 className="wfd-modal-title">
                Confirm batch re-execution
              </h3>
              <button
                type="button"
                className="wfd-modal-close"
                onClick={() => setShowBatchConfirmModal(false)}
                aria-label="Close"
              >
                
              </button>
            </div>
            <div className="wfd-modal-body">
              <p>
                Start a new execution for{' '}
                <strong>{selectedExecutions.size}</strong> selected item
                {selectedExecutions.size > 1 ? 's' : ''}?
              </p>
              <p className="wfd-modal-note">
                Each new execution will use the original execution's input.
              </p>
              {selectedExecutions.size > 25 && (
                <p className="wfd-modal-note">
                  Executions will be processed in batches of 25 to avoid
                  rate limiting.
                </p>
              )}
            </div>
            <div className="wfd-modal-foot">
              <button
                type="button"
                className="wfd-btn"
                onClick={() => setShowBatchConfirmModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="wfd-btn wfd-btn--primary"
                onClick={handleBatchNewExecution}
              >
                Start executions
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Batch progress toast ---------- */}
      {batchProgress.running && (
        <div className="wfd-batch-toast" role="status" aria-live="polite">
          <span className="wfd-batch-toast-spinner" aria-hidden="true" />
          <span>
            Re-executing {batchProgress.completed + batchProgress.failed} of{' '}
            {batchProgress.total}
            {batchProgress.failed > 0 && (
              <>
                {' '}
                <span className="wfd-batch-toast-failed">
                  ({batchProgress.failed} failed)
                </span>
              </>
            )}
          </span>
        </div>
      )}

      {/* ---------- Delete + deployment modals (unchanged) ---------- */}
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
          deletionStatus={deletionStatus}
        />
      )}

      {showDeploymentModal && deploymentId && workflow && (
        <DeploymentStatusModal
          isOpen={showDeploymentModal}
          deploymentId={deploymentId}
          workflowName={`${workflow.name} (Deletion)`}
          onClose={() => {
            setShowDeploymentModal(false);
            setDeploymentId('');
          }}
          onComplete={(status) => {
            if (status.status === 'completed') {
              // Auto-close + redirect after a brief success-display window;
              // the user should NOT need to press Close.
              setTimeout(() => {
                setShowDeploymentModal(false);
                setDeploymentId('');
                navigate('/dashboard');
              }, 1500);
            }
          }}
        />
      )}
    </div>
  );
};

export default WorkflowDetails;

/* ---------- Helpers ---------- */

function DeploymentBadge({ workflow }: { workflow: Workflow }) {
  if (!workflow.isDeployed) {
    return <span className="wfd-badge wfd-badge--default">Draft</span>;
  }
  const status = workflow.deploymentStatus;
  const variant =
    status === 'deployed'
      ? 'succeeded'
      : status === 'deploying'
      ? 'running'
      : status === 'failed' || status === 'delete_failed'
      ? 'failed'
      : 'default';
  const label = (status || 'deployed').toUpperCase();
  return (
    <span className={`wfd-badge wfd-badge--${variant}`}>{label}</span>
  );
}

function ExecutionStatusBadge({ status }: { status: string }) {
  const variant =
    status === 'SUCCEEDED'
      ? 'succeeded'
      : status === 'FAILED'
      ? 'failed'
      : status === 'RUNNING'
      ? 'running'
      : status === 'TIMED_OUT'
      ? 'timed-out'
      : status === 'ABORTED' ||
        status === 'STOPPED' ||
        status === 'CANCELLED'
      ? 'aborted'
      : 'default';
  return (
    <span className={`wfd-badge wfd-badge--${variant}`}>
      {status}
    </span>
  );
}

/* ---------- Inline SVG icons ---------- */

function ChangelogTable({ entries }: { entries: WorkflowChangeEntry[] }) {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const toggle = (sk: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(sk) ? next.delete(sk) : next.add(sk);
      return next;
    });
  };

  const thStyle: React.CSSProperties = {
    textAlign: 'left', padding: '10px 16px',
    fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: '#64748b',
    borderBottom: '1px solid #e2e8f0', background: '#f8fafc',
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr>
            <th style={thStyle}>When</th>
            <th style={thStyle}>Action</th>
            <th style={thStyle}>By</th>
            <th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const isOpen = expanded.has(entry.sk);
            const metaEntries = entry.meta ? Object.entries(entry.meta) : [];
            return (
              <React.Fragment key={entry.sk}>
                <tr style={{ borderBottom: '1px solid #f1f5f9', background: isOpen ? '#f8fafc' : undefined }}>
                  <td style={{ padding: '12px 16px', color: '#475569', whiteSpace: 'nowrap' }}>
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <ChangeActionBadge action={entry.action} />
                  </td>
                  <td style={{ padding: '12px 16px', color: '#374151' }}>
                    {entry.actorEmail || entry.actorUserId}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => toggle(entry.sk)}
                      style={{
                        background: 'none', border: '1px solid #e2e8f0',
                        borderRadius: 6, padding: '2px 8px', fontSize: 12,
                        color: '#475569', cursor: 'pointer',
                      }}
                    >
                      {isOpen ? '▲ Less' : '▼ Details'}
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                    <td colSpan={4} style={{ padding: '8px 16px 12px 32px' }}>
                      {entry.changes ? (
                        <ChangeDiffView diff={entry.changes} />
                      ) : metaEntries.length > 0 ? (
                        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', fontSize: 12 }}>
                          {metaEntries.map(([k, v]) => (
                            <React.Fragment key={k}>
                              <dt style={{ color: '#64748b', fontWeight: 500 }}>{k}</dt>
                              <dd style={{ margin: 0, color: '#374151', fontFamily: 'monospace', wordBreak: 'break-all' }}>{v}</dd>
                            </React.Fragment>
                          ))}
                        </dl>
                      ) : (
                        <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>No additional details recorded.</span>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChangeActionBadge({ action }: { action: ChangeAction }) {
  const styles: Record<ChangeAction, { bg: string; color: string; label: string }> = {
    created:          { bg: '#dbeafe', color: '#1e40af', label: 'Created' },
    saved:            { bg: '#f3f4f6', color: '#374151', label: 'Saved' },
    deploy_triggered: { bg: '#fef3c7', color: '#92400e', label: 'Deploy triggered' },
    deployed:         { bg: '#dcfce7', color: '#166534', label: 'Deployed' },
    deploy_failed:    { bg: '#fef2f2', color: '#b91c1c', label: 'Deploy failed' },
    delete_triggered: { bg: '#fef2f2', color: '#b91c1c', label: 'Delete triggered' },
    deleted:          { bg: '#f1f5f9', color: '#64748b', label: 'Deleted' },
  };
  const s = styles[action] || { bg: '#f3f4f6', color: '#374151', label: action };
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 500, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="m19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="6 4 20 12 6 20" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}
