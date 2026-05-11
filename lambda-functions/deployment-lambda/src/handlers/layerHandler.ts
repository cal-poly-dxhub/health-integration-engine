import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  LambdaClient,
  PublishLayerVersionCommand,
  DeleteLayerVersionCommand,
  GetFunctionConfigurationCommand,
  UpdateFunctionConfigurationCommand,
  ListFunctionsCommand,
} from '@aws-sdk/client-lambda';
import { extractUserIdFromEvent, validateJWTToken, createAuthErrorResponse, createSuccessHeaders } from '../utils/auth';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({ region: process.env.AWS_REGION });
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';
const LAMBDA_CODE_BUCKET = process.env.LAMBDA_CODE_BUCKET || '';

/**
 * Unified handler for layer CRUD operations
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Layer handler event:', JSON.stringify({ method: event.httpMethod, path: event.path }, null, 2));

  // Authenticate
  let userId = extractUserIdFromEvent(event);
  if (!userId) {
    const authResult = await validateJWTToken(event);
    if (!authResult.isValid) {
      return createAuthErrorResponse(authResult.error || 'Authentication required');
    }
    userId = authResult.userId!;
  }

  try {
    const resource = event.resource || event.path || '';
    if (event.httpMethod === 'POST' && resource.endsWith('/layers/upload-url')) {
      return await getUploadUrl(event, userId);
    }

    switch (event.httpMethod) {
      case 'POST':
        return await createLayer(event, userId);
      case 'GET':
        return await listLayers(userId);
      case 'DELETE':
        return await deleteLayer(event, userId);
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

function buildS3Key(userId: string, layerId: string, name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9-_]/g, '-');
  return `layers/${userId}/${layerId}/${safeName}.zip`;
}

/**
 * Issue a presigned PUT URL so the browser can upload the zip directly to S3,
 * bypassing API Gateway/Lambda payload limits.
 */
async function getUploadUrl(event: APIGatewayProxyEvent, userId: string): Promise<APIGatewayProxyResult> {
  if (!event.body) {
    return { statusCode: 400, headers: createSuccessHeaders(), body: JSON.stringify({ error: 'Request body is required' }) };
  }

  const body = JSON.parse(event.body);
  const { name, contentType } = body as { name?: string; contentType?: string };

  if (!name) {
    return { statusCode: 400, headers: createSuccessHeaders(), body: JSON.stringify({ error: 'name is required' }) };
  }

  const layerId = generateLayerId();
  const s3Key = buildS3Key(userId, layerId, name);

  const uploadUrl = await getSignedUrl(
    s3Client,
    new PutObjectCommand({
      Bucket: LAMBDA_CODE_BUCKET,
      Key: s3Key,
      ContentType: contentType || 'application/zip',
    }),
    { expiresIn: 900 }
  );

  return {
    statusCode: 200,
    headers: createSuccessHeaders(),
    body: JSON.stringify({ uploadUrl, s3Key, layerId, contentType: contentType || 'application/zip' }),
  };
}

/**
 * Create a new Lambda Layer from a zip already uploaded to S3 via presigned URL.
 * Verifies the object exists and the key belongs to the caller, then publishes
 * the layer version and stores metadata.
 */
async function createLayer(event: APIGatewayProxyEvent, userId: string): Promise<APIGatewayProxyResult> {
  if (!event.body) {
    return { statusCode: 400, headers: createSuccessHeaders(), body: JSON.stringify({ error: 'Request body is required' }) };
  }

  const body = JSON.parse(event.body);
  const { name, description, compatibleRuntimes, compatibleArchitectures, s3Key, layerId } = body;

  if (!name || !compatibleRuntimes?.length || !s3Key || !layerId) {
    return {
      statusCode: 400,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'name, compatibleRuntimes, s3Key, and layerId are required' }),
    };
  }

  const expectedPrefix = `layers/${userId}/${layerId}/`;
  if (!s3Key.startsWith(expectedPrefix)) {
    return {
      statusCode: 403,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 's3Key does not belong to the authenticated user' }),
    };
  }

  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: LAMBDA_CODE_BUCKET, Key: s3Key }));
  } catch (err) {
    return {
      statusCode: 400,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Uploaded zip not found at s3Key. Upload before creating the layer.' }),
    };
  }

  const publishResult = await lambdaClient.send(new PublishLayerVersionCommand({
    LayerName: `wb-${name.replace(/[^a-zA-Z0-9-_]/g, '-')}`,
    Description: description || '',
    Content: { S3Bucket: LAMBDA_CODE_BUCKET, S3Key: s3Key },
    CompatibleRuntimes: compatibleRuntimes,
    CompatibleArchitectures: compatibleArchitectures || ['x86_64'],
  }));

  const layerRecord = {
    PK: `USER#${userId}`,
    SK: `LAYER#${layerId}`,
    id: layerId,
    name,
    description: description || '',
    compatibleRuntimes,
    compatibleArchitectures: compatibleArchitectures || ['x86_64'],
    layerArn: publishResult.LayerArn,
    layerVersionArn: publishResult.LayerVersionArn,
    version: publishResult.Version,
    s3Key,
    createdAt: new Date().toISOString(),
    userId,
  };

  await docClient.send(new PutCommand({ TableName: WORKFLOWS_TABLE, Item: layerRecord }));

  return {
    statusCode: 201,
    headers: createSuccessHeaders(),
    body: JSON.stringify({ message: 'Layer created successfully', layer: layerRecord }),
  };
}

