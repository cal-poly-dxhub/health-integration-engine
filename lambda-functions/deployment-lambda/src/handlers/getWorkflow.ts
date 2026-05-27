import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, DescribeStateMachineCommand } from '@aws-sdk/client-sfn';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { validateJWTToken, extractUserIdFromEvent, createAuthErrorResponse, createSuccessHeaders } from '../utils/auth';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sfnClient = new SFNClient({ region: process.env.AWS_REGION });
const cfnClient = new CloudFormationClient({ region: process.env.AWS_REGION });

const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';

/**
 * Get workflow details from database
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Get workflow event:', JSON.stringify({ httpMethod: event.httpMethod, path: event.path, pathParameters: event.pathParameters }, null, 2));

  try {
    const workflowId = event.pathParameters?.workflowId;
    
    if (!workflowId) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          error: 'Workflow ID is required',
        }),
      };
    }

    // Validate authentication - try API Gateway authorizer first, then JWT validation
    let userId = extractUserIdFromEvent(event);
    
    if (!userId) {
      // Fallback to manual JWT validation
      const authResult = await validateJWTToken(event);
      if (!authResult.isValid) {
        console.error('JWT validation failed:', authResult.error);
        return createAuthErrorResponse(authResult.error || 'Valid authentication token required');
      }
      userId = authResult.userId!;
    }

    // Fetch workflow from database
    const workflow = await getWorkflowFromDatabase(workflowId, userId);
    
    if (!workflow) {
      return {
        statusCode: 404,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          error: 'Workflow not found',
        }),
      };
    }

    // Refresh deployment status from AWS if workflow has Step Function ARN
    const updatedWorkflow = await refreshWorkflowDeploymentStatus(workflow, userId);

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify(updatedWorkflow),
    };

  } catch (error) {
    console.error('Get workflow error:', error);
    
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
 * Get workflow from database
 */
async function getWorkflowFromDatabase(workflowId: string, userId: string): Promise<any | null> {
  try {
    console.log('Looking up workflow:', { workflowId, userId });
    
    const response = await docClient.send(new GetCommand({
      TableName: WORKFLOWS_TABLE,
      Key: {
        PK: `USER#${userId}`,
        SK: `WORKFLOW#${workflowId}`,
      },
    }));

    if (!response.Item) {
      console.log('No workflow found with ID:', workflowId);
      return null;
    }

    console.log('Found workflow record:', {
      id: response.Item.id,
      name: response.Item.name,
      isDeployed: response.Item.isDeployed,
      deploymentStatus: response.Item.deploymentStatus,
      stepFunctionArn: response.Item.stepFunctionArn,
    });

    return response.Item;
    
  } catch (error) {
    console.error('Error fetching workflow:', error);
    return null;
  }
}

/**
 * Refresh deployment status from AWS for a single workflow
 */
async function refreshWorkflowDeploymentStatus(workflow: any, userId: string): Promise<any> {
  // Skip if no Step Function ARN or already marked as failed
  if (!workflow.stepFunctionArn || workflow.deploymentStatus === 'failed') {
    return workflow;
  }

  try {
    // Check if Step Function still exists and is active
    const stepFunctionStatus = await checkStepFunctionStatus(workflow.stepFunctionArn);
    
    // Check CloudFormation stack status if we have a stack name
    const stackName = `workflow-${workflow.id}`;
    const cloudFormationStatus = await checkCloudFormationStatus(stackName);

    // Determine actual deployment status
    let actualStatus = workflow.deploymentStatus;
    let isDeployed = workflow.isDeployed;

    const stackIsComplete = cloudFormationStatus === 'CREATE_COMPLETE' || cloudFormationStatus === 'UPDATE_COMPLETE';
    
    if (stepFunctionStatus === 'ACTIVE' && stackIsComplete) {
      actualStatus = 'deployed';
      isDeployed = true;
    } else if (stepFunctionStatus === 'DELETING' || cloudFormationStatus === 'DELETE_IN_PROGRESS') {
      actualStatus = 'deleting';
      isDeployed = false;
    } else if (stepFunctionStatus === null && (cloudFormationStatus === 'DELETE_COMPLETE' || cloudFormationStatus === null)) {
      actualStatus = 'draft';
      isDeployed = false;
    } else if (cloudFormationStatus === 'CREATE_FAILED' || cloudFormationStatus === 'UPDATE_FAILED' || cloudFormationStatus === 'ROLLBACK_COMPLETE') {
      actualStatus = 'failed';
      isDeployed = false;
    } else if (cloudFormationStatus === 'CREATE_IN_PROGRESS' || cloudFormationStatus === 'UPDATE_IN_PROGRESS') {
      actualStatus = 'deploying';
      isDeployed = false;
    }

    // Update database if status changed
    if (actualStatus !== workflow.deploymentStatus || isDeployed !== workflow.isDeployed) {
      console.log(`Updating workflow ${workflow.id} status: ${workflow.deploymentStatus} -> ${actualStatus}`);
      
      await updateWorkflowDeploymentStatus(workflow.id, userId, {
        deploymentStatus: actualStatus,
        isDeployed,
        updatedAt: new Date().toISOString(),
      });

      return {
        ...workflow,
        deploymentStatus: actualStatus,
        isDeployed,
        updatedAt: new Date().toISOString(),
      };
    }

    return workflow;
  } catch (error) {
    console.error(`Error checking deployment status for workflow ${workflow.id}:`, error);
    return workflow;
  }
}

/**
 * Check Step Function status
 */
async function checkStepFunctionStatus(stateMachineArn: string): Promise<string | null> {
  try {
    const response = await sfnClient.send(new DescribeStateMachineCommand({
      stateMachineArn,
    }));
    
    return response.status || 'ACTIVE';
  } catch (error: any) {
    if (error.name === 'StateMachineDoesNotExist') {
      return null;
    }
    console.error('Error checking Step Function status:', error);
    return null;
  }
}

/**
 * Check CloudFormation stack status
 */
async function checkCloudFormationStatus(stackName: string): Promise<string | null> {
  try {
    const response = await cfnClient.send(new DescribeStacksCommand({
      StackName: stackName,
    }));
    
    const stack = response.Stacks?.[0];
    return stack?.StackStatus || null;
  } catch (error: any) {
    if (error.name === 'ValidationError' && error.message.includes('does not exist')) {
      return 'DELETE_COMPLETE';
    }
    console.error('Error checking CloudFormation status:', error);
    return null;
  }
}

/**
 * Update workflow deployment status in database
 */
async function updateWorkflowDeploymentStatus(
  workflowId: string, 
  userId: string, 
  updates: { deploymentStatus: string; isDeployed: boolean; updatedAt: string }
): Promise<void> {
  try {
    await docClient.send(new UpdateCommand({
      TableName: WORKFLOWS_TABLE,
      Key: {
        PK: `USER#${userId}`,
        SK: `WORKFLOW#${workflowId}`,
      },
      UpdateExpression: 'SET deploymentStatus = :status, isDeployed = :deployed, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':status': updates.deploymentStatus,
        ':deployed': updates.isDeployed,
        ':updatedAt': updates.updatedAt,
      },
    }));
  } catch (error) {
    console.error('Error updating workflow deployment status:', error);
    throw error;
  }
}