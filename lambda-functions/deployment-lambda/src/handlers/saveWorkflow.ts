import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createSuccessHeaders } from '../utils/auth';
import { resolveCaller, canWriteTeam, unauthenticated, forbidden } from '../utils/authz';
import { writeWorkflowChangeLog } from '../utils/changeLog';
import { computeWorkflowDiff, isEmptyDiff } from '../utils/workflowDiff';
import { Workflow } from '../types/workflow';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';

/**
 * Save or update a workflow.
 *
 * - On UPDATE: caller must be a writer on the workflow's existing team (or admin).
 * - On CREATE: body must include `teamId`; caller must be a writer on that team.
 *   If the caller belongs to exactly one team and no teamId is supplied,
 *   default to that team for ergonomics.
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Save workflow event:', JSON.stringify({ httpMethod: event.httpMethod, path: event.path, pathParameters: event.pathParameters }, null, 2));

  try {
    const caller = await resolveCaller(event);
    if (!caller) return unauthenticated();

    if (!event.body) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    let workflowData: any;
    try {
      workflowData = JSON.parse(event.body);
    } catch {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'Invalid JSON in request body' }),
      };
    }
    if (!workflowData.name) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'Workflow name is required' }),
      };
    }

    const workflowId = workflowData.id || `workflow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    const existingWorkflow = await getExistingWorkflow(workflowId);

    // Determine the target team for this save.
    let targetTeamId: string | undefined;
    if (existingWorkflow) {
      targetTeamId = existingWorkflow.teamId;
    } else {
      targetTeamId = workflowData.teamId;
      if (!targetTeamId) {
        // Convenience: single-team writers don't have to specify.
        const writerTeams = caller.teams.filter(t => t.role === 'writer');
        if (writerTeams.length === 1) {
          targetTeamId = writerTeams[0].teamId;
        } else if (caller.isAdmin && caller.teams.length === 1) {
          targetTeamId = caller.teams[0].teamId;
        }
      }
    }

    if (!targetTeamId) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'teamId is required when creating a workflow' }),
      };
    }

    if (!canWriteTeam(caller, targetTeamId)) {
      return forbidden('You do not have writer access on this team');
    }

    if (existingWorkflow && workflowData.version && workflowData.version !== existingWorkflow.version) {
      return {
        statusCode: 409,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          error: 'Workflow has been modified by another user. Please refresh and try again.',
          currentVersion: existingWorkflow.version,
          providedVersion: workflowData.version,
        }),
      };
    }

    // --- Enforce unique workflow name within the team ---
    // Names are compared trimmed but case-sensitively ("My Flow" and "my flow"
    // may coexist; "my flow" and "my flow " may not). System-generated names
    // (new "Untitled Workflow", duplicates) set autoResolveName so they get the
    // next free name instead of failing; user-typed renames stay strict (409).
    const requestedName = String(workflowData.name).trim();
    if (!requestedName) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'Workflow name is required' }),
      };
    }
    const autoResolveName = workflowData.autoResolveName === true;
    const teamWorkflows = await getTeamWorkflows(targetTeamId);
    const existingNames = new Set(
      teamWorkflows
        .filter(w => w.id !== workflowId)
        .map(w => (w.name || '').trim())
    );

    let finalName: string;
    if (autoResolveName) {
      finalName = resolveUniqueName(requestedName, existingNames);
    } else if (existingNames.has(requestedName)) {
      return {
        statusCode: 409,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          error: `A workflow named "${requestedName}" already exists in this team. Please choose a different name.`,
          code: 'NAME_CONFLICT',
        }),
      };
    } else {
      finalName = requestedName;
    }

    const workflow: Workflow = {
      id: workflowId,
      name: finalName,
      description: workflowData.description || '',
      teamId: targetTeamId,
      nodes: workflowData.nodes || [],
      connections: workflowData.connections || [],
      stepFunctionDefinition: workflowData.stepFunctionDefinition || {},
      deploymentStatus: existingWorkflow?.deploymentStatus || 'draft',
      isDeployed: existingWorkflow?.isDeployed || false,
      stepFunctionArn: existingWorkflow?.stepFunctionArn,
      lastDeploymentId: existingWorkflow?.lastDeploymentId,
      createdAt: existingWorkflow?.createdAt || now,
      updatedAt: now,
      createdBy: existingWorkflow?.createdBy || caller.userId,
      createdByEmail: existingWorkflow?.createdByEmail || caller.email,
      updatedBy: caller.userId,
      updatedByEmail: caller.email,
      version: (existingWorkflow?.version || 0) + 1,
    };

    await saveWorkflowToDatabase(workflow);

    // Compute a structured "what changed" diff against the previous version
    // (or the initial node set for a brand-new workflow) for the change log.
    const diff = computeWorkflowDiff(existingWorkflow, workflow);

    await writeWorkflowChangeLog({
      workflowId,
      action: existingWorkflow ? 'saved' : 'created',
      actorUserId: caller.userId,
      actorEmail: caller.email,
      teamId: targetTeamId,
      workflowName: workflow.name,
      meta: {
        version: String(workflow.version),
        nodeCount: String(workflow.nodes.length),
        deploymentStatus: workflow.deploymentStatus || 'draft',
      },
      changes: isEmptyDiff(diff) ? undefined : diff,
    });

    console.log('Workflow saved:', { workflowId, teamId: targetTeamId, by: caller.userId, version: workflow.version });

    return {
      statusCode: existingWorkflow ? 200 : 201,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        message: existingWorkflow ? 'Workflow updated successfully' : 'Workflow created successfully',
        workflow,
      }),
    };
  } catch (error) {
    console.error('Save workflow error:', error);
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

/**
 * Look up an existing workflow by ID. Workflow IDs are globally unique
 * (timestamp + random suffix), so a single GetItem on the GLOBAL#WORKFLOWS
 * partition is sufficient — see saveWorkflowToDatabase for the layout.
 */
