import React, { useState, useMemo } from 'react';
import { WorkflowMetadata } from '../../types/workflow';
// import WorkflowCard from './WorkflowCard';
import './WorkflowList.css';

interface WorkflowListProps {
  workflows: WorkflowMetadata[];
  loading?: boolean;
  error?: string;
  username?: string;
  onCreateNew: () => void;
  onEditWorkflow: (workflowId: string) => void;
  onViewWorkflow?: (workflowId: string) => void;
  onDeleteWorkflow: (workflowId: string) => void;
  onDuplicateWorkflow?: (workflowId: string) => void;
  onViewDeployment?: (workflowId: string) => void;
  onRefresh?: () => void;
  onSignOut?: () => void;
  isCreating?: boolean;
}

const WorkflowList: React.FC<WorkflowListProps> = ({
  workflows,
  loading = false,
  error,
  username = 'User',
  onCreateNew,
  onEditWorkflow,
  onViewWorkflow,
  onDeleteWorkflow,
  onDuplicateWorkflow,
  onViewDeployment,
  onRefresh,
  onSignOut,
  isCreating = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'created' | 'modified'>('modified');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'deployed'>('all');

  // Filter and sort workflows
  const filteredAndSortedWorkflows = useMemo(() => {
    let filtered = workflows.filter(workflow => {
      // Search filter
      const matchesSearch = workflow.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (workflow.description?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false);

      // Status filter
      const matchesStatus = filterStatus === 'all' ||
        (filterStatus === 'deployed' && workflow.isDeployed) ||
        (filterStatus === 'draft' && !workflow.isDeployed);

      return matchesSearch && matchesStatus;
    });

    // Sort workflows
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'created':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'modified':
          comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [workflows, searchTerm, sortBy, sortOrder, filterStatus]);

  const handleSortChange = (newSortBy: 'name' | 'created' | 'modified') => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSortBy);
      setSortOrder('desc');
    }
  };

  const getSortIcon = (field: 'name' | 'created' | 'modified') => {
    if (sortBy !== field) return '↕️';
    return sortOrder === 'asc' ? '↑' : '↓';
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'deployed':
        return 'status-deployed';
      case 'deploying':
        return 'status-deploying';
      case 'pending':
        return 'status-pending';
      case 'failed':
        return 'status-failed';
      default:
        return 'status-draft';
    }
  };

  const getStatusText = (isDeployed: boolean, status?: string) => {
    if (!isDeployed) return 'Draft';
    return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Draft';
  };

  const getStatusIcon = (isDeployed: boolean, status?: string) => {
    if (!isDeployed) return '📝';
    switch (status) {
      case 'deployed':
        return '✅';
      case 'deploying':
        return '⏳';
      case 'pending':
        return '⏸️';
      case 'failed':
        return '❌';
      default:
        return '📝';
    }
  };

  const getStatusCounts = () => {
    const total = workflows.length;
    const deployed = workflows.filter(w => w.isDeployed).length;
    const draft = total - deployed;
    return { total, deployed, draft };
  };

  const statusCounts = getStatusCounts();

  if (loading) {
    return (
      <div className="workflow-list-container">
        <div className="workflow-list-loading">
          <div className="loading-spinner"></div>
          <p>Loading workflows...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="workflow-list-container">
        <div className="workflow-list-error">
          <h3>Error Loading Workflows</h3>
          <p>{error}</p>
          {onRefresh && (
            <button onClick={onRefresh} className="retry-btn">
              Try Again
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="workflow-list-container">
      {/* Header */}
      <div className="workflow-list-header">
        <div className="header-content">
          <h2>Your Workflows</h2>
          <p>
            Create and manage your message router workflows
          </p>
        </div>
        <div className="header-actions">
          <div className="user-section">
            <span className="welcome-text">Welcome, {username}</span>
            <button className="sign-out-btn" onClick={onSignOut}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16,17 21,12 16,7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Sign Out
            </button>
          </div>
          <button
            onClick={onCreateNew}
            className="create-workflow-btn"
            disabled={isCreating}
          >
            {isCreating ? (
              <>
                <div className="loading-spinner small"></div>
                Creating...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Create New Workflow
              </>
            )}
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="workflow-list-controls">
        <div className="search-section">
          <div className="search-input-container">
            <svg className="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search workflows..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="clear-search-btn"
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div className="filter-section">
          <div className="status-filters">
            <button
              onClick={() => setFilterStatus('all')}
              className={`filter-btn ${filterStatus === 'all' ? 'active' : ''}`}
            >
              All ({statusCounts.total})
            </button>
            <button
              onClick={() => setFilterStatus('draft')}
              className={`filter-btn ${filterStatus === 'draft' ? 'active' : ''}`}
            >
              Draft ({statusCounts.draft})
            </button>
            <button
              onClick={() => setFilterStatus('deployed')}
              className={`filter-btn ${filterStatus === 'deployed' ? 'active' : ''}`}
            >
              Deployed ({statusCounts.deployed})
            </button>
          </div>

          <div className="sort-section">
            <span className="sort-label">Sort by:</span>
            <button
              onClick={() => handleSortChange('name')}
              className={`sort-btn ${sortBy === 'name' ? 'active' : ''}`}
            >
              Name {getSortIcon('name')}
            </button>
            <button
              onClick={() => handleSortChange('created')}
              className={`sort-btn ${sortBy === 'created' ? 'active' : ''}`}
            >
              Created {getSortIcon('created')}
            </button>
            <button
              onClick={() => handleSortChange('modified')}
              className={`sort-btn ${sortBy === 'modified' ? 'active' : ''}`}
            >
              Modified {getSortIcon('modified')}
            </button>
          </div>

          {onRefresh && (
            <button onClick={onRefresh} className="refresh-btn" title="Refresh workflows">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="workflow-list-content">
        {filteredAndSortedWorkflows.length === 0 ? (
          <div className="empty-state">
            {workflows.length === 0 ? (
              <div className="no-workflows">
                <div className="empty-icon">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                  </svg>
                </div>
                <h3>No workflows yet</h3>
                <p>Create your first AWS Step Functions workflow using the "Create New" button in the sidebar.</p>
              </div>
            ) : (
              <div className="no-results">
                <div className="empty-icon">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                </div>
                <h3>No workflows found</h3>
                <p>Try adjusting your search or filter criteria.</p>
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setFilterStatus('all');
                  }}
                  className="clear-filters-btn"
                >
                  Clear Filters
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="workflow-table-container">
            <table className="workflows-table">
              <thead>
                <tr>
                  <th className="name-header">Name</th>
                  <th className="created-header">Created</th>
                  <th className="modified-header">Modified</th>
                  <th className="status-header">Status</th>
                  <th className="actions-header">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedWorkflows.map((workflow) => (
                  <tr key={workflow.id} className="workflow-row">
                    {/* Name Column */}
                    <td className="name-cell">
                      <div className="workflow-name-container">
                        <h3 
                          className="workflow-name-link"
                          onClick={() => {
                            console.log('Workflow name clicked:', workflow.id, 'onViewWorkflow available:', !!onViewWorkflow);
                            if (onViewWorkflow) {
                              onViewWorkflow(workflow.id);
                            } else {
                              console.log('Fallback to onEditWorkflow');
                              onEditWorkflow(workflow.id);
                            }
                          }}
                        >
                          {workflow.name}
                        </h3>
                        {workflow.description && (
                          <p className="workflow-description">{workflow.description}</p>
                        )}
                      </div>
                    </td>
                    
                    {/* Created Column */}
                    <td className="created-cell">
                      {new Date(workflow.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    
                    {/* Modified Column */}
                    <td className="modified-cell">
                      {new Date(workflow.updatedAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    
                    {/* Status Column */}
                    <td className="status-cell">
                      <span className={`status-badge ${getStatusColor(workflow.deploymentStatus)}`}>
                        <span className="status-icon">{getStatusIcon(workflow.isDeployed, workflow.deploymentStatus)}</span>
                        {getStatusText(workflow.isDeployed, workflow.deploymentStatus)}
                      </span>
                    </td>
                    
                    {/* Actions Column */}
                    <td className="actions-cell">
                      <div className="action-buttons">
                        <button
                          onClick={() => onEditWorkflow(workflow.id)}
                          className="action-btn edit-btn"
                          title="Edit workflow"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                          Edit
                        </button>
                        <button
                          onClick={() => onViewWorkflow ? onViewWorkflow(workflow.id) : onEditWorkflow(workflow.id)}
                          className="action-btn deployment-btn"
                          title="View workflow details"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                          View
                        </button>
                        {onDuplicateWorkflow && (
                          <button
                            onClick={() => onDuplicateWorkflow(workflow.id)}
                            className="action-btn duplicate-btn"
                            title="Duplicate workflow"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                            Copy
                          </button>
                        )}
                        <button
                          onClick={() => onDeleteWorkflow(workflow.id)}
                          className="action-btn delete-btn"
                          title="Delete workflow"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3,6 5,6 21,6" />
                            <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2" />
                            <line x1="10" y1="11" x2="10" y2="17" />
                            <line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkflowList;