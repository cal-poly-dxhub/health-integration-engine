import { apiService } from './api';

export interface MyTeam {
  teamId: string;
  name: string;
  role: 'reader' | 'writer';
}

export interface MeResponse {
  userId: string;
  email: string;
  isAdmin: boolean;
  teams: MyTeam[];
  pending: boolean;
}

export interface Team {
  teamId: string;
  name: string;
  description?: string;
  createdAt: string;
  createdBy: string;
  createdByEmail: string;
  memberCount?: number;
}

export interface Membership {
  teamId: string;
  userId: string;
  role: 'reader' | 'writer';
  email?: string;
  addedAt: string;
  addedBy: string;
  addedByEmail: string;
}

export interface AdminUser {
  userId: string;
  username: string;
  email: string;
  emailVerified: boolean;
  enabled?: boolean;
  status?: string;
  createdAt?: string;
  isAdmin: boolean;
}

export type ChangeAction =
  | 'created'
  | 'saved'
  | 'deploy_triggered'
  | 'deployed'
  | 'deploy_failed'
  | 'delete_triggered'
  | 'deleted';

// ----- Structured workflow change diff (mirrors deployment-lambda workflowDiff.ts) -----
export interface FieldChange {
  key: string;
  label: string;
  from: string | null;
  to: string | null;
  kind: 'value' | 'code' | 'masked';
  linesAdded?: number;
  linesRemoved?: number;
  // oldCode/newCode are persisted for the audit record but intentionally not rendered.
  oldCode?: string;
  newCode?: string;
}

export interface NodeRef {
  nodeId: string;
  name: string;
  nodeType: string;
}

export interface NodeModification {
  nodeId: string;
  name: string;
  nodeType: string;
  renamedFrom?: string;
  fields: FieldChange[];
}

export interface ConnectionRef {
  from: string;
  to: string;
}

export interface WorkflowDiff {
  createdNodeCount?: number;
  workflowFields?: FieldChange[];
  nodesAdded?: NodeRef[];
  nodesRemoved?: NodeRef[];
  nodesModified?: NodeModification[];
  connectionsAdded?: ConnectionRef[];
  connectionsRemoved?: ConnectionRef[];
}

export interface WorkflowChangeEntry {
  workflowId: string;
  sk: string;
  timestamp: string;
  action: ChangeAction;
  actorUserId: string;
  actorEmail: string;
  teamId: string;
  workflowName: string;
  meta?: Record<string, string>;
  changes?: WorkflowDiff;
}

export interface AuditEvent {
  pk: string;
  timestamp: string;
  actorUserId: string;
  actorEmail: string;
  action: string;
  teamId?: string;
  targetUserId?: string;
  targetEmail?: string;
  before?: any;
  after?: any;
}

class TeamApiService {
  // ----- /me -----
  async getMe(): Promise<MeResponse> {
    return apiService.get<MeResponse>('/me/teams');
  }

  // ----- Admin: teams -----
  async listTeams(): Promise<Team[]> {
    const r = await apiService.get<{ teams: Team[] }>('/admin/teams');
    return r.teams;
  }

  async createTeam(name: string, description?: string): Promise<Team> {
    const r = await apiService.post<{ team: Team }>('/admin/teams', { name, description });
    return r.team;
  }

  async deleteTeam(teamId: string): Promise<void> {
    await apiService.delete(`/admin/teams/${teamId}`);
  }

  // ----- Admin: members -----
  async listMembers(teamId: string): Promise<Membership[]> {
    const r = await apiService.get<{ members: Membership[] }>(`/admin/teams/${teamId}/members`);
    return r.members;
  }

  async addMember(teamId: string, userId: string, role: 'reader' | 'writer'): Promise<Membership> {
    const r = await apiService.post<{ membership: Membership }>(`/admin/teams/${teamId}/members`, { userId, role });
    return r.membership;
  }

  async updateMemberRole(teamId: string, userId: string, role: 'reader' | 'writer'): Promise<void> {
    await apiService.patch(`/admin/teams/${teamId}/members/${userId}`, { role });
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    await apiService.delete(`/admin/teams/${teamId}/members/${userId}`);
  }

  // ----- Admin: users -----
  async listUsers(): Promise<AdminUser[]> {
    const r = await apiService.get<{ users: AdminUser[] }>('/admin/users');
    return r.users;
  }

  async promoteAdmin(userId: string): Promise<void> {
    await apiService.post(`/admin/users/${userId}/admin`, {});
  }

  async demoteAdmin(userId: string): Promise<void> {
    await apiService.delete(`/admin/users/${userId}/admin`);
  }

  // ----- Admin: audit log -----
  async listAuditLog(actorUserId?: string): Promise<AuditEvent[]> {
    const url = actorUserId ? `/admin/audit-log?actorUserId=${encodeURIComponent(actorUserId)}` : '/admin/audit-log';
    const r = await apiService.get<{ events: AuditEvent[] }>(url);
    return r.events;
  }

  // ----- Workflow changelog -----
  async getWorkflowChangelog(workflowId: string): Promise<WorkflowChangeEntry[]> {
    const r = await apiService.get<{ entries: WorkflowChangeEntry[] }>(`/workflows/${workflowId}/changelog`);
    return r.entries;
  }

  // ----- Admin: all workflow changes -----
  async listAllWorkflowChanges(opts?: { workflowId?: string; actorUserId?: string }): Promise<WorkflowChangeEntry[]> {
    const params = new URLSearchParams();
    if (opts?.workflowId) params.set('workflowId', opts.workflowId);
    if (opts?.actorUserId) params.set('actorUserId', opts.actorUserId);
    const url = `/admin/workflow-changes${params.toString() ? `?${params.toString()}` : ''}`;
    const r = await apiService.get<{ entries: WorkflowChangeEntry[] }>(url);
    return r.entries;
  }
}

export const teamApiService = new TeamApiService();
export default teamApiService;
