import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { DeploymentStatus, DeploymentStep, DeploymentService } from '../../services/deploymentReal';
import { getWebSocketService, DeploymentUpdate } from '../../services/webSocketService';
import './DeploymentStatusModal.css';

interface DeploymentStatusModalProps {
  isOpen: boolean;
  deploymentId: string;
  workflowName: string;
  onClose: () => void;
  onComplete?: (status: DeploymentStatus) => void;
}

const DeploymentStatusModal: React.FC<DeploymentStatusModalProps> = ({
  isOpen,
  deploymentId,
  workflowName,
  onClose,
  onComplete,
}) => {
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stepHistory, setStepHistory] = useState<DeploymentStep[]>([]);
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);
  const isSubscribedRef = useRef<string | null>(null); // Track current subscription
  const scrollContainerRef = useRef<HTMLDivElement>(null); // For auto-scroll management
  
  const navigate = useNavigate();

  // Determine operation type - these are used throughout the component
  const isDeletion = deploymentId.includes('delete') || workflowName.includes('Deletion');
  const isUpdate = workflowName.includes('update') || deploymentId.includes('update');

  useEffect(() => {
    console.log('DeploymentStatusModal useEffect triggered:', { isOpen, deploymentId, currentSubscription: isSubscribedRef.current });
    
    if (isOpen && deploymentId) {
      // Only start new connection if we're not already subscribed to this deployment
      if (isSubscribedRef.current !== deploymentId) {
        // Reset state when modal opens for clean start
        setStepHistory([]);
        setDeploymentStatus(null);
        setLoading(true);
        setError(null);
        
        // Add immediate initialization step for better UX
        const initStep: DeploymentStep = {
          id: `init-${Date.now()}`,
          name: isDeletion ? '🗑️ Initializing workflow deletion...' : 
               isUpdate ? '🚀 Initializing workflow update...' : '🚀 Initializing workflow deployment...',
          status: 'in_progress',
          startTime: new Date().toISOString(),
        };
        setStepHistory([initStep]);
        
        startWebSocketConnection();
        isSubscribedRef.current = deploymentId;
      } else {
        console.log('Already subscribed to this deployment, skipping reconnection');
      }
    }
    
    return () => {
      // Only cleanup when modal is actually closing or deploymentId changes
      if (!isOpen || (deploymentId && isSubscribedRef.current !== deploymentId)) {
        console.log('DeploymentStatusModal cleanup triggered:', { isOpen, deploymentId, wasSubscribed: isSubscribedRef.current });
        const wsService = getWebSocketService();
        if (wsService && isSubscribedRef.current) {
          wsService.unsubscribeFromDeployment(isSubscribedRef.current);
          isSubscribedRef.current = null;
        }
      }
    };
  }, [isOpen, deploymentId]);

  const startWebSocketConnection = async () => {
    try {
      console.log('🔍 DeploymentStatusModal: Starting WebSocket connection for deployment:', deploymentId);
      console.log('🔍 DeploymentStatusModal: isDeletion =', isDeletion, 'isUpdate =', isUpdate);
      setLoading(true);
      setError(null);

      const wsService = getWebSocketService();
      if (wsService) {
        console.log('🔍 DeploymentStatusModal: Subscribing to deploymentId:', deploymentId);
        wsService.subscribeToDeployment(deploymentId, handleDeploymentUpdate);
        console.log('✅ DeploymentStatusModal: WebSocket subscribed to deployment updates');
      } else {
        throw new Error('WebSocket service not available');
      }
    } catch (error) {
      console.error('WebSocket connection failed, falling back to polling:', error);
      startPolling();
    }
  };

  // Helper function to determine deployment phase for deduplication
  const getDeploymentPhase = (stepName: string): string => {
    if (stepName.includes('Template Generation') || stepName.includes('template') || stepName.includes('Generated')) return 'template';
    if (stepName.includes('Template Deployment Started') || stepName.includes('deploying_infrastructure')) return 'deployment_start';
    if (stepName.includes('Resources being deployed') || stepName.includes('stack_creating')) return 'stack_creating';
    if (stepName.includes('Resources being updated') || stepName.includes('stack_updating')) return 'stack_updating';
    if (stepName.includes('CloudFormation') || stepName.includes('stack') || stepName.includes('Updating existing')) return 'cloudformation';
    if (stepName.includes('AWS resources') || stepName.includes('infrastructure')) return 'infrastructure';
    if (stepName.includes('Monitoring') || stepName.includes('progress')) return 'monitoring';
    if (stepName.includes('Finalizing') || stepName.includes('completed')) return 'finalizing';
    return 'other';
  };

  // Helper function to get step order for chronological sorting
  const getStepOrder = (status: string, stepName: string): number => {
    // EventBridge deployment progress events (new)
    if (status === 'initializing' || stepName.includes('Starting workflow')) return 0;
    if (status === 'template_generated' || stepName.includes('Template Generation')) return 1;
    if (status === 'deploying_infrastructure' || stepName.includes('Template Deployment Started')) return 2;
    if (status === 'stack_creating' || stepName.includes('Resources being deployed')) return 3;
    if (status === 'stack_updating' || stepName.includes('Resources being updated')) return 3; // Same order as stack_creating
    
    // Legacy events (maintain existing order)
    if (stepName.includes('CloudFormation') && stepName.includes('Creating')) return 4;
    if (stepName.includes('CloudFormation') && stepName.includes('Updating')) return 4;
    if (stepName.includes('Monitoring') || stepName.includes('progress')) return 5;
    if (stepName.includes('Finalizing')) return 6;
    if (status === 'completed' || stepName.includes('successfully')) return 7;
    if (status === 'failed' || stepName.includes('failed')) return 999; // Failed steps go to end
    
    // Default order for other steps
    return 50;
  };

  const handleDeploymentUpdate = async (update: DeploymentUpdate) => {
    console.log('🎯 DeploymentStatusModal: Received deployment update:', update);
    console.log('🎯 DeploymentStatusModal: Current deploymentId:', deploymentId, 'Update deploymentId:', update.deploymentId);
    
    // Clear loading state immediately when we receive any WebSocket update
    setLoading(false);
    
    // Use originalStatus for detailed step tracking if available
    const detailedStatus = update.originalStatus || update.status;
    
    // When we get a WebSocket update, fetch the detailed status from the API
    if (update.status === 'COMPLETED' || update.status.toLowerCase() === 'completed') {
      console.log('🎉 Deployment completed, fetching detailed status...');
      try {
        const detailedStatus = await DeploymentService.getDeploymentStatus(update.deploymentId);
        console.log('📊 Detailed status received:', detailedStatus);
        if (detailedStatus && detailedStatus.steps && detailedStatus.steps.length > 0) {
          // Use the detailed status from the API which should have all steps
          setDeploymentStatus(detailedStatus);
          setStepHistory(detailedStatus.steps);
          setLoading(false);
          
          if (onComplete) {
            onComplete(detailedStatus);
          }
          
          // Start redirect countdown
          startRedirectCountdown();
          return;
        } else {
          console.log('⚠️ No detailed steps found, continuing with WebSocket flow...');
        }
      } catch (error) {
        console.error('❌ Failed to get detailed deployment status:', error);
      }
    }
    
    // Use component-level operation type detection (isDeletion and isUpdate are defined at component level)

    // Map deployment/deletion/update status to user-friendly messages
    const getStepMessage = (status: string, message?: string) => {
      // If a custom message is provided, use it (especially for deletion workflow)
      if (message && message.includes('🗑️') || message && message.includes('🗄️') || message && message.includes('✅') || message && message.includes('⚠️')) {
        return message;
      }
      
      switch (status) {
        // New EventBridge deployment progress statuses
        case 'initializing':
          return isUpdate ? '🚀 Starting workflow update process...' : '🚀 Starting workflow deployment process...';
        case 'template_generated':
          return isUpdate ? '📝 Workflow Template Generation (Update)' : '📝 Workflow Template Generation';
        case 'deploying_infrastructure':
          return isUpdate ? '🚀 Workflow Template Deployment Started (Update)' : '🚀 Workflow Template Deployment Started';
        case 'stack_creating':
          return '⚡ Workflow Resources being deployed';
        case 'stack_updating':
          return '🔄 Workflow Resources being updated';
        
        // Legacy deployment/update statuses (maintain backward compatibility)
        case 'monitoring_stack':
          // Use the actual CloudFormation status if available in the message
          if (message && message.includes('CloudFormation stack status:')) {
            const cfStatus = message.split('CloudFormation stack status:')[1]?.trim();
            if (cfStatus) {
              switch (cfStatus) {
                case 'CREATE_IN_PROGRESS':
                  return '⚡ CloudFormation: Creating AWS resources...';
                case 'UPDATE_IN_PROGRESS':
                  return '🔄 CloudFormation: Updating AWS resources...';
                case 'CREATE_COMPLETE':
                  return '✅ CloudFormation: Stack creation completed';
                case 'UPDATE_COMPLETE':
                  return '✅ CloudFormation: Stack update completed';
                case 'ROLLBACK_IN_PROGRESS':
                  return '⏪ CloudFormation: Rolling back changes...';
                case 'UPDATE_ROLLBACK_IN_PROGRESS':
                  return '⏪ CloudFormation: Rolling back update...';
                default:
                  return `📊 CloudFormation: ${cfStatus.replace(/_/g, ' ').toLowerCase()}`;
              }
            }
          }
          return isUpdate ? '👀 Monitoring CloudFormation update progress' : '👀 Monitoring CloudFormation stack progress';
        case 'finalizing':
          return isUpdate ? '✨ Finalizing update and refreshing workflow status' : '✨ Finalizing deployment and updating workflow status';
        case 'completed':
          if (isDeletion) return '🎉 Workflow deletion completed successfully!';
          return isUpdate ? '🎉 Workflow Deployed successfully (Update)' : '🎉 Workflow Deployed successfully';
        case 'failed':
          if (isDeletion) return '❌ Workflow deletion failed';
          return isUpdate ? '❌ Workflow Deployment failed (Update)' : '❌ Workflow Deployment failed';
        
        // Deletion statuses (workflow-builder-deletion Step Function)
        case 'deleting':
          return '🗑️ Starting workflow deletion process...';
        case 'deleting_aws_resources':
          return '🗑️ Deleting AWS resources (CloudFormation stack, Lambda functions, IAM roles)';
        case 'cleaning_database':
          return '🗄️ Cleaning up database records (workflow not deployed)';
        case 'aws_resources_deleted':
          return '✅ AWS resources successfully deleted. Cleaning up database records...';
        case 'aws_cleanup_failed':
          return '⚠️ AWS resource cleanup failed. Continuing with database cleanup...';
        case 'deletion_completed':
          return '🎉 Workflow deletion completed successfully!';
        
        // Additional deletion-specific statuses from the state machine
        case 'checking_deployment_status':
          return '🔍 Checking if workflow is deployed to AWS...';
        case 'skipping_aws_cleanup':
          return '⏭️ Workflow not deployed - skipping AWS resource cleanup';
        case 'database_cleanup_complete':
          return '✅ Database records successfully cleaned up';
        case 'database_cleanup_failed':
          return '❌ Database cleanup failed';
        
        default:
          // Handle any other status with proper formatting
          const formattedStatus = status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          if (isDeletion) {
            return `🗑️ ${formattedStatus}`;
          }
          return `📋 ${formattedStatus}`;
      }
    };
    
    // Enhanced step history tracking with deduplication
    const currentTime = update.timestamp && !isNaN(new Date(update.timestamp).getTime()) ? update.timestamp : new Date().toISOString();
    const stepMessage = getStepMessage(detailedStatus, update.message);
    
    console.log('Processing deployment update:', {
      deploymentId: update.deploymentId,
      status: update.status,
      originalStatus: update.originalStatus,
      detailedStatus,
      stepMessage,
      timestamp: currentTime
    });
    
    // Normalize status values
    const normalizeStatus = (status: string): 'completed' | 'failed' | 'in_progress' => {
      const lowerStatus = status.toLowerCase();
      if (lowerStatus === 'completed' || lowerStatus === 'success') return 'completed';
      if (lowerStatus === 'failed' || lowerStatus === 'error' || lowerStatus === 'failure') return 'failed';
      return 'in_progress';
    };

    const normalizedStatus = normalizeStatus(update.status);

    // Update step history with deduplication logic
    setStepHistory(prevHistory => {
      console.log('Updating step history. Previous steps:', prevHistory.length);
      const updatedHistory = [...prevHistory];
      
      // Simplified deduplication - only check for exact message match
      const existingStepIndex = updatedHistory.findIndex(step => step.name === stepMessage);
      
      if (existingStepIndex >= 0) {
        // Update existing step instead of creating a new one
        const existingStep = updatedHistory[existingStepIndex];
        existingStep.status = normalizedStatus;
        existingStep.name = stepMessage; // Update message in case it's more detailed
        
        if (normalizedStatus === 'completed' || normalizedStatus === 'failed') {
          existingStep.endTime = currentTime;
          if (existingStep.startTime) {
            existingStep.duration = new Date(currentTime).getTime() - new Date(existingStep.startTime).getTime();
          }
          
          // Add completion highlight animation
          existingStep.id = existingStep.id + '-just-completed';
          
          // Remove the highlight after animation
          setTimeout(() => {
            setStepHistory(current => 
              current.map(step => 
                step.id === existingStep.id 
                  ? { ...step, id: step.id.replace('-just-completed', '') }
                  : step
              )
            );
          }, 2000);
        }
        
        // If this is the overall completion, mark all in-progress steps as completed
        if (normalizedStatus === 'completed' && update.status.toLowerCase() === 'completed') {
          updatedHistory.forEach(step => {
            if (step.status === 'in_progress') {
              step.status = 'completed';
              step.endTime = currentTime;
              if (step.startTime) {
                step.duration = new Date(currentTime).getTime() - new Date(step.startTime).getTime();
              }
            }
          });
        }
        
        return updatedHistory;
      }
      
      // Mark the last in-progress step as completed when a new step starts
      if (updatedHistory.length > 0 && normalizedStatus === 'in_progress') {
        const lastStep = updatedHistory[updatedHistory.length - 1];
        if (lastStep.status === 'in_progress') {
          lastStep.status = 'completed';
          lastStep.endTime = currentTime;
          if (lastStep.startTime) {
            lastStep.duration = new Date(currentTime).getTime() - new Date(lastStep.startTime).getTime();
          }
          
          // Add completion highlight animation
          lastStep.id = lastStep.id + '-just-completed';
          
          // Remove the highlight after animation
          setTimeout(() => {
            setStepHistory(current => 
              current.map(step => 
                step.id === lastStep.id 
                  ? { ...step, id: step.id.replace('-just-completed', '') }
                  : step
              )
            );
          }, 2000);
        }
      }
      
      // Create new step
      const newStep: DeploymentStep = {
        id: `step-${Date.now()}-new`,
        name: stepMessage,
        status: normalizedStatus,
        startTime: currentTime,
        endTime: (normalizedStatus === 'completed' || normalizedStatus === 'failed') ? currentTime : undefined,
      };
      
      console.log('Creating new step:', newStep);
      
      if (newStep.endTime && newStep.startTime) {
        newStep.duration = new Date(newStep.endTime).getTime() - new Date(newStep.startTime).getTime();
      }
      
      updatedHistory.push(newStep);
      
      // If this is the overall completion, mark all in-progress steps as completed
      if (normalizedStatus === 'completed' && update.status.toLowerCase() === 'completed') {
        updatedHistory.forEach(step => {
          if (step.status === 'in_progress') {
            step.status = 'completed';
            step.endTime = currentTime;
            if (step.startTime) {
              step.duration = new Date(currentTime).getTime() - new Date(step.startTime).getTime();
            }
          }
        });
      }
      
      // Sort steps chronologically based on their logical order
      updatedHistory.sort((a, b) => {
        const orderA = getStepOrder(detailedStatus, a.name);
        const orderB = getStepOrder(detailedStatus, b.name);
        
        // If orders are different, sort by order
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        
        // If orders are the same, sort by start time
        if (a.startTime && b.startTime) {
          return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
        }
        
        // If one has start time and other doesn't, prioritize the one with start time
        if (a.startTime && !b.startTime) return -1;
        if (!a.startTime && b.startTime) return 1;
        
        // Default to maintaining current order
        return 0;
      });
      
      // Remove animation class after a short delay
      setTimeout(() => {
        setStepHistory(current => 
          current.map(step => 
            step.id === newStep.id 
              ? { ...step, id: step.id.replace('-new', '') }
              : step
          )
        );
      }, 500);
      
      console.log('Step history updated. New steps count:', updatedHistory.length);
      
      // Auto-scroll to top to show the first step (after a brief delay to let DOM update)
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = 0;
        }
      }, 100);
      
      return updatedHistory;
    });
    
    // Map overall deployment status
    const getOverallStatus = (status: string): 'pending' | 'in_progress' | 'completed' | 'failed' => {
      const lowerStatus = status.toLowerCase();
      if (lowerStatus === 'completed' || lowerStatus === 'success') return 'completed';
      if (lowerStatus === 'failed' || lowerStatus === 'error' || lowerStatus === 'failure') return 'failed';
      if (lowerStatus === 'pending') return 'pending';
      return 'in_progress';
    };

    // Update deployment status - let the step history update handle the steps
    setDeploymentStatus(prevStatus => ({
      deploymentId: update.deploymentId,
      workflowId: prevStatus?.workflowId || '',
      status: getOverallStatus(update.status),
      createdAt: prevStatus?.createdAt || update.timestamp,
      updatedAt: update.timestamp,
      steps: prevStatus?.steps || [], // Keep existing steps, let stepHistory manage the actual steps
      ...(getOverallStatus(update.status) === 'failed' && {
        error: {
          code: 'DEPLOYMENT_FAILED',
          message: update.message || stepMessage,
          details: 'Check the deployment steps above for more details',
        }
      }),
    }));
    
    // Start redirect countdown if deployment completed
    if (getOverallStatus(update.status) === 'completed') {
      startRedirectCountdown();
    }
  };
  
  const startRedirectCountdown = () => {
    if (redirectCountdown !== null) return; // Already started
    
    setRedirectCountdown(5);
    const interval = setInterval(() => {
      setRedirectCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          // Redirect to workflows page
          navigate('/');
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };
  
  const handleReturnToWorkflows = () => {
    navigate('/');
  };

  const startPolling = async () => {
    try {
      setLoading(true);
      setError(null);

      await DeploymentService.pollDeploymentStatus(
        deploymentId,
        (status) => {
          setDeploymentStatus(status);
          setLoading(false);
        },
        60,
        5000
      );

      if (deploymentStatus && onComplete) {
        onComplete(deploymentStatus);
      }
    } catch (err) {
      console.error('Deployment polling failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to get deployment status');
      setLoading(false);
    }
  };

  const getStepIcon = (step: DeploymentStep) => {
    switch (step.status) {
      case 'completed': return '✅';
      case 'failed': return '❌';
      case 'in_progress': return '⏳';
      case 'skipped': return '⏭️';
      default: return '⏸️';
    }
  };

  const getStepStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#10b981';
      case 'failed': return '#ef4444';
      case 'in_progress': return '#3b82f6';
      case 'skipped': return '#6b7280';
      default: return '#9ca3af';
    }
  };

  const getOverallStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#10b981';
      case 'failed': return '#ef4444';
      case 'in_progress': return '#3b82f6';
      case 'cancelled': return '#f59e0b';
      default: return '#6b7280';
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

  const handleClose = () => {
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className={`modal-content deployment-status-modal ${isDeletion ? 'deletion-mode' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {deploymentId.includes('delete') 
              ? 'Deletion Status' 
              : (workflowName.includes('update') || deploymentId.includes('update'))
                ? 'Update Status'
                : 'Deployment Status'
            }
          </h2>
          <button className="modal-close-btn" onClick={handleClose}>×</button>
        </div>

        <div className="modal-body" ref={scrollContainerRef}>
          <div className="deployment-info">
            <h3>{workflowName}</h3>
            <div className="deployment-metadata">
              <p className="deployment-id">
                {isDeletion ? 'Deletion' : isUpdate ? 'Update' : 'Deployment'} ID: {deploymentId}
              </p>
              {isUpdate && (
                <div className="update-badge">
                  <span className="update-icon">🔄</span>
                  <span className="update-text">Workflow Update</span>
                </div>
              )}
              {isDeletion && (
                <div className="deletion-badge">
                  <span className="deletion-icon">🗑️</span>
                  <span className="deletion-text">Workflow Deletion</span>
                </div>
              )}
            </div>
            
            {deploymentStatus && (
              <div className="deployment-metadata">
                <div className="overall-status">
                  <div 
                    className="status-badge"
                    style={{ backgroundColor: getOverallStatusColor(deploymentStatus?.status || 'pending') }}
                  >
                    {(deploymentStatus?.status || 'pending').toUpperCase()}
                  </div>
                </div>
              </div>
            )}
          </div>

          {loading && !deploymentStatus && (
            <div className={`loading-state ${isDeletion ? 'deletion-loading' : ''}`}>
              <div className="loading-spinner"></div>
              <p>
                {isDeletion ? 'Initializing workflow deletion...' : 
                 isUpdate ? 'Starting workflow update...' : 'Starting deployment...'}
              </p>
            </div>
          )}

          {error && (
            <div className="error-state">
              <h4>{isDeletion ? 'Deletion Error' : isUpdate ? 'Update Error' : 'Deployment Error'}</h4>
              <p>{error}</p>
              <button onClick={startPolling} className="retry-btn">Retry</button>
            </div>
          )}

          {(deploymentStatus || stepHistory.length > 0) && (
            <div className={`deployment-steps ${isDeletion ? 'deletion-mode' : ''}`}>
              <h4>{isDeletion ? 'Deletion Progress' : isUpdate ? 'Update Progress' : 'Deployment Progress'}</h4>
              
              {/* Completed Steps Section */}
              {(() => {
                const allSteps = (deploymentStatus?.steps && deploymentStatus.steps.length > 0) ? deploymentStatus.steps : stepHistory;
                const completedSteps = allSteps.filter(s => s.status === 'completed');
                return completedSteps.length > 0 && (
                  <div className="steps-section completed-section">
                    <div className="section-header">
                      <span className="section-icon">✅</span>
                      <h5>Completed Steps ({completedSteps.length})</h5>
                    </div>
                    <div className="steps-list">
                      {completedSteps.map((step, index) => (
                        <div key={step.id} className="step-item completed">
                          <div className="step-icon">✅</div>
                          <div className="step-content">
                            <div className="step-name">{step.name.replace(/^[📝🏗️⚡🔄👀✨🎉❌]\s*/, '').trim()}</div>
                            <div className="step-time">
                              {step.endTime && `Completed at ${new Date(step.endTime).toLocaleTimeString()}`}
                              {step.duration && ` (${formatDuration(step.duration)})`}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              
              {/* Running Steps Section */}
              {(() => {
                const allSteps = (deploymentStatus?.steps && deploymentStatus.steps.length > 0) ? deploymentStatus.steps : stepHistory;
                const runningSteps = allSteps.filter(s => s.status === 'in_progress' || s.status === 'pending');
                
                console.log('Rendering steps:', {
                  deploymentStatusSteps: deploymentStatus?.steps?.length || 0,
                  stepHistoryLength: stepHistory.length,
                  allStepsLength: allSteps.length,
                  runningStepsLength: runningSteps.length
                });
                
                // Check if deployment is completed first
                if (deploymentStatus?.status === 'completed') {
                  return (
                    <div className="steps-section completed-section">
                      <div className="section-header">
                        <span className="section-icon">🎉</span>
                        <h5>
                          {isDeletion ? 'Deletion Complete!' : 
                           isUpdate ? 'Update Complete!' : 'Deployment Complete!'}
                        </h5>
                      </div>
                      <div className="completion-content">
                        <p className="completion-message">
                          {isDeletion ? 'Your workflow has been successfully removed.' : 
                           isUpdate ? 'Your workflow changes have been applied and are ready to use.' : 'Your workflow is ready to use.'}
                        </p>
                        
                        {redirectCountdown !== null && (
                          <div className="redirect-info">
                            <p className="redirect-text">
                              Returning to workflows in {redirectCountdown} seconds...
                            </p>
                            <button 
                              className="btn btn-primary return-btn"
                              onClick={handleReturnToWorkflows}
                            >
                              Return to Workflows Now
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
                
                // If no steps yet, show initializing with helpful message
                if (runningSteps.length === 0 && allSteps.length === 0) {
                  return (
                    <div className="steps-section running-section">
                      <div className="section-header">
                        <span className="section-icon">⏳</span>
                        <h5>
                          {isDeletion ? 'Initializing Deletion...' : 
                           isUpdate ? 'Initializing Update...' : 'Initializing Deployment...'}
                        </h5>
                      </div>
                      <div className="initializing-steps">
                        <div className="loading-spinner-small"></div>
                        <div className="initializing-content">
                          <p className="main-message">
                            {isDeletion ? '🗑️ Preparing to delete your workflow...' : 
                             isUpdate ? '🔄 Preparing to update your workflow...' : '🚀 Preparing to deploy your workflow...'}
                          </p>
                          <div className="sub-messages">
                            <small>• Setting up deployment pipeline</small>
                            <small>• Initializing AWS resources</small>
                            <small>• {isUpdate ? 'Analyzing changes to apply' : 'Generating CloudFormation template'}</small>
                            <small>• Please wait for real-time updates...</small>
                          </div>
                          <div className="patience-message">
                            <em>
                              {isDeletion ? 'Deletion progress will appear here shortly' : 
                               isUpdate ? 'Update progress will appear here shortly' : 'Deployment progress will appear here shortly'}
                            </em>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }
                
                // If no running steps but has completed steps, don't show running section
                if (runningSteps.length === 0) {
                  return null;
                }
                
                return (
                  <div className="steps-section running-section">
                    <div className="section-header">
                      <span className="section-icon">⏳</span>
                      <h5>Currently Running ({runningSteps.length})</h5>
                    </div>
                    <div className="steps-list">
                      {runningSteps.map((step, index) => (
                        <div key={step.id} className={`step-item ${step.status}`}>
                          <div className="step-icon">
                            {step.status === 'in_progress' ? '⏳' : '⏸️'}
                          </div>
                          <div className="step-content">
                            <div className="step-name">{step.name.replace(/^[📝🏗️⚡🔄👀✨🎉❌]\s*/, '').trim()}</div>
                            <div className="step-time">
                              {step.startTime && `Started at ${new Date(step.startTime).toLocaleTimeString()}`}
                            </div>
                            {step.status === 'in_progress' && (
                              <div className="step-progress">
                                <div className="progress-bar">
                                  <div className="progress-fill"></div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {deploymentStatus?.status === 'completed' && (
            <div className={`success-actions ${isDeletion ? 'deletion-success' : ''}`}>
              <p className="success-message">
                🎉 {isDeletion ? 'Deletion completed successfully!' : 
                     isUpdate ? 'Update completed successfully!' : 'Deployment completed successfully!'} 
                {isDeletion ? 'All AWS resources and database records have been removed.' : 
                 isUpdate ? 'Your workflow changes are now live.' : 'Redirecting to workflow list...'}
              </p>
            </div>
          )}
          
          <button className="btn btn-secondary" onClick={handleClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeploymentStatusModal;