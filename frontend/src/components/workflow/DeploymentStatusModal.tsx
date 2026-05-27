import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DeploymentStatus,
  DeploymentStep,
  DeploymentService,
} from '../../services/deploymentReal';
import {
  getWebSocketService,
  DeploymentUpdate,
} from '../../services/webSocketService';
import './DeploymentStatusModal.css';

interface DeploymentStatusModalProps {
  isOpen: boolean;
  deploymentId: string;
  workflowName: string;
  onClose: () => void;
  onComplete?: (status: DeploymentStatus) => void;
}

type Operation = 'deploy' | 'update' | 'delete';
type StepStatus = 'completed' | 'failed' | 'in_progress' | 'pending';

const DeploymentStatusModal: React.FC<DeploymentStatusModalProps> = ({
  isOpen,
  deploymentId,
  workflowName,
  onClose,
  onComplete,
}) => {
  const navigate = useNavigate();

  const [deploymentStatus, setDeploymentStatus] =
    useState<DeploymentStatus | null>(null);
  const [stepHistory, setStepHistory] = useState<DeploymentStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const isSubscribedRef = useRef<string | null>(null);
  const completedFiredRef = useRef(false);
  // Cancellation flag for the parallel polling loop. Polling runs alongside
  // the WebSocket as a defensive backup so a dropped WS message can't strand
  // the modal forever. Cleared when the modal closes or the deployment ID
  // changes.
  const pollingAbortRef = useRef(false);
  // Timer that drives the auto-redirect to the dashboard once a terminal
  // success status is observed. We navigate from the modal directly (rather
  // than relying solely on a parent setTimeout) because the parent's
  // closure-captured state can race during update redeploys, leaving the
  // user stranded on a "Deployment complete" screen.
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const operation: Operation = (() => {
    if (
      deploymentId.includes('delete') ||
      workflowName.includes('Deletion')
    )
      return 'delete';
    if (workflowName.includes('update') || deploymentId.includes('update'))
      return 'update';
    return 'deploy';
  })();

  const operationLabel: Record<Operation, string> = {
    deploy: 'Deployment',
    update: 'Update',
    delete: 'Deletion',
  };

  /* ---------- Lifecycle: subscribe / cleanup ---------- */

  useEffect(() => {
    if (!isOpen || !deploymentId) return;

    if (isSubscribedRef.current === deploymentId) return;

    // Reset on a fresh subscription
    setStepHistory([
      {
        id: `init-${Date.now()}`,
        name: getInitMessage(operation),
        status: 'in_progress',
        startTime: new Date().toISOString(),
      },
    ]);
    setDeploymentStatus(null);
    setLoading(true);
    setError(null);
    completedFiredRef.current = false;
    pollingAbortRef.current = false;

    startWebSocketConnection();
    // Run polling in parallel as a defensive backup. completedFiredRef
    // guards against double-firing onComplete if both paths report success.
    startPolling();
    isSubscribedRef.current = deploymentId;

    return () => {
      pollingAbortRef.current = true;
      const wsService = getWebSocketService();
      if (wsService && isSubscribedRef.current) {
        wsService.unsubscribeFromDeployment(isSubscribedRef.current);
        isSubscribedRef.current = null;
      }
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, deploymentId]);

  /* ---------- Auto-redirect on success ---------- */

  // Schedule the modal-driven redirect to the workflows list. Idempotent:
  // re-calls during the same session are no-ops once the timer is set.
  // This is the primary auto-close mechanism — it does NOT depend on the
  // parent's onComplete callback firing successfully.
  const scheduleRedirect = (delayMs: number = 1500) => {
    if (redirectTimerRef.current) return;
    redirectTimerRef.current = setTimeout(() => {
      redirectTimerRef.current = null;
      navigate('/');
    }, delayMs);
  };

  /* ---------- WebSocket / polling ---------- */

  const startWebSocketConnection = () => {
    setLoading(true);
    setError(null);
    const wsService = getWebSocketService();
    if (wsService) {
      wsService.subscribeToDeployment(deploymentId, handleDeploymentUpdate);
    } else {
      console.warn(
        'WebSocket service not available; relying on polling only'
      );
    }
  };

  const startPolling = async () => {
    // Polling runs alongside the WebSocket as a defensive backup. We do NOT
    // setError on a polling failure here, since the WS may still be
    // delivering updates. Polling only needs to detect terminal status so
    // the modal can fire onComplete + auto-close even if a WS message is
    // dropped in flight.
    const intervalMs = 5000;
    const maxAttempts = 120; // ~10 minutes upper bound
    let attempts = 0;

    while (attempts < maxAttempts && !pollingAbortRef.current) {
      try {
        const status = await DeploymentService.getDeploymentStatus(
          deploymentId
        );

        if (pollingAbortRef.current) return;

        // Only mirror state into the UI if the WS hasn't already populated
        // a richer view. We always update deploymentStatus so the banner
        // reflects the true current state.
        setDeploymentStatus((prev) =>
          prev && prev.updatedAt && status.updatedAt < prev.updatedAt
            ? prev
            : status
        );
        if (status.steps && status.steps.length > 0) {
          setStepHistory((prev) =>
            prev.length >= status.steps.length ? prev : status.steps
          );
        }
        setLoading(false);

        if (
          (status.status === 'completed' || status.status === 'failed') &&
          !completedFiredRef.current
        ) {
          completedFiredRef.current = true;
          onComplete?.(status);
          if (status.status === 'completed') scheduleRedirect();
          return;
        }

        if (status.status === 'completed' || status.status === 'failed') {
          return;
        }
      } catch (err) {
        // Silently swallow polling errors — the WS path may still be live.
        console.warn('Polling deployment status failed (will retry):', err);
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      attempts++;
    }
  };

  const handleDeploymentUpdate = async (update: DeploymentUpdate) => {
    setLoading(false);

    const detailedStatus = update.originalStatus || update.status;

    // On completion, fire onComplete unconditionally so the parent can drive
    // close + navigation even if the detailed status fetch fails or returns
    // no step data.
    if (
      update.status === 'COMPLETED' ||
      update.status.toLowerCase() === 'completed'
    ) {
      // Claim the completion slot before any async work to prevent double-fire
      if (completedFiredRef.current) return;
      completedFiredRef.current = true;

      let finalStatus: DeploymentStatus = {
        deploymentId: update.deploymentId,
        workflowId: '',
        status: 'completed',
        createdAt: update.timestamp,
        updatedAt: update.timestamp,
        steps: [],
      } as DeploymentStatus;

      try {
        const detailed = await DeploymentService.getDeploymentStatus(
          update.deploymentId
        );
        if (detailed) {
          finalStatus = detailed;
          setDeploymentStatus(detailed);
          if (detailed.steps && detailed.steps.length > 0) {
            setStepHistory(detailed.steps);
          }
        }
      } catch (err) {
        console.error('Failed to fetch detailed deployment status:', err);
      }

      setLoading(false);
      onComplete?.(finalStatus);
      scheduleRedirect();
      return;
    }

    const stepMessage = getStepMessage(detailedStatus, update.message, operation);
    const currentTime =
      update.timestamp && !isNaN(new Date(update.timestamp).getTime())
        ? update.timestamp
        : new Date().toISOString();
    const normalizedStatus = normalizeStatus(update.status);

    setStepHistory((prev) => {
      const next = [...prev];

      const existingIndex = next.findIndex((s) => s.name === stepMessage);

      if (existingIndex >= 0) {
        const existing = next[existingIndex];
        const updatedStep: DeploymentStep = {
          ...existing,
          name: stepMessage,
          status: normalizedStatus,
        };
        if (
          normalizedStatus === 'completed' ||
          normalizedStatus === 'failed'
        ) {
          updatedStep.endTime = currentTime;
          if (existing.startTime) {
            updatedStep.duration =
              new Date(currentTime).getTime() -
              new Date(existing.startTime).getTime();
          }
        }
        next[existingIndex] = updatedStep;
      } else {
        // Mark previous in-progress step as completed when a new step starts
        if (next.length > 0 && normalizedStatus === 'in_progress') {
          const last = next[next.length - 1];
          if (last.status === 'in_progress') {
            const completed: DeploymentStep = {
              ...last,
              status: 'completed',
              endTime: currentTime,
            };
            if (last.startTime) {
              completed.duration =
                new Date(currentTime).getTime() -
                new Date(last.startTime).getTime();
            }
            next[next.length - 1] = completed;
          }
        }

        const newStep: DeploymentStep = {
          id: `step-${Date.now()}-${next.length}`,
          name: stepMessage,
          status: normalizedStatus,
          startTime: currentTime,
          endTime:
            normalizedStatus === 'completed' || normalizedStatus === 'failed'
              ? currentTime
              : undefined,
        };
        if (newStep.endTime && newStep.startTime) {
          newStep.duration =
            new Date(newStep.endTime).getTime() -
            new Date(newStep.startTime).getTime();
        }
        next.push(newStep);
      }

      // On overall completion, mark any remaining in-progress steps as completed
      if (
        normalizedStatus === 'completed' &&
        update.status.toLowerCase() === 'completed'
      ) {
        for (let i = 0; i < next.length; i++) {
          const s = next[i];
          if (s.status === 'in_progress') {
            const completed: DeploymentStep = {
              ...s,
              status: 'completed',
              endTime: currentTime,
            };
            if (s.startTime) {
              completed.duration =
                new Date(currentTime).getTime() -
                new Date(s.startTime).getTime();
            }
            next[i] = completed;
          }
        }
      }

      return next;
    });

    const overallStatus = getOverallStatus(update.status);

    setDeploymentStatus((prev) => ({
      deploymentId: update.deploymentId,
      workflowId: prev?.workflowId || '',
      status: overallStatus,
      createdAt: prev?.createdAt || update.timestamp,
      updatedAt: update.timestamp,
      steps: prev?.steps || [],
      ...(overallStatus === 'failed' && {
        error: {
          code: 'DEPLOYMENT_FAILED',
          message: update.message || stepMessage,
          details: 'Check the steps above for more details.',
        },
      }),
    }));

    if (overallStatus === 'completed' && !completedFiredRef.current) {
      completedFiredRef.current = true;
      onComplete?.({
        deploymentId: update.deploymentId,
        workflowId: '',
        status: 'completed',
        createdAt: update.timestamp,
        updatedAt: update.timestamp,
        steps: [],
      } as DeploymentStatus);
      scheduleRedirect();
    }
  };

  /* ---------- Close handler (block during in-progress) ---------- */

  const isTerminal =
    deploymentStatus?.status === 'completed' ||
    deploymentStatus?.status === 'failed' ||
    !!error;

  const handleClose = () => {
    if (!isTerminal) {
      setConfirmClose(true);
      return;
    }
    onClose();
  };

  if (!isOpen) return null;

  /* ---------- Derived ---------- */

  const allSteps =
    deploymentStatus?.steps && deploymentStatus.steps.length > 0
      ? deploymentStatus.steps
      : stepHistory;

  const overallStatusKey: StepStatus = deploymentStatus
    ? (deploymentStatus.status === 'pending'
        ? 'pending'
        : (deploymentStatus.status as StepStatus))
    : loading
    ? 'in_progress'
    : 'pending';

  const banner = getBanner(overallStatusKey, operation);

  return (
    <>
    {confirmClose && (
      <div role="dialog" aria-modal="true" aria-label="Confirm close" className="dsm-confirm-overlay">
        <div className="dsm-confirm">
          <p className="dsm-confirm-title">
            {operationLabel[operation]} is still in progress. Close this window?
            Progress will keep running in the background.
          </p>
          <div className="dsm-confirm-actions">
            <button type="button" className="dsm-confirm-btn dsm-confirm-btn--primary" onClick={() => { setConfirmClose(false); onClose(); }}>Close anyway</button>
            <button type="button" className="dsm-confirm-btn" onClick={() => setConfirmClose(false)}>Keep open</button>
          </div>
        </div>
      </div>
    )}
    <div
      className="dsm-overlay"
      onClick={(e) => {
        // Only close on backdrop click in terminal state
        if (e.target === e.currentTarget && isTerminal) {
          onClose();
        }
      }}
    >
      <div
        className="dsm-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dsm-title"
      >
        {/* Header */}
        <div className="dsm-head">
          <h2 className={`dsm-title dsm-title--${operation}`} id="dsm-title">
            <span className="dsm-title-icon" aria-hidden="true">
              {operation === 'delete' ? (
                <TrashIcon />
              ) : operation === 'update' ? (
                <RefreshIcon />
              ) : (
                <RocketIcon />
              )}
            </span>
            <span className="dsm-title-text">
              <span className="dsm-title-main">
                {operationLabel[operation]} status
              </span>
              <span className="dsm-title-sub">{workflowName}</span>
            </span>
          </h2>
          <button
            type="button"
            className="dsm-close"
            onClick={handleClose}
            aria-label="Close"
          >
            
          </button>
        </div>

        {/* Status banner */}
        <div className={`dsm-banner dsm-banner--${overallStatusKey}`}>
          <span className="dsm-banner-icon" aria-hidden="true">
            {overallStatusKey === 'in_progress' ? (
              <span className="dsm-banner-spinner" />
            ) : overallStatusKey === 'completed' ? (
              <CheckIcon />
            ) : overallStatusKey === 'failed' ? (
              <CrossIcon />
            ) : (
              <ClockIcon />
            )}
          </span>
          <div className="dsm-banner-body">
            <p className="dsm-banner-title">{banner.title}</p>
            <p className="dsm-banner-sub">{banner.subtitle}</p>
          </div>
        </div>

        {/* Body */}
        <div className="dsm-body">
          {error && (
            <div className="dsm-error" role="alert">
              <span className="dsm-error-icon" aria-hidden="true">
                <AlertIcon />
              </span>
              <div>
                <strong>{operationLabel[operation]} error</strong>
                <div style={{ marginTop: 4 }}>{error}</div>
              </div>
            </div>
          )}

          {loading && allSteps.length === 0 && !error && (
            <div className="dsm-empty">
              <span className="dsm-empty-spinner" aria-hidden="true" />
              <h4 className="dsm-empty-title">
                {getInitMessage(operation)}
              </h4>
              <ul className="dsm-empty-list">
                <li>Setting up pipeline</li>
                <li>Initializing AWS resources</li>
                <li>
                  {operation === 'update'
                    ? 'Analyzing changes to apply'
                    : 'Generating CloudFormation template'}
                </li>
                <li>Real-time updates will appear here</li>
              </ul>
            </div>
          )}

          {allSteps.length > 0 && (
            <div>
              <h4 className="dsm-section-title">
                {operationLabel[operation]} progress ({allSteps.length} step
                {allSteps.length === 1 ? '' : 's'})
              </h4>
              <div className="dsm-steps">
                {allSteps.map((step) => (
                  <StepRow key={step.id} step={step} />
                ))}
              </div>
            </div>
          )}

          {deploymentStatus?.status === 'completed' && (
            <div className="dsm-success">
              <p className="dsm-success-message">
                {operation === 'delete'
                  ? 'Deletion completed. AWS resources and database records have been removed.'
                  : operation === 'update'
                  ? 'Update applied. Your workflow changes are live.'
                  : 'Workflow deployed and ready to use.'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="dsm-foot">
          {error && (
            <button
              type="button"
              className="dsm-btn"
              onClick={startPolling}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            className={
              isTerminal ? 'dsm-btn dsm-btn--primary' : 'dsm-btn'
            }
            onClick={handleClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
    </>
  );
};

export default DeploymentStatusModal;

/* ============================================================
 * Subcomponents + helpers
 * ========================================================== */

interface StepRowProps {
  step: DeploymentStep;
}

const StepRow: React.FC<StepRowProps> = ({ step }) => {
  const cleanName = step.name
    .replace(/^\s*/u, '')
    .trim();

  const status = step.status;

  return (
    <div className={`dsm-step dsm-step--${status}`}>
      <div className="dsm-step-rail" aria-hidden="true">
        <span className="dsm-step-dot">
          {status === 'completed'
            ? ''
            : status === 'failed'
            ? ''
            : status === 'pending'
            ? '○'
            : ''}
        </span>
        <span className="dsm-step-line" />
      </div>
      <div className="dsm-step-body">
        <p className="dsm-step-name">{cleanName}</p>
        {(step.startTime || step.endTime || step.duration) && (
          <p className="dsm-step-meta">
            {step.startTime && (
              <span>
                Started{' '}
                {new Date(step.startTime).toLocaleTimeString()}
              </span>
            )}
            {step.endTime && status !== 'in_progress' && (
              <span>
                · Ended {new Date(step.endTime).toLocaleTimeString()}
              </span>
            )}
            {typeof step.duration === 'number' && step.duration >= 0 && (
              <span>· {formatDuration(step.duration)}</span>
            )}
          </p>
        )}
        {status === 'in_progress' && <div className="dsm-step-progress" />}
      </div>
    </div>
  );
};

function getOverallStatus(
  status: string
): 'pending' | 'in_progress' | 'completed' | 'failed' {
  const lower = status.toLowerCase();
  if (lower === 'completed' || lower === 'success') return 'completed';
  if (lower === 'failed' || lower === 'error' || lower === 'failure')
    return 'failed';
  if (lower === 'pending') return 'pending';
  return 'in_progress';
}

function normalizeStatus(
  status: string
): 'completed' | 'failed' | 'in_progress' {
  const lower = status.toLowerCase();
  if (lower === 'completed' || lower === 'success') return 'completed';
  if (lower === 'failed' || lower === 'error' || lower === 'failure')
    return 'failed';
  return 'in_progress';
}

function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return '';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes > 0) return `${minutes}m ${remaining}s`;
  if (seconds === 0) return `${ms}ms`;
  return `${seconds}s`;
}

function getInitMessage(operation: Operation): string {
  switch (operation) {
    case 'delete':
      return 'Initializing workflow deletion…';
    case 'update':
      return 'Initializing workflow update…';
    default:
      return 'Initializing workflow deployment…';
  }
}

interface BannerCopy {
  title: string;
  subtitle: string;
}

function getBanner(status: StepStatus, operation: Operation): BannerCopy {
  if (status === 'completed') {
    return {
      title:
        operation === 'delete'
          ? 'Deletion complete'
          : operation === 'update'
          ? 'Update complete'
          : 'Deployment complete',
      subtitle:
        operation === 'delete'
          ? 'All resources have been removed.'
          : operation === 'update'
          ? 'Your changes are now live.'
          : 'Your workflow is ready to use.',
    };
  }
  if (status === 'failed') {
    return {
      title:
        operation === 'delete'
          ? 'Deletion failed'
          : operation === 'update'
          ? 'Update failed'
          : 'Deployment failed',
      subtitle: 'Check the steps below for details.',
    };
  }
  if (status === 'pending') {
    return {
      title:
        operation === 'delete'
          ? 'Deletion pending'
          : operation === 'update'
          ? 'Update pending'
          : 'Deployment pending',
      subtitle: 'Waiting for the operation to start.',
    };
  }
  return {
    title:
      operation === 'delete'
        ? 'Deleting workflow'
        : operation === 'update'
        ? 'Updating workflow'
        : 'Deploying workflow',
    subtitle: "This will continue running in the background.",
  };
}

function getStepMessage(
  status: string,
  message: string | undefined,
  operation: Operation
): string {
  // Pass through messages already containing emojis
  if (
    message &&
    (message.includes('') ||
      message.includes('') ||
      message.includes('') ||
      message.includes(''))
  ) {
    return message;
  }

  const isUpdate = operation === 'update';
  const isDeletion = operation === 'delete';

  switch (status) {
    case 'initializing':
      return isUpdate
        ? 'Starting workflow update process…'
        : 'Starting workflow deployment process…';
    case 'template_generated':
      return isUpdate
        ? 'Workflow template generation (update)'
        : 'Workflow template generation';
    case 'deploying_infrastructure':
      return isUpdate
        ? 'Workflow template deployment started (update)'
        : 'Workflow template deployment started';
    case 'stack_creating':
      return 'Workflow resources being deployed';
    case 'stack_updating':
      return 'Workflow resources being updated';
    case 'monitoring_stack':
      if (message && message.includes('CloudFormation stack status:')) {
        const cfStatus = message.split('CloudFormation stack status:')[1]?.trim();
        if (cfStatus) {
          switch (cfStatus) {
            case 'CREATE_IN_PROGRESS':
              return 'CloudFormation: Creating AWS resources…';
            case 'UPDATE_IN_PROGRESS':
              return 'CloudFormation: Updating AWS resources…';
            case 'CREATE_COMPLETE':
              return 'CloudFormation: Stack creation completed';
            case 'UPDATE_COMPLETE':
              return 'CloudFormation: Stack update completed';
            case 'ROLLBACK_IN_PROGRESS':
              return 'CloudFormation: Rolling back changes…';
            case 'UPDATE_ROLLBACK_IN_PROGRESS':
              return 'CloudFormation: Rolling back update…';
            default:
              return `CloudFormation: ${cfStatus.replace(/_/g, ' ').toLowerCase()}`;
          }
        }
      }
      return isUpdate
        ? 'Monitoring CloudFormation update progress'
        : 'Monitoring CloudFormation stack progress';
    case 'finalizing':
      return isUpdate
        ? 'Finalizing update and refreshing workflow status'
        : 'Finalizing deployment and updating workflow status';
    case 'completed':
      if (isDeletion) return 'Workflow deletion completed successfully';
      return isUpdate
        ? 'Workflow deployed successfully (update)'
        : 'Workflow deployed successfully';
    case 'failed':
      if (isDeletion) return 'Workflow deletion failed';
      return isUpdate
        ? 'Workflow deployment failed (update)'
        : 'Workflow deployment failed';
    case 'deleting':
      return 'Starting workflow deletion process…';
    case 'deleting_aws_resources':
      return 'Deleting AWS resources (CloudFormation, Lambdas, IAM)';
    case 'cleaning_database':
      return 'Cleaning up database records (workflow not deployed)';
    case 'aws_resources_deleted':
      return 'AWS resources deleted. Cleaning up database records…';
    case 'aws_cleanup_failed':
      return 'AWS resource cleanup failed. Continuing with database cleanup…';
    case 'deletion_completed':
      return 'Workflow deletion completed successfully';
    case 'checking_deployment_status':
      return 'Checking if workflow is deployed to AWS…';
    case 'skipping_aws_cleanup':
      return 'Workflow not deployed — skipping AWS resource cleanup';
    case 'database_cleanup_complete':
      return 'Database records successfully cleaned up';
    case 'database_cleanup_failed':
      return 'Database cleanup failed';
    default: {
      const formatted = status
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (l) => l.toUpperCase());
      return isDeletion ? `${formatted}` : `${formatted}`;
    }
  }
}

/* ---------- Inline icons ---------- */

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function RocketIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="m19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}
