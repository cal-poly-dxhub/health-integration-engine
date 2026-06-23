/**
 * Tests for the admin promote/demote flow now that admin status is stored in
 * the Admins DynamoDB table (not the Cognito 'admins' group):
 *   - promote writes an Admins row
 *   - demote deletes the row, guarded by a DDB-row count (last-admin guard)
 *   - the bootstrap self-heal writes the acting admin's own row when they are
 *     admin only via the Cognito-group fallback
 */

const mockDdbSend = jest.fn();
const mockCognitoSend = jest.fn();

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const cmd = (n: string) => class { input: any; constructor(i: any) { this.input = i; } static cmdName = n; };
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockDdbSend }) },
    PutCommand: cmd('PutCommand'),
    GetCommand: cmd('GetCommand'),
    QueryCommand: cmd('QueryCommand'),
    ScanCommand: cmd('ScanCommand'),
    DeleteCommand: cmd('DeleteCommand'),
    UpdateCommand: cmd('UpdateCommand'),
    TransactWriteCommand: cmd('TransactWriteCommand'),
  };
});
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
  const cmd = (n: string) => class { input: any; constructor(i: any) { this.input = i; } static cmdName = n; };
  return {
    CognitoIdentityProviderClient: class { send = mockCognitoSend; },
    ListUsersCommand: cmd('ListUsersCommand'),
    AdminUserGlobalSignOutCommand: cmd('AdminUserGlobalSignOutCommand'),
  };
});

// Control the caller identity directly.
const mockResolveCaller = jest.fn();
jest.mock('../utils/authz', () => ({
  ...jest.requireActual('../utils/authz'),
  resolveCaller: (...args: any[]) => mockResolveCaller(...args),
}));

import { handler } from '../handlers/adminHandler';

const ADMIN = { userId: 'admin-1', email: 'admin@example.com', isAdmin: true, teams: [], adminViaFallback: false };
const ADMINS_TABLE = process.env.ADMINS_TABLE || 'WorkflowBuilder-Admins';
const TEAMS_TABLE = process.env.TEAMS_TABLE || 'WorkflowBuilder-Teams';

function adminEvent(method: string, resource: string, pathParameters: any = {}, body?: any): any {
  return {
    httpMethod: method,
    resource,
    path: resource,
    pathParameters,
    body: body ? JSON.stringify(body) : null,
    requestContext: { authorizer: { claims: { sub: ADMIN.userId, email: ADMIN.email } } },
  };
}

// Helper: collect the DynamoDB commands the handler issued, by command class name.
function ddbCalls(): Array<{ name: string; input: any }> {
  return mockDdbSend.mock.calls.map(([c]) => ({ name: (c.constructor as any).cmdName, input: c.input }));
}

beforeEach(() => {
  mockDdbSend.mockReset();
  mockCognitoSend.mockReset();
  mockResolveCaller.mockReset();
  mockResolveCaller.mockResolvedValue(ADMIN);
  // Default Cognito ListUsers (fetchCognitoUser) returns a target user.
  mockCognitoSend.mockResolvedValue({
    Users: [{ Username: 'target-user@example.com', Attributes: [{ Name: 'sub', Value: 'target-1' }, { Name: 'email', Value: 'target-user@example.com' }] }],
  });
});

describe('promoteAdmin', () => {
  it('writes an Admins-table row for the target user', async () => {
    mockDdbSend.mockImplementation((c: any) => {
      const name = (c.constructor as any).cmdName;
      if (name === 'GetCommand') return Promise.resolve({ Item: undefined }); // not already admin
      return Promise.resolve({});
    });

    const res = await handler(adminEvent('POST', '/admin/users/{userId}/admin', { userId: 'target-1' }));
    expect(res.statusCode).toBe(200);

    const put = ddbCalls().find(c => c.name === 'PutCommand' && c.input.TableName === ADMINS_TABLE);
    expect(put).toBeDefined();
    expect(put!.input.Item.userId).toBe('target-1');
  });

  it('rejects promoting a user who is already an admin', async () => {
    mockDdbSend.mockImplementation((c: any) => {
      const name = (c.constructor as any).cmdName;
      if (name === 'GetCommand') return Promise.resolve({ Item: { userId: 'target-1' } }); // already admin
      return Promise.resolve({});
    });

    const res = await handler(adminEvent('POST', '/admin/users/{userId}/admin', { userId: 'target-1' }));
    expect(res.statusCode).toBe(409);
  });
});

