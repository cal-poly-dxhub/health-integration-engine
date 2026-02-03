import { NodeHandlerRegistry, NodeHandler } from './index';

/**
 * S3 node handler - supports different S3 operations
 */
export const s3Handler: NodeHandler = (node, nextState) => {
  const s3Config = node.config as any;
  const operation = s3Config?.operation || 'write';
  
  const operationMap: Record<string, string> = {
    read: 'getObject',
    write: 'putObject',
    list: 'listObjects',
    delete: 'deleteObject',
  };
  
  const awsOperation = operationMap[operation] || 'putObject';
  
  return {
    Type: 'Task',
    Resource: `arn:aws:states:::aws-sdk:s3:${awsOperation}`,
    Comment: `S3 ${operation} operation: ${node.name}`,
    Parameters: {
      Bucket: s3Config?.bucketName || 'default-bucket',
      Key: s3Config?.objectKey || 'default-key',
      ...(operation === 'write' && { Body: s3Config?.body || 'default-content' }),
      ...(s3Config?.metadata && { Metadata: s3Config.metadata }),
    },
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