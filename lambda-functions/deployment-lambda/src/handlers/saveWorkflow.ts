import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { validateJWTToken, extractUserIdFromEvent, createAuthErrorResponse, createSuccessHeaders } from '../utils/auth';
import { Workflow } from '../types/workflow';
// Removed WorkflowStatusReconciler import - using simplified approach

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';

/**
 * Save or update a workflow in the database
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Save workflow event:', JSON.stringify(event, null, 2));

  try {
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

    // Parse request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          error: 'Request body is required',
        }),
      };
    }

    const workflowData = JSON.parse(event.body);
    
    // Validate required fields
    if (!workflowData.name) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          error: 'Workflow name is required',
        }),
      };
    }

    // Generate workflow ID if not provided (new workflow)
    const workflowId = workflowData.id || `workflow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    // Check if workflow exists (for updates)
    const existingWorkflow = await getExistingWorkflow(userId, workflowId);
    
    if (existingWorkflow && existingWorkflow.userId !== userId) {
      return {
        statusCode: 403,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          error: 'Access denied: You can only modify your own workflows',
        }),
      };
    }

    // Prepare workflow record
    const workflow: Workflow = {
      id: workflowId,
      name: workflowData.name,
      description: workflowData.description || '',
      nodes: workflowData.nodes || [],
      connections: workflowData.connections || [],
      vpcConfig: workflowData.vpcConfig,
      stepFunctionDefinition: workflowData.stepFunctionDefinition || {},
      deploymentStatus: existingWorkflow?.deploymentStatus || 'draft',
      isDeployed: existingWorkflow?.isDeployed || false,
      stepFunctionArn: existingWorkflow?.stepFunctionArn,
      lastDeploymentId: existingWorkflow?.lastDeploymentId,
      createdAt: existingWorkflow?.createdAt || now,
      updatedAt: now,
      userId: userId,
      version: (existingWorkflow?.version || 0) + 1,
    };

    // Handle concurrent updates with optimistic locking
    if (existingWorkflow && workflowData.version && workflowData.version !== existingWorkflow.version) {
      return {
        statusCode: 409,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          error: 'Workflow has been modified by another user. Please refresh and try again.',
          currentVersion: existingWorkflow.version,
          providedVersion: workflowData.version,
        }),
      };
    }

    // Save workflow to database
    await saveWorkflowToDatabase(userId, workflow);

    // Status reconciliation is handled in listWorkflows for now
    console.log('✅ Workflow saved, status reconciliation will occur on next list operation');

    console.log('✅ Workflow saved successfully:', { workflowId, userId, version: workflow.version });

    return {
      statusCode: existingWorkflow ? 200 : 201,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        message: existingWorkflow ? 'Workflow updated successfully' : 'Workflow created successfully',
        workflow: workflow,
      }),
    };

  } catch (error) {
    console.error('Save workflow error:', error);
    
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
 * Get existing workflow from database
 */
async function getExistingWorkflow(userId: string, workflowId: string): Promise<Workflow | null> {
  try {
    const response = await docClient.send(new GetCommand({
      TableName: WORKFLOWS_TABLE,
      Key: {
        PK: `USER#${userId}`,
        SK: `WORKFLOW#${workflowId}`,
      },
    }));

    return response.Item as Workflow || null;
  } catch (error) {
    console.error('Error fetching existing workflow:', error);
    return null;
  }
}

/**
 * Save workflow to database
 */
async function saveWorkflowToDatabase(userId: string, workflow: Workflow): Promise<void> {
  await docClient.send(new PutCommand({
    TableName: WORKFLOWS_TABLE,
    Item: {
      PK: `USER#${userId}`,
      SK: `WORKFLOW#${workflow.id}`,
      GSI1PK: `USER#${userId}`,
      GSI1SK: `WORKFLOW#${workflow.updatedAt}`,
      ...workflow,
    },
  }));
}