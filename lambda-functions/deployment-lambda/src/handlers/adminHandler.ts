import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
  DeleteCommand,
  UpdateCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminUserGlobalSignOutCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { createSuccessHeaders } from '../utils/auth';
import { resolveCaller, unauthenticated, forbidden, TeamRole, CallerIdentity } from '../utils/authz';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

const TEAMS_TABLE = process.env.TEAMS_TABLE || 'WorkflowBuilder-Teams';
const MEMBERSHIPS_TABLE = process.env.MEMBERSHIPS_TABLE || 'WorkflowBuilder-Memberships';
const ADMINS_TABLE = process.env.ADMINS_TABLE || 'WorkflowBuilder-Admins';
const ADMIN_AUDIT_LOG_TABLE = process.env.ADMIN_AUDIT_LOG_TABLE || 'WorkflowBuilder-AdminAuditLog';
const USER_POOL_ID = process.env.USER_POOL_ID || '';

const json = (statusCode: number, body: any): APIGatewayProxyResult => ({
  statusCode,
  headers: createSuccessHeaders(),
  body: JSON.stringify(body),
});

/**
 * Parse a JSON request body, distinguishing malformed input (-> 400) from a
 * valid-but-unexpected payload. Returns ok:false so callers can return a 400
 * rather than letting JSON.parse throw into the top-level 500 handler.
 */
function safeParseBody(body: string | null): { ok: true; value: any } | { ok: false } {
  if (!body) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false };
  }
}

