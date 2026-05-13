import { NodeHandlerRegistry, NodeHandler } from './index';

/**
 * S3 node handler - supports different S3 operations
 * For read operations with triggerOnUpload: reads bucket/key from the preserved original EventBridge event
 * For write operations with triggerOnUpload: derives output key from the EventBridge event
 * Manual executions must pass the same EventBridge input format
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
    if (s3Config?.objectKey) {
      parameters = {
        Bucket: s3Config?.bucketName || 'default-bucket',
        Key: s3Config.objectKey,
        'Body.$': 'States.JsonToString($.lambdaResult.Payload)',
        ...(s3Config?.metadata && { Metadata: s3Config.metadata }),
      };
    } else if (triggerOnUpload) {
      // Derive output key from EventBridge event (input.txt → input.json)
      // Manual executions must pass the same EventBridge input format
      parameters = {
        Bucket: s3Config?.bucketName || 'default-bucket',
        'Key.$': "States.Format('{}.json', States.ArrayGetItem(States.StringSplit($.originalEvent.detail.object.key, '.'), 0))",
        'Body.$': 'States.JsonToString($.lambdaResult.Payload)',
        ...(s3Config?.metadata && { Metadata: s3Config.metadata }),
      };
    } else {
      parameters = {
        Bucket: s3Config?.bucketName || 'default-bucket',
        Key: 'output.json',
        'Body.$': 'States.JsonToString($.lambdaResult.Payload)',
        ...(s3Config?.metadata && { Metadata: s3Config.metadata }),
      };
    }
  } else if (operation === 'read') {
    if (triggerOnUpload) {
      // Read from the EventBridge event bucket/key directly
      // Manual executions must pass the same EventBridge input format
      parameters = {
        'Bucket.$': '$.originalEvent.detail.bucket.name',
        'Key.$': '$.originalEvent.detail.object.key',
      };
    } else {
      parameters = {
        Bucket: s3Config?.bucketName || 'default-bucket',
        Key: s3Config?.objectKey || 'default-key',
      };
    }
  } else {
    parameters = {
      Bucket: s3Config?.bucketName || 'default-bucket',
      Key: s3Config?.objectKey || 'default-key',
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
