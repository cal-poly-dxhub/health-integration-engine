import { useState, useEffect } from 'react';
import { authService, AuthUser } from '../services/auth';
import WorkflowList from './workflow/WorkflowList';
import DeployedWorkflowsList from './workflow/DeployedWorkflowsList';
import DeleteWorkflowModal from './workflow/DeleteWorkflowModal';
import DeploymentStatusModal from './workflow/DeploymentStatusModal';
import OpenSearchPanel from './workflow/OpenSearchPanel';
import { useWorkflows } from '../hooks/useWorkflows';
import { WorkflowMetadata } from '../types/workflow';
import './Dashboard.css';

interface DashboardProps {
  onSignOut: () => void;
  onEditWorkflow?: (workflowId: string) => void;
  onViewWorkflow?: (workflowId: string) => void;
}

export default function Dashboard({ onSignOut, onEditWorkflow, onViewWorkflow }: DashboardProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const {
    workflows,
    loading: workflowsLoading,
    error: workflowsError,
    createWorkflow,
    deleteWorkflow,
    duplicateWorkflow,
    refreshWorkflows,
  } = useWorkflows();

  const [workflowToDelete, setWorkflowToDelete] = useState<WorkflowMetadata | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<'workflows' | 'deployed' | 'search'>('workflows');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const [showDeletionProgressModal, setShowDeletionProgressModal] = useState(false);
  const [deletionId, setDeletionId] = useState<string>('');
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);

  // Cmd/Ctrl+K to open global search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowGlobalSearch(prev => !prev);
      }
      if (e.key === 'Escape' && showGlobalSearch) {
        setShowGlobalSearch(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showGlobalSearch]);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const currentUser = await authService.getCurrentUser();
        setUser(currentUser);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load user');
      } finally {
        setLoading(false);
      }
    };

    loadUser();
  }, []);

  const handleToggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  const handleSignOut = async () => {
    try {
      await authService.signOut();
      onSignOut();
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  const handleCreateNew = async () => {
    if (isCreating) return;
    
    try {
      setIsCreating(true);
      const newWorkflow = await createWorkflow('Untitled Workflow', 'New workflow description');
      handleEditWorkflow(newWorkflow.id);
    } catch (error) {
      console.error('Failed to create workflow:', error);
      alert('Failed to create workflow. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleEditWorkflow = (workflowId: string) => {
    if (onEditWorkflow) {
      onEditWorkflow(workflowId);
    } else {
      alert('Edit workflow functionality not implemented yet');
    }
  };

  const handleViewWorkflow = (workflowId: string) => {
    if (onViewWorkflow) {
      onViewWorkflow(workflowId);
    } else {
      console.log('Viewing workflow details for:', workflowId);
      // Fallback: This should navigate to /workflow/{workflowId} to show execution details
    }
  };

  const handleDeleteWorkflow = (workflowId: string) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (workflow) {
      setWorkflowToDelete(workflow);
      setDeleteError(null);
      setDeleteSuccess(null);
    }
  };

  const [dashboardDeletionStatus, setDashboardDeletionStatus] = useState('');

  const confirmDelete = async () => {
    if (!workflowToDelete || isDeleting) return;
    
    try {
      setIsDeleting(true);
      setDeleteError(null);
      setDashboardDeletionStatus('Initiating deletion...');
      
      await deleteWorkflow(workflowToDelete.id);
      
      // Close the delete confirmation modal and open the progress modal
      const workflowId = workflowToDelete.id;
      setWorkflowToDelete(null);
      setIsDeleting(false);
      setDashboardDeletionStatus('');
      setDeletionId(workflowId);
      setShowDeletionProgressModal(true);
      
    } catch (error) {
      console.error('❌ Failed to delete workflow:', error);
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete workflow. Please try again.');
      setIsDeleting(false);
      setDashboardDeletionStatus('');
    }
  };

  const handleCloseDeleteModal = () => {
    if (!isDeleting) {
      setWorkflowToDelete(null);
      setDeleteError(null);
    }
  };

  const handleDuplicateWorkflow = async (workflowId: string) => {
    try {
      const duplicatedWorkflow = await duplicateWorkflow(workflowId);
      handleEditWorkflow(duplicatedWorkflow.id);
    } catch (error) {
      console.error('Failed to duplicate workflow:', error);
      alert('Failed to duplicate workflow. Please try again.');
    }
  };

  const handleViewDeployment = (workflowId: string) => {
    // Switch to deployed workflows tab and select the workflow
    setActiveTab('deployed');
    console.log('Viewing deployment for workflow:', workflowId);
  };

  if (loading) {
    return (
      <div className="dashboard-container">
        <div className="loading">Loading user information...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-container">
        <div className="error-message">{error}</div>
        <button onClick={handleSignOut} className="auth-button">
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <nav className="dashboard-nav">
        <div className="nav-content">
          <div className="nav-flex">
            <div className="nav-left">
              <button 
                className="sidebar-toggle-btn"
                onClick={handleToggleSidebar}
                title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              >
                {sidebarCollapsed ? '☰' : '✕'}
              </button>
              <h1 className="nav-title">
                AWS Message Router Workflow Builder
              </h1>
            </div>
            <div className="nav-user-section">
              <button
                className="nav-search-btn"
                onClick={() => setShowGlobalSearch(true)}
                title="Search across all workflows (⌘K)"
              >
                🔍 Search Messages
                <kbd className="kbd-hint">⌘K</kbd>
              </button>
              <span className="nav-user-info">Welcome, {user?.email}</span>
              <button onClick={handleSignOut} className="nav-button">
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="dashboard-main">
        <div className={`dashboard-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          <div className={`dashboard-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
            <div className="sidebar-header">
              <h3>Navigation</h3>
            </div>
            
            <div className="sidebar-tabs">
              <button
                className={`sidebar-tab ${activeTab === 'workflows' ? 'active' : ''}`}
                onClick={() => setActiveTab('workflows')}
              >
                <div className="tab-icon-wrapper">
                  <span className="tab-icon">📝</span>
                </div>
                <div className="tab-content-wrapper">
                  <span className="tab-title">Workflows</span>
                  <span className="tab-description">Create and manage workflows</span>
                  <span className="tab-count">{workflows.length} total</span>
                </div>
              </button>
              <button
                className={`sidebar-tab ${activeTab === 'deployed' ? 'active' : ''}`}
                onClick={() => setActiveTab('deployed')}
              >
                <div className="tab-icon-wrapper">
                  <span className="tab-icon">🚀</span>
                </div>
                <div className="tab-content-wrapper">
                  <span className="tab-title">Deployed Workflows</span>
                  <span className="tab-description">Monitor deployed workflows</span>
                  <span className="tab-count">Message Router APIs</span>
                </div>
              </button>
              {import.meta.env.VITE_ENABLE_OPENSEARCH !== 'false' && (
              <button
                className={`sidebar-tab ${activeTab === 'search' ? 'active' : ''}`}
                onClick={() => setActiveTab('search')}
              >
                <div className="tab-icon-wrapper">
                  <span className="tab-icon">🔍</span>
                </div>
                <div className="tab-content-wrapper">
                  <span className="tab-title">Message Search</span>
                  <span className="tab-description">Search indexed messages</span>
                  <span className="tab-count">OpenSearch</span>
                </div>
              </button>
              )}
            </div>
          </div>

          <div className="dashboard-content">
            {activeTab === 'workflows' && (
              <WorkflowList
                workflows={workflows}
                loading={workflowsLoading}
                error={workflowsError || undefined}
                username={user?.email || user?.username || 'User'}
                onCreateNew={handleCreateNew}
                onEditWorkflow={handleEditWorkflow}
                onDeleteWorkflow={handleDeleteWorkflow}
                onDuplicateWorkflow={handleDuplicateWorkflow}
                onViewDeployment={handleViewDeployment}
                onRefresh={refreshWorkflows}
                onSignOut={onSignOut}
                isCreating={isCreating}
                onViewWorkflow={handleViewWorkflow}
              />
            )}
            
            {activeTab === 'deployed' && (
              <DeployedWorkflowsList
                workflows={workflows.filter(w => w.isDeployed)}
                loading={workflowsLoading}
                error={workflowsError || undefined}
                onRefresh={refreshWorkflows}
                onViewWorkflow={handleViewWorkflow}
              />
            )}

            {activeTab === 'search' && import.meta.env.VITE_ENABLE_OPENSEARCH !== 'false' && (
              <div className="search-tab-content">
                <div className="search-tab-header">
                  <h2>Message Search</h2>
                  <p>Search indexed HL7 messages in OpenSearch</p>
                </div>
                <OpenSearchPanel />
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      {workflowToDelete && (
        <DeleteWorkflowModal
          workflow={workflowToDelete}
          isOpen={true}
          onClose={handleCloseDeleteModal}
          onConfirm={confirmDelete}
          isDeleting={isDeleting}
          deletionStatus={dashboardDeletionStatus}
        />
      )}

      {/* Success/Error Messages */}
      {deleteSuccess && (
        <div className="notification notification-success">
          <div className="notification-content">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20,6 9,17 4,12" />
            </svg>
            <span>{deleteSuccess}</span>
          </div>
          <button
            onClick={() => setDeleteSuccess(null)}
            className="notification-close"
          >
            ×
          </button>
        </div>
      )}

      {deleteError && (
        <div className="notification notification-error">
          <div className="notification-content">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <span>{deleteError}</span>
          </div>
          <button
            onClick={() => setDeleteError(null)}
            className="notification-close"
          >
            ×
          </button>
        </div>
      )}

      {/* Deletion Progress Modal */}
      {showDeletionProgressModal && deletionId && (
        <DeploymentStatusModal
          isOpen={showDeletionProgressModal}
          deploymentId={deletionId}
          workflowName="Workflow Deletion"
          onClose={() => {
            console.log('🔍 Deletion progress modal closed');
            setShowDeletionProgressModal(false);
            setDeletionId('');
          }}
          onComplete={(status) => {
            console.log('🔍 Deletion completed:', status);
            // When deletion completes, just close the modal
            if (status.status === 'completed') {
              setShowDeletionProgressModal(false);
              setDeletionId('');
              setDeleteSuccess('Workflow deleted successfully!');
              
              // Clear success message after 5 seconds
              setTimeout(() => {
                setDeleteSuccess(null);
              }, 5000);
            }
          }}
        />
      )}

      {/* Global Search Modal */}
      {showGlobalSearch && import.meta.env.VITE_ENABLE_OPENSEARCH !== 'false' && (
        <div className="global-search-overlay" onClick={() => setShowGlobalSearch(false)}>
          <div className="global-search-modal" onClick={(e) => e.stopPropagation()}>
            <div className="global-search-modal-header">
              <h2>🔍 Search Across All Workflows</h2>
              <button className="global-search-close" onClick={() => setShowGlobalSearch(false)} aria-label="Close search">
                ✕
              </button>
            </div>
            <div className="global-search-modal-body">
              <OpenSearchPanel />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}