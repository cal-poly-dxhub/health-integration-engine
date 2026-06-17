/**
 * openSearchAccessManager
 * -----------------------
 * Dynamically manages the Amazon OpenSearch Serverless (AOSS) *data access
 * policy* that authorises per-workflow indexer Lambda roles to write into the
 * shared collection.
 *
 * Why this exists
 * ---------------
 * AOSS data access policies do not support wildcard principals, and each
 * workflow's indexer role (`OpenSearch-Lambda-Role-<WorkflowId>`, created by
 * the per-workflow CloudFormation stack) is not known at CDK synth time.
 * Previously the CDK stack granted write access to the entire account root
 * (`arn:aws:iam::<account>:root`), which is overly permissive. Instead, this
 * module has the deployment Lambda add the *exact* indexer role ARN to a
 * dedicated data access policy when a workflow with an OpenSearch node is
 * deployed, and remove it when the workflow is deleted.
 *
 * AOSS evaluates the union of all data access policies that match a
 * collection, so this indexer policy composes with the static read-only
 * policy the CDK stack creates for the search Lambda.
 *
 * All public operations are best-effort and never throw: a failure to update
 * the policy is logged but must not break the deployment/deletion pipeline.
 */
import {
  OpenSearchServerlessClient,
  GetAccessPolicyCommand,
  CreateAccessPolicyCommand,
  UpdateAccessPolicyCommand,
  DeleteAccessPolicyCommand,
} from '@aws-sdk/client-opensearchserverless';

const ACCESS_POLICY_TYPE = 'data';
const MAX_CONFLICT_RETRIES = 5;

let cachedClient: OpenSearchServerlessClient | undefined;

function getClient(): OpenSearchServerlessClient {
  if (!cachedClient) {
    cachedClient = new OpenSearchServerlessClient({ region: process.env.AWS_REGION });
  }
  return cachedClient;
}

/**
 * Deterministic ARN of the per-workflow indexer role created by the workflow's
 * CloudFormation stack (see cloudFormationTemplateGenerator.ts:
 * `RoleName: OpenSearch-Lambda-Role-${WorkflowId}`).
 */
export function indexerRoleArn(accountId: string, workflowId: string): string {
  return `arn:aws:iam::${accountId}:role/OpenSearch-Lambda-Role-${workflowId}`;
}

/**
 * Build the AOSS data access policy document granting the supplied indexer
 * role ARNs read+write+create-index access on the collection. Pure function —
 * returns the JSON string AOSS expects.
 */
export function buildIndexerPolicyDocument(collectionName: string, principals: string[]): string {
  return JSON.stringify([
    {
      Description: 'Read+write access for per-workflow OpenSearch indexer Lambdas',
      Rules: [
        {
          ResourceType: 'index',
          Resource: [`index/${collectionName}/*`],
          Permission: [
            'aoss:CreateIndex',
            'aoss:UpdateIndex',
            'aoss:DescribeIndex',
            'aoss:ReadDocument',
            'aoss:WriteDocument',
          ],
        },
        {
          ResourceType: 'collection',
          Resource: [`collection/${collectionName}`],
          Permission: [
            'aoss:CreateCollectionItems',
            'aoss:UpdateCollectionItems',
            'aoss:DescribeCollectionItems',
          ],
        },
      ],
      Principal: principals,
    },
  ]);
}

/**
 * Extract the unique set of principal ARNs from an AOSS data access policy
 * document. Accepts either the parsed object form returned by GetAccessPolicy
 * or the JSON string form. Pure function.
 */
