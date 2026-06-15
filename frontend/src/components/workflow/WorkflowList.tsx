import React, { useMemo, useState } from 'react';
import { WorkflowMetadata } from '../../types/workflow';
import './WorkflowList.css';

interface WorkflowListProps {
  workflows: WorkflowMetadata[];
  loading?: boolean;
  error?: string;
  username?: string;
  /** teamId -> human-friendly team name. Falls back to teamId on miss. */
  teamNamesById?: Record<string, string>;
  /** When provided, returns whether the caller can write to a given workflow's team.
   *  Rows where this is false hide edit / delete / duplicate actions. */
  canWriteWorkflow?: (workflow: WorkflowMetadata) => boolean;
  onCreateNew: () => void;
  /** When false, the create button is disabled (e.g. a read-only team is selected). */
  canCreate?: boolean;
  /** Tooltip explaining why creation is disabled. */
  createDisabledReason?: string;
  onEditWorkflow: (workflowId: string) => void;
  onViewWorkflow?: (workflowId: string) => void;
  onDeleteWorkflow: (workflowId: string) => void;
  onDuplicateWorkflow?: (workflowId: string) => void;
  onViewDeployment?: (workflowId: string) => void;
  onRefresh?: () => void;
  onSignOut?: () => void;
  isCreating?: boolean;
  onManageLayers?: () => void;
}

type SortKey = 'name' | 'created' | 'modified';
type SortOrder = 'asc' | 'desc';
type StatusFilter = 'all' | 'draft' | 'deployed';

