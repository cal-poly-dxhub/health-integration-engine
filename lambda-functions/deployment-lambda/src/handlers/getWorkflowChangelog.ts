import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { createSuccessHeaders } from '../utils/auth';
import { resolveCaller, canReadTeam, unauthenticated, forbidden } from '../utils/authz';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';
const WORKFLOW_CHANGE_LOGS_TABLE =
  process.env.WORKFLOW_CHANGE_LOGS_TABLE || 'WorkflowBuilder-WorkflowChangeLogs';

/**
 * GET /workflows/{workflowId}/changelog
 *   — Returns changelog entries for a specific workflow.
 *   — Caller must be a reader on the workflow's team (or admin).
 *
 * GET /admin/workflow-changes
 *   — Returns changelog entries across ALL workflows. Admin only.
 *   — Optional ?workflowId= to filter to one workflow.
 *   — Optional ?actorUserId= to filter by actor.
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const caller = await resolveCaller(event);
    if (!caller) return unauthenticated();

    const isAdminEndpoint = event.path?.includes('/admin/workflow-changes');
    const qp = event.queryStringParameters || {};
    const limit = Math.min(parseInt(qp.limit || '100'), 500);

    if (isAdminEndpoint) {
      if (!caller.isAdmin) return forbidden('Admin access required');

      const actorFilter = qp.actorUserId;
      const workflowFilter = qp.workflowId;

      if (actorFilter) {
        // Query by actor via GSI
        const resp = await docClient.send(new QueryCommand({
          TableName: WORKFLOW_CHANGE_LOGS_TABLE,
          IndexName: 'ActorIndex',
          KeyConditionExpression: 'actorUserId = :a',
          ExpressionAttributeValues: { ':a': actorFilter },
          ScanIndexForward: false,
          Limit: limit,
        }));
        return ok(resp.Items || []);
      }

      if (workflowFilter) {
        // Query by workflow
        const resp = await docClient.send(new QueryCommand({
          TableName: WORKFLOW_CHANGE_LOGS_TABLE,
          KeyConditionExpression: 'workflowId = :w',
          ExpressionAttributeValues: { ':w': workflowFilter },
          ScanIndexForward: false,
          Limit: limit,
        }));
        return ok(resp.Items || []);
      }

      // No filter — scan the whole table (admin sees everything)
      const items: any[] = [];
      let lastKey: any;
      do {
        const resp = await docClient.send(new ScanCommand({
          TableName: WORKFLOW_CHANGE_LOGS_TABLE,
          Limit: limit,
          ExclusiveStartKey: lastKey,
        }));
        items.push(...(resp.Items || []));
        lastKey = resp.LastEvaluatedKey;
      } while (lastKey && items.length < limit);

      // Sort by sk (timestamp#uuid) descending
      items.sort((a, b) => (b.sk < a.sk ? -1 : b.sk > a.sk ? 1 : 0));
      return ok(items.slice(0, limit));
    }

    // --- Per-workflow endpoint ---
    const workflowId = event.pathParameters?.workflowId;
    if (!workflowId) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'workflowId required' }),
      };
    }

    // Auth: caller must be reader on the workflow's team
    const workflow = await docClient.send(new GetCommand({
      TableName: WORKFLOWS_TABLE,
      Key: { PK: `WORKFLOW#${workflowId}`, SK: 'META' },
    }));
    if (!workflow.Item) {
      return { statusCode: 404, headers: createSuccessHeaders(), body: JSON.stringify({ error: 'Workflow not found' }) };
    }
    if (!canReadTeam(caller, workflow.Item.teamId)) {
      return { statusCode: 404, headers: createSuccessHeaders(), body: JSON.stringify({ error: 'Workflow not found' }) };
    }

    const resp = await docClient.send(new QueryCommand({
      TableName: WORKFLOW_CHANGE_LOGS_TABLE,
      KeyConditionExpression: 'workflowId = :w',
      ExpressionAttributeValues: { ':w': workflowId },
      ScanIndexForward: false,
      Limit: limit,
    }));

    return ok(resp.Items || []);
  } catch (error) {
    console.error('getWorkflowChangelog error:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

function ok(items: any[]): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: createSuccessHeaders(),
    body: JSON.stringify({ entries: items }),
  };
}
