import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { migrateExistingData } from '../utils/dataMigration';
import { extractUserIdFromEvent, createAuthErrorResponse, createSuccessHeaders } from '../utils/auth';

/**
 * Run data migration to fix existing inconsistent data
 * This should be called once to migrate existing data
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Run data migration event:', JSON.stringify(event, null, 2));

  try {
    // Validate authentication - only allow authenticated users to run migration
    const userId = extractUserIdFromEvent(event);
    if (!userId) {
      return createAuthErrorResponse('Valid authentication token required');
    }

    console.log('🔄 Starting data migration requested by user:', userId);

    // Run the migration
    const result = await migrateExistingData();

    console.log('✅ Data migration completed:', result);

    return {
      statusCode: 200,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        message: 'Data migration completed successfully',
        result,
      }),
    };

  } catch (error) {
    console.error('Data migration error:', error);
    
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        error: 'Data migration failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};