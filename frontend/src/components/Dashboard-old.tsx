import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import WorkflowList from './workflow/WorkflowList';
import DeleteWorkflowModal from './workflow/DeleteWorkflowModal';
import { useWorkflows } from '../hooks/useWorkflows';
import { WorkflowMetadata } from '../types/workflow';
import './Dashboard.css';

const Dashboard: React.FC = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const {
    workflows,
    loading,
    error,
    createWorkflow,
    deleteWorkflow,
    duplicateWorkflow,
    refreshWorkflows,
  } = useWorkflows();

  const [workflowToDelete, setWorkflowToDelete] = useState<WorkflowMetadata | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<'workflows' | 'deployed'>('workflows');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const handleCreateNew = async () => {
    if (isCreating) return;
    
    try {
      setIsCreating(true);
      // Create a new workflow first
      const newWorkflow = await createWorkflow('Untitled Workflow', 'New workflow description');
      
      // Navigate to the workflow editor with the new workflow ID
      navigate(`/workflow/editor/${newWorkflow.id}`);
    } catch (error) {
      console.error('Failed to create workflow:', error);
      alert('Failed to create workflow. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleEditWorkflow = (workflowId: string) => {
    // Navigate to the workflow editor with the specific workflow ID
    navigate(`/workflow/editor/${workflowId}`);
  };

  const handleDeleteWorkflow = (workflowId: string) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (workflow) {
      setWorkflowToDelete(workflow);
      setDeleteError(null);
      setDeleteSuccess(null);
    }
  };

  const confirmDelete = async () => {
    if (!workflowToDelete || isDeleting) return;
    
    try {
      setIsDeleting(true);
      setDeleteError(null);
      
      const result = await deleteWorkflow(workflowToDelete.id);
      
      if (result.success) {
        setDeleteSuccess(result.message);
        setWorkflowToDelete(null);
        
        // Show success message briefly
        setTimeout(() => {
          setDeleteSuccess(null);
        }, 5000);
      } else {
        setDeleteError('Workflow deletion completed with issues. Please check the logs.');
      }
    } catch (error) {
      console.error('Failed to delete workflow:', error);
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete workflow. Please try again.');
    } finally {
      setIsDeleting(false);
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
      // Navigate to the editor with the duplicated workflow
      navigate(`/workflow/editor/${duplicatedWorkflow.id}`);
    } catch (error) {
      console.error('Failed to duplicate workflow:', error);
      alert('Failed to duplicate workflow. Please try again.');
    }
  };

  const handleViewDeployment = (workflowId: string) => {
    // Switch to deployed workflows tab and select the workflow
    setActiveTab('deployed');
    // The DeployedWorkflowsList component will handle the selection
    console.log('Viewing deployment for workflow:', workflowId);
  };



  return (
    <div className="dashboard-container">
      {/* Navigation */}
      <nav className="dashboard-nav">
        <div className="nav-content">
          <div className="nav-flex">
            <h1 className="nav-title">
              AWS Step Functions Workflow Builder
            </h1>
            <div className="nav-user-section">
              <span className="nav-user-info">
                Welcome, {user?.email}
              </span>
              <Link to="/profile" className="nav-link">
                Profile
              </Link>
              <button
                onClick={handleSignOut}
                className="nav-button"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="dashboard-main">
        <div className="dashboard-layout">
          {/* Left Sidebar with Navigation */}
          <div className="dashboard-sidebar">
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
                  <span className="tab-count">Step Functions APIs</span>
                </div>
              </button>
            </div>
            
            {/* Quick Stats */}
            <div className="sidebar-stats">
              <div className="stat-item">
                <span className="stat-label">Total Workflows</span>
                <span className="stat-value">{workflows.length}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Saved</span>
                <span className="stat-value success">{workflows.length}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">In DynamoDB</span>
                <span className="stat-value">{workflows.length}</span>
              </div>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="dashboard-content">
            {activeTab === 'workflows' && (
              <WorkflowList
                workflows={workflows}
                loading={loading}
                error={error || undefined}
                onCreateNew={handleCreateNew}
                onEditWorkflow={handleEditWorkflow}
                onDeleteWorkflow={handleDeleteWorkflow}
                onDuplicateWorkflow={handleDuplicateWorkflow}
                onViewDeployment={handleViewDeployment}
                onRefresh={refreshWorkflows}
                isCreating={isCreating}
              />
            )}
            
            {activeTab === 'deployed' && (
              <div className="deployed-workflows-container">
                <div className="deployed-workflows-header">
                  <h2>Deployed Workflows</h2>
                  <p>Real-time data from AWS Step Functions</p>
                </div>
                <div className="deployed-workflows-content">
                  <p>🚧 Coming soon: Real-time deployed workflow monitoring using Step Functions APIs</p>
                  <p>This tab will show:</p>
                  <ul>
                    <li>✅ Live workflow executions from Step Functions</li>
                    <li>✅ Real-time execution status and history</li>
                    <li>✅ Start/stop execution controls</li>
                    <li>✅ Execution logs and details</li>
                  </ul>
                </div>
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
    </div>
  );
};

export default Dashboard;