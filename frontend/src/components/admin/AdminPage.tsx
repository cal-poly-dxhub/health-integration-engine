import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  teamApiService,
  Team,
  Membership,
  AdminUser,
  AuditEvent,
  WorkflowChangeEntry,
  ChangeAction,
} from '../../services/teamApi';
import ChangeDiffView from '../ChangeDiffView';
import './AdminPage.css';

type Tab = 'users' | 'teams' | 'audit' | 'workflow-changes';

export default function AdminPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('users');

  const tabs: Array<{ key: Tab; title: string; desc: string; icon: JSX.Element }> = [
    { key: 'users', title: 'Users', desc: 'View and promote users', icon: <UsersIcon /> },
    { key: 'teams', title: 'Teams', desc: 'Create teams and manage members', icon: <TeamsIcon /> },
    { key: 'audit', title: 'Audit log', desc: 'Admin management actions', icon: <ClockIcon /> },
    { key: 'workflow-changes', title: 'Workflow changes', desc: 'All workflow edits and deploys', icon: <WorkflowChangesIcon /> },
  ];

  return (
    <div className="adm-root">
      <nav className="adm-nav">
        <div className="adm-nav-left">
          <div className="adm-brand">
            <span className="adm-brand-mark">H</span>
            <span>Health Data Integration Engine</span>
          </div>
          <span className="adm-nav-title">Admin</span>
        </div>
        <div className="adm-nav-right">
          <button type="button" className="adm-nav-btn" onClick={() => navigate('/dashboard')}>
            <BackIcon />
            Back to dashboard
          </button>
        </div>
      </nav>

      <div className="adm-body">
        <aside className="adm-sidebar">
          <div className="adm-sidebar-section">
            <div className="adm-sidebar-label">Workspace</div>
            {tabs.map((t) => {
              const isActive = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  className={`adm-tab${isActive ? ' adm-tab--active' : ''}`}
                  onClick={() => setTab(t.key)}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="adm-tab-icon" aria-hidden="true">{t.icon}</span>
                  <span className="adm-tab-body">
                    <span className="adm-tab-title">{t.title}</span>
                    <span className="adm-tab-desc">{t.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="adm-content">
          <div className="adm-pane">
            {tab === 'users' && <UsersTab />}
            {tab === 'teams' && <TeamsTab />}
            {tab === 'audit' && <AuditTab />}
            {tab === 'workflow-changes' && <WorkflowChangesTab />}
          </div>
        </main>
      </div>
    </div>
  );
}

// ---------- Users ----------

function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      setUsers(await teamApiService.listUsers());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const promote = async (userId: string) => {
    try { setBusy(userId); await teamApiService.promoteAdmin(userId); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to promote'); }
    finally { setBusy(null); }
  };
  const demote = async (userId: string) => {
    try { setBusy(userId); await teamApiService.demoteAdmin(userId); await load(); }
    catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Failed to demote';
      setError(msg);
    }
    finally { setBusy(null); }
  };

  return (
    <>
      <div className="adm-page-header">
        <div>
          <div className="adm-page-title">Users</div>
          <div className="adm-page-sub">Everyone who has signed up. Promote or demote admins here.</div>
        </div>
        <button className="adm-btn" onClick={load} disabled={loading}>Refresh</button>
      </div>

      {error && <div className="adm-error">{error}</div>}

      <div className="adm-card">
        {loading ? <div className="adm-loading">Loading…</div> : users.length === 0 ? (
          <div className="adm-empty">No users yet.</div>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Role</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.userId}>
                    <td>{u.email}</td>
                    <td className="adm-cell-muted">{u.status || '—'}</td>
                    <td className="adm-cell-muted">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
                    <td>{u.isAdmin ? <span className="adm-badge adm-badge--admin">admin</span> : <span className="adm-cell-muted">—</span>}</td>
                    <td className="adm-cell-actions">
                      {u.isAdmin ? (
                        <button className="adm-btn adm-btn--danger" disabled={busy === u.userId} onClick={() => demote(u.userId)}>
                          Demote
                        </button>
                      ) : (
                        <button className="adm-btn" disabled={busy === u.userId} onClick={() => promote(u.userId)}>
                          Promote to admin
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ---------- Teams ----------

function TeamsTab() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      setTeams(await teamApiService.listTeams());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load teams');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!newName.trim()) return;
    try {
      setCreating(true);
      await teamApiService.createTeam(newName.trim(), newDesc.trim() || undefined);
      setNewName(''); setNewDesc('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create team');
    } finally { setCreating(false); }
  };

  const delTeam = async (teamId: string) => {
    if (!confirm('Delete this team? It must have no members.')) return;
    try {
      await teamApiService.deleteTeam(teamId);
      await load();
      if (selected === teamId) setSelected(null);
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Failed to delete team';
      setError(msg);
    }
  };

  const selectedTeam = teams.find(t => t.teamId === selected) || null;

  return (
    <>
      <div className="adm-page-header">
        <div>
          <div className="adm-page-title">Teams</div>
          <div className="adm-page-sub">Create teams, manage members, set their roles.</div>
        </div>
      </div>

      {error && <div className="adm-error">{error}</div>}

      <div className="adm-card">
        <div className="adm-card-header">
          <div className="adm-card-title">Create a team</div>
        </div>
        <div className="adm-card-body">
          <div className="adm-form-row">
            <input
              className="adm-input"
              placeholder="Team name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              disabled={creating}
              style={{ minWidth: 220 }}
            />
            <input
              className="adm-input adm-input--grow"
              placeholder="Description (optional)"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              disabled={creating}
            />
            <button className="adm-btn adm-btn--primary" onClick={create} disabled={creating || !newName.trim()}>
              {creating ? 'Creating…' : 'Create team'}
            </button>
          </div>
        </div>
      </div>

      <div className="adm-card">
        <div className="adm-card-header">
          <div className="adm-card-title">All teams</div>
          <button className="adm-btn" onClick={load} disabled={loading}>Refresh</button>
        </div>
        {loading ? <div className="adm-loading">Loading…</div> : teams.length === 0 ? (
          <div className="adm-empty">No teams yet — create one above.</div>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Members</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {teams.map(t => (
                  <tr key={t.teamId}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{t.name}</div>
                      {t.description && <div className="adm-cell-muted">{t.description}</div>}
                    </td>
                    <td>{t.memberCount ?? 0}</td>
                    <td className="adm-cell-muted">{new Date(t.createdAt).toLocaleDateString()}</td>
                    <td className="adm-cell-actions">
                      <button
                        className="adm-btn"
                        onClick={() => setSelected(t.teamId === selected ? null : t.teamId)}
                      >
                        {selected === t.teamId ? 'Hide members' : 'Manage members'}
                      </button>
                      <button className="adm-btn adm-btn--danger" onClick={() => delTeam(t.teamId)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && selectedTeam && (
        <TeamDetail team={selectedTeam} onChanged={load} />
      )}
    </>
  );
}

function TeamDetail({ team, onChanged }: { team: Team; onChanged: () => void }) {
  const [members, setMembers] = useState<Membership[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState<'reader' | 'writer'>('reader');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [m, u] = await Promise.all([
        teamApiService.listMembers(team.teamId),
        teamApiService.listUsers(),
      ]);
      setMembers(m);
      setUsers(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load members');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [team.teamId]);

  const memberIds = new Set(members.map(m => m.userId));
  // Admins implicitly have writer-level access on every team. They are
  // excluded from the candidate list to avoid confusion.
  const candidates = users.filter(u => !u.isAdmin && !memberIds.has(u.userId));

  const add = async () => {
    if (!addUserId) return;
    try {
      setBusy(true);
      await teamApiService.addMember(team.teamId, addUserId, addRole);
      setAddUserId('');
      await load();
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to add member'); }
    finally { setBusy(false); }
  };

  const updateRole = async (userId: string, role: 'reader' | 'writer') => {
    try { await teamApiService.updateMemberRole(team.teamId, userId, role); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to update role'); }
  };

  const remove = async (userId: string) => {
    if (!confirm('Remove this member from the team?')) return;
    try { await teamApiService.removeMember(team.teamId, userId); await load(); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to remove'); }
  };

  return (
    <div className="adm-card">
      <div className="adm-card-header">
        <div className="adm-card-title">Members of {team.name}</div>
      </div>

      <div className="adm-card-body">
        {error && <div className="adm-error">{error}</div>}

        <div className="adm-form-row" style={{ marginBottom: 16 }}>
          <select
            className="adm-select adm-input--grow"
            value={addUserId}
            onChange={e => setAddUserId(e.target.value)}
            disabled={busy}
          >
            <option value="">Select user to add…</option>
            {candidates.map(u => (
              <option key={u.userId} value={u.userId}>{u.email}</option>
            ))}
          </select>
          <select className="adm-select" value={addRole} onChange={e => setAddRole(e.target.value as any)} disabled={busy}>
            <option value="reader">reader</option>
            <option value="writer">writer</option>
          </select>
          <button className="adm-btn adm-btn--primary" onClick={add} disabled={busy || !addUserId}>
            {busy ? 'Adding…' : 'Add member'}
          </button>
        </div>

        {loading ? <div className="adm-loading">Loading…</div> : members.length === 0 ? (
          <div className="adm-empty">No members yet.</div>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr><th>Email</th><th>Role</th><th>Added</th><th></th></tr>
              </thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.userId}>
                    <td>{m.email || m.userId}</td>
                    <td>
                      <select
                        className="adm-select"
                        value={m.role}
                        onChange={e => updateRole(m.userId, e.target.value as any)}
                      >
                        <option value="reader">reader</option>
                        <option value="writer">writer</option>
                      </select>
                    </td>
                    <td className="adm-cell-muted">{new Date(m.addedAt).toLocaleDateString()}</td>
                    <td className="adm-cell-actions">
                      <button className="adm-btn adm-btn--danger" onClick={() => remove(m.userId)}>Remove</button>
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
}

// ---------- Audit log ----------

function AuditTab() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      setEvents(await teamApiService.listAuditLog());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <>
      <div className="adm-page-header">
        <div>
          <div className="adm-page-title">Audit log</div>
          <div className="adm-page-sub">Every admin action that creates, removes, or changes access.</div>
        </div>
        <button className="adm-btn" onClick={load} disabled={loading}>Refresh</button>
      </div>

      {error && <div className="adm-error">{error}</div>}

      <div className="adm-card">
        {loading ? <div className="adm-loading">Loading…</div> : events.length === 0 ? (
          <div className="adm-empty">No admin actions yet.</div>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map(ev => (
                  <tr key={ev.timestamp}>
                    <td className="adm-cell-muted">{new Date(ev.timestamp.split('#')[0]).toLocaleString()}</td>
                    <td>{ev.actorEmail || ev.actorUserId}</td>
                    <td><code style={{ fontSize: 12, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>{ev.action}</code></td>
                    <td>{ev.targetEmail || ev.targetUserId || ev.teamId || '—'}</td>
                    <td className="adm-cell-muted" style={{ fontSize: 11, maxWidth: 360, wordBreak: 'break-all' }}>
                      {ev.before && `before: ${JSON.stringify(ev.before)}`}
                      {ev.before && ev.after && ' · '}
                      {ev.after && `after: ${JSON.stringify(ev.after)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ---------- Workflow Changes Tab ----------

function WorkflowChangesTab() {
  const [entries, setEntries] = useState<WorkflowChangeEntry[]>([]);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterWorkflow, setFilterWorkflow] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [data, teams] = await Promise.all([
        teamApiService.listAllWorkflowChanges(
          filterWorkflow.trim() ? { workflowId: filterWorkflow.trim() } : undefined
        ),
        teamApiService.listTeams(),
      ]);
      setEntries(data);
      const nameMap: Record<string, string> = {};
      teams.forEach(t => { nameMap[t.teamId] = t.name; });
      setTeamNames(nameMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workflow changes');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const toggleExpand = (sk: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(sk) ? next.delete(sk) : next.add(sk);
      return next;
    });
  };

  const actionStyles: Record<ChangeAction, { bg: string; color: string; label: string }> = {
    created:          { bg: '#dbeafe', color: '#1e40af', label: 'Created' },
    saved:            { bg: '#f3f4f6', color: '#374151', label: 'Saved' },
    deploy_triggered: { bg: '#fef3c7', color: '#92400e', label: 'Deploy triggered' },
    deployed:         { bg: '#dcfce7', color: '#166534', label: 'Deployed' },
    deploy_failed:    { bg: '#fef2f2', color: '#b91c1c', label: 'Deploy failed' },
    delete_triggered: { bg: '#fef2f2', color: '#b91c1c', label: 'Delete triggered' },
    deleted:          { bg: '#f1f5f9', color: '#64748b', label: 'Deleted' },
  };

  return (
    <>
      <div className="adm-page-header">
        <div>
          <div className="adm-page-title">Workflow changes</div>
          <div className="adm-page-sub">Every save, deploy, and delete across all teams.</div>
        </div>
        <button className="adm-btn" onClick={load} disabled={loading}>Refresh</button>
      </div>

      <div className="adm-card">
        <div className="adm-card-body">
          <div className="adm-form-row">
            <input
              className="adm-input adm-input--grow"
              placeholder="Filter by workflow ID…"
              value={filterWorkflow}
              onChange={e => setFilterWorkflow(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && load()}
            />
            <button className="adm-btn adm-btn--primary" onClick={load} disabled={loading}>
              Search
            </button>
          </div>
        </div>
      </div>

      {error && <div className="adm-error">{error}</div>}

      <div className="adm-card">
        {loading ? <div className="adm-loading">Loading…</div> : entries.length === 0 ? (
          <div className="adm-empty">No workflow changes recorded yet.</div>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Workflow</th>
                  <th>Action</th>
                  <th>By</th>
                  <th>Team</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => {
                  const s = actionStyles[e.action] || actionStyles.saved;
                  const isOpen = expanded.has(e.sk);
                  const metaEntries = e.meta ? Object.entries(e.meta) : [];
                  return (
                    <React.Fragment key={e.sk}>
                      <tr style={{ background: isOpen ? '#f8fafc' : undefined }}>
                        <td className="adm-cell-muted" style={{ whiteSpace: 'nowrap' }}>
                          {new Date(e.timestamp).toLocaleString()}
                        </td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{e.workflowName}</div>
                          <div className="adm-cell-muted" style={{ fontSize: 11 }}>{e.workflowId}</div>
                        </td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 500, background: s.bg, color: s.color }}>
                            {s.label}
                          </span>
                        </td>
                        <td>{e.actorEmail || e.actorUserId}</td>
                        <td className="adm-cell-muted">
                          {teamNames[e.teamId] || e.teamId}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="adm-btn"
                            onClick={() => toggleExpand(e.sk)}
                            style={{ padding: '3px 8px', fontSize: 12 }}
                          >
                            {isOpen ? '▲ Less' : '▼ Details'}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${e.sk}-details`} style={{ background: '#f8fafc' }}>
                          <td colSpan={6} style={{ padding: '8px 16px 12px 32px' }}>
                            {e.changes ? (
                              <ChangeDiffView diff={e.changes} />
                            ) : metaEntries.length > 0 ? (
                              <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', fontSize: 12 }}>
                                {metaEntries.map(([k, v]) => (
                                  <React.Fragment key={k}>
                                    <dt style={{ color: '#64748b', fontWeight: 500 }}>{k}</dt>
                                    <dd style={{ margin: 0, color: '#374151', fontFamily: 'monospace', wordBreak: 'break-all' }}>{v}</dd>
                                  </React.Fragment>
                                ))}
                              </dl>
                            ) : (
                              <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>No additional details recorded.</span>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- Inline SVG icons ---------- */

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function TeamsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function WorkflowChangesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
