import { Workflow, WorkflowNode, Connection } from '../types/workflow';
import { 
  LambdaFunctionConfig, 
  StepFunctionConfig, 
  IAMRoleConfig,
  DeploymentContext 
} from '../types/deployment';

export class WorkflowConverter {
  /**
   * Convert a workflow into AWS resources configuration
   */
  static convertWorkflowToAWSResources(
    workflow: Workflow,
    deploymentContext: DeploymentContext
  ): {
    lambdaFunctions: LambdaFunctionConfig[];
    stepFunction: StepFunctionConfig;
    iamRoles: IAMRoleConfig[];
  } {
    console.log('Converting workflow to AWS resources:', {
      workflowId: workflow.id,
      workflowName: workflow.name,
      nodeCount: workflow.nodes?.length || 0,
      connectionCount: workflow.connections?.length || 0,
    });

    const lambdaFunctions = this.generateLambdaFunctions(workflow, deploymentContext);
    const iamRoles = this.generateIAMRoles(workflow, deploymentContext);
    const stepFunction = this.generateStepFunction(workflow, deploymentContext, lambdaFunctions);

    console.log('AWS resources generated:', {
      lambdaFunctions: lambdaFunctions.length,
      iamRoles: iamRoles.length,
      stepFunctionName: stepFunction.stateMachineName,
    });

    return {
      lambdaFunctions,
      stepFunction,
      iamRoles,
    };
  }

  /**
   * Generate Lambda functions for Lambda nodes in the workflow
   */
  private static generateLambdaFunctions(
    workflow: Workflow,
    deploymentContext: DeploymentContext
  ): LambdaFunctionConfig[] {
    const lambdaNodes = workflow.nodes.filter(node => node.type === 'lambda');
    
    return lambdaNodes.map(node => {
      const config = node.config || {};
      const functionName = `${workflow.name.replace(/[^a-zA-Z0-9]/g, '-')}-${node.id}`;
      
      return {
        functionName,
        runtime: config.runtime || 'nodejs18.x',
        handler: 'index.handler',
        code: {
          zipFile: Buffer.from(this.generateLambdaCode(node, config)),
        },
        environment: {
          NODE_ENV: deploymentContext.environment,
          WORKFLOW_ID: workflow.id,
          NODE_ID: node.id,
          ...config.environment,
        },
        timeout: config.timeout || 30,
        memorySize: config.memory || 128,
        description: `Lambda function for ${node.name} in workflow ${workflow.name}`,
        tags: {
          WorkflowId: workflow.id,
          NodeId: node.id,
          NodeType: node.type,
          Environment: deploymentContext.environment,
          ...deploymentContext.configuration.tags,
        },
        tracingConfig: deploymentContext.configuration.enableXRay ? {
          mode: 'Active' as const,
        } : undefined,
      };
    });
  }

  /**
   * Generate Lambda function code based on node configuration
   */
  private static generateLambdaCode(node: WorkflowNode, config: any): string {
    if (config.code) {
      // Use user-provided code
      return config.code;
    }

    // Generate default Lambda code
    return `
const AWS = require('aws-sdk');

exports.handler = async (event, context) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    console.log('Context:', JSON.stringify(context, null, 2));
    
    try {
        // TODO: Implement your business logic here
        // This is a generated Lambda function for node: ${node.name}
        
        const result = {
            statusCode: 200,
            body: {
                message: 'Lambda function executed successfully',
                nodeId: '${node.id}',
                nodeName: '${node.name}',
                timestamp: new Date().toISOString(),
                input: event
            }
        };
        
        console.log('Result:', JSON.stringify(result, null, 2));
        return result;
        
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
};
`.trim();
  }

