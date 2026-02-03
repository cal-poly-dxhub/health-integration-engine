import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, DescribeExecutionCommand, GetExecutionHistoryCommand } from '@aws-sdk/client-sfn';

import { DeploymentStatus } from '../types/deployment';
import { extractUserIdFromEvent, createAuthErrorResponse, createSuccessHeaders } from '../utils/auth';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sfnClient = new SFNClient({ region: process.env.AWS_REGION });

const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE || 'WorkflowBuilder-Deployments';

/**
 * Get deployment status
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Get deployment status event:', JSON.stringify(event, null, 2));

  try {
    const deploymentId = event.pathParameters?.deploymentId;
    
    if (!deploymentId) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          error: 'Deployment ID is required',
        }),
      };
    }

    // Get user ID from JWT token - no fallback to demo-user
    const userId = extractUserIdFromEvent(event);
    
    if (!userId) {
      console.error('❌ No user ID found in JWT token');
      return createAuthErrorResponse('Valid authentication token required');
    }

    // Fetch deployment status from database and Step Functions
    const deploymentStatus = await getDeploymentStatusWithStepFunctions(deploymentId, userId);
    
    if (!deploymentStatus) {
      return {
        statusCode: 404,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          error: 'Deployment not found',
        }),
      };
    }

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify(deploymentStatus),
    };

  } catch (error) {
    console.error('Get deployment status error:', error);
    
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

/**
 * Get deployment status from database and Step Functions
 */
async function getDeploymentStatusWithStepFunctions(deploymentId: string, userId: string): Promise<DeploymentStatus | null> {
  try {
    console.log('🔍 Looking up deployment status for ID:', deploymentId);
    
    // Get basic deployment info from database with user ownership validation
    const response = await docClient.send(new ScanCommand({
      TableName: DEPLOYMENTS_TABLE,
      FilterExpression: 'deploymentId = :deploymentId AND userId = :userId',
      ExpressionAttributeValues: {
        ':deploymentId': deploymentId,
        ':userId': userId,
      },
    }));

    if (!response.Items || response.Items.length === 0) {
      console.log('❌ No deployment found with ID:', deploymentId);
      return null;
    }

    const deploymentRecord = response.Items[0];
    console.log('✅ Found deployment record:', deploymentRecord.status);

    // If we have a deployment execution ARN, get real-time status from Step Functions
    const executionArn = deploymentRecord.deploymentExecutionArn || deploymentRecord.stepFunctionArn;
    if (executionArn) {
      console.log('🔄 Getting real-time status from Step Functions:', executionArn);
      
      try {
        const stepFunctionStatus = await getStepFunctionStatus(executionArn);
        
        // Merge database record with Step Functions status
        const deploymentStatus: DeploymentStatus = {
          deploymentId: deploymentRecord.deploymentId,
          workflowId: deploymentRecord.workflowId,
          status: stepFunctionStatus.status,
          createdAt: deploymentRecord.createdAt,
          updatedAt: stepFunctionStatus.updatedAt,
          steps: stepFunctionStatus.steps,
          stepFunctionArn: deploymentRecord.stepFunctionArn, // Actual workflow ARN
          deploymentExecutionArn: deploymentRecord.deploymentExecutionArn, // Deployment execution ARN
          ...(stepFunctionStatus.error && { error: stepFunctionStatus.error }),
        };

        console.log('✅ Merged deployment status:', deploymentStatus.status, 'with', deploymentStatus.steps.length, 'steps');
        return deploymentStatus;
        
      } catch (sfnError) {
        console.error('❌ Error getting Step Functions status, falling back to database:', sfnError);
        // Fall back to database record
      }
    }

    // Return database record as-is if no Step Functions ARN or error
    return deploymentRecord as DeploymentStatus;
    
  } catch (error) {
    console.error('❌ Error fetching deployment status:', error);
    return null;
  }
}

/**
 * Get deployment status from Step Functions execution
 */
