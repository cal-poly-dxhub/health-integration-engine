import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { extractUserIdFromEvent, createSuccessHeaders } from './auth';

export type TeamRole = 'reader' | 'writer';

export interface TeamMembership {
  teamId: string;
  role: TeamRole;
}

export interface CallerIdentity {
  userId: string;
  email: string;
  isAdmin: boolean;
  teams: TeamMembership[];
  /**
   * True when admin came ONLY from the Cognito-group bootstrap (no durable
   * Admins row yet); adminHandler self-heals a row on first use. See resolveCaller.
   */
  adminViaFallback: boolean;
}

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const MEMBERSHIPS_TABLE = process.env.MEMBERSHIPS_TABLE || 'WorkflowBuilder-Memberships';
const ADMINS_TABLE = process.env.ADMINS_TABLE || 'WorkflowBuilder-Admins';

/**
 * Resolve the caller's identity, admin status, and team memberships.
 *
 * Authorization is LIVE: roles + admin are read from DynamoDB on every request,
 * never from JWT claims, so membership/role/admin changes take effect on the
 * caller's next request. Fails CLOSED — a DynamoDB read error yields no teams /
 * not admin rather than trusting a stale claim.
 *
 * isAdmin = hasDdbAdminRow OR (inCognitoAdminsGroup AND zeroDdbAdmins); the
 * group clause is a one-shot bootstrap that's dead once any admin row exists.
 */
export async function resolveCaller(event: APIGatewayProxyEvent): Promise<CallerIdentity | null> {
  const userId = extractUserIdFromEvent(event);
  if (!userId) return null;

  const claims = event.requestContext.authorizer?.claims || {};
  const email = (claims.email as string) || '';

  // Cognito groups arrive as a stringified array, e.g. "[admins,team-abc]".
  // Used ONLY for the zero-admins bootstrap fallback, never as the primary
  // admin source.
  const groupsRaw = (claims['cognito:groups'] as string) || '';
  const inCognitoAdminsGroup = parseCognitoGroups(groupsRaw).includes('admins');

  // Live reads, in parallel: team memberships + this user's admin record.
  const [teams, hasAdminRecord] = await Promise.all([
    loadMembershipsForUser(userId),
    hasAdminRecordForUser(userId),
  ]);

  let isAdmin = hasAdminRecord;
  let adminViaFallback = false;
  if (!isAdmin && inCognitoAdminsGroup && (await zeroAdminsExist())) {
    isAdmin = true;
    adminViaFallback = true;
  }

  return { userId, email, isAdmin, teams, adminViaFallback };
}

/**
 * Live lookup against the Memberships table by userId GSI. Returns the empty
 * list (fail-closed) on error so a transient DynamoDB issue denies access
 * rather than granting stale permissions.
 */
export async function loadMembershipsForUser(userId: string): Promise<TeamMembership[]> {
  try {
    const response = await docClient.send(new QueryCommand({
      TableName: MEMBERSHIPS_TABLE,
      IndexName: 'UserIdIndex',
      KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': userId },
    }));
    return (response.Items || []).map(item => ({
      teamId: item.teamId,
      role: (item.role as TeamRole) || 'reader',
    }));
  } catch (error) {
    console.error('Failed to load memberships for user', userId, error);
    return [];
  }
}

/**
 * True if a durable admin record exists for this user. Fail-closed on error.
 */
export async function hasAdminRecordForUser(userId: string): Promise<boolean> {
  try {
    const response = await docClient.send(new GetCommand({
      TableName: ADMINS_TABLE,
      Key: { userId },
    }));
    return !!response.Item;
  } catch (error) {
    console.error('Failed to load admin record for user', userId, error);
    return false;
  }
}

/**
 * True if there are NO admin rows in the Admins table. Only consulted on the
 * bootstrap fallback path (a Cognito admins-group member with no row yet).
 * Fail-closed on error: returns false so the fallback does NOT grant admin.
 */
