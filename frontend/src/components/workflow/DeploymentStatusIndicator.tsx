import React from 'react';
import { DeploymentStatus } from '../../services/deploymentReal';

interface DeploymentStatusIndicatorProps {
  isDeploying: boolean;
  deploymentStatus?: DeploymentStatus | null;
  error?: string | null;
  className?: string;
}

const DeploymentStatusIndicator: React.FC<DeploymentStatusIndicatorProps> = ({
  isDeploying,
  deploymentStatus,
  error,
  className = '',
}) => {
  const getStatusInfo = () => {
    if (error) {
      return {
        icon: '❌',
        text: 'Failed',
        color: 'status-failed',
        description: error,
      };
    }

    if (isDeploying) {
      return {
        icon: '⏳',
        text: 'Deploying',
        color: 'status-deploying',
        description: 'Deployment in progress...',
      };
    }

    if (deploymentStatus) {
      switch (deploymentStatus.status as any) {
        case 'completed':
          return {
            icon: '✅',
            text: 'Deployed',
            color: 'status-deployed',
            description: 'Successfully deployed',
          };
        case 'failed':
          return {
            icon: '❌',
            text: 'Failed',
            color: 'status-failed',
            description: deploymentStatus.error?.message || 'Deployment failed',
          };
        case 'in_progress':
          return {
            icon: '⏳',
            text: 'Deploying',
            color: 'status-deploying',
            description: 'Deployment in progress...',
          };
        case 'pending':
          return {
            icon: '⏸️',
            text: 'Pending',
            color: 'status-pending',
            description: 'Deployment queued',
          };
        case 'cancelled':
          return {
            icon: '⏹️',
            text: 'Cancelled',
            color: 'status-cancelled',
            description: 'Deployment cancelled',
          };
        case 'delete_failed':
          return {
            icon: '🚫',
            text: 'Delete Failed',
            color: 'status-failed',
            description: 'Workflow deletion failed',
          };
        default:
          return {
            icon: '📝',
            text: 'Draft',
            color: 'status-draft',
            description: 'Not deployed',
          };
      }
    }

    return {
      icon: '📝',
      text: 'Draft',
      color: 'status-draft',
      description: 'Not deployed',
    };
  };

  const statusInfo = getStatusInfo();

  return (
    <span className={`workflow-status ${statusInfo.color} ${className}`} title={statusInfo.description}>
      <span className="status-icon">{statusInfo.icon}</span>
      {statusInfo.text}
    </span>
  );
};

export default DeploymentStatusIndicator;