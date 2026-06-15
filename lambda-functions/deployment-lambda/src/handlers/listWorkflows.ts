import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { createSuccessHeaders } from '../utils/auth';
import { resolveCaller, readableTeamIds, unauthenticated } from '../utils/authz';
import { Workflow } from '../types/workflow';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';

interface ListWorkflowsResponse {
  workflows: Workflow[];
  pagination: {
    nextToken?: string;
    hasMore: boolean;
    total: number;
  };
}

/**
 * List workflows visible to the caller.
 *
 *   - Admin: returns all workflows (Scan; small enough at our scale).
 *   - Team member: returns workflows for every team they belong to.
 *   - Pending user (no teams): returns an empty list with hasMore=false.
 *
 * Optional query param `teamId` filters down to a single team — handy for the
 * UI's team switcher. Out-of-scope teams return 403 implicitly via empty result.
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('List workflows event:', JSON.stringify({ httpMethod: event.httpMethod, path: event.path, queryStringParameters: event.queryStringParameters }, null, 2));

  try {
    const caller = await resolveCaller(event);
    if (!caller) return unauthenticated();

    const queryParams = event.queryStringParameters || {};
    const limit = Math.min(parseInt(queryParams.limit || '20'), 100);
    const search = queryParams.search?.toLowerCase();
    const deploymentStatus = queryParams.deploymentStatus;
    const sortBy = queryParams.sortBy || 'updatedAt';
    const sortOrder = queryParams.sortOrder || 'desc';
    const teamFilter = queryParams.teamId;

    const allowed = readableTeamIds(caller); // null = admin / all teams
    let teamsToQuery: string[] | null;
    if (teamFilter) {
      if (allowed !== null && !allowed.includes(teamFilter)) {
        // Caller asked for a team they're not on. Return empty rather than 403
        // so the UI handles it cleanly.
        return {
          statusCode: 200,
          headers: createSuccessHeaders(),
          body: JSON.stringify({ workflows: [], pagination: { hasMore: false, total: 0 } } as ListWorkflowsResponse),
        };
      }
      teamsToQuery = [teamFilter];
    } else if (allowed === null) {
      teamsToQuery = null; // admin scan
    } else if (allowed.length === 0) {
      // Pending user — no teams, nothing to show.
      return {
        statusCode: 200,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ workflows: [], pagination: { hasMore: false, total: 0 } } as ListWorkflowsResponse),
      };
    } else {
      teamsToQuery = allowed;
    }

    let workflows: Workflow[];
    if (teamsToQuery === null) {
      workflows = await scanAllWorkflows();
    } else {
      const lists = await Promise.all(teamsToQuery.map(t => queryWorkflowsByTeam(t)));
      workflows = lists.flat();
    }

    if (deploymentStatus) {
      workflows = workflows.filter(w => w.deploymentStatus === deploymentStatus);
    }
    if (search) {
      workflows = workflows.filter(w =>
        w.name.toLowerCase().includes(search) ||
        (w.description && w.description.toLowerCase().includes(search))
      );
    }

    workflows.sort((a, b) => {
      let av: any, bv: any;
      switch (sortBy) {
        case 'name': av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
        case 'createdAt': av = new Date(a.createdAt).getTime(); bv = new Date(b.createdAt).getTime(); break;
        default: av = new Date(a.updatedAt).getTime(); bv = new Date(b.updatedAt).getTime();
      }
      if (sortOrder === 'asc') return av < bv ? -1 : av > bv ? 1 : 0;
      return av > bv ? -1 : av < bv ? 1 : 0;
    });

    const total = workflows.length;
    const paginated = workflows.slice(0, limit);
    const hasMore = total > limit;

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        workflows: paginated,
        pagination: { hasMore, total },
      } as ListWorkflowsResponse),
    };
  } catch (error) {
    console.error('List workflows error:', error);
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

async function queryWorkflowsByTeam(teamId: string): Promise<Workflow[]> {
  const items: Workflow[] = [];
  let lastKey: any;
  do {
    const response = await docClient.send(new QueryCommand({
      TableName: WORKFLOWS_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: { ':pk': `TEAM#${teamId}`, ':sk': 'WORKFLOW#' },
      ExclusiveStartKey: lastKey,
      ScanIndexForward: false,
    }));
    items.push(...((response.Items || []) as Workflow[]));
    lastKey = response.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function scanAllWorkflows(): Promise<Workflow[]> {
  const items: Workflow[] = [];
  let lastKey: any;
  do {
    const response = await docClient.send(new ScanCommand({
      TableName: WORKFLOWS_TABLE,
      FilterExpression: 'SK = :sk',
      ExpressionAttributeValues: { ':sk': 'META' },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...((response.Items || []) as Workflow[]));
    lastKey = response.LastEvaluatedKey;
  } while (lastKey);
  return items;
}
