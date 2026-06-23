import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createHash } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  LambdaClient,
  PublishLayerVersionCommand,
  DeleteLayerVersionCommand,
  UpdateFunctionConfigurationCommand,
  ListFunctionsCommand,
  ListTagsCommand,
} from '@aws-sdk/client-lambda';
import { createAuthErrorResponse, createSuccessHeaders } from '../utils/auth';
import { resolveCaller, canReadTeam, canWriteTeam, readableTeamIds, forbidden, unauthenticated, CallerIdentity } from '../utils/authz';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({ region: process.env.AWS_REGION });
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';
const LAMBDA_CODE_BUCKET = process.env.LAMBDA_CODE_BUCKET || '';

// AWS Lambda layer hard limits (zipped)
const MAX_LAYER_ZIP_BYTES = 50 * 1024 * 1024; // 50 MiB

// Tag used to scope the live-detach sweep on layer deletion
const MANAGED_BY_TAG_KEY = 'ManagedBy';
const MANAGED_BY_TAG_VALUE = 'workflow-builder';

/**
 * Unified handler for layer CRUD operations
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Layer handler event:', JSON.stringify({ method: event.httpMethod, path: event.path }, null, 2));

  // Authenticate. Layers are scoped per team (mirroring workflows); each
  // operation does its own canRead/canWrite check. Pending users (zero teams,
  // not admin) can't use the system at all.
  const caller = await resolveCaller(event);
  if (!caller) return unauthenticated();
  if (!caller.isAdmin && caller.teams.length === 0) {
    return createAuthErrorResponse('Your account is pending. An admin must add you to a team before you can use this feature.');
  }

  try {
    const resource = event.resource || event.path || '';
    if (event.httpMethod === 'POST' && resource.endsWith('/layers/upload-url')) {
      return await getUploadUrl(event, caller);
    }

    switch (event.httpMethod) {
      case 'POST':
        return await createLayer(event, caller);
      case 'GET':
        return await listLayers(event, caller);
      case 'DELETE':
        return await deleteLayer(event, caller);
      default:
        return { statusCode: 405, headers: createSuccessHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
    }
  } catch (error) {
    console.error('Layer handler error:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' }),
    };
  }
};

function generateLayerId(): string {
  return `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Per-team namespace for the AWS layer name. Layer names are account-global,
 * so we prefix with a short hash of the teamId to prevent cross-team collisions.
 */
function teamNamespace(teamId: string): string {
  return createHash('sha256').update(teamId).digest('hex').slice(0, 12);
}

function buildLayerName(teamId: string, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9-_]/g, '-');
  return `wb-${teamNamespace(teamId)}-${safe}`;
}

/**
 * S3 key depends on teamId + layerId, not the user-supplied name — this avoids
 * ambiguity when two layers share a sanitized name.
 */
function buildS3Key(teamId: string, layerId: string): string {
  return `layers/${teamId}/${layerId}/layer.zip`;
}

/**
 * Issue a presigned PUT URL so the browser can upload the zip directly to S3,
 * bypassing API Gateway/Lambda payload limits.
 *
 * The ContentType is pinned at signing time — the client MUST send the same
 * Content-Type header on the PUT or S3 will reject the upload.
 */
async function getUploadUrl(event: APIGatewayProxyEvent, caller: CallerIdentity): Promise<APIGatewayProxyResult> {
  if (!event.body) {
    return { statusCode: 400, headers: createSuccessHeaders(), body: JSON.stringify({ error: 'Request body is required' }) };
  }

  const body = JSON.parse(event.body);
  const { name, teamId } = body as { name?: string; teamId?: string };

  if (!name) {
    return { statusCode: 400, headers: createSuccessHeaders(), body: JSON.stringify({ error: 'name is required' }) };
  }
  if (!teamId) {
    return { statusCode: 400, headers: createSuccessHeaders(), body: JSON.stringify({ error: 'teamId is required' }) };
  }
  if (!canWriteTeam(caller, teamId)) {
    return forbidden('You do not have writer access on this team');
  }

  const layerId = generateLayerId();
  const s3Key = buildS3Key(teamId, layerId);
  const contentType = 'application/zip';

  const uploadUrl = await getSignedUrl(
    s3Client,
    new PutObjectCommand({
      Bucket: LAMBDA_CODE_BUCKET,
      Key: s3Key,
      ContentType: contentType,
    }),
    { expiresIn: 900 }
  );

  return {
    statusCode: 200,
    headers: createSuccessHeaders(),
    body: JSON.stringify({ uploadUrl, s3Key, layerId, contentType }),
  };
}

