import { NodeHandlerRegistry, NodeHandler } from './index';

/**
 * S3 node handler - supports different S3 operations
 * For read operations with triggerOnUpload: reads bucket/key from the preserved original EventBridge event
 * For write operations: always uses the node's own configured bucket/key and writes the Lambda result
 */
export const s3Handler: NodeHandler = (node, nextState) => {
  const s3Config = node.config as any;
  const operation = s3Config?.operation || 'read';
  const triggerOnUpload = s3Config?.triggerOnUpload ?? true;
  
  const operationMap: Record<string, string> = {
    read: 'getObject',
    write: 'putObject',
    list: 'listObjects',
    delete: 'deleteObject',
  };
  
  const awsOperation = operationMap[operation] || 'getObject';
  
  let parameters: any;
  
  if (operation === 'write') {
    // Write operations always use the node's own configured bucket
    // and write the Lambda-processed result as the body
    // States.JsonToString converts the Lambda result object to a JSON string for S3
    // States.Format replaces the file extension with .json for the output key
    parameters = {
      Bucket: s3Config?.bucketName || 'default-bucket',
      ...(s3Config?.objectKey
        ? { Key: s3Config.objectKey }
        : triggerOnUpload
          ? { 'Key.$': "States.Format('{}.json', States.ArrayGetItem(States.StringSplit($.originalEvent.detail.object.key, '.'), 0))" }
          : { Key: 'output.json' }),
      'Body.$': 'States.JsonToString($.lambdaResult.Payload)',
      ...(s3Config?.metadata && { Metadata: s3Config.metadata }),
    };
  } else if (triggerOnUpload && operation === 'read') {
    // Read from the triggering file using the EventBridge event data
    parameters = {
      'Bucket.$': '$.originalEvent.detail.bucket.name',
      'Key.$': '$.originalEvent.detail.object.key',
    };
  } else {
    // Static config for non-triggered operations
    parameters = {
      Bucket: s3Config?.bucketName || 'default-bucket',
      Key: s3Config?.objectKey || 'default-key',
      ...(operation === 'write' && { Body: s3Config?.body || 'default-content' }),
      ...(s3Config?.metadata && { Metadata: s3Config.metadata }),
    };
  }
  
  return {
    Type: 'Task',
    Resource: `arn:aws:states:::aws-sdk:s3:${awsOperation}`,
    Comment: `S3 ${operation} operation: ${node.name}${triggerOnUpload ? ' (event-triggered)' : ''}`,
    Parameters: parameters,
    ResultPath: '$.s3Result',
    Next: nextState || 'End',
    Retry: [
      {
        ErrorEquals: ['States.TaskFailed'],
        IntervalSeconds: 2,
        MaxAttempts: 3,
        BackoffRate: 2,
      },
    ],
  };
};

// Auto-register the handler
NodeHandlerRegistry.register('s3', s3Handler);
