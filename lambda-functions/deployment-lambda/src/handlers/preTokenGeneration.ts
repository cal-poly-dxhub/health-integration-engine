import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const MEMBERSHIPS_TABLE = process.env.MEMBERSHIPS_TABLE || 'WorkflowBuilder-Memberships';

/**
 * Cognito PreTokenGeneration trigger.
 *
 * Looks up the user's team memberships in DynamoDB and injects two claims into
 * the ID/access token:
 *   - team_roles  — JSON string mapping teamId -> role (reader|writer)
 *   - team_count  — number of teams the user belongs to (for quick "is pending" check)
 *
 * Pending users (no memberships) get team_roles = "{}" and team_count = "0".
 * The trigger MUST never throw; on lookup failure we fall back to empty
 * claims rather than blocking sign-in.
 */
export const handler = async (event: any): Promise<any> => {
  const userId =
    event?.request?.userAttributes?.sub ||
    event?.userName ||
    '';

  let teamRoles: Record<string, string> = {};
  if (userId) {
    try {
      const response = await docClient.send(new QueryCommand({
        TableName: MEMBERSHIPS_TABLE,
        IndexName: 'UserIdIndex',
        KeyConditionExpression: 'userId = :u',
        ExpressionAttributeValues: { ':u': userId },
      }));
      for (const item of response.Items || []) {
        if (item.teamId && item.role) {
          teamRoles[item.teamId] = item.role;
        }
      }
    } catch (error) {
      console.error('PreTokenGeneration membership lookup failed; emitting empty claims', error);
      teamRoles = {};
    }
  }

  event.response = event.response || {};
  event.response.claimsOverrideDetails = {
    claimsToAddOrOverride: {
      team_roles: JSON.stringify(teamRoles),
      team_count: String(Object.keys(teamRoles).length),
    },
  };

  return event;
};