/**
 * Single Lambda router for all /admin/* endpoints. Every operation:
 *   1. Verifies the caller is in the 'admins' Cognito group.
 *   2. Performs the requested action against DynamoDB / Cognito.
 *   3. Writes an entry to the AdminAuditLog table for non-read actions.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Admin handler:', JSON.stringify({ method: event.httpMethod, resource: event.resource, path: event.path, params: event.pathParameters }, null, 2));

  try {
    const caller = await resolveCaller(event);
    if (!caller) return unauthenticated();
    if (!caller.isAdmin) return forbidden('Admin access required');

    // Bootstrap self-heal: if this caller is admin only via the Cognito-group
    // fallback (no durable Admins row yet), persist their row now. This makes
    // the single console-bootstrapped admin durable BEFORE they can promote
    // anyone else — a promote seeds another admin row and flips "zero admins"
    // to false, which would otherwise revoke a fallback-only admin's own
    // access on their next request. Writing here closes that gap.
    if (caller.adminViaFallback) {
      await ensureAdminRecord(caller, caller, 'admin.bootstrap_self_heal');
    }

    const method = event.httpMethod;
    const resource = event.resource || '';

    if (resource.endsWith('/admin/teams') && method === 'GET') return await listTeams();
    if (resource.endsWith('/admin/teams') && method === 'POST') return await createTeam(event, caller);
    if (resource.endsWith('/admin/teams/{teamId}') && method === 'GET') return await getTeam(event);
    if (resource.endsWith('/admin/teams/{teamId}') && method === 'DELETE') return await deleteTeam(event, caller);

    if (resource.endsWith('/admin/teams/{teamId}/members') && method === 'GET') return await listMembers(event);
    if (resource.endsWith('/admin/teams/{teamId}/members') && method === 'POST') return await addMember(event, caller);
    if (resource.endsWith('/admin/teams/{teamId}/members/{userId}') && method === 'PATCH') return await updateMember(event, caller);
    if (resource.endsWith('/admin/teams/{teamId}/members/{userId}') && method === 'DELETE') return await removeMember(event, caller);

    if (resource.endsWith('/admin/users') && method === 'GET') return await listUsers();
    if (resource.endsWith('/admin/users/{userId}/admin') && method === 'POST') return await promoteAdmin(event, caller);
    if (resource.endsWith('/admin/users/{userId}/admin') && method === 'DELETE') return await demoteAdmin(event, caller);

    if (resource.endsWith('/admin/audit-log') && method === 'GET') return await listAuditLog(event);

    return json(404, { error: 'Route not found' });
  } catch (error) {
    // Log full detail to CloudWatch, but don't leak internal error text to the
    // client (could expose table names, ARNs, SDK internals, etc.).
    console.error('Admin handler error:', error);
    return json(500, { error: 'Internal server error' });
  }
};

// ----- Teams -----

async function listTeams(): Promise<APIGatewayProxyResult> {
  const teamsResp = await docClient.send(new ScanCommand({ TableName: TEAMS_TABLE }));
  const teams = teamsResp.Items || [];

  // Tally member counts in a single pass over the memberships table instead of
  // one COUNT query per team (avoids an N+1 as team count grows).
  const countByTeam = new Map<string, number>();
  let lastKey: Record<string, any> | undefined;
  do {
    const resp = await docClient.send(new ScanCommand({
      TableName: MEMBERSHIPS_TABLE,
      ProjectionExpression: 'teamId',
      ExclusiveStartKey: lastKey,
    }));
    for (const m of resp.Items || []) {
      if (m.teamId) countByTeam.set(m.teamId, (countByTeam.get(m.teamId) || 0) + 1);
    }
    lastKey = resp.LastEvaluatedKey;
  } while (lastKey);

  const enriched = teams.map(t => ({
    ...t,
    memberCount: countByTeam.get(t.teamId as string) || 0,
  }));

  return json(200, { teams: enriched });
}

async function createTeam(event: APIGatewayProxyEvent, caller: any): Promise<APIGatewayProxyResult> {
  if (!event.body) return json(400, { error: 'Request body required' });
  const parsed = safeParseBody(event.body);
  if (!parsed.ok) return json(400, { error: 'Invalid JSON in request body' });
  const { name, description } = parsed.value;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return json(400, { error: 'Team name is required' });
  }

  const teamId = `team-${randomUUID()}`;
  const now = new Date().toISOString();
  const team = {
    teamId,
    name: name.trim(),
    description: description || '',
    createdAt: now,
    createdBy: caller.userId,
    createdByEmail: caller.email,
  };

  await docClient.send(new PutCommand({ TableName: TEAMS_TABLE, Item: team }));
  await writeAudit(caller, 'team.create', { teamId, after: team });

  return json(201, { team });
}

async function getTeam(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const teamId = event.pathParameters?.teamId;
  if (!teamId) return json(400, { error: 'teamId required' });
  const resp = await docClient.send(new GetCommand({ TableName: TEAMS_TABLE, Key: { teamId } }));
  if (!resp.Item) return json(404, { error: 'Team not found' });
  return json(200, { team: resp.Item });
}

async function deleteTeam(event: APIGatewayProxyEvent, caller: any): Promise<APIGatewayProxyResult> {
  const teamId = event.pathParameters?.teamId;
  if (!teamId) return json(400, { error: 'teamId required' });

  // Close the TOCTOU between the member check and the delete: first atomically
  // flag the team as 'deleting' (404 if it doesn't exist). addMember runs a
  // conditional transaction that refuses to add to a team in this state, so
  // once the flag is set the subsequent member count is stable.
  let before: Record<string, any> | undefined;
  try {
    const marked = await docClient.send(new UpdateCommand({
      TableName: TEAMS_TABLE,
      Key: { teamId },
      UpdateExpression: 'SET #st = :deleting',
      ConditionExpression: 'attribute_exists(teamId)',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':deleting': 'deleting' },
      ReturnValues: 'ALL_OLD',
    }));
    before = marked.Attributes;
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') return json(404, { error: 'Team not found' });
    throw err;
  }

  // Refuse if any members remain — caller must remove them first to avoid
  // accidental mass-revocation. Safe now that no new members can be added.
  const members = await docClient.send(new QueryCommand({
    TableName: MEMBERSHIPS_TABLE,
    KeyConditionExpression: 'teamId = :t',
    ExpressionAttributeValues: { ':t': teamId },
    Select: 'COUNT',
  }));
  if ((members.Count || 0) > 0) {
    // Roll back the flag so the team stays usable.
    await docClient.send(new UpdateCommand({
      TableName: TEAMS_TABLE,
      Key: { teamId },
      UpdateExpression: 'REMOVE #st',
      ExpressionAttributeNames: { '#st': 'status' },
    }));
    return json(409, { error: 'Team still has members; remove them before deleting the team' });
  }

  await docClient.send(new DeleteCommand({ TableName: TEAMS_TABLE, Key: { teamId } }));
  await writeAudit(caller, 'team.delete', { teamId, before });

  return json(200, { message: 'Team deleted' });
}

// ----- Members -----

async function listMembers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const teamId = event.pathParameters?.teamId;
  if (!teamId) return json(400, { error: 'teamId required' });
  const resp = await docClient.send(new QueryCommand({
    TableName: MEMBERSHIPS_TABLE,
    KeyConditionExpression: 'teamId = :t',
    ExpressionAttributeValues: { ':t': teamId },
  }));
  return json(200, { members: resp.Items || [] });
}

async function addMember(event: APIGatewayProxyEvent, caller: any): Promise<APIGatewayProxyResult> {
  const teamId = event.pathParameters?.teamId;
  if (!teamId) return json(400, { error: 'teamId required' });
  if (!event.body) return json(400, { error: 'Request body required' });

  const parsed = safeParseBody(event.body);
  if (!parsed.ok) return json(400, { error: 'Invalid JSON in request body' });
  const { userId, role } = parsed.value;
  if (!userId || !isValidRole(role)) {
    return json(400, { error: 'userId and role (reader|writer) required' });
  }

  const team = await docClient.send(new GetCommand({ TableName: TEAMS_TABLE, Key: { teamId } }));
  if (!team.Item) return json(404, { error: 'Team not found' });

  const cognitoUser = await fetchCognitoUser(userId);
  if (!cognitoUser) return json(404, { error: 'User not found in Cognito' });

  // Admins implicitly have writer-level access to every team. Adding one as
  // a per-team reader/writer would be confusing (their effective role doesn't
  // change) and creates a stale Memberships row if they're later demoted.
  // Reject the attempt outright. Admin status now lives in the Admins table.
  if (await isAdminUserId(userId)) {
    return json(409, {
      error: 'This user is an admin and already has access to every team. Demote them from admin first if you want to scope their access to specific teams.',
    });
  }

  const membership = {
    teamId,
    userId,
    role,
    email: cognitoUser.email,
    addedAt: new Date().toISOString(),
    addedBy: caller.userId,
    addedByEmail: caller.email,
  };
  // Write the membership only if the team still exists and isn't mid-deletion,
  // as a single transaction. This closes the race with deleteTeam: once that
  // flags the team 'deleting', this ConditionCheck fails and no orphaned
  // membership can be created.
  try {
    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          ConditionCheck: {
            TableName: TEAMS_TABLE,
            Key: { teamId },
            ConditionExpression:
              'attribute_exists(teamId) AND (attribute_not_exists(#st) OR #st <> :deleting)',
            ExpressionAttributeNames: { '#st': 'status' },
            ExpressionAttributeValues: { ':deleting': 'deleting' },
          },
        },
        { Put: { TableName: MEMBERSHIPS_TABLE, Item: membership } },
      ],
    }));
  } catch (err: any) {
    if (err?.name === 'TransactionCanceledException') {
      return json(409, { error: 'Team is no longer available (it may be being deleted). Refresh and try again.' });
    }
    throw err;
  }
  await writeAudit(caller, 'member.add', { teamId, targetUserId: userId, after: membership });

  return json(201, { membership });
}

async function updateMember(event: APIGatewayProxyEvent, caller: any): Promise<APIGatewayProxyResult> {
  const teamId = event.pathParameters?.teamId;
  const userId = event.pathParameters?.userId;
  if (!teamId || !userId) return json(400, { error: 'teamId and userId required' });
  if (!event.body) return json(400, { error: 'Request body required' });
  const parsed = safeParseBody(event.body);
  if (!parsed.ok) return json(400, { error: 'Invalid JSON in request body' });
  const { role } = parsed.value;
  if (!isValidRole(role)) return json(400, { error: 'role (reader|writer) required' });

  const before = await docClient.send(new GetCommand({ TableName: MEMBERSHIPS_TABLE, Key: { teamId, userId } }));
  if (!before.Item) return json(404, { error: 'Membership not found' });

  await docClient.send(new UpdateCommand({
    TableName: MEMBERSHIPS_TABLE,
    Key: { teamId, userId },
    UpdateExpression: 'SET #r = :r, updatedAt = :u, updatedBy = :ub, updatedByEmail = :ube',
    ExpressionAttributeNames: { '#r': 'role' },
    ExpressionAttributeValues: {
      ':r': role,
      ':u': new Date().toISOString(),
      ':ub': caller.userId,
      ':ube': caller.email,
    },
  }));
  await writeAudit(caller, 'member.role_change', {
    teamId,
    targetUserId: userId,
    before: { role: before.Item.role },
    after: { role },
  });

  return json(200, { teamId, userId, role });
}

async function removeMember(event: APIGatewayProxyEvent, caller: any): Promise<APIGatewayProxyResult> {
  const teamId = event.pathParameters?.teamId;
  const userId = event.pathParameters?.userId;
  if (!teamId || !userId) return json(400, { error: 'teamId and userId required' });

  const before = await docClient.send(new GetCommand({ TableName: MEMBERSHIPS_TABLE, Key: { teamId, userId } }));
  if (!before.Item) return json(404, { error: 'Membership not found' });

  await docClient.send(new DeleteCommand({ TableName: MEMBERSHIPS_TABLE, Key: { teamId, userId } }));
  await writeAudit(caller, 'member.remove', { teamId, targetUserId: userId, before: before.Item });

  // Defense-in-depth: globally sign the removed member out. Their team access
  // is already revoked on their next request by the live read in
  // resolveCaller; this additionally invalidates their refresh token so they
  // can't continue an existing session indefinitely. Best-effort.
  await globalSignOut(userId);

  return json(200, { message: 'Member removed' });
}

// ----- Users / admin promotion -----

async function listUsers(): Promise<APIGatewayProxyResult> {
  const users: any[] = [];
  let token: string | undefined;
  do {
    const resp = await cognitoClient.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Limit: 60,
      PaginationToken: token,
    }));
    for (const u of resp.Users || []) {
      const attrs: Record<string, string> = {};
      (u.Attributes || []).forEach(a => { if (a.Name && a.Value) attrs[a.Name] = a.Value; });
      users.push({
        userId: attrs.sub || u.Username,
        username: u.Username,
        email: attrs.email || '',
        emailVerified: attrs.email_verified === 'true',
        enabled: u.Enabled,
        status: u.UserStatus,
        createdAt: u.UserCreateDate?.toISOString(),
      });
    }
    token = resp.PaginationToken;
  } while (token);

  // Mark admins so the UI can highlight them. Admin status is authoritative in
  // the Admins table (keyed by Cognito sub), so badges stay correct after a
  // promote/demote rather than lagging behind a Cognito group membership.
  const adminIds = await loadAllAdminIds();
  for (const u of users) {
    u.isAdmin = adminIds.has(u.userId);
  }

  return json(200, { users });
}

async function promoteAdmin(event: APIGatewayProxyEvent, caller: CallerIdentity): Promise<APIGatewayProxyResult> {
  const userId = event.pathParameters?.userId;
  if (!userId) return json(400, { error: 'userId required' });

  // userId is the Cognito sub. Resolve the user so we can store their email
  // on the admin record for display/audit.
  const cognitoUser = await fetchCognitoUser(userId);
  if (!cognitoUser) return json(404, { error: 'User not found' });

  if (await isAdminUserId(userId)) {
    return json(409, { error: 'User is already an admin' });
  }

  await docClient.send(new PutCommand({
    TableName: ADMINS_TABLE,
    Item: {
      userId,
      email: cognitoUser.email,
      addedAt: new Date().toISOString(),
      addedBy: caller.userId,
      addedByEmail: caller.email,
    },
  }));
  await writeAudit(caller, 'admin.promote', { targetUserId: userId, targetEmail: cognitoUser.email });

  return json(200, { message: 'User promoted to admin' });
}

async function demoteAdmin(event: APIGatewayProxyEvent, caller: CallerIdentity): Promise<APIGatewayProxyResult> {
  const userId = event.pathParameters?.userId;
  if (!userId) return json(400, { error: 'userId required' });

  if (!(await isAdminUserId(userId))) {
    return json(404, { error: 'User is not an admin' });
  }

  // Last-admin guard: refuse the demotion if it would leave zero admins.
  const adminCount = await countAdmins();
  if (adminCount <= 1) {
    return json(409, { error: 'Cannot remove the last admin. Promote another user to admin first.' });
  }

  const cognitoUser = await fetchCognitoUser(userId);

  await docClient.send(new DeleteCommand({
    TableName: ADMINS_TABLE,
    Key: { userId },
  }));
  await writeAudit(caller, 'admin.demote', { targetUserId: userId, targetEmail: cognitoUser?.email });

  // Defense-in-depth: globally sign the user out so they can't mint fresh
  // tokens via their refresh token. Note this does NOT instantly invalidate
  // their current access token at the offline API Gateway authorizer — the
  // live admin read in resolveCaller is what revokes their admin powers on
  // their next request. Best-effort; never fail the demotion on sign-out error.
  if (cognitoUser) {
    try {
      await cognitoClient.send(new AdminUserGlobalSignOutCommand({
        UserPoolId: USER_POOL_ID,
        Username: cognitoUser.username,
      }));
    } catch (error) {
      console.warn('Global sign-out after demotion failed (non-fatal):', error);
    }
  }

  return json(200, { message: 'Admin demoted' });
}

// ----- Audit log -----

async function listAuditLog(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const qp = event.queryStringParameters || {};
  const limit = Math.min(parseInt(qp.limit || '100'), 500);
  const actorUserId = qp.actorUserId;

  if (actorUserId) {
    const resp = await docClient.send(new QueryCommand({
      TableName: ADMIN_AUDIT_LOG_TABLE,
      IndexName: 'ActorIndex',
      KeyConditionExpression: 'actorUserId = :a',
      ExpressionAttributeValues: { ':a': actorUserId },
      ScanIndexForward: false,
      Limit: limit,
    }));
    return json(200, { events: resp.Items || [] });
  }

  const resp = await docClient.send(new QueryCommand({
    TableName: ADMIN_AUDIT_LOG_TABLE,
    KeyConditionExpression: 'pk = :p',
    ExpressionAttributeValues: { ':p': 'AUDIT' },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return json(200, { events: resp.Items || [] });
}

// ----- Helpers -----

function isValidRole(role: any): role is TeamRole {
  return role === 'reader' || role === 'writer';
}

/** True if a durable admin row exists for this Cognito sub. */
async function isAdminUserId(userId: string): Promise<boolean> {
  const resp = await docClient.send(new GetCommand({ TableName: ADMINS_TABLE, Key: { userId } }));
  return !!resp.Item;
}

