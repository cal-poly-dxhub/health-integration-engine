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
    // States.JsonToString converts the Lambda result object to a JSON string for S3
    if (s3Config?.objectKey) {
      // Static key configured — always use it
      parameters = {
        Bucket: s3Config?.bucketName || 'default-bucket',
        Key: s3Config.objectKey,
        'Body.$': 'States.JsonToString($.lambdaResult.Payload)',
        ...(s3Config?.metadata && { Metadata: s3Config.metadata }),
      };
    } else if (triggerOnUpload) {
      // No static key + trigger mode: use Choice to handle manual vs event-triggered
      return {
        Type: 'Choice',
        Comment: `S3 write routing: ${node.name} (event-triggered with manual fallback)`,
        Choices: [
          {
            Variable: '$.originalEvent.detail.object.key',
            IsPresent: true,
            Next: `${node.name || node.id}_EventWrite`,
          },
        ],
        Default: `${node.name || node.id}_StaticWrite`,
        _additionalStates: {
          [`${node.name || node.id}_EventWrite`]: {
            Type: 'Task',
            Resource: `arn:aws:states:::aws-sdk:s3:${awsOperation}`,
            Comment: `S3 write with event-derived key: ${node.name}`,
            Parameters: {
              Bucket: s3Config?.bucketName || 'default-bucket',
              'Key.$': "States.Format('{}.json', States.ArrayGetItem(States.StringSplit($.originalEvent.detail.object.key, '.'), 0))",
              'Body.$': 'States.JsonToString($.lambdaResult.Payload)',
              ...(s3Config?.metadata && { Metadata: s3Config.metadata }),
            },
            ResultPath: '$.s3Result',
            Next: nextState || 'End',
            Retry: [{ ErrorEquals: ['States.TaskFailed'], IntervalSeconds: 2, MaxAttempts: 3, BackoffRate: 2 }],
          },
          [`${node.name || node.id}_StaticWrite`]: {
            Type: 'Task',
            Resource: `arn:aws:states:::aws-sdk:s3:${awsOperation}`,
            Comment: `S3 write with default key (manual execution): ${node.name}`,
            Parameters: {
              Bucket: s3Config?.bucketName || 'default-bucket',
              Key: 'output.json',
              'Body.$': 'States.JsonToString($.lambdaResult.Payload)',
              ...(s3Config?.metadata && { Metadata: s3Config.metadata }),
            },
            ResultPath: '$.s3Result',
            Next: nextState || 'End',
            Retry: [{ ErrorEquals: ['States.TaskFailed'], IntervalSeconds: 2, MaxAttempts: 3, BackoffRate: 2 }],
          },
        },
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
      // For event-triggered reads: use a Choice state to check if the event data exists
      // If originalEvent.detail exists, read from the triggering file
      // Otherwise fall back to the statically configured bucket/key
      const staticBucket = s3Config?.bucketName || 'default-bucket';
      const staticKey = s3Config?.objectKey || 'default-key';

      // Return a Choice state that branches based on whether event data is present
      return {
        Type: 'Choice',
        Comment: `S3 read routing: ${node.name} (event-triggered with manual fallback)`,
        Choices: [
          {
            Variable: '$.originalEvent.detail.bucket.name',
            IsPresent: true,
            Next: `${node.name || node.id}_EventRead`,
          },
        ],
        Default: `${node.name || node.id}_StaticRead`,
        // Attach sub-states that the CFT generator will merge
        _additionalStates: {
          [`${node.name || node.id}_EventRead`]: {
            Type: 'Task',
            Resource: `arn:aws:states:::aws-sdk:s3:${awsOperation}`,
            Comment: `S3 read from trigger event: ${node.name}`,
            Parameters: {
              'Bucket.$': '$.originalEvent.detail.bucket.name',
              'Key.$': '$.originalEvent.detail.object.key',
            },
            ResultPath: '$.s3Result',
            Next: nextState || 'End',
            Retry: [{ ErrorEquals: ['States.TaskFailed'], IntervalSeconds: 2, MaxAttempts: 3, BackoffRate: 2 }],
          },
          [`${node.name || node.id}_StaticRead`]: {
            Type: 'Task',
            Resource: `arn:aws:states:::aws-sdk:s3:${awsOperation}`,
            Comment: `S3 read from config (manual execution): ${node.name}`,
            Parameters: {
              Bucket: staticBucket,
              Key: staticKey,
            },
            ResultPath: '$.s3Result',
            Next: nextState || 'End',
            Retry: [{ ErrorEquals: ['States.TaskFailed'], IntervalSeconds: 2, MaxAttempts: 3, BackoffRate: 2 }],
          },
        },
      };
    }
    // Static config for non-triggered read operations
    parameters = {
      Bucket: s3Config?.bucketName || 'default-bucket',
      Key: s3Config?.objectKey || 'default-key',
    };
  } else {
    // Static config for other operations (list, delete)
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