export function parsePrincipals(policy: unknown): string[] {
  let parsed: unknown = policy;
  if (typeof policy === 'string') {
    try {
      parsed = JSON.parse(policy);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const principals = new Set<string>();
  for (const statement of parsed) {
    const list = (statement as { Principal?: unknown })?.Principal;
    if (Array.isArray(list)) {
      for (const p of list) {
        if (typeof p === 'string') principals.add(p);
      }
    }
  }
  return [...principals];
}

/** Return a copy of `principals` that includes `arn` exactly once. Pure. */
export function addPrincipal(principals: string[], arn: string): string[] {
  return principals.includes(arn) ? [...principals] : [...principals, arn];
}

/** Return a copy of `principals` with `arn` removed. Pure. */
export function removePrincipal(principals: string[], arn: string): string[] {
  return principals.filter((p) => p !== arn);
}

/** True when both arrays contain the same set of values (order-insensitive). */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

function isErrorWithName(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === name;
}

/**
 * Read the current indexer policy, apply `mutate` to its principal list, and
 * persist the result (create / update / delete as appropriate). Retries on
 * AOSS optimistic-concurrency conflicts. Throws on unrecoverable errors —
 * callers wrap this in best-effort handling.
 */
async function updateIndexerPolicy(mutate: (principals: string[]) => string[]): Promise<void> {
  const policyName = process.env.OPENSEARCH_INDEXER_ACCESS_POLICY_NAME;
  const collectionName = process.env.OPENSEARCH_COLLECTION_NAME;

  if (!policyName || !collectionName) {
    console.warn(
      'openSearchAccessManager: OPENSEARCH_INDEXER_ACCESS_POLICY_NAME / OPENSEARCH_COLLECTION_NAME not set; skipping indexer access policy update (OpenSearch likely disabled).'
    );
    return;
  }

  const client = getClient();

  for (let attempt = 1; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
    let exists = true;
    let currentPrincipals: string[] = [];
    let currentVersion: string | undefined;

    try {
      const res = await client.send(
        new GetAccessPolicyCommand({ name: policyName, type: ACCESS_POLICY_TYPE })
      );
      currentPrincipals = parsePrincipals(res.accessPolicyDetail?.policy);
      currentVersion = res.accessPolicyDetail?.policyVersion;
    } catch (error) {
      if (isErrorWithName(error, 'ResourceNotFoundException')) {
        exists = false;
      } else {
        throw error;
      }
    }

    const nextPrincipals = mutate(currentPrincipals);

    // Nothing changed — no API call needed.
    if (exists && sameSet(nextPrincipals, currentPrincipals)) {
      return;
    }

    try {
      if (!exists) {
        if (nextPrincipals.length === 0) {
          return; // nothing to grant and no policy to create
        }
        await client.send(
          new CreateAccessPolicyCommand({
            name: policyName,
            type: ACCESS_POLICY_TYPE,
            policy: buildIndexerPolicyDocument(collectionName, nextPrincipals),
          })
        );
        return;
      }

      if (nextPrincipals.length === 0) {
        // AOSS requires at least one principal per statement; once the last
        // indexer role is removed, delete the policy entirely. It is recreated
        // on the next deploy.
        await client.send(
          new DeleteAccessPolicyCommand({
            name: policyName,
            type: ACCESS_POLICY_TYPE,
          })
        );
        return;
      }

      await client.send(
        new UpdateAccessPolicyCommand({
          name: policyName,
          type: ACCESS_POLICY_TYPE,
          policyVersion: currentVersion,
          policy: buildIndexerPolicyDocument(collectionName, nextPrincipals),
        })
      );
      return;
    } catch (error) {
      // Concurrent deploys/deletes can race on the same policy version; retry.
      if (isErrorWithName(error, 'ConflictException') && attempt < MAX_CONFLICT_RETRIES) {
        console.warn(
          `openSearchAccessManager: conflict updating indexer access policy (attempt ${attempt}/${MAX_CONFLICT_RETRIES}); retrying.`
        );
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `openSearchAccessManager: exhausted ${MAX_CONFLICT_RETRIES} retries updating indexer access policy`
  );
}

function resolveAccountId(): string | undefined {
  return process.env.AWS_ACCOUNT_ID || process.env.CDK_DEFAULT_ACCOUNT;
}

/**
 * Grant the given workflow's indexer role write access to the shared
 * collection. Best-effort: logs and swallows errors so deployment is never
 * blocked by an access-policy update failure.
 */
export async function grantIndexerAccess(workflowId: string): Promise<void> {
  const accountId = resolveAccountId();
  if (!accountId) {
    console.warn('openSearchAccessManager: AWS_ACCOUNT_ID not set; cannot grant indexer access.');
    return;
  }
  const arn = indexerRoleArn(accountId, workflowId);
  try {
    await updateIndexerPolicy((principals) => addPrincipal(principals, arn));
    console.log(`openSearchAccessManager: granted indexer access for ${arn}`);
  } catch (error) {
    console.error(
      `openSearchAccessManager: failed to grant indexer access for ${arn} (indexing may not work until resolved):`,
      error
    );
  }
}

/**
 * Revoke the given workflow's indexer role access from the shared collection.
 * Best-effort and idempotent: a missing principal/policy is treated as success.
 */
export async function revokeIndexerAccess(workflowId: string): Promise<void> {
  const accountId = resolveAccountId();
  if (!accountId) {
    console.warn('openSearchAccessManager: AWS_ACCOUNT_ID not set; cannot revoke indexer access.');
    return;
  }
  const arn = indexerRoleArn(accountId, workflowId);
  try {
    await updateIndexerPolicy((principals) => removePrincipal(principals, arn));
    console.log(`openSearchAccessManager: revoked indexer access for ${arn}`);
  } catch (error) {
    console.error(`openSearchAccessManager: failed to revoke indexer access for ${arn}:`, error);
  }
}
