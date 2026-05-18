import { CloudFormationStackManager } from './cloudFormationStackManager';
import { WebSocketNotificationService } from './webSocketNotificationService';

export interface DeletionRequest {
  workflowId: string;
  userId: string;
  workflowName: string;
  isDeployed: boolean;
}

export interface DeletionStep {
  id: string;
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startTime?: string;
  endTime?: string;
  error?: string;
}

export class DeletionOrchestrator {
  private stackManager: CloudFormationStackManager;
  private notificationService: WebSocketNotificationService;

  constructor() {
    this.stackManager = new CloudFormationStackManager();
    this.notificationService = WebSocketNotificationService.create();
  }

  async orchestrateDeletion(request: DeletionRequest): Promise<void> {
    const { workflowId, userId, workflowName, isDeployed } = request;
    
    console.log(`Starting deletion orchestration for workflow: ${workflowName}`);

    const steps: DeletionStep[] = [
      { id: 'aws-cleanup', name: 'Clean up AWS resources', status: 'pending' },
      { id: 'database-cleanup', name: 'Remove database records', status: 'pending' },
    ];

    try {
      // Send initial status
      await this.notificationService.sendDeletionUpdate(userId, {
        workflowId,
        status: 'in_progress',
        message: 'Starting workflow deletion...',
        steps,
      });

      // Step 1: Clean up AWS resources (if deployed)
      if (isDeployed) {
        await this.executeAwsCleanup(workflowId, userId, steps);
      } else {
        // Skip AWS cleanup for draft workflows
        steps[0].status = 'completed';
        steps[0].startTime = new Date().toISOString();
        steps[0].endTime = new Date().toISOString();
        console.log('Skipping AWS cleanup for draft workflow');
      }

      // Step 2: Clean up database records
      await this.executeDatabaseCleanup(workflowId, userId, steps);

      // Send completion notification
      await this.notificationService.sendDeletionUpdate(userId, {
        workflowId,
        status: 'completed',
        message: 'Workflow deleted successfully',
        steps,
      });

      console.log(`Deletion orchestration completed for workflow: ${workflowName}`);

    } catch (error) {
      console.error(`Deletion orchestration failed for workflow: ${workflowName}`, error);
      
      // Send failure notification
      await this.notificationService.sendDeletionUpdate(userId, {
        workflowId,
        status: 'failed',
        message: `Deletion failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        steps,
      });

      throw error;
    }
  }

  private async executeAwsCleanup(workflowId: string, userId: string, steps: DeletionStep[]): Promise<void> {
    const step = steps.find(s => s.id === 'aws-cleanup')!;
    step.status = 'in_progress';
    step.startTime = new Date().toISOString();

    try {
      console.log(`Starting AWS cleanup for workflow: ${workflowId}`);
      
      // Send progress update
      await this.notificationService.sendDeletionUpdate(userId, {
        workflowId,
        status: 'in_progress',
        message: 'Cleaning up AWS resources...',
        steps,
      });

      // Delete CloudFormation stack
      const stackName = `workflow-${workflowId}`;
      console.log(`DeletionOrchestrator: About to call stackManager.deleteStack for ${stackName}`);
      
      try {
        const deletionResult = await this.stackManager.deleteStack(stackName, workflowId, userId);
        console.log(`DeletionOrchestrator: stackManager.deleteStack completed:`, deletionResult);
      } catch (stackError) {
        console.error(`DeletionOrchestrator: stackManager.deleteStack failed:`, stackError);
        throw stackError;
      }
      
      // Send progress update about stack deletion initiation
      await this.notificationService.sendDeletionUpdate(userId, {
        workflowId,
        status: 'in_progress',
        message: 'CloudFormation stack deletion initiated - AWS resources are being cleaned up in the background',
        steps,
      });

      step.status = 'completed';
      step.endTime = new Date().toISOString();
      
      console.log(`AWS cleanup initiated for workflow: ${workflowId}`);

    } catch (error) {
      step.status = 'failed';
      step.endTime = new Date().toISOString();
      step.error = error instanceof Error ? error.message : 'Unknown error';
      
      console.error(`AWS cleanup failed for workflow: ${workflowId}`, error);
      throw error;
    }
  }

  private async executeDatabaseCleanup(workflowId: string, userId: string, steps: DeletionStep[]): Promise<void> {
    const step = steps.find(s => s.id === 'database-cleanup')!;
    step.status = 'in_progress';
    step.startTime = new Date().toISOString();

    try {
      console.log(`Starting database cleanup for workflow: ${workflowId}`);
      
      // Send progress update
      await this.notificationService.sendDeletionUpdate(userId, {
        workflowId,
        status: 'in_progress',
        message: 'Removing database records...',
        steps,
      });

      // Import DynamoDB modules
      const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
      const { DynamoDBDocumentClient, DeleteCommand } = await import('@aws-sdk/lib-dynamodb');

      const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
      const docClient = DynamoDBDocumentClient.from(dynamoClient);
      const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';

      // Delete workflow record
      await docClient.send(new DeleteCommand({
        TableName: WORKFLOWS_TABLE,
        Key: {
          PK: `USER#${userId}`,
          SK: `WORKFLOW#${workflowId}`,
        },
      }));

      step.status = 'completed';
      step.endTime = new Date().toISOString();
      
      console.log(`Database cleanup completed for workflow: ${workflowId}`);

    } catch (error) {
      step.status = 'failed';
      step.endTime = new Date().toISOString();
      step.error = error instanceof Error ? error.message : 'Unknown error';
      
      console.error(`Database cleanup failed for workflow: ${workflowId}`, error);
      throw error;
    }
  }
}