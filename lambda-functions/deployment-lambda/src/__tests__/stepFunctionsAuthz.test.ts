/**
 * Tests for server-side team authorization on the Step Functions API handlers.
 *
 * The guarantee under test: a caller may only act on a state machine /
 * execution that belongs to a workflow on one of their teams (admins: any).
 * The owning workflow is derived from the ARN (`SF-<workflowId>`) and its team
 * is read live from DynamoDB — the request body is never trusted for scope.
 * Read ops mask denials as 404; write ops return 403; failures fail closed.
 */

const mockDdbSend = jest.fn();
const mockSfnSend = jest.fn();

jest.mock('@aws-sdk/lib-dynamodb', () => {
  class QueryCommand { constructor(public input: any) {} }
  class GetCommand { constructor(public input: any) {} }
  class ScanCommand { constructor(public input: any) {} }
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockDdbSend }) },
    QueryCommand,
    GetCommand,
    ScanCommand,
  };
});
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));

jest.mock('@aws-sdk/client-sfn', () => {
  const cmd = (name: string) => {
    const c = class { input: any; constructor(input: any) { this.input = input; } };
    Object.defineProperty(c, 'name', { value: name });
    return c;
  };
  return {
    SFNClient: class { send = mockSfnSend; },
    ListExecutionsCommand: cmd('ListExecutionsCommand'),
    DescribeExecutionCommand: cmd('DescribeExecutionCommand'),
    GetExecutionHistoryCommand: cmd('GetExecutionHistoryCommand'),
    StartExecutionCommand: cmd('StartExecutionCommand'),
    StopExecutionCommand: cmd('StopExecutionCommand'),
    DescribeStateMachineCommand: cmd('DescribeStateMachineCommand'),
    DescribeStateMachineForExecutionCommand: cmd('DescribeStateMachineForExecutionCommand'),
    RedriveExecutionCommand: cmd('RedriveExecutionCommand'),
  };
});

import {
  listExecutions,
  startExecution,
  describeExecution,
  redriveExecution,
} from '../handlers/stepFunctionsApiHandlers';
import { parseWorkflowIdFromSfnArn } from '../utils/authz';

const SUB = 'user-sub-123';
const WORKFLOW_ID = 'workflow-1700000000000-abc123';
const STATE_MACHINE_ARN = `arn:aws:states:us-east-1:111122223333:stateMachine:SF-${WORKFLOW_ID}`;
const EXECUTION_ARN = `arn:aws:states:us-east-1:111122223333:execution:SF-${WORKFLOW_ID}:exec-1`;

function event(body: any, claims: Record<string, any> = { sub: SUB, email: 'u@example.com' }): any {
  return { requestContext: { authorizer: { claims } }, body: JSON.stringify(body) };
}

/**
 * Script DynamoDB: caller's memberships (GSI query), this user's admin row
 * (GetCommand on Admins), and the owning workflow (GetCommand on Workflows).
 */
function scriptDynamo(opts: {
  memberships?: Array<{ teamId: string; role: string }>;
  adminRecord?: Record<string, any> | null;
  adminCount?: number;
  workflow?: Record<string, any> | null;
  throwWorkflow?: boolean;
}) {
  mockDdbSend.mockImplementation((command: any) => {
    const name = command.constructor.name;
    const table: string = command.input?.TableName || '';
    if (name === 'QueryCommand') {
      return Promise.resolve({ Items: opts.memberships ?? [] });
    }
    if (name === 'ScanCommand') {
      return Promise.resolve({ Count: opts.adminCount ?? 0 });
    }
    if (name === 'GetCommand') {
      if (table.includes('Workflows')) {
        if (opts.throwWorkflow) return Promise.reject(new Error('ddb down'));
        return Promise.resolve({ Item: opts.workflow ?? undefined });
      }
      // Admins table
      return Promise.resolve({ Item: opts.adminRecord ?? undefined });
    }
    throw new Error(`unexpected command ${name} on ${table}`);
  });
}

beforeEach(() => {
  mockDdbSend.mockReset();
  mockSfnSend.mockReset();
  mockSfnSend.mockResolvedValue({ executions: [], events: [] });
});

