import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { validateJWTToken, extractUserIdFromEvent, createAuthErrorResponse, createSuccessHeaders } from '../utils/auth';
import { Workflow } from '../types/workflow';
// Status reconciliation removed - now using event-driven status updates from deployment Step Functions

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';

interface ListWorkflowsResponse {
  workflows: Workflow[];
  pagination: {
    nextToken?: string;
    hasMore: boolean;
    total: number;
  };
}

/**
 * List workflows for the authenticated user with pagination and filtering
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('List workflows event:', JSON.stringify(event, null, 2));

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

    // Parse query parameters
    const queryParams = event.queryStringParameters || {};
    const limit = Math.min(parseInt(queryParams.limit || '20'), 100); // Max 100 items per page
    const nextToken = queryParams.nextToken;
    const search = queryParams.search?.toLowerCase();
    const deploymentStatus = queryParams.deploymentStatus;
    const sortBy = queryParams.sortBy || 'updatedAt'; // updatedAt, createdAt, name
    const sortOrder = queryParams.sortOrder || 'desc'; // asc, desc

    console.log('📋 Query parameters:', { limit, search, deploymentStatus, sortBy, sortOrder });

    // Query workflows for the user
    const workflows = await queryUserWorkflows(userId, {
      limit,
      nextToken,
      search,
      deploymentStatus,
      sortBy,
      sortOrder,
    });

    console.log('✅ Found', workflows.workflows.length, 'workflows for user:', userId);

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify(workflows),
    };

  } catch (error) {
    console.error('List workflows error:', error);
    
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
 * Query user workflows from database with filtering and pagination
 */
async function queryUserWorkflows(
  userId: string,
  options: {
    limit: number;
    nextToken?: string;
    search?: string;
    deploymentStatus?: string;
    sortBy: string;
    sortOrder: string;
  }
): Promise<ListWorkflowsResponse> {
  const { limit, nextToken, search, deploymentStatus, sortBy, sortOrder } = options;

  // Build query parameters
  const queryParams: any = {
    TableName: WORKFLOWS_TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `USER#${userId}`,
      ':sk': 'WORKFLOW#',
    },
    Limit: limit * 2, // Query more to account for filtering
    ScanIndexForward: sortOrder === 'asc',
  };

  // Add pagination token
  if (nextToken) {
    try {
      queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
    } catch (error) {
      console.error('Invalid nextToken:', error);
      // Continue without pagination token
    }
  }

  // Add filter expression for deployment status
  if (deploymentStatus) {
    queryParams.FilterExpression = 'deploymentStatus = :deploymentStatus';
    queryParams.ExpressionAttributeValues[':deploymentStatus'] = deploymentStatus;
  }

  console.log('🔍 Querying workflows with params:', {
    userId,
    limit: queryParams.Limit,
    hasNextToken: !!nextToken,
    deploymentStatus,
  });

  const response = await docClient.send(new QueryCommand(queryParams));
  let workflows = (response.Items || []) as Workflow[];

  console.log('📊 Raw query returned', workflows.length, 'workflows');

  // Apply client-side filtering for search
  if (search) {
    workflows = workflows.filter(workflow => 
      workflow.name.toLowerCase().includes(search) ||
      (workflow.description && workflow.description.toLowerCase().includes(search))
    );
    console.log('🔍 After search filter:', workflows.length, 'workflows');
  }

  // Sort workflows if not using default DynamoDB sort
  if (sortBy !== 'updatedAt') {
    workflows.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortBy) {
        case 'name':
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
          break;
        case 'createdAt':
          aValue = new Date(a.createdAt).getTime();
          bValue = new Date(b.createdAt).getTime();
          break;
        default:
          aValue = new Date(a.updatedAt).getTime();
          bValue = new Date(b.updatedAt).getTime();
      }

      if (sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });
  }

  // Apply pagination to filtered results
  const paginatedWorkflows = workflows.slice(0, limit);
  const hasMore = workflows.length > limit || !!response.LastEvaluatedKey;

  // Create next token if there are more results
  let nextTokenResponse: string | undefined;
  if (hasMore && response.LastEvaluatedKey) {
    nextTokenResponse = Buffer.from(JSON.stringify(response.LastEvaluatedKey)).toString('base64');
  }

  // Note: Status is now updated via event-driven approach from deployment Step Functions
  // No need for real-time reconciliation as status is maintained by deployment events
  
  console.log('📄 Returning', paginatedWorkflows.length, 'workflows, hasMore:', hasMore);

  return {
    workflows: paginatedWorkflows,
    pagination: {
      nextToken: nextTokenResponse,
      hasMore,
      total: workflows.length, // This is approximate due to filtering
    },
  };
}

// Reconciliation functions removed - status is now maintained by event-driven updates from deployment Step Functions

