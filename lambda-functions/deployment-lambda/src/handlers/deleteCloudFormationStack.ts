import { CloudFormationStackManager } from '../services/cloudFormationStackManager';
import { revokeIndexerAccess } from '../services/openSearchAccessManager';

/**
 * Lambda function to delete CloudFormation stack for a workflow
 * Used by the deletion Step Function
 */
export const handler = async (event: any) => {
  console.log('DELETE CLOUDFORMATION STACK HANDLER INVOKED');
  console.log('Event received:', JSON.stringify({ workflowId: event.workflowId, stackName: event.stackName }, null, 2));

  const { workflowId, userId } = event;

  if (!workflowId) {
    throw new Error('workflowId is required');
  }

  try {
    const stackManager = new CloudFormationStackManager();
    const stackName = `workflow-${workflowId}`;
    
    console.log(`Deleting CloudFormation stack: ${stackName}`);
    
    const deletionResult = await stackManager.deleteStack(stackName, workflowId, userId);

    // Remove this workflow's indexer role from the shared AOSS data access
    // policy. Idempotent and best-effort (no-op if the workflow never used
    // OpenSearch or the principal is already absent).
    await revokeIndexerAccess(workflowId);

    if (deletionResult.success) {
      console.log('CloudFormation stack deletion initiated successfully');
      console.log('Resources to be deleted:', deletionResult.deletedResources?.join(', '));
      
      return {
        statusCode: 200,
        workflowId,
        userId,
        message: 'CloudFormation stack deletion initiated successfully',
        deletedResources: deletionResult.deletedResources,
        warnings: deletionResult.warnings,
      };
    } else {
      console.error('CloudFormation stack deletion had issues:', deletionResult.message);
      
      // Return partial success for Step Function to handle
      return {
        statusCode: 206, // Partial Content
        workflowId,
        userId,
        message: deletionResult.message,
        partialFailures: deletionResult.partialFailures,
        warnings: deletionResult.warnings,
      };
    }

  } catch (error) {
    console.error('CloudFormation stack deletion failed:', error);
    throw error;
  }
};