/** Count of admin rows. Used by the last-admin guard. */
async function countAdmins(): Promise<number> {
  let count = 0;
  let lastKey: Record<string, any> | undefined;
  do {
    const resp = await docClient.send(new ScanCommand({
      TableName: ADMINS_TABLE,
      Select: 'COUNT',
      ExclusiveStartKey: lastKey,
    }));
    count += resp.Count || 0;
    lastKey = resp.LastEvaluatedKey;
  } while (lastKey);
  return count;
}

/** All admin Cognito subs, for marking the user list. */
async function loadAllAdminIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  let lastKey: Record<string, any> | undefined;
  do {
    const resp = await docClient.send(new ScanCommand({
      TableName: ADMINS_TABLE,
      ProjectionExpression: 'userId',
      ExclusiveStartKey: lastKey,
    }));
    for (const item of resp.Items || []) {
      if (item.userId) ids.add(item.userId as string);
    }
    lastKey = resp.LastEvaluatedKey;
  } while (lastKey);
  return ids;
}

/**
 * Idempotently write the admin row for a user if it doesn't already exist.
 * Used by the bootstrap self-heal path. Best-effort: a failure here must not
 * break the privileged action the caller actually requested.
 */
async function ensureAdminRecord(
  target: CallerIdentity,
  actor: CallerIdentity,
  auditAction: string
): Promise<void> {
  try {
    await docClient.send(new PutCommand({
      TableName: ADMINS_TABLE,
      Item: {
        userId: target.userId,
        email: target.email,
        addedAt: new Date().toISOString(),
        addedBy: actor.userId,
        addedByEmail: actor.email,
        bootstrap: true,
      },
      ConditionExpression: 'attribute_not_exists(userId)',
    }));
    await writeAudit(actor, auditAction, { targetUserId: target.userId, targetEmail: target.email });
  } catch (error: any) {
    // ConditionalCheckFailed => row already exists (another request healed it
    // first). Anything else is logged but swallowed so the request proceeds.
    if (error?.name !== 'ConditionalCheckFailedException') {
      console.warn('Admin self-heal write failed (non-fatal):', error);
    }
  }
}

