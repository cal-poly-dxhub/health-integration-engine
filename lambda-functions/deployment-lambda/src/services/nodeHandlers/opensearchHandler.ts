import { NodeHandlerRegistry, NodeHandler } from './index';

/**
 * OpenSearch Serverless node handler - supports index operations
 */
export const opensearchHandler: NodeHandler = (node, nextState, workflow, deploymentContext) => {
  const config = node.config as any;
  const nodeName = node.name || `OpenSearch${node.id}`;

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
        'executionId.$': '$$.Execution.Id',
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
};

// Auto-register the handler
NodeHandlerRegistry.register('opensearch', opensearchHandler);
