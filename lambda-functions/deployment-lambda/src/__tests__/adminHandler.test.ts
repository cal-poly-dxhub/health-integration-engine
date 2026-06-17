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