async function getStepFunctionStatus(executionArn: string): Promise<{
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  updatedAt: string;
  steps: any[];
  error?: any;
}> {
  console.log('📊 Getting Step Functions execution details:', executionArn);
  
  // Get execution details
  const execution = await sfnClient.send(new DescribeExecutionCommand({
    executionArn: executionArn,
  }));

  console.log('📋 Step Functions execution status:', execution.status);

  // Map Step Functions status to our deployment status
  let status: 'pending' | 'in_progress' | 'completed' | 'failed';
  switch (execution.status) {
    case 'RUNNING':
      status = 'in_progress';
      break;
    case 'SUCCEEDED':
      status = 'completed';
      break;
    case 'FAILED':
    case 'TIMED_OUT':
    case 'ABORTED':
      status = 'failed';
      break;
    default:
      status = 'pending';
  }

  // Get execution history to build steps
  const history = await sfnClient.send(new GetExecutionHistoryCommand({
    executionArn: executionArn,
    maxResults: 100,
    reverseOrder: false,
  }));

  console.log('📚 Got', history.events?.length || 0, 'execution events');

  // Parse execution history into deployment steps
  const steps = parseExecutionHistory(history.events || []);

  return {
    status,
    updatedAt: execution.stopDate?.toISOString() || execution.startDate?.toISOString() || new Date().toISOString(),
    steps,
    ...(execution.status === 'FAILED' && execution.error && {
      error: {
        code: 'STEP_FUNCTION_FAILED',
        message: execution.error,
        details: execution.cause,
      },
    }),
  };
}

/**
 * Parse Step Functions execution history into deployment steps
 */
function parseExecutionHistory(events: any[]): any[] {
  const steps: any[] = [];
  const taskStates = new Map<string, any>();

  // Process events to identify task executions
  for (const event of events) {
    const timestamp = event.timestamp?.toISOString() || new Date().toISOString();

    switch (event.type) {
      case 'TaskStateEntered':
        if (event.stateEnteredEventDetails?.name) {
          const stepName = event.stateEnteredEventDetails.name;
          taskStates.set(stepName, {
            id: stepName.toLowerCase().replace(/\s+/g, '-'),
            name: stepName,
            status: 'in_progress',
            startTime: timestamp,
          });
        }
        break;

      case 'TaskStateExited':
        if (event.stateExitedEventDetails?.name) {
          const stepName = event.stateExitedEventDetails.name;
          const step = taskStates.get(stepName);
          if (step) {
            step.status = 'completed';
            step.endTime = timestamp;
            step.duration = new Date(timestamp).getTime() - new Date(step.startTime).getTime();
          }
        }
        break;

      case 'TaskFailed':
        if (event.taskFailedEventDetails) {
          // Find the corresponding step and mark as failed
          const failedSteps = Array.from(taskStates.values()).filter(s => s.status === 'in_progress');
          if (failedSteps.length > 0) {
            const step = failedSteps[failedSteps.length - 1]; // Get the most recent in-progress step
            step.status = 'failed';
            step.endTime = timestamp;
            step.duration = new Date(timestamp).getTime() - new Date(step.startTime).getTime();
            step.error = {
              code: event.taskFailedEventDetails.error || 'TASK_FAILED',
              message: event.taskFailedEventDetails.cause || 'Task execution failed',
            };
          }
        }
        break;

      case 'LambdaFunctionSucceeded':
      case 'LambdaFunctionFailed':
        // Handle Lambda function executions
        const isSuccess = event.type === 'LambdaFunctionSucceeded';
        const lambdaStep = {
          id: `lambda-${event.id}`,
          name: isSuccess ? 'Lambda Function Executed' : 'Lambda Function Failed',
          status: isSuccess ? 'completed' : 'failed',
          startTime: timestamp,
          endTime: timestamp,
          duration: 0,
          ...(event.type === 'LambdaFunctionFailed' && {
            error: {
              code: 'LAMBDA_FAILED',
              message: event.lambdaFunctionFailedEventDetails?.cause || 'Lambda function failed',
            },
          }),
        };
        steps.push(lambdaStep);
        break;
    }
  }

  // Add all task states to steps
  steps.push(...Array.from(taskStates.values()));

  // If no specific steps found, create generic ones based on execution status
  if (steps.length === 0) {
    const executionStart = events.find(e => e.type === 'ExecutionStarted')?.timestamp?.toISOString() || new Date().toISOString();
    const executionEnd = events.find(e => e.type === 'ExecutionSucceeded' || e.type === 'ExecutionFailed')?.timestamp?.toISOString();
    
    steps.push(
      {
        id: 'initialization',
        name: 'Initialize Deployment',
        status: 'completed',
        startTime: executionStart,
        endTime: executionEnd || executionStart,
      },
      {
        id: 'resource-creation',
        name: 'Create AWS Resources',
        status: executionEnd ? 'completed' : 'in_progress',
        startTime: executionStart,
        endTime: executionEnd,
      }
    );
  }

  // Sort steps by start time
  steps.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  console.log('📋 Parsed', steps.length, 'deployment steps from execution history');
  return steps;
}