  /**
   * Generate Step Function state machine definition
   */
  private static generateStepFunction(
    workflow: Workflow,
    deploymentContext: DeploymentContext,
    lambdaFunctions: LambdaFunctionConfig[]
  ): StepFunctionConfig {
    const stateMachineName = `${workflow.name.replace(/[^a-zA-Z0-9]/g, '-')}-StateMachine`;
    const definition = this.generateStepFunctionDefinition(workflow, lambdaFunctions);
    
    return {
      stateMachineName,
      definition: JSON.stringify(definition, null, 2),
      roleArn: `arn:aws:iam::${process.env.AWS_ACCOUNT_ID}:role/${workflow.name.replace(/[^a-zA-Z0-9]/g, '-')}-StepFunctionRole`,
      loggingConfiguration: deploymentContext.configuration.enableLogging ? {
        level: 'ALL' as const,
        includeExecutionData: true,
        destinations: [{
          cloudWatchLogsLogGroup: {
            logGroupArn: `arn:aws:logs:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:log-group:/aws/stepfunctions/${stateMachineName}`,
          },
        }],
      } : undefined,
      tracingConfiguration: deploymentContext.configuration.enableXRay ? {
        enabled: true,
      } : undefined,
      tags: {
        WorkflowId: workflow.id,
        Environment: deploymentContext.environment,
        ...deploymentContext.configuration.tags,
      },
    };
  }

  /**
   * Generate Step Function definition JSON
   */
  private static generateStepFunctionDefinition(
    workflow: Workflow,
    lambdaFunctions: LambdaFunctionConfig[]
  ): any {
    const states: any = {};
    const startNode = workflow.nodes.find(node => node.type === 'start');
    
    if (!startNode) {
      throw new Error('Workflow must have a start node');
    }

    // Generate states for each node
    workflow.nodes.forEach(node => {
      const state = this.generateStateForNode(node, workflow, lambdaFunctions);
      if (state) {
        states[node.id] = state;
      }
    });

    // Set up transitions based on connections
    this.setupStateTransitions(states, workflow.connections, workflow.nodes);

    return {
      Comment: `Step Function for workflow: ${workflow.name}`,
      StartAt: startNode.id,
      States: states,
    };
  }

  /**
   * Generate a Step Function state for a workflow node
   */
  private static generateStateForNode(
    node: WorkflowNode,
    workflow: Workflow,
    lambdaFunctions: LambdaFunctionConfig[]
  ): any {
    switch (node.type) {
      case 'start':
        return {
          Type: 'Pass',
          Comment: `Start of workflow: ${workflow.name}`,
          Result: {
            message: 'Workflow started',
            timestamp: '$.timestamp',
            workflowId: workflow.id,
          },
        };

      case 'end':
        return {
          Type: 'Pass',
          Comment: 'End of workflow',
          Result: {
            message: 'Workflow completed successfully',
            timestamp: '$.timestamp',
            workflowId: workflow.id,
          },
          End: true,
        };

      case 'lambda':
        const lambdaFunction = lambdaFunctions.find(fn => 
          fn.functionName.includes(node.id)
        );
        return {
          Type: 'Task',
          Resource: `arn:aws:states:::lambda:invoke`,
          Parameters: {
            FunctionName: lambdaFunction?.functionName,
            Payload: {
              'input.$': '$',
              'nodeId': node.id,
              'nodeName': node.name,
            },
          },
          Comment: `Lambda task: ${node.name}`,
          Retry: [
            {
              ErrorEquals: ['Lambda.ServiceException', 'Lambda.AWSLambdaException', 'Lambda.SdkClientException'],
              IntervalSeconds: 2,
              MaxAttempts: 6,
              BackoffRate: 2,
            },
          ],
          Catch: [
            {
              ErrorEquals: ['States.TaskFailed'],
              Next: 'ErrorHandler',
              ResultPath: '$.error',
            },
          ],
        };

      case 's3':
        return this.generateS3State(node);

      case 'database':
        return this.generateDatabaseState(node);

      default:
        return {
          Type: 'Pass',
          Comment: `Unsupported node type: ${node.type}`,
        };
    }
  }

  /**
   * Generate S3 state
   */
  private static generateS3State(node: WorkflowNode): any {
    const config = node.config || {};
    
    switch (config.operation) {
      case 'read':
        return {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:s3:getObject',
          Parameters: {
            Bucket: config.bucketName,
            Key: config.objectKey || '$.objectKey',
          },
          Comment: `S3 Read: ${node.name}`,
          ResultPath: '$.s3Result',
        };

      case 'write':
        return {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:s3:putObject',
          Parameters: {
            Bucket: config.bucketName,
            Key: config.objectKey || '$.objectKey',
            Body: '$.body',
          },
          Comment: `S3 Write: ${node.name}`,
          ResultPath: '$.s3Result',
        };

      case 'list':
        return {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:s3:listObjectsV2',
          Parameters: {
            Bucket: config.bucketName,
            Prefix: config.prefix || '',
          },
          Comment: `S3 List: ${node.name}`,
          ResultPath: '$.s3Result',
        };

      default:
        return {
          Type: 'Pass',
          Comment: `S3 operation: ${config.operation}`,
          Result: {
            bucket: config.bucketName,
            operation: config.operation,
          },
        };
    }
  }