/**
 * Create a new Lambda Layer from a zip already uploaded to S3 via presigned URL.
 * Verifies the object exists, belongs to the caller, and is within the size limit
 * before publishing the layer version. Rolls back the published layer version
 * if the DynamoDB record write fails.
 */
async function createLayer(event: APIGatewayProxyEvent, caller: CallerIdentity): Promise<APIGatewayProxyResult> {
  if (!event.body) {
    return { statusCode: 400, headers: createSuccessHeaders(), body: JSON.stringify({ error: 'Request body is required' }) };
  }

  const body = JSON.parse(event.body);
  const { name, description, compatibleRuntimes, compatibleArchitectures, s3Key, layerId, teamId } = body;

  if (!name || !compatibleRuntimes?.length || !s3Key || !layerId || !teamId) {
    return {
      statusCode: 400,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'name, compatibleRuntimes, s3Key, layerId, and teamId are required' }),
    };
  }

  if (!canWriteTeam(caller, teamId)) {
    return forbidden('You do not have writer access on this team');
  }

  const expectedPrefix = `layers/${teamId}/${layerId}/`;
  if (!s3Key.startsWith(expectedPrefix)) {
    return {
      statusCode: 403,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 's3Key does not belong to the target team' }),
    };
  }

  // Enforce unique layer name within the team (trimmed, case-sensitive —
  // same rule as workflow names).
  const trimmedName = String(name).trim();
  if (!trimmedName) {
    return { statusCode: 400, headers: createSuccessHeaders(), body: JSON.stringify({ error: 'name is required' }) };
  }
  const existing = await getTeamLayers(teamId);
  if (existing.some(l => (l.name || '').trim() === trimmedName)) {
    return {
      statusCode: 409,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        error: `A layer named "${trimmedName}" already exists in this team. Please choose a different name.`,
        code: 'NAME_CONFLICT',
      }),
    };
  }

  // HeadObject confirms upload happened AND gives us ContentLength for size enforcement
  let contentLength: number | undefined;
  try {
    const head = await s3Client.send(new HeadObjectCommand({ Bucket: LAMBDA_CODE_BUCKET, Key: s3Key }));
    contentLength = head.ContentLength;
  } catch (err) {
    return {
      statusCode: 400,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Uploaded zip not found at s3Key. Upload before creating the layer.' }),
    };
  }

  if (contentLength !== undefined && contentLength > MAX_LAYER_ZIP_BYTES) {
    // Clean up the oversize object so it doesn't accumulate in the bucket
    try {
      await s3Client.send(new DeleteObjectCommand({ Bucket: LAMBDA_CODE_BUCKET, Key: s3Key }));
    } catch (err) {
      console.warn('Failed to delete oversize layer zip:', err);
    }
    return {
      statusCode: 413,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        error: `Layer zip is ${(contentLength / 1024 / 1024).toFixed(1)} MiB; AWS limit is 50 MiB zipped`,
      }),
    };
  }

  const layerName = buildLayerName(teamId, trimmedName);
  const publishResult = await lambdaClient.send(new PublishLayerVersionCommand({
    LayerName: layerName,
    Description: description || '',
    Content: { S3Bucket: LAMBDA_CODE_BUCKET, S3Key: s3Key },
    CompatibleRuntimes: compatibleRuntimes,
    CompatibleArchitectures: compatibleArchitectures || ['x86_64'],
  }));

  const createdAt = new Date().toISOString();
  const layerRecord = {
    PK: `LAYER#${layerId}`,
    SK: 'META',
    GSI1PK: `TEAM#${teamId}`,
    GSI1SK: `LAYER#${createdAt}#${layerId}`,
    id: layerId,
    name: trimmedName,
    description: description || '',
    compatibleRuntimes,
    compatibleArchitectures: compatibleArchitectures || ['x86_64'],
    layerArn: publishResult.LayerArn,
    layerVersionArn: publishResult.LayerVersionArn,
    layerName,
    version: publishResult.Version,
    s3Key,
    sizeBytes: contentLength,
    createdAt,
    teamId,
    createdBy: caller.userId,
    createdByEmail: caller.email,
  };

  try {
    await docClient.send(new PutCommand({ TableName: WORKFLOWS_TABLE, Item: layerRecord }));
  } catch (err) {
    console.error('DDB put failed; rolling back published layer version:', err);
    try {
      await lambdaClient.send(new DeleteLayerVersionCommand({
        LayerName: layerName,
        VersionNumber: publishResult.Version,
      }));
    } catch (rollbackErr) {
      console.error('Rollback DeleteLayerVersion failed (orphan layer version may exist):', rollbackErr);
    }
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Failed to persist layer metadata; published layer was rolled back' }),
    };
  }

  return {
    statusCode: 201,
    headers: createSuccessHeaders(),
    body: JSON.stringify({ message: 'Layer created successfully', layer: layerRecord }),
  };
}