describe('demoteAdmin', () => {
  it('deletes the row and globally signs the user out when >1 admin remains', async () => {
    mockDdbSend.mockImplementation((c: any) => {
      const name = (c.constructor as any).cmdName;
      if (name === 'GetCommand') return Promise.resolve({ Item: { userId: 'target-1' } }); // is admin
      if (name === 'ScanCommand') return Promise.resolve({ Count: 2 }); // two admins total
      return Promise.resolve({});
    });

    const res = await handler(adminEvent('DELETE', '/admin/users/{userId}/admin', { userId: 'target-1' }));
    expect(res.statusCode).toBe(200);

    const del = ddbCalls().find(c => c.name === 'DeleteCommand' && c.input.TableName === ADMINS_TABLE);
    expect(del).toBeDefined();
    expect(del!.input.Key.userId).toBe('target-1');

    const signedOut = mockCognitoSend.mock.calls.some(([c]) => (c.constructor as any).cmdName === 'AdminUserGlobalSignOutCommand');
    expect(signedOut).toBe(true);
  });

  it('refuses to demote the last admin (DDB count <= 1)', async () => {
    mockDdbSend.mockImplementation((c: any) => {
      const name = (c.constructor as any).cmdName;
      if (name === 'GetCommand') return Promise.resolve({ Item: { userId: 'target-1' } });
      if (name === 'ScanCommand') return Promise.resolve({ Count: 1 }); // only one admin
      return Promise.resolve({});
    });

    const res = await handler(adminEvent('DELETE', '/admin/users/{userId}/admin', { userId: 'target-1' }));
    expect(res.statusCode).toBe(409);

    const del = ddbCalls().find(c => c.name === 'DeleteCommand');
    expect(del).toBeUndefined();
  });

  it('returns 404 when the target is not an admin', async () => {
    mockDdbSend.mockImplementation((c: any) => {
      const name = (c.constructor as any).cmdName;
      if (name === 'GetCommand') return Promise.resolve({ Item: undefined });
      return Promise.resolve({});
    });

    const res = await handler(adminEvent('DELETE', '/admin/users/{userId}/admin', { userId: 'target-1' }));
    expect(res.statusCode).toBe(404);
  });
});

describe('bootstrap self-heal', () => {
  it('writes the acting admin\'s own row when admin only via fallback', async () => {
    mockResolveCaller.mockResolvedValue({ ...ADMIN, adminViaFallback: true });
    mockDdbSend.mockImplementation((c: any) => {
      const name = (c.constructor as any).cmdName;
      if (name === 'GetCommand') return Promise.resolve({ Item: undefined });
      if (name === 'ScanCommand') return Promise.resolve({ Count: 0 });
      return Promise.resolve({}); // PutCommand etc.
    });

    // Any admin route triggers the self-heal; use a harmless GET.
    await handler(adminEvent('GET', '/admin/teams'));

    const heal = ddbCalls().find(
      c => c.name === 'PutCommand' && c.input.TableName === ADMINS_TABLE && c.input.Item.userId === ADMIN.userId
    );
    expect(heal).toBeDefined();
    expect(heal!.input.ConditionExpression).toContain('attribute_not_exists');
  });

  it('does NOT self-heal when the caller already has a durable row', async () => {
    mockResolveCaller.mockResolvedValue({ ...ADMIN, adminViaFallback: false });
    mockDdbSend.mockResolvedValue({ Items: [] });

    await handler(adminEvent('GET', '/admin/teams'));

    const heal = ddbCalls().find(
      c => c.name === 'PutCommand' && c.input.TableName === ADMINS_TABLE && c.input.Item?.userId === ADMIN.userId
    );
    expect(heal).toBeUndefined();
  });
});