/** Best-effort global sign-out by Cognito sub. Never throws. */
async function globalSignOut(userId: string): Promise<void> {
  try {
    const user = await fetchCognitoUser(userId);
    if (!user) return;
    await cognitoClient.send(new AdminUserGlobalSignOutCommand({
      UserPoolId: USER_POOL_ID,
      Username: user.username,
    }));
  } catch (error) {
    console.warn('Global sign-out failed (non-fatal):', error);
  }
}

async function fetchCognitoUser(userId: string): Promise<{ username: string; email: string } | null> {
  // userId may be Cognito sub or username. AdminGetUser takes the username
  // which in our pool is the email — but we store sub in DynamoDB.
  // Resolve via ListUsers filter on the sub attribute.
  try {
    const resp = await cognitoClient.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `sub = "${userId}"`,
      Limit: 1,
    }));
    const u = resp.Users?.[0];
    if (!u) return null;
    const attrs: Record<string, string> = {};
    (u.Attributes || []).forEach(a => { if (a.Name && a.Value) attrs[a.Name] = a.Value; });
    return { username: u.Username || '', email: attrs.email || '' };
  } catch (error) {
    console.error('fetchCognitoUser failed:', error);
    return null;
  }
}

async function writeAudit(
  caller: { userId: string; email: string },
  action: string,
  details: { teamId?: string; targetUserId?: string; targetEmail?: string; before?: any; after?: any }
): Promise<void> {
  try {
    const timestamp = `${new Date().toISOString()}#${randomUUID()}`;
    await docClient.send(new PutCommand({
      TableName: ADMIN_AUDIT_LOG_TABLE,
      Item: {
        pk: 'AUDIT',
        timestamp,
        actorUserId: caller.userId,
        actorEmail: caller.email,
        action,
        ...details,
      },
    }));
  } catch (error) {
    // Don't fail the operation just because audit logging failed; surface as a warning.
    console.warn('Audit log write failed:', error);
  }
}