async function getExistingWorkflow(workflowId: string): Promise<Workflow | null> {
  try {
    const response = await docClient.send(new GetCommand({
      TableName: WORKFLOWS_TABLE,
      Key: {
        PK: `WORKFLOW#${workflowId}`,
        SK: 'META',
      },
    }));
    return (response.Item as Workflow) || null;
  } catch (error) {
    console.error('Error fetching existing workflow:', error);
    return null;
  }
}

/**
 * Persist the workflow.
 *
 * Layout:
 *   PK = WORKFLOW#<workflowId>, SK = META
 *   GSI1PK = TEAM#<teamId>,     GSI1SK = WORKFLOW#<updatedAt>#<workflowId>
 * The GSI lets us list workflows for a team sorted by recency.
 */
async function saveWorkflowToDatabase(workflow: Workflow): Promise<void> {
  await docClient.send(new PutCommand({
    TableName: WORKFLOWS_TABLE,
    Item: {
      PK: `WORKFLOW#${workflow.id}`,
      SK: 'META',
      GSI1PK: `TEAM#${workflow.teamId}`,
      GSI1SK: `WORKFLOW#${workflow.updatedAt}#${workflow.id}`,
      ...workflow,
    },
  }));
}

/**
 * Fetch all workflows (id + name) for a team via the team GSI. Used to enforce
 * unique workflow names within a team.
 */
async function getTeamWorkflows(teamId: string): Promise<Array<{ id: string; name: string }>> {
  const items: Array<{ id: string; name: string }> = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const response = await docClient.send(new QueryCommand({
      TableName: WORKFLOWS_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: { ':pk': `TEAM#${teamId}`, ':sk': 'WORKFLOW#' },
      // `name` is a DynamoDB reserved word, so alias it.
      ProjectionExpression: 'id, #nm',
      ExpressionAttributeNames: { '#nm': 'name' },
      ExclusiveStartKey: lastKey,
    }));
    for (const item of (response.Items || []) as Array<{ id: string; name: string }>) {
      items.push({ id: item.id, name: item.name });
    }
    lastKey = response.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

/**
 * Return `requested` if free within the team, otherwise the first available
 * "<requested> (n)" (n starting at 2). Comparison is trimmed, case-sensitive.
 */
export function resolveUniqueName(requested: string, existingNames: Set<string>): string {
  const trimmed = requested.trim();
  if (!existingNames.has(trimmed)) return trimmed;
  let n = 2;
  while (existingNames.has(`${trimmed} (${n})`)) n++;
  return `${trimmed} (${n})`;
}
