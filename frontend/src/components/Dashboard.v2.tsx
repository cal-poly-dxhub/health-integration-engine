import { useEffect, useRef, useState } from 'react';
import { authService, AuthUser } from '../services/auth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import WorkflowList from './workflow/WorkflowList.v2';
import DeleteWorkflowModal from './workflow/DeleteWorkflowModal.v2';
import DeploymentStatusModal from './workflow/DeploymentStatusModal.v2';
import OpenSearchPanel from './workflow/OpenSearchPanel.v2';
import LayerManagement from './workflow/LayerManagement.v2';
import { useWorkflows } from '../hooks/useWorkflows';
import { WorkflowMetadata } from '../types/workflow';
import './Dashboard.v2.css';

interface DashboardProps {
  onSignOut: () => void;
  onEditWorkflow?: (workflowId: string) => void;
  onViewWorkflow?: (workflowId: string) => void;
}

type TabKey = 'workflows' | 'search' | 'layers';

export default function Dashboard({
  onSignOut,
  onEditWorkflow,
  onViewWorkflow,
}: DashboardProps) {
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

  const [workflowToDelete, setWorkflowToDelete] =
    useState<WorkflowMetadata | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('workflows');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const [showDeletionProgressModal, setShowDeletionProgressModal] =
    useState(false);
  const [deletionId, setDeletionId] = useState<string>('');
  const [dashboardDeletionStatus, setDashboardDeletionStatus] = useState('');

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useDocumentTitle(
    activeTab === 'workflows'
      ? 'Workflows'
      : activeTab === 'layers'
      ? 'Lambda Layers'
      : activeTab === 'search'
      ? 'Message Search'
      : 'Dashboard'
  );

  // Cmd/Ctrl+K switches to the Message Search tab
  useEffect(() => {
    if (import.meta.env.VITE_ENABLE_OPENSEARCH === 'false') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setActiveTab('search');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  // Close user menu on outside click
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(e.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [userMenuOpen]);

  const handleToggleSidebar = () => {
    setSidebarCollapsed((s) => !s);
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
      const newWorkflow = await createWorkflow(
        'Untitled Workflow',
        'New workflow description'
      );
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
    }
  };

  const handleDeleteWorkflow = (workflowId: string) => {
    const workflow = workflows.find((w) => w.id === workflowId);
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
      setDashboardDeletionStatus('Initiating deletion...');

      await deleteWorkflow(workflowToDelete.id);

      const workflowId = workflowToDelete.id;
      setWorkflowToDelete(null);
      setIsDeleting(false);
      setDashboardDeletionStatus('');
      setDeletionId(workflowId);
      setShowDeletionProgressModal(true);
    } catch (error) {
      console.error('❌ Failed to delete workflow:', error);
      setDeleteError(
        error instanceof Error
          ? error.message
          : 'Failed to delete workflow. Please try again.'
      );
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

  if (loading) {
    return (
      <div className="dash-v2-root">
        <div className="dash-v2-fullstate">
          <span className="dash-v2-fullstate-spinner" aria-hidden="true" />
          <span>Loading your workspace…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dash-v2-root">
        <div className="dash-v2-fullstate">
          <div className="dash-v2-fullstate-error">{error}</div>
          <button
            onClick={handleSignOut}
            className="dash-v2-fullstate-action"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  const userInitials = (user?.email || user?.username || 'U')
    .trim()
    .slice(0, 1)
    .toUpperCase();

  const tabs: Array<{
    key: TabKey;
    title: string;
    desc: string;
    badge?: string;
    icon: JSX.Element;
    enabled: boolean;
  }> = [
    {
      key: 'workflows',
      title: 'Workflows',
      desc: 'Create and manage workflows',
      badge: `${workflows.length}`,
      icon: <WorkflowIcon />,
      enabled: true,
    },
    {
      key: 'layers',
      title: 'Lambda Layers',
      desc: 'Shared library packages',
      icon: <LayersIcon />,
      enabled: true,
    },
    {
      key: 'search',
      title: 'Message Search',
      desc: 'OpenSearch indexed messages',
      icon: <SearchIcon />,
      enabled: import.meta.env.VITE_ENABLE_OPENSEARCH !== 'false',
    },
  ];

  return (
    <div className="dash-v2-root">
      {/* ---------- Top nav ---------- */}
      <nav className="dash-v2-nav">
        <div className="dash-v2-nav-left">
          <button
            type="button"
            className="dash-v2-icon-btn"
            onClick={handleToggleSidebar}
            aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            <MenuIcon />
          </button>
          <div className="dash-v2-brand">
            <span className="dash-v2-brand-mark">H</span>
            <span className="dash-v2-brand-text">
              Health Data Integration Engine
            </span>
          </div>
        </div>

        <div className="dash-v2-nav-right">
          {import.meta.env.VITE_ENABLE_OPENSEARCH !== 'false' && (
            <button
              type="button"
              className="dash-v2-search-btn"
              onClick={() => setActiveTab('search')}
              title="Search messages across all workflows (⌘K)"
            >
              <SearchIcon />
              <span className="dash-v2-search-btn-text">Search messages</span>
              <kbd className="dash-v2-kbd">⌘K</kbd>
            </button>
          )}

          <div className="dash-v2-user-wrap" ref={userMenuRef}>
            <button
              type="button"
              className="dash-v2-user-btn"
              onClick={() => setUserMenuOpen((s) => !s)}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
            >
              <span className="dash-v2-avatar" aria-hidden="true">
                {userInitials}
              </span>
              <span className="dash-v2-user-email">{user?.email}</span>
              <span className="dash-v2-user-caret" aria-hidden="true">
                <ChevronDownIcon />
              </span>
            </button>

            {userMenuOpen && (
              <div className="dash-v2-menu" role="menu">
                <div className="dash-v2-menu-header">
                  <div className="dash-v2-menu-name">
                    {user?.email || 'Signed in'}
                  </div>
                  {user?.userRole && (
                    <div className="dash-v2-menu-sub">
                      {user.userRole}
                      {user.organization ? ` · ${user.organization}` : ''}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="dash-v2-menu-item dash-v2-menu-item--danger"
                  onClick={() => {
                    setUserMenuOpen(false);
                    handleSignOut();
                  }}
                >
                  <SignOutIcon />
                  <span>Sign out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* ---------- Body ---------- */}
      <div
        className={`dash-v2-body${
          sidebarCollapsed ? ' dash-v2-body--collapsed' : ''
        }`}
      >
        {/* ----- Sidebar ----- */}
        <aside className="dash-v2-sidebar">
          <div className="dash-v2-sidebar-section">
            <div className="dash-v2-sidebar-label">Workspace</div>
            {tabs
              .filter((t) => t.enabled)
              .map((tab) => {
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    className={`dash-v2-tab${
                      isActive ? ' dash-v2-tab--active' : ''
                    }`}
                    onClick={() => setActiveTab(tab.key)}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className="dash-v2-tab-icon" aria-hidden="true">
                      {tab.icon}
                    </span>
                    <span className="dash-v2-tab-body">
                      <span className="dash-v2-tab-title">{tab.title}</span>
                      <span className="dash-v2-tab-desc">{tab.desc}</span>
                    </span>
                    {tab.badge && (
                      <span className="dash-v2-tab-badge">{tab.badge}</span>
                    )}
                  </button>
                );
              })}
          </div>

        </aside>

        {/* ----- Content ----- */}
        <main className="dash-v2-content">
          <div className="dash-v2-content-inner">
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
                onRefresh={refreshWorkflows}
                onSignOut={onSignOut}
                isCreating={isCreating}
                onViewWorkflow={handleViewWorkflow}
                onManageLayers={() => setActiveTab('layers')}
              />
            )}

            {activeTab === 'layers' && <LayerManagement />}

            {activeTab === 'search' &&
              import.meta.env.VITE_ENABLE_OPENSEARCH !== 'false' && (
                <OpenSearchPanel />
              )}
          </div>
        </main>
      </div>

      {/* ---------- Modals & toasts ---------- */}
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

      {deleteSuccess && (
        <div
          className="dash-v2-toast dash-v2-toast--success"
          role="status"
          aria-live="polite"
        >
          <CheckCircleIcon />
          <div className="dash-v2-toast-body">{deleteSuccess}</div>
          <button
            type="button"
            className="dash-v2-toast-close"
            onClick={() => setDeleteSuccess(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {deleteError && (
        <div
          className="dash-v2-toast dash-v2-toast--error"
          role="alert"
          aria-live="polite"
        >
          <AlertIcon />
          <div className="dash-v2-toast-body">{deleteError}</div>
          <button
            type="button"
            className="dash-v2-toast-close"
            onClick={() => setDeleteError(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {showDeletionProgressModal && deletionId && (
        <DeploymentStatusModal
          isOpen={showDeletionProgressModal}
          deploymentId={deletionId}
          workflowName="Workflow Deletion"
          onClose={() => {
            setShowDeletionProgressModal(false);
            setDeletionId('');
          }}
          onComplete={(status) => {
            if (status.status === 'completed') {
              setShowDeletionProgressModal(false);
              setDeletionId('');
              setDeleteSuccess('Workflow deleted successfully!');
              setTimeout(() => setDeleteSuccess(null), 5000);
            }
          }}
        />
      )}
    </div>
  );
}

/* ---------- Inline SVG icons ---------- */

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function WorkflowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="15" y="3" width="6" height="6" rx="1.5" />
      <rect x="9" y="15" width="6" height="6" rx="1.5" />
      <path d="M6 9v3a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
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
