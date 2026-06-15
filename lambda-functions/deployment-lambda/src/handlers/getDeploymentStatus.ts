import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, DescribeExecutionCommand, GetExecutionHistoryCommand } from '@aws-sdk/client-sfn';

import { DeploymentStatus } from '../types/deployment';
import { createSuccessHeaders } from '../utils/auth';
import { resolveCaller, canReadTeam, unauthenticated } from '../utils/authz';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sfnClient = new SFNClient({ region: process.env.AWS_REGION });

const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE || 'WorkflowBuilder-Deployments';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const deploymentId = event.pathParameters?.deploymentId;
    if (!deploymentId) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'Deployment ID is required' }),
      };
    }

    const caller = await resolveCaller(event);
    if (!caller) return unauthenticated();

    const deploymentRecord = await getDeploymentRecord(deploymentId);
    if (!deploymentRecord) {
      return {
        statusCode: 404,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'Deployment not found' }),
      };
    }

    // Authorize: caller must be reader on the deployment's team. Older
    // records may not have teamId; fall back to allowing any authenticated
    // caller to view (these are pre-migration records from the wipe).
    if (deploymentRecord.teamId && !canReadTeam(caller, deploymentRecord.teamId)) {
      return {
        statusCode: 404,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'Deployment not found' }),
      };
    }

    const deploymentStatus = await enrichWithStepFunctions(deploymentRecord);
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

async function getDeploymentRecord(deploymentId: string): Promise<any | null> {
  const response = await docClient.send(new QueryCommand({
    TableName: DEPLOYMENTS_TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `DEPLOYMENT#${deploymentId}` },
  }));
  return response.Items?.[0] || null;
}

async function enrichWithStepFunctions(deploymentRecord: any): Promise<DeploymentStatus> {
  const executionArn = deploymentRecord.deploymentExecutionArn || deploymentRecord.stepFunctionArn;
  if (executionArn) {
    try {
      const stepFunctionStatus = await getStepFunctionStatus(executionArn);
      return {
        deploymentId: deploymentRecord.deploymentId,
        workflowId: deploymentRecord.workflowId,
        teamId: deploymentRecord.teamId,
        createdBy: deploymentRecord.createdBy,
        createdByEmail: deploymentRecord.createdByEmail,
        status: stepFunctionStatus.status,
        createdAt: deploymentRecord.createdAt,
        updatedAt: stepFunctionStatus.updatedAt,
        steps: stepFunctionStatus.steps,
        stepFunctionArn: deploymentRecord.stepFunctionArn,
        deploymentExecutionArn: deploymentRecord.deploymentExecutionArn,
        ...(stepFunctionStatus.error && { error: stepFunctionStatus.error }),
      };
    } catch (sfnError) {
      console.error('Error getting Step Functions status, falling back to database:', sfnError);
    }
  }
  return deploymentRecord as DeploymentStatus;
}

async function getStepFunctionStatus(executionArn: string): Promise<{
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  updatedAt: string;
  steps: any[];
  error?: any;
}> {
  const execution = await sfnClient.send(new DescribeExecutionCommand({ executionArn }));

  let status: 'pending' | 'in_progress' | 'completed' | 'failed';
  switch (execution.status) {
    case 'RUNNING': status = 'in_progress'; break;
    case 'SUCCEEDED': status = 'completed'; break;
    case 'FAILED':
    case 'TIMED_OUT':
    case 'ABORTED': status = 'failed'; break;
    default: status = 'pending';
  }

  const history = await sfnClient.send(new GetExecutionHistoryCommand({
    executionArn, maxResults: 100, reverseOrder: false,
  }));

  return {
    status,
    updatedAt: execution.stopDate?.toISOString() || execution.startDate?.toISOString() || new Date().toISOString(),
    steps: parseExecutionHistory(history.events || []),
    ...(execution.status === 'FAILED' && execution.error && {
      error: { code: 'STEP_FUNCTION_FAILED', message: execution.error, details: execution.cause },
    }),
  };
}

function parseExecutionHistory(events: any[]): any[] {
  const steps: any[] = [];
  const taskStates = new Map<string, any>();
  for (const event of events) {
    const timestamp = event.timestamp?.toISOString() || new Date().toISOString();
    switch (event.type) {
      case 'TaskStateEntered':
        if (event.stateEnteredEventDetails?.name) {
          const stepName = event.stateEnteredEventDetails.name;
          taskStates.set(stepName, { id: stepName.toLowerCase().replace(/\s+/g, '-'), name: stepName, status: 'in_progress', startTime: timestamp });
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
          const failedSteps = Array.from(taskStates.values()).filter(s => s.status === 'in_progress');
          if (failedSteps.length > 0) {
            const step = failedSteps[failedSteps.length - 1];
            step.status = 'failed';
            step.endTime = timestamp;
            step.duration = new Date(timestamp).getTime() - new Date(step.startTime).getTime();
            step.error = { code: event.taskFailedEventDetails.error || 'TASK_FAILED', message: event.taskFailedEventDetails.cause || 'Task execution failed' };
          }
        }
        break;
      case 'LambdaFunctionSucceeded':
      case 'LambdaFunctionFailed': {
        const isSuccess = event.type === 'LambdaFunctionSucceeded';
        steps.push({
          id: `lambda-${event.id}`,
          name: isSuccess ? 'Lambda Function Executed' : 'Lambda Function Failed',
          status: isSuccess ? 'completed' : 'failed',
          startTime: timestamp,
          endTime: timestamp,
          duration: 0,
          ...(event.type === 'LambdaFunctionFailed' && {
            error: { code: 'LAMBDA_FAILED', message: event.lambdaFunctionFailedEventDetails?.cause || 'Lambda function failed' },
          }),
        });
        break;
      }
    }
  }
  steps.push(...Array.from(taskStates.values()));
  if (steps.length === 0) {
    const executionStart = events.find(e => e.type === 'ExecutionStarted')?.timestamp?.toISOString() || new Date().toISOString();
    const executionEnd = events.find(e => e.type === 'ExecutionSucceeded' || e.type === 'ExecutionFailed')?.timestamp?.toISOString();
    steps.push(
      { id: 'initialization', name: 'Initialize Deployment', status: 'completed', startTime: executionStart, endTime: executionEnd || executionStart },
      { id: 'resource-creation', name: 'Create AWS Resources', status: executionEnd ? 'completed' : 'in_progress', startTime: executionStart, endTime: executionEnd },
    );
  }
  steps.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  return steps;
}