export async function zeroAdminsExist(): Promise<boolean> {
  try {
    const response = await docClient.send(new ScanCommand({
      TableName: ADMINS_TABLE,
      Select: 'COUNT',
      Limit: 1,
    }));
    return (response.Count || 0) === 0;
  } catch (error) {
    console.error('Failed to count admins', error);
    return false;
  }
}

/**
 * Returns true if the caller can read the given team (admin OR any role on the team).
 */
export function canReadTeam(caller: CallerIdentity, teamId: string): boolean {
  if (caller.isAdmin) return true;
  return caller.teams.some(t => t.teamId === teamId);
}

/**
 * Returns true if the caller can write to the given team (admin OR writer on the team).
 */
export function canWriteTeam(caller: CallerIdentity, teamId: string): boolean {
  if (caller.isAdmin) return true;
  return caller.teams.some(t => t.teamId === teamId && t.role === 'writer');
}

/**
 * Set of team IDs the caller can read. Empty when the caller is a pending user.
 * Admins return null to signal "all teams" — callers must handle the null case.
 */
export function readableTeamIds(caller: CallerIdentity): string[] | null {
  if (caller.isAdmin) return null;
  return caller.teams.map(t => t.teamId);
}

/**
 * Standard 401 response for unauthenticated callers.
 */
export function unauthenticated(message: string = 'Authentication required'): APIGatewayProxyResult {
  return {
    statusCode: 401,
    headers: createSuccessHeaders(),
    body: JSON.stringify({ error: 'Unauthorized', message }),
  };
}

/**
 * Standard 403 response when the caller lacks permission.
 */
export function forbidden(message: string = 'Forbidden'): APIGatewayProxyResult {
  return {
    statusCode: 403,
    headers: createSuccessHeaders(),
    body: JSON.stringify({ error: 'Forbidden', message }),
  };
}

/**
 * Extract the owning workflowId from a Step Functions state-machine or
 * execution ARN. Per-workflow state machines are named `SF-<workflowId>`
 * (see cloudFormationTemplateGenerator: `StateMachineName: SF-${WorkflowId}`),
 * so the workflowId is recoverable from the ARN without a lookup.
 *
 * Handles both ARN shapes (alias suffix tolerated):
 *   arn:aws:states:<region>:<acct>:stateMachine:SF-<workflowId>[:<alias>]
 *   arn:aws:states:<region>:<acct>:execution:SF-<workflowId>:<executionName>
 *
 * Returns null for anything that is not a workflow state machine — e.g. the
 * internal deployment/deletion state machines (`workflow-builder-*`) or a
 * malformed ARN — so callers can deny access to non-workflow resources rather
 * than fail open.
 */
export function parseWorkflowIdFromSfnArn(arn: string | undefined | null): string | null {
  if (!arn || typeof arn !== 'string') return null;
  const parts = arn.split(':');
  // arn:aws:states:<region>:<account>:<resourceType>:<name>[:<extra>]
  // parts[5] = resourceType, parts[6] = state-machine name (or alias base).
  if (parts.length < 7) return null;
  const resourceType = parts[5];
  if (resourceType !== 'stateMachine' && resourceType !== 'execution') return null;
  const name = parts[6];
  if (!name || !name.startsWith('SF-')) return null;
  const workflowId = name.slice('SF-'.length);
  return workflowId.length > 0 ? workflowId : null;
}

/**
 * Cognito serializes the groups claim as e.g. "[admins,team-abc]". Parse it
 * defensively to a plain string array.
 */
function parseCognitoGroups(raw: string): string[] {
  if (!raw) return [];
  // Already a JSON array
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // fall through to bracket-split
    }
    // Cognito ID-token style: "[a,b,c]" — not valid JSON
    return raw.replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean);
  }
  // Comma- or space-separated
  return raw.split(/[ ,]+/).map(s => s.trim()).filter(Boolean);
}
