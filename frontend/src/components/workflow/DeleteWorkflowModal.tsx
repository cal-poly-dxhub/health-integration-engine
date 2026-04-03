import React, { useState } from 'react';
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

  const handleConfirm = async () => {
    if (canDelete) {
      try {
        await onConfirm();
        // Don't close here — parent will close when deletion completes or navigate away
      } catch (error) {
        // Error handling is done by the parent component
        console.error('Delete workflow error:', error);
      }
    }
  };

  const handleClose = () => {
    if (!isDeleting) {
      setConfirmationText('');
      setHasReadWarning(false);
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canDelete) {
      handleConfirm();
    } else if (e.key === 'Escape' && !isDeleting) {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="delete-workflow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Delete Workflow</h2>
          {!isDeleting && (
            <button onClick={handleClose} className="modal-close-btn" aria-label="Close">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="modal-content">
          <div className="warning-section">
            <div className="warning-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h3>This action cannot be undone</h3>
            <p>
              You are about to permanently delete the workflow <strong>"{workflow.name}"</strong>.
            </p>
          </div>

          <div className="deletion-details">
            <h4>What will be deleted:</h4>
            <ul>
              <li>
                <span className="detail-icon">📋</span>
                Workflow definition and configuration
              </li>
              <li>
                <span className="detail-icon">🔗</span>
                All node connections and settings
              </li>
              <li>
                <span className="detail-icon">📊</span>
                Deployment history and metadata
              </li>
              {workflow.isDeployed && (
                <>
                  <li>
                    <span className="detail-icon">⚡</span>
                    AWS Step Functions state machine
                  </li>
                  <li>
                    <span className="detail-icon">🔧</span>
                    Associated Lambda functions (if any)
                  </li>
                  <li>
                    <span className="detail-icon">🔐</span>
                    IAM roles and policies
                  </li>
                  <li>
                    <span className="detail-icon">☁️</span>
                    CloudFormation stack and all AWS resources
                  </li>
                </>
              )}
            </ul>
          </div>

          {workflow.isDeployed && (
            <div className="aws-warning">
              <div className="aws-warning-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="aws-warning-content">
                <h4>AWS Resources Will Be Deleted</h4>
                <p>
                  This workflow is currently deployed. Deleting it will remove all associated AWS resources 
                  including the Step Functions state machine, Lambda functions, and IAM roles. 
                  Any running executions will be stopped.
                </p>
              </div>
            </div>
          )}

          <div className="confirmation-section">
            <div className="checkbox-container">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={hasReadWarning}
                  onChange={(e) => setHasReadWarning(e.target.checked)}
                  disabled={isDeleting}
                />
                <span className="checkbox-custom"></span>
                I understand that this action is permanent and cannot be undone
              </label>
            </div>

            <div className="confirmation-input-section">
              <label htmlFor="confirmation-input">
                Type <strong>{expectedConfirmationText}</strong> to confirm deletion:
              </label>
              <input
                id="confirmation-input"
                type="text"
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Type "${expectedConfirmationText}" here`}
                disabled={isDeleting}
                className={isConfirmationValid ? 'valid' : ''}
                autoComplete="off"
                autoFocus
              />
              {confirmationText && !isConfirmationValid && (
                <div className="confirmation-error">
                  Text doesn't match. Please type "{expectedConfirmationText}" exactly.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button
            onClick={handleClose}
            className="cancel-btn"
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="delete-btn"
            disabled={!canDelete}
          >
            {isDeleting ? (
              <>
                <div className="spinner"></div>
                {deletionStatus || 'Deleting...'}
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3,6 5,6 21,6" />
                  <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                Delete Workflow
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteWorkflowModal;