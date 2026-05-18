import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';
const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE || 'WorkflowBuilder-Deployments';

/**
 * Lambda function to delete database records for a workflow
 * Used by the deletion Step Function
 */
export const handler = async (event: any) => {
  console.log('DELETE DATABASE RECORDS HANDLER INVOKED');
  console.log('Event received:', JSON.stringify(event, null, 2));

  const { workflowId, userId } = event;

  if (!workflowId || !userId) {
    throw new Error('workflowId and userId are required');
  }

  try {
    // Delete deployment records and workflow in parallel
    await Promise.all([
      deleteDeploymentRecords(workflowId),
      deleteWorkflowFromDatabase(workflowId, userId)
    ]);

    console.log('Database cleanup completed successfully');

    return {
      statusCode: 200,
      workflowId,
      userId,
      message: 'Database records deleted successfully',
    };

  } catch (error) {
    console.error('Database cleanup failed:', error);
    throw error;
  }
};

/**
 * Delete all deployment records for a workflow
 */
async function deleteDeploymentRecords(workflowId: string): Promise<void> {
  try {
    console.log(`Starting deletion of deployment records for workflow: ${workflowId}`);
    
    let lastEvaluatedKey: any = undefined;
    let totalDeleted = 0;
    
    do {
      const scanResponse = await docClient.send(new ScanCommand({
        TableName: DEPLOYMENTS_TABLE,
        FilterExpression: 'workflowId = :workflowId',
        ExpressionAttributeValues: {
          ':workflowId': workflowId,
        },
        Limit: 25,
        ExclusiveStartKey: lastEvaluatedKey,
      }));

      if (scanResponse.Items && scanResponse.Items.length > 0) {
        console.log(`Found ${scanResponse.Items.length} deployment records in this batch`);
        
        const deletePromises = scanResponse.Items.map(item =>
          docClient.send(new DeleteCommand({
            TableName: DEPLOYMENTS_TABLE,
            Key: {
              PK: item.PK,
              SK: item.SK,
            },
          }))
        );
        
        await Promise.all(deletePromises);
        totalDeleted += scanResponse.Items.length;
        console.log(`Deleted ${scanResponse.Items.length} deployment records (${totalDeleted} total)`);
      }
      
      lastEvaluatedKey = scanResponse.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    
    if (totalDeleted > 0) {
      console.log(`All ${totalDeleted} deployment records deleted successfully`);
    } else {
      console.log('No deployment records found for this workflow');
    }
  } catch (error) {
    console.error('Failed to delete deployment records:', error);
    throw error;
  }
}

/**
 * Delete workflow from database
 */
async function deleteWorkflowFromDatabase(workflowId: string, userId: string): Promise<void> {
  try {
    await docClient.send(new DeleteCommand({
      TableName: WORKFLOWS_TABLE,
      Key: {
        PK: `USER#${userId}`,
        SK: `WORKFLOW#${workflowId}`,
      },
    }));
    
    console.log('Workflow deleted from database');
  } catch (error) {
    console.error('Failed to delete workflow from database:', error);
    throw error;
  }
}