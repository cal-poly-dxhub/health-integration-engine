import React from 'react';
import { WorkflowMetadata } from '../../types/workflow';
import DeploymentStatusIndicator from './DeploymentStatusIndicator';
import './WorkflowCard.css';

interface WorkflowCardProps {
  workflow: WorkflowMetadata;
  onEdit: (workflowId: string) => void;
  onDelete: (workflowId: string) => void;
  onDuplicate?: (workflowId: string) => void;
  onViewDeployment?: (workflowId: string) => void;
}

const WorkflowCard: React.FC<WorkflowCardProps> = ({
  workflow,
  onEdit,
  onDelete,
  onDuplicate,
  onViewDeployment,
}) => {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };



  // Check if workflow is being deleted
  const isDeleting = (workflow as any).isDeleting || (workflow as any).status === 'deleting';
  
  // Debug logging
  if (isDeleting) {
    console.log('🗑️ WorkflowCard: Workflow is deleting:', workflow.name, {
      isDeleting: (workflow as any).isDeleting,
      status: (workflow as any).status
    });
  }

  return (
    <div className={`workflow-card ${isDeleting ? 'deleting' : ''}`}>
      <div className="workflow-card-header">
        <div className="workflow-card-title-section">
          <h3 className="workflow-card-title">{workflow.name}</h3>
          {isDeleting ? (
            <div className="deletion-status-indicator">
              <div className="spinner-small"></div>
              <span className="deletion-text">
                {(workflow as any).deletionStage || 'Deleting...'}
              </span>
            </div>
          ) : (
            <DeploymentStatusIndicator
              isDeploying={workflow.deploymentStatus === 'deploying' || workflow.deploymentStatus === 'pending'}
              deploymentStatus={{
                deploymentId: '',
                workflowId: workflow.id,
                status: workflow.deploymentStatus as any || 'draft',
                createdAt: workflow.createdAt,
                updatedAt: workflow.updatedAt,
                steps: [],
              }}
            />
          )}
        </div>
        <div className="workflow-card-actions">
          <button
            onClick={() => onEdit(workflow.id)}
            className="action-btn edit-btn"
            title="Edit workflow"
            disabled={isDeleting}
          >
            Edit
          </button>
          {workflow.isDeployed && onViewDeployment && (
            <button
              onClick={() => onViewDeployment(workflow.id)}
              className="action-btn view-btn"
              title="View deployment details"
              disabled={isDeleting}
            >
              View
            </button>
          )}
          {onDuplicate && (
            <button
              onClick={() => onDuplicate(workflow.id)}
              className="action-btn copy-btn"
              title="Duplicate workflow"
              disabled={isDeleting}
            >
              Copy
            </button>
          )}
          <button
            onClick={() => onDelete(workflow.id)}
            className="action-btn delete-btn"
            title={isDeleting ? "Deleting..." : "Delete workflow"}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>



      <div className="workflow-card-metadata">
        <div className="workflow-metadata-item">
          <span className="metadata-label">Nodes:</span>
          <span className="metadata-value">{workflow.nodeCount}</span>
        </div>
        <div className="workflow-metadata-item">
          <span className="metadata-label">Created:</span>
          <span className="metadata-value">{formatDate(workflow.createdAt)}</span>
        </div>
        <div className="workflow-metadata-item">
          <span className="metadata-label">Modified:</span>
          <span className="metadata-value">{formatDate(workflow.updatedAt)}</span>
        </div>
      </div>
    </div>
  );
};

export default WorkflowCard;