const WorkflowList: React.FC<WorkflowListProps> = ({
  workflows,
  loading = false,
  error,
  teamNamesById,
  canWriteWorkflow,
  onCreateNew,
  canCreate = true,
  createDisabledReason,
  onEditWorkflow,
  onViewWorkflow,
  onDeleteWorkflow,
  onDuplicateWorkflow,
  onRefresh,
  isCreating = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('modified');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');

  const filteredAndSortedWorkflows = useMemo(() => {
    const filtered = workflows.filter((workflow) => {
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        workflow.name.toLowerCase().includes(term) ||
        (workflow.description?.toLowerCase().includes(term) ?? false);
      const matchesStatus =
        filterStatus === 'all' ||
        (filterStatus === 'deployed' && workflow.isDeployed) ||
        (filterStatus === 'draft' && !workflow.isDeployed);

      return matchesSearch && matchesStatus;
    });

    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'created':
          comparison =
            new Date(a.createdAt).getTime() -
            new Date(b.createdAt).getTime();
          break;
        case 'modified':
          comparison =
            new Date(a.updatedAt).getTime() -
            new Date(b.updatedAt).getTime();
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [workflows, searchTerm, sortBy, sortOrder, filterStatus]);

  const handleSortChange = (newSortBy: SortKey) => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSortBy);
      setSortOrder('desc');
    }
  };

  const sortArrow = (field: SortKey) => {
    if (sortBy !== field) return '';
    return sortOrder === 'asc' ? '↑' : '↓';
  };

  const statusCounts = useMemo(() => {
    const total = workflows.length;
    const deployed = workflows.filter((w) => w.isDeployed).length;
    return { total, deployed, draft: total - deployed };
  }, [workflows]);

  if (loading) {
    return (
      <div className="wfl-root">
        <div className="wfl-state">
          <span className="wfl-state-spinner" aria-hidden="true" />
          <p className="wfl-state-sub">Loading workflows…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wfl-root">
        <div className="wfl-state wfl-state--error" role="alert">
          <span className="wfl-state-icon" aria-hidden="true">
            <AlertIcon />
          </span>
          <h3 className="wfl-state-title">Failed to load workflows</h3>
          <p className="wfl-state-sub">{error}</p>
          {onRefresh && (
            <div className="wfl-state-actions">
              <button onClick={onRefresh} className="wfl-btn">
                <RefreshIcon />
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="wfl-root">
      {/* ---------- Header ---------- */}
      <header className="wfl-header">
        <div>
          <h2 className="wfl-title">Workflows</h2>
          <p className="wfl-subtitle">
            Create, edit, and deploy your message router workflows.
          </p>
        </div>

        <div style={{ display: 'inline-flex', gap: 8 }}>
          {onRefresh && (
            <button
              type="button"
              className="wfl-btn wfl-btn--icon"
              onClick={onRefresh}
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshIcon />
            </button>
          )}
          <span
            title={!canCreate ? createDisabledReason : undefined}
            style={{ display: 'inline-flex' }}
          >
            <button
              type="button"
              className="wfl-btn wfl-btn--primary"
              onClick={onCreateNew}
              disabled={isCreating || !canCreate}
            >
              {isCreating ? (
                <>
                  <span
                    className="wfl-spinner-sm"
                    aria-hidden="true"
                  />
                  Creating…
                </>
              ) : (
                <>
                  <PlusIcon />
                  Create workflow
                </>
              )}
            </button>
          </span>
        </div>
      </header>

      {/* ---------- Toolbar ---------- */}
      <div className="wfl-toolbar">
        <div className="wfl-search">
          <span className="wfl-search-icon" aria-hidden="true">
            <SearchIcon />
          </span>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search workflows by name or description"
            className="wfl-search-input"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="wfl-search-clear"
              aria-label="Clear search"
            >
              <XIcon />
            </button>
          )}
        </div>

        <div
          className="wfl-filters"
          role="tablist"
          aria-label="Filter by status"
        >
          {(
            [
              { key: 'all', label: 'All', count: statusCounts.total },
              { key: 'draft', label: 'Draft', count: statusCounts.draft },
              {
                key: 'deployed',
                label: 'Deployed',
                count: statusCounts.deployed,
              },
            ] as const
          ).map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filterStatus === f.key}
              onClick={() => setFilterStatus(f.key)}
              className={`wfl-filter${
                filterStatus === f.key ? ' wfl-filter--active' : ''
              }`}
            >
              {f.label} ({f.count})
            </button>
          ))}
        </div>

        <div className="wfl-toolbar-right">
          <div className="wfl-sort">
            <span className="wfl-sort-label">Sort by</span>
            <div className="wfl-sort-btns">
              {(['name', 'created', 'modified'] as const).map((field) => (
                <button
                  key={field}
                  type="button"
                  onClick={() => handleSortChange(field)}
                  className={`wfl-sort-btn${
                    sortBy === field ? ' wfl-sort-btn--active' : ''
                  }`}
                >
                  {field === 'name'
                    ? 'Name'
                    : field === 'created'
                    ? 'Created'
                    : 'Modified'}
                  {sortBy === field && (
                    <span className="wfl-sort-arrow" aria-hidden="true">
                      {sortArrow(field)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Results ---------- */}
      {filteredAndSortedWorkflows.length === 0 ? (
        workflows.length === 0 ? (
          <div className="wfl-state">
            <span className="wfl-state-icon" aria-hidden="true">
              <EmptyIcon />
            </span>
            <h3 className="wfl-state-title">No workflows yet</h3>
            <p className="wfl-state-sub">
              Get started by creating your first AWS Step Functions workflow.
            </p>
            <div className="wfl-state-actions">
              <span
                title={!canCreate ? createDisabledReason : undefined}
                style={{ display: 'inline-flex' }}
              >
                <button
                  type="button"
                  onClick={onCreateNew}
                  className="wfl-btn wfl-btn--primary"
                  disabled={isCreating || !canCreate}
                >
                  <PlusIcon />
                  Create workflow
                </button>
              </span>
            </div>
          </div>
        ) : (
          <div className="wfl-state">
            <span className="wfl-state-icon" aria-hidden="true">
              <SearchIcon />
            </span>
            <h3 className="wfl-state-title">No matches</h3>
            <p className="wfl-state-sub">
              Try adjusting your search or filter criteria.
            </p>
            <div className="wfl-state-actions">
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setFilterStatus('all');
                }}
                className="wfl-btn"
              >
                Clear filters
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="wfl-card">
          <table className="wfl-table">
            <thead>
              <tr>
                <th style={{ width: '36%' }}>Name</th>
                <th>Team</th>
                <th>Created</th>
                <th>Modified</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedWorkflows.map((workflow) => (
                <tr key={workflow.id}>
                  <td>
                    <button
                      type="button"
                      className="wfl-name-link"
                      onClick={() => {
                        if (onViewWorkflow) onViewWorkflow(workflow.id);
                        else onEditWorkflow(workflow.id);
                      }}
                    >
                      {workflow.name}
                    </button>
                    {workflow.description && (
                      <p className="wfl-name-desc">
                        {workflow.description}
                      </p>
                    )}
                  </td>
                  <td data-label="Team">
                    {workflow.teamId
                      ? (teamNamesById?.[workflow.teamId] || workflow.teamId)
                      : <span style={{ color: '#9ca3af' }}>—</span>}
                  </td>
                  <td className="wfl-cell-date" data-label="Created">
                    {formatDate(workflow.createdAt)}
                  </td>
                  <td className="wfl-cell-date" data-label="Modified">
                    <div>{formatDate(workflow.updatedAt)}</div>
                    {workflow.updatedByEmail && (
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                        by {workflow.updatedByEmail}
                      </div>
                    )}
                  </td>
                  <td>
                    <StatusBadge
                      isDeployed={workflow.isDeployed}
                      status={workflow.deploymentStatus}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="wfl-actions">
                      {(() => {
                        const canWrite = canWriteWorkflow ? canWriteWorkflow(workflow) : true;
                        return (
                          <>
                            {/* Writers get the edit (pencil) icon → canvas editor.
                                Readers get the eye icon → canvas in read-only mode.
                                Both get the details (view) icon → WorkflowDetails. */}
                            {canWrite ? (
                              <button
                                type="button"
                                className="wfl-action wfl-action--edit"
                                onClick={() => onEditWorkflow(workflow.id)}
                                title="Edit workflow"
                                aria-label={`Edit ${workflow.name}`}
                              >
                                <EditIcon />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="wfl-action wfl-action--edit"
                                onClick={() => onEditWorkflow(workflow.id)}
                                title="View canvas (read-only)"
                                aria-label={`View canvas for ${workflow.name}`}
                              >
                                <EyeIcon />
                              </button>
                            )}
                            {onViewWorkflow && (
                              <button
                                type="button"
                                className="wfl-action"
                                onClick={() => onViewWorkflow(workflow.id)}
                                title="View workflow details"
                                aria-label={`View details for ${workflow.name}`}
                              >
                                <DetailsIcon />
                              </button>
                            )}
                            {canWrite && onDuplicateWorkflow && (
                              <button
                                type="button"
                                className="wfl-action"
                                onClick={() => onDuplicateWorkflow(workflow.id)}
                                title="Duplicate workflow"
                                aria-label={`Duplicate ${workflow.name}`}
                              >
                                <CopyIcon />
                              </button>
                            )}
                            {canWrite && (
                              <button
                                type="button"
                                className="wfl-action wfl-action--danger"
                                onClick={() => onDeleteWorkflow(workflow.id)}
                                title="Delete workflow"
                                aria-label={`Delete ${workflow.name}`}
                              >
                                <TrashIcon />
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default WorkflowList;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({
  isDeployed,
  status,
}: {
  isDeployed: boolean;
  status?: string;
}) {
  const variant = !isDeployed
    ? 'draft'
    : status === 'deployed'
    ? 'deployed'
    : status === 'deploying'
    ? 'deploying'
    : status === 'pending'
    ? 'pending'
    : status === 'failed'
    ? 'failed'
    : 'draft';

  const label = !isDeployed
    ? 'Draft'
    : status
    ? status.charAt(0).toUpperCase() + status.slice(1)
    : 'Draft';

  return (
    <span className={`wfl-badge wfl-badge--${variant}`}>{label}</span>
  );
}

/* ---------- Inline SVG icons ---------- */

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="m19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function DetailsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function EmptyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 17.5h7" />
      <path d="M17.5 14v7" />
    </svg>
  );
}
