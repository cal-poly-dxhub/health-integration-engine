import {
  indexerRoleArn,
  buildIndexerPolicyDocument,
  parsePrincipals,
  addPrincipal,
  removePrincipal,
} from '../openSearchAccessManager';

describe('openSearchAccessManager pure helpers', () => {
  const account = '123456789012';
  const collection = 'health-msgs-789012';

  describe('indexerRoleArn', () => {
    it('builds the deterministic per-workflow indexer role ARN', () => {
      expect(indexerRoleArn(account, 'wf-abc')).toBe(
        'arn:aws:iam::123456789012:role/OpenSearch-Lambda-Role-wf-abc'
      );
    });
  });

  describe('addPrincipal', () => {
    it('appends a new principal', () => {
      expect(addPrincipal([], 'a')).toEqual(['a']);
      expect(addPrincipal(['a'], 'b')).toEqual(['a', 'b']);
    });

    it('is idempotent for an existing principal', () => {
      expect(addPrincipal(['a', 'b'], 'a')).toEqual(['a', 'b']);
    });

    it('does not mutate the input array', () => {
      const input = ['a'];
      addPrincipal(input, 'b');
      expect(input).toEqual(['a']);
    });
  });

  describe('removePrincipal', () => {
    it('removes the matching principal', () => {
      expect(removePrincipal(['a', 'b'], 'a')).toEqual(['b']);
    });

    it('is a no-op when the principal is absent', () => {
      expect(removePrincipal(['a', 'b'], 'c')).toEqual(['a', 'b']);
    });

    it('can empty the list', () => {
      expect(removePrincipal(['a'], 'a')).toEqual([]);
    });
  });

  describe('buildIndexerPolicyDocument / parsePrincipals round-trip', () => {
    it('produces a document whose principals parse back', () => {
      const arn = indexerRoleArn(account, 'wf-1');
      const doc = buildIndexerPolicyDocument(collection, [arn]);
      expect(parsePrincipals(doc)).toEqual([arn]);
    });

    it('scopes rules to the collection name', () => {
      const doc = JSON.parse(buildIndexerPolicyDocument(collection, ['arn:x']));
      const indexRule = doc[0].Rules.find((r: any) => r.ResourceType === 'index');
      const collectionRule = doc[0].Rules.find((r: any) => r.ResourceType === 'collection');
      expect(indexRule.Resource).toEqual([`index/${collection}/*`]);
      expect(collectionRule.Resource).toEqual([`collection/${collection}`]);
    });

    it('never grants account-root', () => {
      const doc = buildIndexerPolicyDocument(collection, [indexerRoleArn(account, 'wf-1')]);
      expect(doc).not.toContain(':root');
    });

    it('grants write/create-index permissions to indexers', () => {
      const doc = JSON.parse(buildIndexerPolicyDocument(collection, ['arn:x']));
      const indexRule = doc[0].Rules.find((r: any) => r.ResourceType === 'index');
      expect(indexRule.Permission).toEqual(
        expect.arrayContaining(['aoss:CreateIndex', 'aoss:WriteDocument'])
      );
    });
  });

  describe('parsePrincipals', () => {
    it('accepts the parsed object form from GetAccessPolicy', () => {
      const obj = [{ Principal: ['arn:a', 'arn:b'] }];
      expect(parsePrincipals(obj)).toEqual(['arn:a', 'arn:b']);
    });

    it('dedupes principals across statements', () => {
      const obj = [{ Principal: ['arn:a'] }, { Principal: ['arn:a', 'arn:b'] }];
      expect(parsePrincipals(obj).sort()).toEqual(['arn:a', 'arn:b']);
    });

    it('returns [] for undefined, malformed JSON, or non-array policies', () => {
      expect(parsePrincipals(undefined)).toEqual([]);
      expect(parsePrincipals('{not json')).toEqual([]);
      expect(parsePrincipals('{"Principal":"x"}')).toEqual([]);
    });
  });

  describe('add/remove composition models a deploy then delete', () => {
    it('returns to empty after granting and revoking the same workflow', () => {
      const arn = indexerRoleArn(account, 'wf-1');
      let principals: string[] = [];
      principals = addPrincipal(principals, arn);
      expect(principals).toEqual([arn]);
      principals = removePrincipal(principals, arn);
      expect(principals).toEqual([]);
    });

    it('retains other workflows when one is revoked', () => {
      const a = indexerRoleArn(account, 'wf-a');
      const b = indexerRoleArn(account, 'wf-b');
      let principals = addPrincipal(addPrincipal([], a), b);
      principals = removePrincipal(principals, a);
      expect(principals).toEqual([b]);
    });
  });
});
