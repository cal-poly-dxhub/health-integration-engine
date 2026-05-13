import React, { useEffect, useState } from 'react';
import { WorkflowMetadata } from '../../types/workflow';
import './DeleteWorkflowModal.css';

interface DeleteWorkflowModalProps {
  workflow: WorkflowMetadata;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isDeleting?: boolean;
  deletionStatus?: string;
}

const DeleteWorkflowModal: React.FC<DeleteWorkflowModalProps> = ({
  workflow,
  isOpen,
  onClose,
  onConfirm,
  isDeleting = false,
  deletionStatus = '',
}) => {
  const [confirmationText, setConfirmationText] = useState('');
  const [hasReadWarning, setHasReadWarning] = useState(false);

  const expectedConfirmationText = workflow.name;
  const isConfirmationValid = confirmationText === expectedConfirmationText;
  const canDelete = isConfirmationValid && hasReadWarning && !isDeleting;

  // Reset form whenever modal opens for a new workflow
  useEffect(() => {
    if (isOpen) {
      setConfirmationText('');
      setHasReadWarning(false);
    }
  }, [isOpen, workflow.id]);

  const handleConfirm = async () => {
    if (!canDelete) return;
    try {
      await onConfirm();
    } catch (err) {
      console.error('Delete workflow error:', err);
    }
  };

  const handleClose = () => {
    if (isDeleting) return;
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canDelete) handleConfirm();
    else if (e.key === 'Escape' && !isDeleting) handleClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="dwm-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="dwm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dwm-title"
      >
        {/* Header */}
        <div className="dwm-head">
          <div className="dwm-title-wrap">
            <span className="dwm-title-icon" aria-hidden="true">
              <AlertIcon />
            </span>
            <div>
              <h2 className="dwm-title" id="dwm-title">
                Delete workflow
              </h2>
              <p className="dwm-title-sub">
                This action cannot be undone.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="dwm-close"
            onClick={handleClose}
            disabled={isDeleting}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="dwm-body">
          <p className="dwm-prompt">
            You're about to permanently delete{' '}
            <span className="dwm-name-pill">{workflow.name}</span>.
          </p>

          <div className="dwm-list">
            <h4 className="dwm-list-title">What will be deleted</h4>
            <ul>
              <li>Workflow definition, nodes, and connections</li>
              <li>Deployment history and metadata</li>
              {workflow.isDeployed && (
                <>
                  <li>AWS Step Functions state machine</li>
                  <li>Associated Lambda functions</li>
                  <li>IAM roles and policies created for this workflow</li>
                  <li>CloudFormation stack and all AWS resources</li>
                </>
              )}
            </ul>
          </div>

          {workflow.isDeployed && (
            <div className="dwm-aws-warning" role="alert">
              <span
                className="dwm-aws-warning-icon"
                aria-hidden="true"
              >
                <CloudIcon />
              </span>
              <div>
                <strong>This workflow is currently deployed.</strong>
                Any running executions will be stopped, and the AWS resources
                listed above will be removed.
              </div>
            </div>
          )}

          <div className="dwm-confirm">
            <label
              className={`dwm-checkbox${
                isDeleting ? ' dwm-checkbox--disabled' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={hasReadWarning}
                onChange={(e) => setHasReadWarning(e.target.checked)}
                disabled={isDeleting}
              />
              I understand this action is permanent and cannot be undone.
            </label>

            <div className="dwm-field">
              <label htmlFor="dwm-input" className="dwm-label">
                Type
                <span className="dwm-label-name">
                  {expectedConfirmationText}
                </span>
                to confirm.
              </label>
              <input
                id="dwm-input"
                type="text"
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Type "${expectedConfirmationText}" to confirm`}
                disabled={isDeleting}
                className={`dwm-input${
                  confirmationText && !isConfirmationValid
                    ? ' dwm-input--invalid'
                    : isConfirmationValid
                    ? ' dwm-input--valid'
                    : ''
                }`}
                autoComplete="off"
                autoFocus
              />
              {confirmationText && !isConfirmationValid && (
                <p className="dwm-error">
                  Doesn't match — type the workflow name exactly.
                </p>
              )}
            </div>

            {isDeleting && deletionStatus && (
              <div className="dwm-deletion-status" role="status">
                <span
                  className="dwm-deletion-spinner"
                  aria-hidden="true"
                />
                {deletionStatus}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="dwm-foot">
          <button
            type="button"
            className="dwm-btn"
            onClick={handleClose}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="dwm-btn dwm-btn--danger"
            onClick={handleConfirm}
            disabled={!canDelete}
          >
            {isDeleting ? (
              <>
                <span className="dwm-btn-spinner" aria-hidden="true" />
                Deleting…
              </>
            ) : (
              <>
                <TrashIcon />
                Delete workflow
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteWorkflowModal;

/* ---------- Inline icons ---------- */

function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10Z" />
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
