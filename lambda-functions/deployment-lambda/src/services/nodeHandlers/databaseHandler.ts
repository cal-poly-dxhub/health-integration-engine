import { NodeHandlerRegistry, NodeHandler } from './index';

/**
 * Database node handler - supports multiple database types
 */
export const databaseHandler: NodeHandler = (node, nextState) => {
  const dbConfig = node.config as any;
  
  if (dbConfig?.engine === 'dynamodb') {
    return {
      Type: 'Task',
      Resource: 'arn:aws:states:::aws-sdk:dynamodb:putItem',
      Comment: `DynamoDB operation: ${node.name}`,
      Parameters: {
        TableName: dbConfig.tableName || 'default-table',
        Item: dbConfig.item || { id: { S: 'default-id' } },
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
  }
  
  // Default to RDS Data API for other database types
  return {
    Type: 'Task',
    Resource: 'arn:aws:states:::aws-sdk:rdsdata:executeStatement',
    Comment: `Database operation: ${node.name}`,
    Parameters: {
      ResourceArn: dbConfig?.resourceArn || 'arn:aws:rds:region:account:cluster:default',
      SecretArn: dbConfig?.secretArn || 'arn:aws:secretsmanager:region:account:secret:default',
      Sql: dbConfig?.query || 'SELECT 1',
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
NodeHandlerRegistry.register('database', databaseHandler);