import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { createSuccessHeaders } from '../utils/auth';
import { resolveCaller, unauthenticated } from '../utils/authz';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TEAMS_TABLE = process.env.TEAMS_TABLE || 'WorkflowBuilder-Teams';

/**
 * GET /me/teams — return the caller's teams + roles, plus their admin flag.
 *
 * The frontend uses this to:
 *   - Detect "pending" users (no teams + not admin) and show the pending screen.
 *   - Render the team switcher with team names (resolved from the Teams table).
 *   - Decide whether to show the /admin route entry point.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const caller = await resolveCaller(event);
    if (!caller) return unauthenticated();

    let teams: Array<{ teamId: string; name: string; role: string }> = [];

    if (caller.teams.length > 0) {
      const keys = caller.teams.map(t => ({ teamId: t.teamId }));
      const resp = await docClient.send(new BatchGetCommand({
        RequestItems: { [TEAMS_TABLE]: { Keys: keys } },
      }));
      const teamItems = resp.Responses?.[TEAMS_TABLE] || [];
      const byId = new Map<string, any>();
      for (const item of teamItems) byId.set(item.teamId, item);

      teams = caller.teams.map(t => ({
        teamId: t.teamId,
        name: byId.get(t.teamId)?.name || '(unknown team)',
        role: t.role,
      }));
    }

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        userId: caller.userId,
        email: caller.email,
        isAdmin: caller.isAdmin,
        teams,
        // pending = not admin AND no team memberships
        pending: !caller.isAdmin && teams.length === 0,
      }),
    };
  } catch (error) {
    console.error('me/teams error:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
