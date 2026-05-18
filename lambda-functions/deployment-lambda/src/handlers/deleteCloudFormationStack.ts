import { CloudFormationStackManager } from '../services/cloudFormationStackManager';

/**
 * Lambda function to delete CloudFormation stack for a workflow
 * Used by the deletion Step Function
 */
export const handler = async (event: any) => {
  console.log('DELETE CLOUDFORMATION STACK HANDLER INVOKED');
  console.log('Event received:', JSON.stringify(event, null, 2));

  const { workflowId, userId } = event;

  if (!workflowId || !userId) {
    throw new Error('workflowId and userId are required');
  }

  try {
    const stackManager = new CloudFormationStackManager();
    const stackName = `workflow-${workflowId}`;
    
    console.log(`Deleting CloudFormation stack: ${stackName}`);
    
    const deletionResult = await stackManager.deleteStack(stackName, workflowId, userId);
    
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