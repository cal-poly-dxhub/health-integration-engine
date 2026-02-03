import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
  SFNClient, 
  ListExecutionsCommand, 
  DescribeExecutionCommand, 
  GetExecutionHistoryCommand,
  StartExecutionCommand,
  StopExecutionCommand,
  DescribeStateMachineCommand,
  DescribeStateMachineForExecutionCommand
} from '@aws-sdk/client-sfn';
import { extractUserIdFromEvent, createAuthErrorResponse, createSuccessHeaders } from '../utils/auth';

const sfnClient = new SFNClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * List executions for a state machine
 */
export const listExecutions = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Validate authentication
    const userId = extractUserIdFromEvent(event);
    if (!userId) {
      return createAuthErrorResponse('Valid authentication token required');
    }

    const body = JSON.parse(event.body || '{}');
    const { stateMachineArn, maxResults = 100, nextToken } = body;

    if (!stateMachineArn) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'stateMachineArn is required' }),
      };
    }

    const command = new ListExecutionsCommand({
      stateMachineArn,
      maxResults,
      nextToken,
    });

    const response = await sfnClient.send(command);

    // Convert Date objects to ISO strings for proper JSON serialization
    const executions = (response.executions || []).map(execution => ({
      ...execution,
      startDate: execution.startDate ? execution.startDate.toISOString() : undefined,
      stopDate: execution.stopDate ? execution.stopDate.toISOString() : undefined,
    }));

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        executions,
        nextToken: response.nextToken,
      }),
    };
  } catch (error) {
    console.error('Error listing executions:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Failed to list executions' }),
    };
  }
};

/**
 * Describe a specific execution
 */
export const describeExecution = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Validate authentication
    const userId = extractUserIdFromEvent(event);
    if (!userId) {
      return createAuthErrorResponse('Valid authentication token required');
    }

    const body = JSON.parse(event.body || '{}');
    const { executionArn } = body;

    if (!executionArn) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'executionArn is required' }),
      };
    }

    const command = new DescribeExecutionCommand({
      executionArn,
    });

    const response = await sfnClient.send(command);

    // Convert Date objects to ISO strings for proper JSON serialization
    const executionDetails = {
      ...response,
      startDate: response.startDate ? response.startDate.toISOString() : undefined,
      stopDate: response.stopDate ? response.stopDate.toISOString() : undefined,
    };

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify(executionDetails),
    };
  } catch (error) {
    console.error('Error describing execution:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Failed to describe execution' }),
    };
  }
};

/**
 * Get execution history with detailed step information
 */
export const getExecutionHistory = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Validate authentication
    const userId = extractUserIdFromEvent(event);
    if (!userId) {
      return createAuthErrorResponse('Valid authentication token required');
    }

    const body = JSON.parse(event.body || '{}');
    const { executionArn, maxResults = 100, nextToken, reverseOrder = true } = body;

    if (!executionArn) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'executionArn is required' }),
      };
    }

    const command = new GetExecutionHistoryCommand({
      executionArn,
      maxResults,
      nextToken,
      reverseOrder,
      includeExecutionData: true,
    });

    const response = await sfnClient.send(command);

    // Convert Date objects to ISO strings for proper JSON serialization
    const events = (response.events || []).map(event => ({
      ...event,
      timestamp: event.timestamp ? event.timestamp.toISOString() : undefined,
    }));

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        events,
        nextToken: response.nextToken,
      }),
    };
  } catch (error) {
    console.error('Error getting execution history:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Failed to get execution history' }),
    };
  }
};

/**
 * Start a new execution
 */
export const startExecution = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Validate authentication
    const userId = extractUserIdFromEvent(event);
    if (!userId) {
      return createAuthErrorResponse('Valid authentication token required');
    }

    const body = JSON.parse(event.body || '{}');
    const { stateMachineArn, name, input = '{}' } = body;

    if (!stateMachineArn) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'stateMachineArn is required' }),
      };
    }

    const command = new StartExecutionCommand({
      stateMachineArn,
      name: name || `execution-${Date.now()}`,
      input,
    });

    const response = await sfnClient.send(command);

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        executionArn: response.executionArn,
        startDate: response.startDate,
      }),
    };
  } catch (error) {
    console.error('Error starting execution:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Failed to start execution' }),
    };
  }
};

/**
 * Stop an execution
 */
export const stopExecution = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Validate authentication
    const userId = extractUserIdFromEvent(event);
    if (!userId) {
      return createAuthErrorResponse('Valid authentication token required');
    }

    const body = JSON.parse(event.body || '{}');
    const { executionArn, error: errorMessage, cause } = body;

    if (!executionArn) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'executionArn is required' }),
      };
    }

    const command = new StopExecutionCommand({
      executionArn,
      error: errorMessage,
      cause,
    });

    const response = await sfnClient.send(command);

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        stopDate: response.stopDate,
      }),
    };
  } catch (error) {
    console.error('Error stopping execution:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Failed to stop execution' }),
    };
  }
};

/**
 * Describe state machine details
 */
export const describeStateMachine = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Validate authentication
    const userId = extractUserIdFromEvent(event);
    if (!userId) {
      return createAuthErrorResponse('Valid authentication token required');
    }

    const body = JSON.parse(event.body || '{}');
    const { stateMachineArn } = body;

    if (!stateMachineArn) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'stateMachineArn is required' }),
      };
    }

    const command = new DescribeStateMachineCommand({
      stateMachineArn,
    });

    const response = await sfnClient.send(command);

    // Convert Date objects to ISO strings for proper JSON serialization
    const stateMachineDetails = {
      ...response,
      creationDate: response.creationDate ? response.creationDate.toISOString() : undefined,
    };

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify(stateMachineDetails),
    };
  } catch (error) {
    console.error('Error describing state machine:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Failed to describe state machine' }),
    };
  }
};

/**
 * Describe state machine for a specific execution
 */
export const describeStateMachineForExecution = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Validate authentication
    const userId = extractUserIdFromEvent(event);
    if (!userId) {
      return createAuthErrorResponse('Valid authentication token required');
    }

    const body = JSON.parse(event.body || '{}');
    const { executionArn } = body;

    if (!executionArn) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({ error: 'executionArn is required' }),
      };
    }

    const command = new DescribeStateMachineForExecutionCommand({
      executionArn,
    });

    const response = await sfnClient.send(command);

    // Convert Date objects to ISO strings for proper JSON serialization
    const stateMachineDetails = {
      ...response,
      updateDate: response.updateDate ? response.updateDate.toISOString() : undefined,
    };

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify(stateMachineDetails),
    };
  } catch (error) {
    console.error('Error describing state machine for execution:', error);
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({ error: 'Failed to describe state machine for execution' }),
    };
  }
};