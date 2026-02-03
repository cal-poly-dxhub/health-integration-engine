import { NodeHandlerRegistry, NodeHandler } from './index';

/**
 * Lambda node handler
 */
export const lambdaHandler: NodeHandler = (node, nextState, workflow, deploymentContext) => {
  const nodeName = node.name || `Lambda${node.id}`;
  // Use the user-specified function name from config, fallback to node name
  const userFunctionName = node.config?.functionName || nodeName;
  const sanitizedName = userFunctionName.replace(/[^a-zA-Z0-9]/g, '');

  // Use same truncation logic as CloudFormation template to ensure consistency
  const truncatedName = sanitizedName.length > 15 ? sanitizedName.substring(0, 15) : sanitizedName;

  // Resolve the actual function name using the deployment context
  // This creates the actual function name that will be deployed
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
    // Extract just the parsed JSON data from the Lambda response
    // This removes the Lambda wrapper and returns only the business logic output
    OutputPath: '$.Payload',
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