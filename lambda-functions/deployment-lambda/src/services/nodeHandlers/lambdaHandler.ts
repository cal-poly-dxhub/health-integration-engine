import { NodeHandlerRegistry, NodeHandler } from './index';

/**
 * Lambda node handler
 */
export const lambdaHandler: NodeHandler = (node, nextState, workflow, deploymentContext) => {
  const nodeName = node.name || `Lambda${node.id}`;
  const userFunctionName = node.config?.functionName || nodeName;
  const sanitizedName = userFunctionName.replace(/[^a-zA-Z0-9]/g, '');
  const actualFunctionName = `${deploymentContext.workflowId}-${sanitizedName}`;

  return {
    Type: 'Task',
    Resource: 'arn:aws:states:::lambda:invoke',
    Comment: `Lambda function: ${nodeName}`,
    Parameters: {
      FunctionName: actualFunctionName,
      Payload: {
        'input.$': '$',
        'nodeId': node.id,
        'nodeName': nodeName,
        ...node.config?.parameters,
      },
    },
    ResultPath: '$.lambdaResult',
    Next: nextState || 'End',
    Retry: [
      {
        ErrorEquals: ['Lambda.ServiceException', 'Lambda.AWSLambdaException', 'Lambda.SdkClientException'],
        IntervalSeconds: 2,
        MaxAttempts: 6,
        BackoffRate: 2,
      },
    ],
  };
};

// Auto-register the handler
NodeHandlerRegistry.register('lambda', lambdaHandler);
