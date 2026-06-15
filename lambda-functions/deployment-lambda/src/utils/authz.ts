import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
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
}

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const MEMBERSHIPS_TABLE = process.env.MEMBERSHIPS_TABLE || 'WorkflowBuilder-Memberships';

/**
 * Resolve the calling user's identity, admin status, and team memberships.
 *
 * Reads team membership claims that the PreTokenGeneration trigger injects
 * into the JWT (`teams` and `team_roles`). If those claims are missing — for
 * example on a stale token before the next sign-in — falls back to a live
 * lookup against the Memberships table.
 */
export async function resolveCaller(event: APIGatewayProxyEvent): Promise<CallerIdentity | null> {
  const userId = extractUserIdFromEvent(event);
  if (!userId) return null;

  const claims = event.requestContext.authorizer?.claims || {};
  const email = (claims.email as string) || '';

  // Cognito groups arrive as a stringified array, e.g. "[admins,team-abc]"
  const groupsRaw = (claims['cognito:groups'] as string) || '';
  const groups = parseCognitoGroups(groupsRaw);
  const isAdmin = groups.includes('admins');

  // PreTokenGen trigger injects "team_roles" as a JSON string of {teamId: role} pairs.
  let teams: TeamMembership[] = [];
  const teamRolesClaim = claims['team_roles'];
  if (typeof teamRolesClaim === 'string' && teamRolesClaim.length > 0) {
    try {
      const parsed = JSON.parse(teamRolesClaim) as Record<string, TeamRole>;
      teams = Object.entries(parsed).map(([teamId, role]) => ({ teamId, role }));
    } catch {
      // fall through to live lookup
    }
  }

  if (teams.length === 0) {
    teams = await loadMembershipsForUser(userId);
  }

  return { userId, email, isAdmin, teams };
}

/**
 * Live lookup against the Memberships table by userId GSI.
 * Used as fallback when the JWT lacks the team_roles claim.
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
