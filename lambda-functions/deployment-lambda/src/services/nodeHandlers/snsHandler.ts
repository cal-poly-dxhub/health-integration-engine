import { NodeHandlerRegistry, NodeHandler } from './index';

/**
 * SNS node handler - sends notifications via Amazon SNS
 * 
 * Configuration options:
 * - topicArn: ARN of the SNS topic to publish to
 * - message: Message content to send
 * - subject: Optional subject line for email notifications
 * - messageAttributes: Optional message attributes
 */
export const snsHandler: NodeHandler = (node, nextState) => {
  const snsConfig = node.config as any;
  
  return {
    Type: 'Task',
    Resource: 'arn:aws:states:::sns:publish',
    Comment: `SNS publish: ${node.name}`,
    Parameters: {
      TopicArn: snsConfig?.topicArn || 'arn:aws:sns:us-east-1:123456789012:default-topic',
      Message: snsConfig?.message || 'Default notification message',
      ...(snsConfig?.subject && { Subject: snsConfig.subject }),
      ...(snsConfig?.messageAttributes && { MessageAttributes: snsConfig.messageAttributes }),
    },
    Next: nextState || 'End',
    Retry: [
      {
        ErrorEquals: ['SNS.AmazonSNSException', 'States.TaskFailed'],
        IntervalSeconds: 2,
        MaxAttempts: 3,
        BackoffRate: 2,
      },
    ],
    Catch: [
      {
        ErrorEquals: ['States.ALL'],
        Next: 'End',
        ResultPath: '$.error',
      },
    ],
  };
};

// Auto-register the handler
// Uncomment this line when 'sns' is added to the workflow node types
// NodeHandlerRegistry.register('sns', snsHandler);