/**
 * List all layers for the authenticated user
 */
async function listLayers(userId: string): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(new QueryCommand({
    TableName: WORKFLOWS_TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':sk': 'LAYER#' },
  }));

  const layers = (result.Items || []).map(item => ({
    id: item.id,
    name: item.name,
    description: item.description,
    compatibleRuntimes: item.compatibleRuntimes,
    compatibleArchitectures: item.compatibleArchitectures,
    layerVersionArn: item.layerVersionArn,
    version: item.version,
    createdAt: item.createdAt,
  }));

  return {
    statusCode: 200,
    headers: createSuccessHeaders(),
    body: JSON.stringify({ layers }),
  };
}

/**
 * Delete a layer: remove from AWS, S3, and DynamoDB
 */
async function deleteLayer(event: APIGatewayProxyEvent, userId: string): Promise<APIGatewayProxyResult> {
  const layerId = event.pathParameters?.layerId;
  if (!layerId) {
    return { statusCode: 400, headers: createSuccessHeaders(), body: JSON.stringify({ error: 'layerId is required' }) };
  }

  // Fetch layer record
  const result = await docClient.send(new QueryCommand({
    TableName: WORKFLOWS_TABLE,
    KeyConditionExpression: 'PK = :pk AND SK = :sk',
    ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':sk': `LAYER#${layerId}` },
  }));

  const layer = result.Items?.[0];
  if (!layer) {
    return { statusCode: 404, headers: createSuccessHeaders(), body: JSON.stringify({ error: 'Layer not found' }) };
  }

  // Delete layer version from AWS Lambda
  try {
    await lambdaClient.send(new DeleteLayerVersionCommand({
      LayerName: layer.layerArn,
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
    Key: { PK: `USER#${userId}`, SK: `LAYER#${layerId}` },
  }));

  // Detach layer from all workflows that reference it
  const layerVersionArn = layer.layerVersionArn;
  try {
    const workflowsResult = await docClient.send(new QueryCommand({
      TableName: WORKFLOWS_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':sk': 'WORKFLOW#' },
    }));

    for (const workflow of workflowsResult.Items || []) {
      const nodes = workflow.nodes || [];
      let modified = false;

      for (const node of nodes) {
        if (node.type === 'lambda' && node.config?.layers?.includes(layerVersionArn)) {
          node.config.layers = node.config.layers.filter((arn: string) => arn !== layerVersionArn);
          modified = true;
        }
      }

      if (modified) {
        await docClient.send(new UpdateCommand({
          TableName: WORKFLOWS_TABLE,
          Key: { PK: workflow.PK, SK: workflow.SK },
          UpdateExpression: 'SET nodes = :nodes',
          ExpressionAttributeValues: { ':nodes': nodes },
        }));
      }
    }
  } catch (err) {
    console.warn('Failed to detach layer from workflows:', err);
  }

  // Remove layer from live deployed Lambda functions
  try {
    let marker: string | undefined;
    do {
      const listResult = await lambdaClient.send(new ListFunctionsCommand({ Marker: marker }));
      for (const fn of listResult.Functions || []) {
        if (!fn.FunctionName || !fn.Layers?.some(l => l.Arn === layerVersionArn)) continue;
        const remainingLayers = fn.Layers.filter(l => l.Arn !== layerVersionArn).map(l => l.Arn!);
        await lambdaClient.send(new UpdateFunctionConfigurationCommand({
          FunctionName: fn.FunctionName,
          Layers: remainingLayers,
        }));
        console.log(`Removed layer from live function: ${fn.FunctionName}`);
      }
      marker = listResult.NextMarker;
    } while (marker);
  } catch (err) {
    console.warn('Failed to remove layer from live functions:', err);
  }

  return {
    statusCode: 200,
    headers: createSuccessHeaders(),
    body: JSON.stringify({ message: 'Layer deleted successfully', layerId }),
  };
}