describe('deleteTeam — TOCTOU guard', () => {
  it('flags the team "deleting", then deletes when it has no members', async () => {
    mockDdbSend.mockImplementation((c: any) => {
      const name = (c.constructor as any).cmdName;
      if (name === 'UpdateCommand') return Promise.resolve({ Attributes: { teamId: 'team-1', name: 'T' } });
      if (name === 'QueryCommand') return Promise.resolve({ Count: 0 });
      return Promise.resolve({});
    });

    const res = await handler(adminEvent('DELETE', '/admin/teams/{teamId}', { teamId: 'team-1' }));
    expect(res.statusCode).toBe(200);

    const calls = ddbCalls();
    const mark = calls.find(c => c.name === 'UpdateCommand' && /SET/.test(c.input.UpdateExpression));
    expect(mark).toBeDefined();
    expect(mark!.input.ExpressionAttributeValues[':deleting']).toBe('deleting');
    expect(mark!.input.ConditionExpression).toContain('attribute_exists');
    expect(calls.some(c => c.name === 'DeleteCommand' && c.input.TableName === TEAMS_TABLE)).toBe(true);
  });

  it('reverts the flag and 409s when members remain (no delete)', async () => {
    mockDdbSend.mockImplementation((c: any) => {
      const name = (c.constructor as any).cmdName;
      if (name === 'UpdateCommand') return Promise.resolve({ Attributes: { teamId: 'team-1' } });
      if (name === 'QueryCommand') return Promise.resolve({ Count: 3 });
      return Promise.resolve({});
    });

    const res = await handler(adminEvent('DELETE', '/admin/teams/{teamId}', { teamId: 'team-1' }));
    expect(res.statusCode).toBe(409);

    const calls = ddbCalls();
    expect(calls.some(c => c.name === 'UpdateCommand' && /REMOVE/.test(c.input.UpdateExpression))).toBe(true);
    expect(calls.some(c => c.name === 'DeleteCommand')).toBe(false);
  });

  it('404s when the team does not exist (mark-deleting condition fails)', async () => {
    mockDdbSend.mockImplementation((c: any) => {
      const name = (c.constructor as any).cmdName;
      if (name === 'UpdateCommand') return Promise.reject({ name: 'ConditionalCheckFailedException' });
      return Promise.resolve({});
    });

    const res = await handler(adminEvent('DELETE', '/admin/teams/{teamId}', { teamId: 'missing' }));
    expect(res.statusCode).toBe(404);
    expect(ddbCalls().some(c => c.name === 'DeleteCommand')).toBe(false);
  });
});

describe('addMember — transactional guard', () => {
  function memberImpl(extra?: (name: string, input: any) => any) {
    return (c: any) => {
      const name = (c.constructor as any).cmdName;
      const input = c.input;
      const r = extra?.(name, input);
      if (r !== undefined) return r;
      if (name === 'GetCommand' && input.TableName === TEAMS_TABLE) return Promise.resolve({ Item: { teamId: 'team-1' } });
      if (name === 'GetCommand' && input.TableName === ADMINS_TABLE) return Promise.resolve({ Item: undefined }); // not an admin
      return Promise.resolve({});
    };
  }

  it('writes the membership via a conditional transaction (team exists & not deleting)', async () => {
    mockDdbSend.mockImplementation(memberImpl());

    const res = await handler(adminEvent('POST', '/admin/teams/{teamId}/members', { teamId: 'team-1' }, { userId: 'target-1', role: 'reader' }));
    expect(res.statusCode).toBe(201);

    const tx = ddbCalls().find(c => c.name === 'TransactWriteCommand');
    expect(tx).toBeDefined();
    const items = tx!.input.TransactItems;
    const check = items.find((i: any) => i.ConditionCheck)?.ConditionCheck;
    expect(check.TableName).toBe(TEAMS_TABLE);
    expect(check.ConditionExpression).toContain('attribute_exists');
    expect(check.ExpressionAttributeValues[':deleting']).toBe('deleting');
    expect(items.some((i: any) => i.Put)).toBe(true);
  });

  it('409s when the transaction is cancelled (team being deleted)', async () => {
    mockDdbSend.mockImplementation(memberImpl((name) => {
      if (name === 'TransactWriteCommand') return Promise.reject({ name: 'TransactionCanceledException' });
      return undefined;
    }));

    const res = await handler(adminEvent('POST', '/admin/teams/{teamId}/members', { teamId: 'team-1' }, { userId: 'target-1', role: 'reader' }));
    expect(res.statusCode).toBe(409);
  });
});