/**
 * List layers visible to the caller. Mirrors listWorkflows:
 *   - optional ?teamId= filters to one team (must be readable)
 *   - admins with no filter see all layers (scan)
 *   - otherwise: union of the caller's readable teams
 */
async function listLayers(event: APIGatewayProxyEvent, caller: CallerIdentity): Promise<APIGatewayProxyResult> {
  const teamFilter = event.queryStringParameters?.teamId;
  const allowed = readableTeamIds(caller); // null = admin / all teams

  let items: any[];
  if (teamFilter) {
    if (allowed !== null && !allowed.includes(teamFilter)) {
      // Caller asked for a team they can't read — return empty rather than 403.
      return ok([]);
    }
    items = await queryLayersByTeam(teamFilter);
  } else if (allowed === null) {
    items = await scanAllLayers();
  } else if (allowed.length === 0) {
    items = [];
  } else {
    const lists = await Promise.all(allowed.map(t => queryLayersByTeam(t)));
    items = lists.flat();
  }

  const layers = items.map(toLayerDto);
  // Newest first.
  layers.sort((a, b) => (b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0));
  return ok(layers);
}

function ok(layers: any[]): APIGatewayProxyResult {
  return { statusCode: 200, headers: createSuccessHeaders(), body: JSON.stringify({ layers }) };
}

function toLayerDto(item: any) {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    compatibleRuntimes: item.compatibleRuntimes,
    compatibleArchitectures: item.compatibleArchitectures,
    layerVersionArn: item.layerVersionArn,
    version: item.version,
    sizeBytes: item.sizeBytes,
    createdAt: item.createdAt,
    teamId: item.teamId,
  };
}

