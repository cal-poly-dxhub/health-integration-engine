import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService, AuthUser } from '../services/auth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMe } from '../contexts/MeContext';
import WorkflowList from './workflow/WorkflowList';
import DeleteWorkflowModal from './workflow/DeleteWorkflowModal';
import DeploymentStatusModal from './workflow/DeploymentStatusModal';
import OpenSearchPanel from './workflow/OpenSearchPanel';
import LayerManagement from './workflow/LayerManagement';
import { useWorkflows } from '../hooks/useWorkflows';
import { WorkflowMetadata } from '../types/workflow';
import './Dashboard.css';

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
  const navigate = useNavigate();
  const { me, selectedTeamId, selectTeam, teamNamesById, teamNamesReady, teamsById, allTeamsForAdmin, canWriteSelected } = useMe();
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
  } = useWorkflows({ teamId: selectedTeamId || undefined });

  const [workflowToDelete, setWorkflowToDelete] =
    useState<WorkflowMetadata | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('workflows');
  const [operationError, setOperationError] = useState<string | null>(null);

  // Auto-dismiss operation error toast after 6 seconds.
  useEffect(() => {
    if (!operationError) return;
    const t = setTimeout(() => setOperationError(null), 6000);
    return () => clearTimeout(t);
  }, [operationError]);
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

  // When the caller could create in more than one team and hasn't picked
  // one in the switcher, we pop a small modal so they pick before creating.
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  // When duplicating and the target team is ambiguous, hold the source
  // workflow id while the team picker is open.
  const [duplicatePickerWorkflowId, setDuplicatePickerWorkflowId] = useState<string | null>(null);

  const eligibleCreateTeams = (() => {
    if (!me) return [] as { teamId: string; name: string }[];
    if (me.isAdmin) {
      // Admin can create in any team that exists.
      return allTeamsForAdmin;
    }
    // Non-admin: only teams they have writer role on.
    return me.teams
      .filter(t => t.role === 'writer')
      .map(t => ({ teamId: t.teamId, name: t.name }));
  })();

  const performCreate = async (teamId: string | undefined) => {
    try {
      setIsCreating(true);
      const newWorkflow = await createWorkflow(
        'Untitled Workflow',
        'New workflow description',
        teamId
      );
      handleEditWorkflow(newWorkflow.id);
    } catch (error) {
      console.error('Failed to create workflow:', error);
      setOperationError(
        error instanceof Error ? error.message : 'Failed to create workflow. Please try again.'
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateNew = async () => {
    if (isCreating) return;
    if (!me) return;

    if (!me.isAdmin && eligibleCreateTeams.length === 0) {
      setOperationError('You need writer access on at least one team to create workflows.');
      return;
    }

    // A specific team is selected that the user can only read. Don't silently
    // create in some other team — tell them to switch to a writable team.
    if (selectedTeamId && !me.isAdmin && !eligibleCreateTeams.some(t => t.teamId === selectedTeamId)) {
      const teamName = teamNamesById[selectedTeamId] || selectedTeamId;
      setOperationError(
        `You have read-only access to ${teamName}. Switch to a team where you have writer access to create a workflow.`
      );
      return;
    }

    // If the team switcher already targets a specific eligible team, use it.
    if (selectedTeamId && eligibleCreateTeams.some(t => t.teamId === selectedTeamId)) {
      await performCreate(selectedTeamId);
      return;
    }

    // Otherwise: single eligible team auto-selects; multiple opens the picker.
    if (eligibleCreateTeams.length === 1) {
      await performCreate(eligibleCreateTeams[0].teamId);
      return;
    }

    if (eligibleCreateTeams.length === 0) {
      if (me.isAdmin) {
        setOperationError('No teams exist yet. Create a team in the admin page first.');
      } else {
        setOperationError('You need to be a member of a team to create workflows.');
      }
      return;
    }

    setTeamPickerOpen(true);
  };

  const handleEditWorkflow = (workflowId: string) => {
    if (onEditWorkflow) {
      onEditWorkflow(workflowId);
    }
  };

  const handleViewWorkflow = (workflowId: string) => {
    if (onViewWorkflow) {
      onViewWorkflow(workflowId);
    }
  };

  const handleDeleteWorkflow = (workflowId: string) => {
    const workflow = workflows.find((w) => w.id === workflowId);
    if (workflow) {
      setWorkflowToDelete(workflow);
      setOperationError(null);
      setDeleteSuccess(null);
    }
  };

  const confirmDelete = async () => {
    if (!workflowToDelete || isDeleting) return;

    try {
      setIsDeleting(true);
      setOperationError(null);
      setDashboardDeletionStatus('Initiating deletion...');

      await deleteWorkflow(workflowToDelete.id);

      const workflowId = workflowToDelete.id;
      setWorkflowToDelete(null);
      setIsDeleting(false);
      setDashboardDeletionStatus('');
      setDeletionId(workflowId);
      setShowDeletionProgressModal(true);
    } catch (error) {
      console.error('Failed to delete workflow:', error);
      setOperationError(
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
      setOperationError(null);
    }
  };

  const performDuplicate = async (workflowId: string, teamId: string | undefined) => {
    try {
      const duplicatedWorkflow = await duplicateWorkflow(workflowId, teamId);
      handleEditWorkflow(duplicatedWorkflow.id);
    } catch (error) {
      console.error('Failed to duplicate workflow:', error);
      setOperationError(
        error instanceof Error ? error.message : 'Failed to duplicate workflow. Please try again.'
      );
    }
  };

  const handleDuplicateWorkflow = async (workflowId: string) => {
    if (!me) return;

    if (!me.isAdmin && eligibleCreateTeams.length === 0) {
      setOperationError('You need writer access on at least one team to duplicate workflows.');
      return;
    }

    // A specific team is selected that the user can only read. Don't silently
    // duplicate into some other team — tell them to switch to a writable team.
    if (selectedTeamId && !me.isAdmin && !eligibleCreateTeams.some(t => t.teamId === selectedTeamId)) {
      const teamName = teamNamesById[selectedTeamId] || selectedTeamId;
      setOperationError(
        `You have read-only access to ${teamName}. Switch to a team where you have writer access to duplicate workflows.`
      );
      return;
    }

    // If the team switcher already targets a specific eligible team, use it.
    if (selectedTeamId && eligibleCreateTeams.some(t => t.teamId === selectedTeamId)) {
      await performDuplicate(workflowId, selectedTeamId);
      return;
    }

    // Otherwise: single eligible team auto-selects; multiple opens the picker.
    if (eligibleCreateTeams.length === 1) {
      await performDuplicate(workflowId, eligibleCreateTeams[0].teamId);
      return;
    }

    if (eligibleCreateTeams.length === 0) {
      setOperationError(
        me.isAdmin
          ? 'No teams exist yet. Create a team in the admin page first.'
          : 'You need to be a member of a team to duplicate workflows.'
      );
      return;
    }

    setDuplicatePickerWorkflowId(workflowId);
  };

  if (loading) {
    return (
      <div className="dash-root">
        <div className="dash-fullstate">
          <span className="dash-fullstate-spinner" aria-hidden="true" />
          <span>Loading your workspace…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dash-root">
        <div className="dash-fullstate">
          <div className="dash-fullstate-error">{error}</div>
          <button
            onClick={handleSignOut}
            className="dash-fullstate-action"
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
    <div className="dash-root">
      {/* ---------- Top nav ---------- */}
      <nav className="dash-nav">
        <div className="dash-nav-left">
          <button
            type="button"
            className="dash-icon-btn"
            onClick={handleToggleSidebar}
            aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            <MenuIcon />
          </button>
          <div className="dash-brand">
            <span className="dash-brand-mark">H</span>
            <span className="dash-brand-text">
              Health Data Integration Engine
            </span>
          </div>
        </div>

        <div className="dash-nav-right">
          {me && (me.teams.length > 0 || (me.isAdmin && allTeamsForAdmin.length > 0)) && (
            <select
              value={selectedTeamId || ''}
              onChange={(e) => {
                selectTeam(e.target.value || null);
                // useWorkflows re-fetches automatically when params.teamId changes
              }}
              style={{
                padding: '6px 10px',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                fontSize: 13,
                background: '#fff',
                color: '#374151',
              }}
              title="Filter workflows by team"
            >
              {/* "All" option available to everyone with multiple teams */}
              {(me.isAdmin || me.teams.length > 1) && (
                <option value="">
                  {me.isAdmin ? 'All teams (admin)' : 'All my teams'}
                </option>
              )}
              {/* Admins see every team in the system; non-admins see their own. */}
              {(me.isAdmin ? allTeamsForAdmin : me.teams).map(t => (
                <option key={t.teamId} value={t.teamId}>
                  {t.name}{!me.isAdmin && 'role' in t ? ` (${(t as any).role})` : ''}
                </option>
              ))}
            </select>
          )}

          {me?.isAdmin && (
            <button
              type="button"
              className="dash-search-btn"
              onClick={() => navigate('/admin')}
              title="Open admin dashboard"
            >
              <span className="dash-search-btn-text">Admin</span>
            </button>
          )}

          {import.meta.env.VITE_ENABLE_OPENSEARCH !== 'false' && (
            <button
              type="button"
              className="dash-search-btn"
              onClick={() => setActiveTab('search')}
              title="Search messages across all workflows (Cmd+K)"
            >
              <SearchIcon />
              <span className="dash-search-btn-text">Search messages</span>
              <kbd className="dash-kbd">Cmd+K</kbd>
            </button>
          )}

          <div className="dash-user-wrap" ref={userMenuRef}>
            <button
              type="button"
              className="dash-user-btn"
              onClick={() => setUserMenuOpen((s) => !s)}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
            >
              <span className="dash-avatar" aria-hidden="true">
                {userInitials}
              </span>
              <span className="dash-user-email">{user?.email}</span>
              <span className="dash-user-caret" aria-hidden="true">
                <ChevronDownIcon />
              </span>
            </button>

            {userMenuOpen && (
              <div className="dash-menu" role="menu">
                <div className="dash-menu-header">
                  <div className="dash-menu-name">
                    {user?.email || 'Signed in'}
                  </div>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="dash-menu-item dash-menu-item--danger"
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
        className={`dash-body${
          sidebarCollapsed ? ' dash-body--collapsed' : ''
        }`}
      >
        {/* ----- Sidebar ----- */}
        <aside className="dash-sidebar">
          <div className="dash-sidebar-section">
            <div className="dash-sidebar-label">Workspace</div>
            {tabs
              .filter((t) => t.enabled)
              .map((tab) => {
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    className={`dash-tab${
                      isActive ? ' dash-tab--active' : ''
                    }`}
                    onClick={() => setActiveTab(tab.key)}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className="dash-tab-icon" aria-hidden="true">
                      {tab.icon}
                    </span>
                    <span className="dash-tab-body">
                      <span className="dash-tab-title">{tab.title}</span>
                      <span className="dash-tab-desc">{tab.desc}</span>
                    </span>
                    {tab.badge && (
                      <span className="dash-tab-badge">{tab.badge}</span>
                    )}
                  </button>
                );
              })}
          </div>

        </aside>

        {/* ----- Content ----- */}
        <main className="dash-content">
          <div className="dash-content-inner">
            {activeTab === 'workflows' && (
              <WorkflowList
                workflows={workflows}
                loading={workflowsLoading || !teamNamesReady}
                error={workflowsError || undefined}
                username={user?.email || user?.username || 'User'}
                teamNamesById={teamNamesById}
                canCreate={!(selectedTeamId && !canWriteSelected)}
                createDisabledReason={
                  selectedTeamId && !canWriteSelected
                    ? `You have read-only access to ${teamNamesById[selectedTeamId] || selectedTeamId}. Switch to a team where you have writer access to create workflows.`
                    : undefined
                }
                canWriteWorkflow={(w) => {
                  if (!me) return false;
                  if (me.isAdmin) return true;
                  if (!w.teamId) return false;
                  return teamsById[w.teamId]?.role === 'writer';
                }}
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
                <OpenSearchPanel
                  allowedWorkflowIds={workflows
                    .filter((w) => w.deploymentStatus === 'deployed')
                    .map((w) => w.id)}
                />
              )}
          </div>
        </main>
      </div>

      {/* ---------- Modals & toasts ---------- */}
      {teamPickerOpen && (
        <CreateInTeamPicker
          teams={eligibleCreateTeams}
          onCancel={() => setTeamPickerOpen(false)}
          onConfirm={async (teamId) => {
            setTeamPickerOpen(false);
            await performCreate(teamId);
          }}
        />
      )}

      {duplicatePickerWorkflowId && (
        <CreateInTeamPicker
          teams={eligibleCreateTeams}
          title="Duplicate workflow into which team?"
          description="Pick the team the copied workflow should belong to."
          confirmLabel="Duplicate"
          defaultTeamId={workflows.find(w => w.id === duplicatePickerWorkflowId)?.teamId}
          onCancel={() => setDuplicatePickerWorkflowId(null)}
          onConfirm={async (teamId) => {
            const sourceId = duplicatePickerWorkflowId;
            setDuplicatePickerWorkflowId(null);
            if (sourceId) await performDuplicate(sourceId, teamId);
          }}
        />
      )}

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
          className="dash-toast dash-toast--success"
          role="status"
          aria-live="polite"
        >
          <CheckCircleIcon />
          <div className="dash-toast-body">{deleteSuccess}</div>
          <button
            type="button"
            className="dash-toast-close"
            onClick={() => setDeleteSuccess(null)}
            aria-label="Dismiss"
          >
            
          </button>
        </div>
      )}

      {operationError && (
        <div
          className="dash-toast dash-toast--error"
          role="alert"
          aria-live="polite"
        >
          <AlertIcon />
          <div className="dash-toast-body">{operationError}</div>
          <button
            type="button"
            className="dash-toast-close"
            onClick={() => setOperationError(null)}
            aria-label="Dismiss"
          >
            
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

/* ---------- Pick-team modal ---------- */

interface CreateInTeamPickerProps {
  teams: { teamId: string; name: string }[];
  onCancel: () => void;
  onConfirm: (teamId: string) => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  /** Pre-selected team in the dropdown (falls back to the first team). */
  defaultTeamId?: string;
}

function CreateInTeamPicker({ teams, onCancel, onConfirm, title, description, confirmLabel, defaultTeamId }: CreateInTeamPickerProps) {
  const initial = defaultTeamId && teams.some(t => t.teamId === defaultTeamId)
    ? defaultTeamId
    : (teams[0]?.teamId || '');
  const [picked, setPicked] = useState<string>(initial);
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 400,
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.18)',
      }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 600 }}>{title || 'Create workflow in which team?'}</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6b7280' }}>
          {description || 'You can create workflows in more than one team. Pick the team this workflow should belong to.'}
        </p>
        <select
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          style={{
            width: '100%', padding: '10px 12px', fontSize: 14,
            border: '1px solid #d1d5db', borderRadius: 6, marginBottom: 16,
          }}
        >
          {teams.map(t => (
            <option key={t.teamId} value={t.teamId}>{t.name}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '8px 14px', background: '#fff', color: '#374151',
              border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => picked && onConfirm(picked)}
            disabled={!picked}
            style={{
              padding: '8px 14px', background: '#2563eb', color: '#fff',
              border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer',
            }}
          >
            {confirmLabel || 'Create'}
          </button>
        </div>
      </div>
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