  /**
   * Generate Database state
   */
  private static generateDatabaseState(node: WorkflowNode): any {
    const config = node.config || {};
    
    if (config.connectionType === 'dynamodb') {
      return {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:scan',
        Parameters: {
          TableName: config.database,
        },
        Comment: `DynamoDB Query: ${node.name}`,
        ResultPath: '$.dbResult',
      };
    }

    // For other database types, use a Lambda function
    return {
      Type: 'Pass',
      Comment: `Database operation: ${node.name}`,
      Result: {
        connectionType: config.connectionType,
        host: config.host,
        database: config.database,
        query: config.query,
      },
    };
  }

  /**
   * Setup state transitions based on workflow connections
   */
  private static setupStateTransitions(
    states: any,
    connections: Connection[],
    nodes: WorkflowNode[]
  ): void {
    connections.forEach(connection => {
      const sourceState = states[connection.sourceNodeId];
      const targetNode = nodes.find(n => n.id === connection.targetNodeId);
      
      if (sourceState && targetNode && targetNode.type !== 'end') {
        if (!sourceState.End) {
          sourceState.Next = connection.targetNodeId;
        }
      }
    });

    // Add error handler state
    states.ErrorHandler = {
      Type: 'Pass',
      Comment: 'Error handler for workflow failures',
      Result: {
        error: 'Workflow execution failed',
        timestamp: '$.timestamp',
      },
      End: true,
    };
  }

  /**
   * Generate IAM roles for the Step Function and Lambda functions
   */
  private static generateIAMRoles(
    workflow: Workflow,
    deploymentContext: DeploymentContext
  ): IAMRoleConfig[] {
    const stepFunctionRoleName = `${workflow.name.replace(/[^a-zA-Z0-9]/g, '-')}-StepFunctionRole`;
    
    const stepFunctionRole: IAMRoleConfig = {
      roleName: stepFunctionRoleName,
      assumeRolePolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'states.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      }),
      policies: [
        {
          policyName: 'StepFunctionExecutionPolicy',
          policyDocument: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: [
                  'lambda:InvokeFunction',
                  's3:GetObject',
                  's3:PutObject',
                  's3:ListBucket',
                  'dynamodb:Scan',
                  'dynamodb:Query',
                  'dynamodb:GetItem',
                  'dynamodb:PutItem',
                  'dynamodb:UpdateItem',
                  'dynamodb:DeleteItem',
                  'logs:CreateLogGroup',
                  'logs:CreateLogStream',
                  'logs:PutLogEvents',
                  'xray:PutTraceSegments',
                  'xray:PutTelemetryRecords',
                ],
                Resource: '*',
              },
            ],
          }),
        },
      ],
      tags: {
        WorkflowId: workflow.id,
        Environment: deploymentContext.environment,
        ...deploymentContext.configuration.tags,
      },
    };

    // Lambda execution role
    const lambdaExecutionRole: IAMRoleConfig = {
      roleName: 'lambda-execution-role',
      assumeRolePolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'lambda.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      }),
      policies: [
        {
          policyName: 'LambdaExecutionPolicy',
          policyDocument: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: [
                  'logs:CreateLogGroup',
                  'logs:CreateLogStream',
                  'logs:PutLogEvents',
                  'xray:PutTraceSegments',
                  'xray:PutTelemetryRecords',
                ],
                Resource: '*',
              },
            ],
          }),
        },
      ],
      tags: {
        WorkflowId: workflow.id,
        Environment: deploymentContext.environment,
        ...deploymentContext.configuration.tags,
      },
    };

    return [stepFunctionRole, lambdaExecutionRole];
  }
}