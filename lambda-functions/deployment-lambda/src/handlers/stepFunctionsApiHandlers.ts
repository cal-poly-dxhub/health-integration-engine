import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
  SFNClient, 
  ListExecutionsCommand, 
  DescribeExecutionCommand, 
  GetExecutionHistoryCommand,
  StartExecutionCommand,
  StopExecutionCommand,
  DescribeStateMachineCommand,
  DescribeStateMachineForExecutionCommand,
  RedriveExecutionCommand
} from '@aws-sdk/client-sfn';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { createSuccessHeaders } from '../utils/auth';
import {
  resolveCaller,
  canReadTeam,
  canWriteTeam,
  forbidden,
  unauthenticated,
  parseWorkflowIdFromSfnArn,
} from '../utils/authz';

const sfnClient = new SFNClient({});
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';

type SfnAccess = 'read' | 'write';

interface AuthorizeResult {
  ok: boolean;
  /** Populated only when `ok` is false — the response to return immediately. */
  response?: APIGatewayProxyResult;
}

const notFound = (): APIGatewayProxyResult => ({
  statusCode: 404,
  headers: createSuccessHeaders(),
  body: JSON.stringify({ error: 'Not found' }),
});

/**
 * Server-side authorization for every Step Functions API call. The caller may
 * only act on state machines / executions belonging to a workflow on one of
 * their teams (admins can act on any). The owning workflow is derived from the
 * ARN itself (state machines are named `SF-<workflowId>`), never trusted from
 * the request body, and the workflow's team is read live from DynamoDB.
 *
 * Read ops mask denials as 404 (so out-of-scope/unknown ARNs aren't
 * enumerable); write ops return 403. ARNs that don't map to a workflow
 * (e.g. the internal deployment/deletion state machines) are denied.
 */
async function authorizeSfnArn(
  event: APIGatewayProxyEvent,
  arn: string,
  access: SfnAccess
): Promise<AuthorizeResult> {
  const caller = await resolveCaller(event);
  if (!caller) {
    return { ok: false, response: unauthenticated('Valid authentication token required') };
  }

  const workflowId = parseWorkflowIdFromSfnArn(arn);
  if (!workflowId) {
    // Not a per-workflow state machine ARN — deny rather than fall open.
    return { ok: false, response: access === 'read' ? notFound() : forbidden('Not authorized for this resource') };
  }

  let workflow: { teamId?: string } | null = null;
  try {
    const resp = await docClient.send(new GetCommand({
      TableName: WORKFLOWS_TABLE,
      Key: { PK: `WORKFLOW#${workflowId}`, SK: 'META' },
    }));
    workflow = (resp.Item as { teamId?: string }) || null;
  } catch (error) {
    console.error('SFN authz: failed to load workflow', workflowId, error);
    return {
      ok: false,
      response: {
        statusCode: 500,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'Authorization check failed' }),
      },
    };
  }

  if (!workflow || !workflow.teamId) {
    return { ok: false, response: notFound() };
  }

  const permitted = access === 'write'
    ? canWriteTeam(caller, workflow.teamId)
    : canReadTeam(caller, workflow.teamId);

  if (!permitted) {
    // Mask reads as 404; writes as explicit 403.
    return { ok: false, response: access === 'read' ? notFound() : forbidden('You do not have access to this workflow') };
  }

  return { ok: true };
}

/**
 * List executions for a state machine
 */
export const listExecutions = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { stateMachineArn, maxResults = 100, nextToken } = body;

    if (!stateMachineArn) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'stateMachineArn is required' }),
      };
    }

    const authz = await authorizeSfnArn(event, stateMachineArn, 'read');
    if (!authz.ok) return authz.response!;

    const command = new ListExecutionsCommand({
      stateMachineArn,
      maxResults,
      nextToken,
    });

    const response = await sfnClient.send(command);

    // Convert Date objects to ISO strings for proper JSON serialization
    const executions = (response.executions || []).map(execution => ({
      ...execution,
      startDate: execution.startDate ? execution.startDate.toISOString() : undefined,
      stopDate: execution.stopDate ? execution.stopDate.toISOString() : undefined,
    }));

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        executions,
        nextToken: response.nextToken,
      }),
    };
  } catch (error) {
    console.error('Error listing executions:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Failed to list executions' }),
    };
  }
};

/**
 * Describe a specific execution
 */
export const describeExecution = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { executionArn } = body;

    if (!executionArn) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'executionArn is required' }),
      };
    }

    const authz = await authorizeSfnArn(event, executionArn, 'read');
    if (!authz.ok) return authz.response!;

    const command = new DescribeExecutionCommand({
      executionArn,
    });

    const response = await sfnClient.send(command);

    // Convert Date objects to ISO strings for proper JSON serialization
    const executionDetails = {
      ...response,
      startDate: response.startDate ? response.startDate.toISOString() : undefined,
      stopDate: response.stopDate ? response.stopDate.toISOString() : undefined,
    };

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify(executionDetails),
    };
  } catch (error) {
    console.error('Error describing execution:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Failed to describe execution' }),
    };
  }
};

