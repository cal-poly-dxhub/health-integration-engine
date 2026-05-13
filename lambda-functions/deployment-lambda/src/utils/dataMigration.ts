import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';
const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE || 'WorkflowBuilder-Deployments';

interface MigrationResult {
  workflowsProcessed: number;
  deploymentsProcessed: number;
  errors: string[];
}

/**
 * Migrate existing data to fix inconsistencies
 * This function should be run once to fix existing data
 */
export async function migrateExistingData(): Promise<MigrationResult> {
  console.log('🔄 Starting data migration...');
  
  const result: MigrationResult = {
    workflowsProcessed: 0,
    deploymentsProcessed: 0,
    errors: [],
  };

  try {
    // Step 1: Fix workflow records that might be missing proper structure
    await migrateWorkflowRecords(result);
    
    // Step 2: Fix deployment records and their relationships
    await migrateDeploymentRecords(result);
    
    // Step 3: Ensure proper Step Functions ARN storage
    await fixStepFunctionArnStorage(result);
    
    console.log('✅ Data migration completed:', result);
    return result;
    
  } catch (error) {
    console.error('❌ Data migration failed:', error);
    result.errors.push(`Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return result;
  }
}

/**
 * Migrate workflow records to ensure proper structure
 */
async function migrateWorkflowRecords(result: MigrationResult): Promise<void> {
  console.log('📋 Migrating workflow records...');
  
  try {
    // Scan all workflow records
    const response = await docClient.send(new ScanCommand({
      TableName: WORKFLOWS_TABLE,
      FilterExpression: 'begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':sk': 'WORKFLOW#',
      },
    }));

    const workflows = response.Items || [];
    console.log(`Found ${workflows.length} workflow records to process`);

    for (const workflow of workflows) {
      try {
        let needsUpdate = false;
        const updates: Record<string, any> = {};

        // Ensure required fields exist
        if (!workflow.version) {
          updates.version = 1;
          needsUpdate = true;
        }

        if (!workflow.deploymentStatus) {
          updates.deploymentStatus = workflow.isDeployed ? 'deployed' : 'draft';
          needsUpdate = true;
        }

        if (!workflow.nodes) {
          updates.nodes = [];
          needsUpdate = true;
        }

        if (!workflow.connections) {
          updates.connections = [];
          needsUpdate = true;
        }

        if (!workflow.stepFunctionDefinition) {
          updates.stepFunctionDefinition = {};
          needsUpdate = true;
        }

        // Ensure proper timestamps
        if (!workflow.createdAt) {
          updates.createdAt = workflow.updatedAt || new Date().toISOString();
          needsUpdate = true;
        }

        if (!workflow.updatedAt) {
          updates.updatedAt = new Date().toISOString();
          needsUpdate = true;
        }

        // Update record if needed
        if (needsUpdate) {
          await updateWorkflowRecord(workflow.PK, workflow.SK, updates);
          console.log(`✅ Updated workflow: ${workflow.id}`);
        }

        result.workflowsProcessed++;
        
      } catch (error) {
        const errorMsg = `Failed to migrate workflow ${workflow.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error('❌', errorMsg);
        result.errors.push(errorMsg);
      }
    }
    
  } catch (error) {
    const errorMsg = `Failed to scan workflow records: ${error instanceof Error ? error.message : 'Unknown error'}`;
    console.error('❌', errorMsg);
    result.errors.push(errorMsg);
  }
}

/**
 * Migrate deployment records to ensure proper relationships
 */