describe('parseWorkflowIdFromSfnArn', () => {
  it('extracts workflowId from a state machine ARN', () => {
    expect(parseWorkflowIdFromSfnArn(STATE_MACHINE_ARN)).toBe(WORKFLOW_ID);
  });
  it('extracts workflowId from an execution ARN', () => {
    expect(parseWorkflowIdFromSfnArn(EXECUTION_ARN)).toBe(WORKFLOW_ID);
  });
  it('tolerates a state-machine alias suffix', () => {
    expect(parseWorkflowIdFromSfnArn(`${STATE_MACHINE_ARN}:live`)).toBe(WORKFLOW_ID);
  });
  it('returns null for non-workflow (internal) state machines', () => {
    expect(parseWorkflowIdFromSfnArn('arn:aws:states:us-east-1:111122223333:stateMachine:workflow-builder-deletion')).toBeNull();
  });
  it('returns null for malformed / empty input', () => {
    expect(parseWorkflowIdFromSfnArn('')).toBeNull();
    expect(parseWorkflowIdFromSfnArn(undefined)).toBeNull();
    expect(parseWorkflowIdFromSfnArn('not-an-arn')).toBeNull();
  });
});

describe('Step Functions handler authorization', () => {
  it('returns 401 when the caller is unauthenticated', async () => {
    scriptDynamo({});
    const res = await listExecutions(event({ stateMachineArn: STATE_MACHINE_ARN }, {}));
    expect(res.statusCode).toBe(401);
    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it('returns 400 when the ARN is missing (before any authz/SFN call)', async () => {
    scriptDynamo({});
    const res = await listExecutions(event({}));
    expect(res.statusCode).toBe(400);
    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it('allows a reader to read executions for a workflow on their team', async () => {
    scriptDynamo({
      memberships: [{ teamId: 'team-a', role: 'reader' }],
      workflow: { teamId: 'team-a' },
    });
    const res = await listExecutions(event({ stateMachineArn: STATE_MACHINE_ARN }));
    expect(res.statusCode).toBe(200);
    expect(mockSfnSend).toHaveBeenCalledTimes(1);
  });

  it('masks a cross-team read as 404 and never calls Step Functions', async () => {
    scriptDynamo({
      memberships: [{ teamId: 'team-b', role: 'writer' }], // not team-a
      workflow: { teamId: 'team-a' },
    });
    const res = await describeExecution(event({ executionArn: EXECUTION_ARN }));
    expect(res.statusCode).toBe(404);
    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it('returns 404 when the owning workflow no longer exists', async () => {
    scriptDynamo({ memberships: [{ teamId: 'team-a', role: 'writer' }], workflow: null });
    const res = await listExecutions(event({ stateMachineArn: STATE_MACHINE_ARN }));
    expect(res.statusCode).toBe(404);
    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it('forbids a reader from starting an execution (write op -> 403)', async () => {
    scriptDynamo({
      memberships: [{ teamId: 'team-a', role: 'reader' }],
      workflow: { teamId: 'team-a' },
    });
    const res = await startExecution(event({ stateMachineArn: STATE_MACHINE_ARN }));
    expect(res.statusCode).toBe(403);
    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it('allows a writer to start an execution', async () => {
    scriptDynamo({
      memberships: [{ teamId: 'team-a', role: 'writer' }],
      workflow: { teamId: 'team-a' },
    });
    mockSfnSend.mockResolvedValueOnce({ executionArn: 'arn:exec', startDate: new Date() });
    const res = await startExecution(event({ stateMachineArn: STATE_MACHINE_ARN }));
    expect(res.statusCode).toBe(200);
    expect(mockSfnSend).toHaveBeenCalledTimes(1);
  });

  it('lets an admin redrive any workflow execution', async () => {
    scriptDynamo({
      memberships: [],
      adminRecord: { userId: SUB },
      workflow: { teamId: 'some-other-team' },
    });
    mockSfnSend.mockResolvedValueOnce({ redriveDate: new Date() });
    const res = await redriveExecution(event({ executionArn: EXECUTION_ARN }));
    expect(res.statusCode).toBe(200);
    expect(mockSfnSend).toHaveBeenCalledTimes(1);
  });

  it('forbids a write against a non-workflow ARN (403)', async () => {
    scriptDynamo({ memberships: [{ teamId: 'team-a', role: 'writer' }] });
    const res = await startExecution(event({
      stateMachineArn: 'arn:aws:states:us-east-1:111122223333:stateMachine:workflow-builder-deployment',
    }));
    expect(res.statusCode).toBe(403);
    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it('fails closed with 500 when the workflow lookup throws', async () => {
    scriptDynamo({
      memberships: [{ teamId: 'team-a', role: 'reader' }],
      throwWorkflow: true,
    });
    const res = await listExecutions(event({ stateMachineArn: STATE_MACHINE_ARN }));
    expect(res.statusCode).toBe(500);
    expect(mockSfnSend).not.toHaveBeenCalled();
  });
});