/**
 * Get execution history with detailed step information
 */
export const getExecutionHistory = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { executionArn, maxResults = 100, nextToken, reverseOrder = true } = body;

    if (!executionArn) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'executionArn is required' }),
      };
    }

    const authz = await authorizeSfnArn(event, executionArn, 'read');
    if (!authz.ok) return authz.response!;

    const command = new GetExecutionHistoryCommand({
      executionArn,
      maxResults,
      nextToken,
      reverseOrder,
      includeExecutionData: true,
    });

    const response = await sfnClient.send(command);

    // Convert Date objects to ISO strings for proper JSON serialization
    const events = (response.events || []).map(event => ({
      ...event,
      timestamp: event.timestamp ? event.timestamp.toISOString() : undefined,
    }));

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        events,
        nextToken: response.nextToken,
      }),
    };
  } catch (error) {
    console.error('Error getting execution history:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Failed to get execution history' }),
    };
  }
};

/**
 * Start a new execution
 */
export const startExecution = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { stateMachineArn, name, input = '{}' } = body;

    if (!stateMachineArn) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'stateMachineArn is required' }),
      };
    }

    const authz = await authorizeSfnArn(event, stateMachineArn, 'write');
    if (!authz.ok) return authz.response!;

    const command = new StartExecutionCommand({
      stateMachineArn,
      name: name || `execution-${Date.now()}`,
      input,
    });

    const response = await sfnClient.send(command);

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        executionArn: response.executionArn,
        startDate: response.startDate,
      }),
    };
  } catch (error) {
    console.error('Error starting execution:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Failed to start execution' }),
    };
  }
};

/**
 * Stop an execution
 */
export const stopExecution = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { executionArn, error: errorMessage, cause } = body;

    if (!executionArn) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'executionArn is required' }),
      };
    }

    const authz = await authorizeSfnArn(event, executionArn, 'write');
    if (!authz.ok) return authz.response!;

    const command = new StopExecutionCommand({
      executionArn,
      error: errorMessage,
      cause,
    });

    const response = await sfnClient.send(command);

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        stopDate: response.stopDate,
      }),
    };
  } catch (error) {
    console.error('Error stopping execution:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Failed to stop execution' }),
    };
  }
};

/**
 * Describe state machine details
 */
export const describeStateMachine = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { stateMachineArn } = body;

    if (!stateMachineArn) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'stateMachineArn is required' }),
      };
    }

    const authz = await authorizeSfnArn(event, stateMachineArn, 'read');
    if (!authz.ok) return authz.response!;

    const command = new DescribeStateMachineCommand({
      stateMachineArn,
    });

    const response = await sfnClient.send(command);

    // Convert Date objects to ISO strings for proper JSON serialization
    const stateMachineDetails = {
      ...response,
      creationDate: response.creationDate ? response.creationDate.toISOString() : undefined,
    };

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify(stateMachineDetails),
    };
  } catch (error) {
    console.error('Error describing state machine:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Failed to describe state machine' }),
    };
  }
};

/**
 * Describe state machine for a specific execution
 */
export const describeStateMachineForExecution = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { executionArn } = body;

    if (!executionArn) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'executionArn is required' }),
      };
    }

    const authz = await authorizeSfnArn(event, executionArn, 'read');
    if (!authz.ok) return authz.response!;

    const command = new DescribeStateMachineForExecutionCommand({
      executionArn,
    });

    const response = await sfnClient.send(command);

    // Convert Date objects to ISO strings for proper JSON serialization
    const stateMachineDetails = {
      ...response,
      updateDate: response.updateDate ? response.updateDate.toISOString() : undefined,
    };

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify(stateMachineDetails),
    };
  } catch (error) {
    console.error('Error describing state machine for execution:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Failed to describe state machine for execution' }),
    };
  }
};

/**
 * Redrive a failed execution from the point of failure
 */
export const redriveExecution = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { executionArn } = body;

    if (!executionArn) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'executionArn is required' }),
      };
    }

    const authz = await authorizeSfnArn(event, executionArn, 'write');
    if (!authz.ok) return authz.response!;

    const command = new RedriveExecutionCommand({
      executionArn,
    });

    const response = await sfnClient.send(command);

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        redriveDate: response.redriveDate ? response.redriveDate.toISOString() : undefined,
      }),
    };
  } catch (error) {
    console.error('Error redriving execution:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Failed to redrive execution' }),
    };
  }
};