/** Query all layer records for a team via the shared GSI1 (TEAM# partition). */
async function queryLayersByTeam(teamId: string): Promise<any[]> {
  const items: any[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const resp = await docClient.send(new QueryCommand({
      TableName: WORKFLOWS_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: { ':pk': `TEAM#${teamId}`, ':sk': 'LAYER#' },
      ExclusiveStartKey: lastKey,
      ScanIndexForward: false,
    }));
    items.push(...(resp.Items || []));
    lastKey = resp.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

/** Scan all layer records (admin only). Filters to layer META items. */
async function scanAllLayers(): Promise<any[]> {
  const items: any[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const resp = await docClient.send(new ScanCommand({
      TableName: WORKFLOWS_TABLE,
      FilterExpression: 'SK = :sk AND begins_with(PK, :pk)',
      ExpressionAttributeValues: { ':sk': 'META', ':pk': 'LAYER#' },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(resp.Items || []));
    lastKey = resp.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

/** Layer id+name pairs for a team — used to enforce unique names. */
async function getTeamLayers(teamId: string): Promise<Array<{ id: string; name: string }>> {
  const items = await queryLayersByTeam(teamId);
  return items.map(i => ({ id: i.id, name: i.name }));
}

/**
 * Delete a layer: remove from AWS, S3, and DynamoDB.
 *
 * Refuses deletion when the layer is attached to a deployed workflow unless
 * ?force=true is passed. Detaches from saved-workflow records with optimistic
 * locking, then strips the ARN from any live wb-managed Lambda functions
 * (scoped via tag) so we don't sweep unrelated functions in the account.
 */
async function deleteLayer(event: APIGatewayProxyEvent, caller: CallerIdentity): Promise<APIGatewayProxyResult> {
  const layerId = event.pathParameters?.layerId;
  if (!layerId) {
    return { statusCode: 400, headers: createSuccessHeaders(), body: JSON.stringify({ error: 'layerId is required' }) };
  }

  const force = event.queryStringParameters?.force === 'true';

  // Fetch layer record by id.
  const result = await docClient.send(new GetCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `LAYER#${layerId}`, SK: 'META' },
  }));

  const layer = result.Item;
  if (!layer) {
    return { statusCode: 404, headers: createSuccessHeaders(), body: JSON.stringify({ error: 'Layer not found' }) };
  }

  if (!canWriteTeam(caller, layer.teamId)) {
    return forbidden('You do not have writer access on this team');
  }

  const layerVersionArn = layer.layerVersionArn;

  // Scan for workflow records (WORKFLOW#…/META) that reference this layer ARN,
  // then detach. Bounded by Lambda timeout; acceptable at this project's scale.
  const workflowsScan = await docClient.send(new ScanCommand({
    TableName: WORKFLOWS_TABLE,
    FilterExpression: 'SK = :sk AND begins_with(PK, :pk)',
    ExpressionAttributeValues: { ':sk': 'META', ':pk': 'WORKFLOW#' },
  }));
  const referencingWorkflows = (workflowsScan.Items || []).filter(w =>
    (w.nodes || []).some((n: any) => n.type === 'lambda' && n.config?.layers?.includes(layerVersionArn))
  );
  const deployedReferences = referencingWorkflows.filter(w => w.isDeployed);

  if (deployedReferences.length > 0 && !force) {
    return {
      statusCode: 409,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        error: 'Layer is in use by deployed workflows. Pass ?force=true to delete and detach.',
        deployedWorkflows: deployedReferences.map(w => ({ id: w.id, name: w.name })),
        totalReferences: referencingWorkflows.length,
      }),
    };
  }

  // Delete layer version from AWS Lambda
  try {
    // Use the stored layerName when available (newer records); fall back to layerArn for older records
    const layerNameForDelete = layer.layerName || layer.layerArn;
    await lambdaClient.send(new DeleteLayerVersionCommand({
      LayerName: layerNameForDelete,
      VersionNumber: layer.version,
    }));
  } catch (err) {
    console.warn('Failed to delete layer version from AWS (may already be deleted):', err);
  }

  // Delete zip from S3
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: LAMBDA_CODE_BUCKET, Key: layer.s3Key }));
  } catch (err) {
    console.warn('Failed to delete layer zip from S3:', err);
  }

  // Delete DynamoDB record
  await docClient.send(new DeleteCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `LAYER#${layerId}`, SK: 'META' },
  }));

  // Detach layer from saved workflows that reference it.
  // Use a version-based ConditionExpression so we don't clobber a concurrent edit.
  for (const workflow of referencingWorkflows) {
    await detachLayerFromWorkflowWithRetry(workflow, layerVersionArn);
  }

  // Remove layer from live deployed Lambda functions, but only those tagged
  // ManagedBy=workflow-builder so we don't touch unrelated functions in the account.
  await detachLayerFromManagedFunctions(layerVersionArn);

  return {
    statusCode: 200,
    headers: createSuccessHeaders(),
    body: JSON.stringify({
      message: 'Layer deleted successfully',
      layerId,
      detachedFromWorkflows: referencingWorkflows.length,
    }),
  };
}

