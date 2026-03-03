import { NodeHandlerRegistry, NodeHandler } from './index';

/**
 * OpenSearch Serverless node handler - supports index and search operations
 */
export const opensearchHandler: NodeHandler = (node, nextState, workflow, deploymentContext) => {
  const config = node.config as any;
  const operation = config?.operation || 'index';
  const nodeName = node.name || `OpenSearch${node.id}`;

  if (operation === 'index') {
    return {
      Type: 'Task',
      Resource: 'arn:aws:states:::lambda:invoke',
      Comment: `OpenSearch index: ${nodeName}`,
      Parameters: {
        FunctionName: `${deploymentContext?.workflowId}-opensearch-indexer`,
        Payload: {
          'operation': 'index',
          'indexName': config.indexName || 'health-messages',
          'workflowId': deploymentContext?.workflowId,
          'document.$': '$.lambdaResult.Payload',
          'metadata.$': '$.originalEvent.detail',
        },
      },
      ResultPath: '$.opensearchResult',
      Next: nextState || 'End',
      Retry: [
        {
          ErrorEquals: ['Lambda.ServiceException', 'Lambda.TooManyRequestsException', 'Lambda.SdkClientException'],
          IntervalSeconds: 2,
          MaxAttempts: 3,
          BackoffRate: 2,
        },
      ],
    };
  }

  if (operation === 'search') {
    return {
      Type: 'Task',
      Resource: 'arn:aws:states:::lambda:invoke',
      Comment: `OpenSearch search: ${nodeName}`,
      Parameters: {
        FunctionName: `${deploymentContext?.workflowId}-opensearch-searcher`,
        Payload: {
          'operation': 'search',
          'indexName': config.indexName || 'health-messages',
          'workflowId': deploymentContext?.workflowId,
          'searchConfig': {
            queryType: config.queryType || 'bool',
            dateRangeField: config.dateRangeField || 'ingestedAt',
            dateRangeDays: config.dateRangeDays || 2,
          },
          'query.$': '$.searchQuery',
        },
      },
      ResultPath: '$.opensearchResult',
      Next: nextState || 'End',
      Retry: [
        {
          ErrorEquals: ['Lambda.ServiceException', 'Lambda.TooManyRequestsException'],
          IntervalSeconds: 2,
          MaxAttempts: 3,
          BackoffRate: 2,
        },
      ],
    };
  }

  // Default pass-through for unsupported operations
  return {
    Type: 'Pass',
    Comment: `OpenSearch operation: ${operation} (unsupported)`,
    Next: nextState || 'End',
  };
};

// Auto-register the handler
NodeHandlerRegistry.register('opensearch', opensearchHandler);
