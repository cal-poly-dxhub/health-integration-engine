/**
 * Tests for the LIVE authorization path in resolveCaller.
 *
 * The core guarantee under test: team roles and admin status come from
 * DynamoDB on every request, never from JWT claims — so a removed membership,
 * a downgraded role, or a revoked admin is enforced on the caller's NEXT
 * request, and a DynamoDB failure denies (fail-closed) rather than trusting a
 * stale claim.
 */

// Mock the DynamoDB document client so the module-level docClient.send is a
// jest mock we can script per-command.
const mockSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => {
  class QueryCommand { constructor(public input: any) {} }
  class GetCommand { constructor(public input: any) {} }
  class ScanCommand { constructor(public input: any) {} }
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    QueryCommand,
    GetCommand,
    ScanCommand,
  };
});
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));

import {
  resolveCaller,
  canReadTeam,
  canWriteTeam,
  CallerIdentity,
} from '../utils/authz';

// Build an APIGateway event with the given Cognito claims.
function eventWith(claims: Record<string, any>): any {
  return { requestContext: { authorizer: { claims } } };
}

// Route a mocked send() call to the right response based on which command and
// table it targets. memberships: GSI query result; admins: this user's row;
// adminCount: Scan COUNT on the Admins table.
function scriptDynamo(opts: {
  memberships?: Array<{ teamId: string; role: string }>;
  adminRecord?: Record<string, any> | null;
  adminCount?: number;
  throwOn?: 'memberships' | 'adminGet';
}) {
  mockSend.mockImplementation((command: any) => {
    const name = command.constructor.name;
    const table = command.input?.TableName;
    if (name === 'QueryCommand') {
      if (opts.throwOn === 'memberships') return Promise.reject(new Error('ddb down'));
      return Promise.resolve({ Items: opts.memberships ?? [] });
    }
    if (name === 'GetCommand') {
      if (opts.throwOn === 'adminGet') return Promise.reject(new Error('ddb down'));
      return Promise.resolve({ Item: opts.adminRecord ?? undefined });
    }
    if (name === 'ScanCommand') {
      return Promise.resolve({ Count: opts.adminCount ?? 0 });
    }
    throw new Error(`unexpected command ${name} on ${table}`);
  });
}

const SUB = 'user-sub-123';
const baseClaims = { sub: SUB, email: 'u@example.com' };

beforeEach(() => mockSend.mockReset());

describe('resolveCaller — live team roles', () => {
  it('reads team roles from DynamoDB, not the JWT claim', async () => {
    // The (now ignored) stale claim says writer on team-a; DynamoDB says nothing.
    scriptDynamo({ memberships: [] });
    const caller = (await resolveCaller(
      eventWith({ ...baseClaims, team_roles: '{"team-a":"writer"}' })
    )) as CallerIdentity;

    expect(caller.teams).toEqual([]);
    expect(canReadTeam(caller, 'team-a')).toBe(false);
  });

  it('denies a removed membership on the next request', async () => {
    // User was on team-a but the row is now gone.
    scriptDynamo({ memberships: [] });
    const caller = (await resolveCaller(eventWith(baseClaims))) as CallerIdentity;

    expect(canReadTeam(caller, 'team-a')).toBe(false);
    expect(canWriteTeam(caller, 'team-a')).toBe(false);
  });

  it('enforces a writer -> reader downgrade immediately', async () => {
    scriptDynamo({ memberships: [{ teamId: 'team-a', role: 'reader' }] });
    const caller = (await resolveCaller(eventWith(baseClaims))) as CallerIdentity;

    expect(canReadTeam(caller, 'team-a')).toBe(true);
    expect(canWriteTeam(caller, 'team-a')).toBe(false);
  });

  it('fails closed (deny) when the memberships query throws', async () => {
    scriptDynamo({ throwOn: 'memberships', adminRecord: null });
    const caller = (await resolveCaller(eventWith(baseClaims))) as CallerIdentity;

    expect(caller.teams).toEqual([]);
    expect(canReadTeam(caller, 'team-a')).toBe(false);
  });
});

describe('resolveCaller — live admin status', () => {
  it('is admin when a durable Admins-table row exists', async () => {
    scriptDynamo({ memberships: [], adminRecord: { userId: SUB } });
    const caller = (await resolveCaller(eventWith(baseClaims))) as CallerIdentity;

    expect(caller.isAdmin).toBe(true);
    expect(caller.adminViaFallback).toBe(false);
  });

  it('revokes admin on the next request after the row is deleted', async () => {
    // No row, not in the Cognito group either.
    scriptDynamo({ memberships: [], adminRecord: null });
    const caller = (await resolveCaller(eventWith(baseClaims))) as CallerIdentity;

    expect(caller.isAdmin).toBe(false);
  });

  it('does NOT grant admin from the Cognito group once any admin row exists', async () => {
    // Group member, but the Admins table is non-empty -> bootstrap is over.
    scriptDynamo({ memberships: [], adminRecord: null, adminCount: 1 });
    const caller = (await resolveCaller(
      eventWith({ ...baseClaims, 'cognito:groups': '[admins]' })
    )) as CallerIdentity;

    expect(caller.isAdmin).toBe(false);
    expect(caller.adminViaFallback).toBe(false);
  });

  it('grants admin via the bootstrap fallback only when zero admin rows exist', async () => {
    scriptDynamo({ memberships: [], adminRecord: null, adminCount: 0 });
    const caller = (await resolveCaller(
      eventWith({ ...baseClaims, 'cognito:groups': '[admins]' })
    )) as CallerIdentity;

    expect(caller.isAdmin).toBe(true);
    expect(caller.adminViaFallback).toBe(true);
  });

  it('returns null when no user id can be extracted', async () => {
    scriptDynamo({});
    const caller = await resolveCaller(eventWith({}));
    expect(caller).toBeNull();
  });
});