/**
 * Detach the given layerVersionArn from a single workflow record using optimistic
 * locking. Retries up to 3 times if the workflow's version changes between read
 * and write.
 */
async function detachLayerFromWorkflowWithRetry(workflowItem: any, layerVersionArn: string): Promise<void> {
  const MAX_ATTEMPTS = 3;
  let currentItem = workflowItem;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const expectedVersion = currentItem.version;
    const nodes = (currentItem.nodes || []).map((node: any) => {
      if (node.type === 'lambda' && node.config?.layers?.includes(layerVersionArn)) {
        return {
          ...node,
          config: {
            ...node.config,
            layers: node.config.layers.filter((arn: string) => arn !== layerVersionArn),
          },
        };
      }
      return node;
    });

    try {
      await docClient.send(new UpdateCommand({
        TableName: WORKFLOWS_TABLE,
        Key: { PK: currentItem.PK, SK: currentItem.SK },
        UpdateExpression: 'SET nodes = :nodes, version = :newVersion, updatedAt = :updatedAt',
        ConditionExpression: 'version = :expectedVersion',
        ExpressionAttributeValues: {
          ':nodes': nodes,
          ':expectedVersion': expectedVersion,
          ':newVersion': (expectedVersion || 0) + 1,
          ':updatedAt': new Date().toISOString(),
        },
      }));
      return;
    } catch (err: any) {
      if (err?.name !== 'ConditionalCheckFailedException') {
        console.warn(`Failed to detach layer from workflow ${currentItem.id}:`, err);
        return;
      }
      // Reload the workflow and try again
      const reloaded = await docClient.send(new QueryCommand({
        TableName: WORKFLOWS_TABLE,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: { ':pk': currentItem.PK, ':sk': currentItem.SK },
      }));
      const fresh = reloaded.Items?.[0];
      if (!fresh) return;
      // If the layer is no longer referenced after the concurrent edit, we're done
      const stillReferenced = (fresh.nodes || []).some(
        (n: any) => n.type === 'lambda' && n.config?.layers?.includes(layerVersionArn)
      );
      if (!stillReferenced) return;
      currentItem = fresh;
    }
  }
  console.warn(`Gave up detaching layer from workflow ${workflowItem.id} after ${MAX_ATTEMPTS} attempts`);
}

/**
 * Sweep live Lambda functions and strip the layer ARN, but ONLY from functions
 * tagged ManagedBy=workflow-builder. This bounds the blast radius to functions
 * this app deployed and avoids touching unrelated Lambdas in the account.
 */
async function detachLayerFromManagedFunctions(layerVersionArn: string): Promise<void> {
  try {
    let marker: string | undefined;
    do {
      const listResult = await lambdaClient.send(new ListFunctionsCommand({ Marker: marker }));
      for (const fn of listResult.Functions || []) {
        if (!fn.FunctionName || !fn.FunctionArn) continue;
        if (!fn.Layers?.some(l => l.Arn === layerVersionArn)) continue;

        // Tag-scope the sweep
        let isManaged = false;
        try {
          const tagResult = await lambdaClient.send(new ListTagsCommand({ Resource: fn.FunctionArn }));
          isManaged = tagResult.Tags?.[MANAGED_BY_TAG_KEY] === MANAGED_BY_TAG_VALUE;
        } catch (err) {
          console.warn(`Failed to read tags for ${fn.FunctionName}, skipping:`, err);
          continue;
        }

        if (!isManaged) continue;

        const remainingLayers = fn.Layers.filter(l => l.Arn !== layerVersionArn).map(l => l.Arn!);
        await lambdaClient.send(new UpdateFunctionConfigurationCommand({
          FunctionName: fn.FunctionName,
          Layers: remainingLayers,
        }));
        console.log(`Removed layer from managed function: ${fn.FunctionName}`);
      }
      marker = listResult.NextMarker;
    } while (marker);
  } catch (err) {
    console.warn('Failed to sweep managed functions for layer detach:', err);
  }
}
