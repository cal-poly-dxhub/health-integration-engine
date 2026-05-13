import React, { useState, useEffect } from 'react';
import { getWebSocketService } from '../../services/webSocketService';
import './DeploymentStatusModal.css'; // Reuse the same styles

interface DeletionStatusModalProps {
  isOpen: boolean;
  workflowId: string;
  workflowName: string;
  onClose: () => void;
  onComplete?: () => void;
}

interface DeletionStatus {
  workflowId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  message: string;
  steps: Array<{
    id: string;
    name: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    startTime?: string;
    endTime?: string;
    error?: string;
  }>;
}

const DeletionStatusModal: React.FC<DeletionStatusModalProps> = ({
  isOpen,
  workflowId,
  workflowName,
  onClose,
  onComplete,
}) => {
  const [deletionStatus, setDeletionStatus] = useState<DeletionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && workflowId) {
      startMonitoring();
    }
    
    return () => {
      // Cleanup WebSocket subscription
      const wsService = getWebSocketService();
      if (wsService) {
        wsService.unsubscribeFromDeletion(workflowId);
      }
    };
  }, [isOpen, workflowId]);

  const startMonitoring = async () => {
    try {
      setLoading(true);
      setError(null);

      // Initialize with starting status
      const initialStatus: DeletionStatus = {
        workflowId,
        status: 'in_progress',
        message: 'Starting workflow deletion...',
        steps: [
          {
            id: 'cleanup-aws',
            name: 'Cleaning up AWS resources',
            status: 'in_progress',
            startTime: new Date().toISOString(),
          },
          {
            id: 'cleanup-db',
            name: 'Removing database records',
            status: 'pending',
          }
        ]
      };
      
      setDeletionStatus(initialStatus);
      setLoading(false);

      // Subscribe to WebSocket updates
      const wsService = getWebSocketService();
      if (wsService) {
        console.log('🔌 Subscribing to deletion updates for:', workflowId);
        
        wsService.subscribeToDeletion(workflowId, (update) => {
          console.log('📨 Received deletion update:', update);
          
          // Update status based on WebSocket message
          setDeletionStatus(prevStatus => {
            if (!prevStatus) return prevStatus;
            
            const newStatus = { ...prevStatus };
            newStatus.status = update.status === 'completed' ? 'completed' : 
                              update.status === 'failed' ? 'failed' : 'in_progress';
            newStatus.message = update.message || 'Deletion status updated';
            
            // Update steps based on status
            if (update.status === 'completed') {
              newStatus.steps = newStatus.steps.map(step => ({
                ...step,
                status: 'completed',
                endTime: update.timestamp || new Date().toISOString()
              }));
              
              // Trigger completion callback
              setTimeout(() => {
                if (onComplete) {
                  onComplete();
                }
              }, 1000);
            } else if (update.status === 'failed') {
              newStatus.steps = newStatus.steps.map((step, index) => ({
                ...step,
                status: index === 0 ? 'failed' : 'pending',
                endTime: index === 0 ? (update.timestamp || new Date().toISOString()) : undefined
              }));
            }
            
            return newStatus;
          });
        });
        
        // Ensure WebSocket is connected
        await wsService.connect();
      } else {
        console.error('❌ WebSocket service not available');
        setError('Real-time updates not available');
      }
      
    } catch (error) {
      console.error('Failed to start deletion monitoring:', error);
      setError('Failed to monitor deletion progress');
      setLoading(false);
    }
  };

  const getStepIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return '✅';
      case 'failed':
        return '❌';
      case 'in_progress':
        return '⏳';
      default:
        return '⏸️';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return '#10b981';
      case 'failed':
        return '#ef4444';
      case 'in_progress':
        return '#3b82f6';
      default:
        return '#6b7280';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content deployment-status-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Deletion Status</h2>
          <button className="modal-close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="deployment-info">
            <h3>{workflowName || 'Unknown Workflow'}</h3>
            <p className="deployment-id">Workflow ID: {workflowId}</p>
            
            {deletionStatus && (
              <div className="deployment-metadata">
                <div className="overall-status">
                  <div 
                    className="status-badge"
                    style={{ backgroundColor: getStatusColor(deletionStatus.status) }}
                  >
                    {deletionStatus.status.toUpperCase()}
                  </div>
                </div>
              </div>
            )}
          </div>

          {loading && !deletionStatus && (
            <div className="loading-state">
              <div className="loading-spinner"></div>
              <p>Starting deletion process...</p>
            </div>
          )}

          {error && (
            <div className="error-state">
              <h4>Deletion Error</h4>
              <p>{error}</p>
            </div>
          )}

          {deletionStatus && (
            <div className="deployment-steps">
              <h4>Deletion Steps</h4>
              <div className="steps-list">
                {deletionStatus.steps.map((step) => (
                  <div 
                    key={step.id} 
                    className={`step-item ${step.status}`}
                  >
                    <div className="step-header">
                      <div className="step-icon">
                        {getStepIcon(step.status)}
                      </div>
                      <div className="step-info">
                        <h5>{step.name}</h5>
                        <div className="step-meta">
                          <span 
                            className="step-status"
                            style={{ color: getStatusColor(step.status) }}
                          >
                            {step.status.replace('_', ' ').toUpperCase()}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {step.status === 'in_progress' && (
                      <div className="step-progress">
                        <div className="progress-bar">
                          <div className="progress-fill"></div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(deletionStatus as any)?.error && (
            <div className="deployment-error">
              <h4>Deletion Failed</h4>
              <p><strong>Error:</strong> {(deletionStatus as any)?.error?.message}</p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {deletionStatus?.status === 'completed' && (
            <div className="success-actions">
              <p className="success-message">
                🎉 Workflow deleted successfully!
              </p>
            </div>
          )}
          
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeletionStatusModal;