async function migrateDeploymentRecords(result: MigrationResult): Promise<void> {
  console.log('🚀 Migrating deployment records...');
  
  try {
    // Scan all deployment records
    const response = await docClient.send(new ScanCommand({
      TableName: DEPLOYMENTS_TABLE,
      FilterExpression: 'begins_with(PK, :pk)',
      ExpressionAttributeValues: {
        ':pk': 'DEPLOYMENT#',
      },
    }));

    const deployments = response.Items || [];
    console.log(`Found ${deployments.length} deployment records to process`);

    for (const deployment of deployments) {
      try {
        let needsUpdate = false;
        const updates: Record<string, any> = {};

        // Ensure userId exists
        if (!deployment.userId) {
          console.warn(`⚠️ Deployment ${deployment.deploymentId} missing userId - skipping`);
          result.errors.push(`Deployment ${deployment.deploymentId} missing userId`);
          continue;
        }

        // Ensure proper status
        if (!deployment.status) {
          updates.status = 'pending';
          needsUpdate = true;
        }

        // Ensure proper timestamps
        if (!deployment.createdAt) {
          updates.createdAt = deployment.updatedAt || new Date().toISOString();
          needsUpdate = true;
        }

        if (!deployment.updatedAt) {
          updates.updatedAt = new Date().toISOString();
          needsUpdate = true;
        }

        // Update record if needed
        if (needsUpdate) {
          await updateDeploymentRecord(deployment.PK, deployment.SK, updates);
          console.log(`✅ Updated deployment: ${deployment.deploymentId}`);
        }

        result.deploymentsProcessed++;
        
      } catch (error) {
        const errorMsg = `Failed to migrate deployment ${deployment.deploymentId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error('❌', errorMsg);
        result.errors.push(errorMsg);
      }
    }
    
  } catch (error) {
    const errorMsg = `Failed to scan deployment records: ${error instanceof Error ? error.message : 'Unknown error'}`;
    console.error('❌', errorMsg);
    result.errors.push(errorMsg);
  }
}

/**
 * Fix Step Functions ARN storage to use correct workflow ARN
 */
async function fixStepFunctionArnStorage(result: MigrationResult): Promise<void> {
  console.log('🔧 Fixing Step Functions ARN storage...');
  
  try {
    // Find workflows that have deployment orchestration ARNs instead of workflow ARNs
    const response = await docClient.send(new ScanCommand({
      TableName: WORKFLOWS_TABLE,
      FilterExpression: 'begins_with(SK, :sk) AND contains(stepFunctionArn, :orchestration)',
      ExpressionAttributeValues: {
        ':sk': 'WORKFLOW#',
        ':orchestration': 'workflow-builder-deployment',
      },
    }));

    const workflowsToFix = response.Items || [];
    console.log(`Found ${workflowsToFix.length} workflows with incorrect Step Functions ARNs`);

    for (const workflow of workflowsToFix) {
      try {
        // Find the corresponding deployment to get the correct ARN
        const deploymentResponse = await docClient.send(new ScanCommand({
          TableName: DEPLOYMENTS_TABLE,
          FilterExpression: 'workflowId = :workflowId AND #status = :status',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':workflowId': workflow.id,
            ':status': 'completed',
          },
        }));

        const completedDeployments = deploymentResponse.Items || [];
        if (completedDeployments.length > 0) {
          // Get the most recent completed deployment
          const latestDeployment = completedDeployments.sort((a, b) => 
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          )[0];

          // If we have a CloudFormation stack ARN, we can derive the correct Step Functions ARN
          if (latestDeployment.cloudFormationStackArn) {
            // The actual workflow Step Functions ARN should be in CloudFormation outputs
            // For now, we'll clear the incorrect ARN and let the next deployment fix it
            await updateWorkflowRecord(workflow.PK, workflow.SK, {
              stepFunctionArn: null,
              deploymentStatus: 'deployed',
              lastDeploymentId: latestDeployment.deploymentId,
              updatedAt: new Date().toISOString(),
            });

            console.log(`✅ Cleared incorrect Step Functions ARN for workflow: ${workflow.id}`);
          }
        }
        
      } catch (error) {
        const errorMsg = `Failed to fix Step Functions ARN for workflow ${workflow.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error('❌', errorMsg);
        result.errors.push(errorMsg);
      }
    }
    
  } catch (error) {
    const errorMsg = `Failed to fix Step Functions ARN storage: ${error instanceof Error ? error.message : 'Unknown error'}`;
    console.error('❌', errorMsg);
    result.errors.push(errorMsg);
  }
}

/**
 * Update workflow record
 */
async function updateWorkflowRecord(pk: string, sk: string, updates: Record<string, any>): Promise<void> {
  const updateExpression: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  Object.entries(updates).forEach(([key, value], index) => {
    const attrName = `#attr${index}`;
    const attrValue = `:val${index}`;
    
    if (value === null) {
      updateExpression.push(`${attrName} = ${attrValue}`);
    } else {
      updateExpression.push(`${attrName} = ${attrValue}`);
    }
    
    expressionAttributeNames[attrName] = key;
    expressionAttributeValues[attrValue] = value;
  });

  await docClient.send(new UpdateCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: pk, SK: sk },
    UpdateExpression: `SET ${updateExpression.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));
}

/**
 * Update deployment record
 */
async function updateDeploymentRecord(pk: string, sk: string, updates: Record<string, any>): Promise<void> {
  const updateExpression: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  Object.entries(updates).forEach(([key, value], index) => {
    const attrName = `#attr${index}`;
    const attrValue = `:val${index}`;
    
    updateExpression.push(`${attrName} = ${attrValue}`);
    expressionAttributeNames[attrName] = key;
    expressionAttributeValues[attrValue] = value;
  });

  await docClient.send(new UpdateCommand({
    TableName: DEPLOYMENTS_TABLE,
    Key: { PK: pk, SK: sk },
    UpdateExpression: `SET ${updateExpression.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));
}