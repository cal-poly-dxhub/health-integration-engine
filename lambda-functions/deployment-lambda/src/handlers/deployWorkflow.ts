import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

import { 
  DeploymentRequest, 
  DeploymentStatus, 
  DeploymentContext,
  isDeploymentRequest 
} from '../types/deployment';
import { Workflow } from '../types/workflow';

import { DeploymentOrchestrator } from '../services/deploymentOrchestrator';
import { CloudFormationTemplateGenerator } from '../services/cloudFormationTemplateGenerator';
import { extractUserIdFromEvent, createAuthErrorResponse, createSuccessHeaders } from '../utils/auth';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sfnClient = new SFNClient({ region: process.env.AWS_REGION });
const eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION });

const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || 'WorkflowBuilder-Workflows';
const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE || 'WorkflowBuilder-Deployments';
const DEPLOYMENT_STATE_MACHINE_ARN = process.env.DEPLOYMENT_STATE_MACHINE_ARN;

/**
 * Deploy a workflow to AWS Step Functions
 * Handles both API Gateway events and Step Functions events
 */
export const handler = async (
  event: any
): Promise<any> => {
  console.log('🚀 DEPLOYMENT LAMBDA INVOKED!');
  console.log('📋 Event received:', JSON.stringify(event, null, 2));
  console.log('🌍 Environment variables:', {
    AWS_REGION: process.env.AWS_REGION,
    WORKFLOWS_TABLE: process.env.WORKFLOWS_TABLE,
    DEPLOYMENTS_TABLE: process.env.DEPLOYMENTS_TABLE,
    AWS_ACCOUNT_ID: process.env.AWS_ACCOUNT_ID,
  });

  try {
    // Check if this is a Step Functions call (has deploymentContext and workflow directly)
    if (event.deploymentContext && event.workflow) {
      console.log('🔄 STEP FUNCTIONS MODE: Handling Step Functions template generation request');
      return await handleStepFunctionsTemplateGeneration(event);
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

    const requestBody = JSON.parse(event.body);
    
    if (!isDeploymentRequest(requestBody)) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          error: 'Invalid deployment request format',
        }),
      };
    }

    const deploymentRequest: DeploymentRequest = requestBody;

    // Get user ID from JWT token - no fallback to demo-user
    const userId = extractUserIdFromEvent(event);
    
    if (!userId) {
      console.error('❌ No user ID found in JWT token');
      return createAuthErrorResponse('Valid authentication token required');
    }

    // Get workflow data from request or database
    let workflow: Workflow;
    
    if (deploymentRequest.workflowData) {
      // Workflow data provided in request (from localStorage)
      workflow = deploymentRequest.workflowData;
    } else {
      // Try to fetch from database (future implementation)
      const dbWorkflow = await getWorkflow(deploymentRequest.workflowId, userId);
      if (!dbWorkflow) {
        return {
          statusCode: 400,
          headers: createSuccessHeaders(),
          body: JSON.stringify({
            error: 'Workflow data must be provided in request or stored in database',
            hint: 'Include workflowData in the deployment request',
          }),
        };
      }
      workflow = dbWorkflow;
    }

    // Validate workflow is ready for deployment
    const validationResult = validateWorkflowForDeployment(workflow);
    if (!validationResult.isValid) {
      return {
        statusCode: 400,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          error: 'Workflow is not ready for deployment',
          details: validationResult.errors,
        }),
      };
    }

    // Create deployment context
    const deploymentId = `deploy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const deploymentContext: DeploymentContext = {
      deploymentId,
      workflowId: workflow.id,
      userId,
      environment: deploymentRequest.environment || 'development',
      configuration: {
        enableLogging: deploymentRequest.configuration?.enableLogging ?? true,
        enableXRay: deploymentRequest.configuration?.enableXRay ?? false,
        tags: {
          DeployedBy: userId,
          DeploymentId: deploymentId,
          ...deploymentRequest.configuration?.tags,
        },
      },
      resources: {
        lambdaFunctions: [],
        iamRoles: [],
        stepFunction: {} as any,
      },
    };

    // Note: AWS resources will be generated by the CloudFormation template generator
    // No need to pre-convert workflow to AWS resources here
    console.log('✅ Workflow ready for CloudFormation template generation');

    // Create initial deployment record
    const initialDeploymentStatus: DeploymentStatus = {
      deploymentId,
      workflowId: workflow.id,
      userId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [],
    };

    console.log('💾 Saving deployment status to database...');
    try {
      await saveDeploymentStatus(initialDeploymentStatus);
      console.log('✅ Deployment status saved successfully');
    } catch (saveError) {
      console.error('❌ Failed to save deployment status:', saveError);
      return {
        statusCode: 500,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          error: 'Failed to save deployment status',
          message: saveError instanceof Error ? saveError.message : 'Unknown database error',
        }),
      };
    }

    // Pre-upload all Lambda code to S3 before starting Step Function (if possible)
    console.log('📦 Attempting to pre-upload Lambda code to S3...');
    let lambdaCodeUploads: any[] = [];
    
    try {
      lambdaCodeUploads = await preUploadLambdaCode(workflow, deploymentContext);
      console.log(`✅ Successfully pre-uploaded ${lambdaCodeUploads.length} Lambda functions`);
    } catch (uploadError) {
      console.warn('⚠️ Pre-upload failed, will use fallback inline code deployment:', uploadError);
      
      // Check if this is a jszip dependency issue
      const errorMessage = uploadError instanceof Error ? uploadError.message : String(uploadError);
      if (errorMessage.includes('jszip') || errorMessage.includes('Cannot find module')) {
        console.log('📝 jszip not available, proceeding with inline code deployment fallback');
        // Continue with empty lambdaCodeUploads array - the template generator will handle fallback
        lambdaCodeUploads = [];
      } else {
        // For other errors, still fail the deployment
        console.error('❌ Critical error during pre-upload:', uploadError);
        
        try {
          await updateDeploymentStatus(deploymentId, {
            status: 'failed',
            workflowId: workflow.id,
            error: {
              code: 'CODE_UPLOAD_FAILED',
              message: uploadError instanceof Error ? uploadError.message : 'Failed to upload Lambda code to S3',
              details: uploadError instanceof Error ? uploadError.stack : String(uploadError),
            },
            updatedAt: new Date().toISOString(),
          });
        } catch (updateError) {
          console.error('❌ Failed to update deployment status:', updateError);
        }
        
        return {
          statusCode: 500,
          headers: createSuccessHeaders(),
          body: JSON.stringify({
            deploymentId,
            status: 'failed',
            error: 'Failed to upload Lambda code to S3',
            message: uploadError instanceof Error ? uploadError.message : 'Unknown upload error',
            statusUrl: `/api/deployments/${deploymentId}/status`,
          }),
        };
      }
    }

    // Use existing CloudFormation-based Step Functions deployment
    console.log('🚀 Starting CloudFormation-based Step Functions deployment...');
    
    // Start deployment using the existing workflow-builder-deployment state machine
    try {
      const executionArn = await startDeploymentStepFunction(deploymentContext, workflow, lambdaCodeUploads);
      console.log('✅ CloudFormation deployment started:', executionArn);
      
      // Return immediate response while deployment continues in background
      return {
        statusCode: 202,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          deploymentId,
          status: 'pending',
          message: 'Deployment started successfully',
          executionArn,
          statusUrl: `/api/deployments/${deploymentId}/status`,
        }),
      };
      
    } catch (deploymentError) {
      console.error('❌ CloudFormation deployment failed to start:', deploymentError);
      
      try {
        await updateDeploymentStatus(deploymentId, {
          status: 'failed',
          workflowId: workflow.id,
          error: {
            code: 'DEPLOYMENT_START_FAILED',
            message: deploymentError instanceof Error ? deploymentError.message : 'Unknown deployment error',
            details: deploymentError,
          },
          updatedAt: new Date().toISOString(),
        });
      } catch (updateError) {
        console.error('❌ Failed to update deployment status to failed:', updateError);
      }
      
      // Return error response
      return {
        statusCode: 500,
        headers: createSuccessHeaders(),
        body: JSON.stringify({
          deploymentId,
          status: 'failed',
          error: 'Failed to start deployment',
          message: deploymentError instanceof Error ? deploymentError.message : 'Unknown deployment error',
          statusUrl: `/api/deployments/${deploymentId}/status`,
        }),
      };
    }

  } catch (error) {
    console.error('Deploy workflow error:', error);
    
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
async function getWorkflow(workflowId: string, userId: string): Promise<Workflow | null> {
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
    console.error('Error fetching workflow:', error);
    return null;
  }
}

/**
 * Validate workflow is ready for deployment
 */
function validateWorkflowForDeployment(workflow: Workflow): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check if workflow has nodes
  if (!workflow.nodes || workflow.nodes.length === 0) {
    errors.push('Workflow must have at least one node');
  }

  // Check for start node
  const hasStartNode = workflow.nodes.some(node => node.type === 'start');
  if (!hasStartNode) {
    errors.push('Workflow must have a start node');
  }

  // Check for end node
  const hasEndNode = workflow.nodes.some(node => node.type === 'end');
  if (!hasEndNode) {
    errors.push('Workflow must have an end node');
  }

  // Check all nodes are configured
  const unconfiguredNodes = workflow.nodes.filter(node => !node.isConfigured);
  if (unconfiguredNodes.length > 0) {
    errors.push(`The following nodes are not configured: ${unconfiguredNodes.map(n => n.name).join(', ')}`);
  }

  // Check connections
  if (!workflow.connections || workflow.connections.length === 0) {
    if (workflow.nodes.length > 1) {
      errors.push('Workflow nodes must be connected');
    }
  }

  // Check S3 trigger loop: output bucket must differ from input trigger bucket
  const s3Nodes = workflow.nodes.filter(node => node.type === 's3');
  const triggerNode = s3Nodes.find(n => n.config?.triggerOnUpload !== false && n.config?.operation === 'read');
  if (triggerNode) {
    const triggerBucket = triggerNode.config?.bucketName;
    const writeNodes = s3Nodes.filter(n => n.config?.operation === 'write');
    for (const w of writeNodes) {
      if (w.config?.bucketName && w.config.bucketName === triggerBucket) {
        errors.push(`S3 output node "${w.name}" cannot write to the same bucket ("${triggerBucket}") that triggers the workflow — this would cause an infinite loop`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Save deployment status to database
 */
async function saveDeploymentStatus(deploymentStatus: DeploymentStatus): Promise<void> {
  await docClient.send(new PutCommand({
    TableName: DEPLOYMENTS_TABLE,
    Item: {
      PK: `DEPLOYMENT#${deploymentStatus.deploymentId}`,
      SK: `WORKFLOW#${deploymentStatus.workflowId}`,
      GSI1PK: `WORKFLOW#${deploymentStatus.workflowId}`,
      GSI1SK: `DEPLOYMENT#${deploymentStatus.deploymentId}`,
      ...deploymentStatus,
    },
  }));
}

/**
 * Update deployment status in database
 */
async function updateDeploymentStatus(
  deploymentId: string, 
  updates: Partial<DeploymentStatus>
): Promise<void> {
  console.log('📊 Updating deployment status:', { deploymentId, updates });
  
  // First, get the current deployment to find the workflowId
  let workflowId: string;
  
  if (updates.workflowId) {
    workflowId = updates.workflowId;
  } else {
    // Scan to find the deployment record
    const scanResponse = await docClient.send(new ScanCommand({
      TableName: DEPLOYMENTS_TABLE,
      FilterExpression: 'deploymentId = :deploymentId',
      ExpressionAttributeValues: {
        ':deploymentId': deploymentId,
      },
    }));
    
    if (!scanResponse.Items || scanResponse.Items.length === 0) {
      console.error('❌ Deployment not found for update:', deploymentId);
      throw new Error(`Deployment ${deploymentId} not found`);
    }
    
    workflowId = scanResponse.Items[0].workflowId;
  }

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

  if (updateExpression.length > 0) {
    console.log('📝 Executing DynamoDB update:', {
      deploymentId,
      workflowId,
      updateExpression: updateExpression.join(', '),
    });
    
    await docClient.send(new UpdateCommand({
      TableName: DEPLOYMENTS_TABLE,
      Key: {
        PK: `DEPLOYMENT#${deploymentId}`,
        SK: `WORKFLOW#${workflowId}`,
      },
      UpdateExpression: `SET ${updateExpression.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    }));
    
    console.log('✅ Deployment status updated successfully');
  }
}/*
*
 * Start Step Functions execution for deployment orchestration
 */
async function startDeploymentStepFunction(
  deploymentContext: DeploymentContext,
  workflow: Workflow,
  lambdaCodeUploads: any[] = []
): Promise<string> {
  if (!DEPLOYMENT_STATE_MACHINE_ARN) {
    throw new Error('DEPLOYMENT_STATE_MACHINE_ARN environment variable not set');
  }

  const executionName = `deployment-${deploymentContext.deploymentId}`;
  const input = {
    deploymentContext,
    workflow,
    lambdaCodeUploads,
  };

  console.log('🚀 Starting Step Functions execution:', executionName);
  console.log('📋 Input:', JSON.stringify(input, null, 2));

  const response = await sfnClient.send(new StartExecutionCommand({
    stateMachineArn: DEPLOYMENT_STATE_MACHINE_ARN,
    name: executionName,
    input: JSON.stringify(input),
  }));

  console.log('✅ Step Functions execution started:', response.executionArn);
  return response.executionArn!;
}

/**
 * Pre-upload all Lambda code to S3 before starting Step Function
 */
async function preUploadLambdaCode(workflow: Workflow, deploymentContext: DeploymentContext): Promise<any[]> {
  console.log('📦 PRE-UPLOAD: Starting Lambda code upload to S3...');
  
  const codeUploads: any[] = [];
  
  // Find all Lambda nodes in the workflow
  const lambdaNodes = workflow.nodes.filter(node => node.type === 'lambda');
  
  if (lambdaNodes.length === 0) {
    console.log('📦 PRE-UPLOAD: No Lambda nodes found in workflow');
    return codeUploads;
  }
  
  console.log(`📦 PRE-UPLOAD: Found ${lambdaNodes.length} Lambda nodes to upload`);
  
  for (const lambdaNode of lambdaNodes) {
    try {
      const code = lambdaNode.config?.code || getDefaultLambdaCodeForNode(lambdaNode);
      
      if (!code) {
        console.warn(`⚠️ PRE-UPLOAD: No code found for Lambda node ${lambdaNode.id}`);
        continue;
      }
      
      // Create ZIP file
      const zipBuffer = await createCodeZipBuffer(code, lambdaNode);
      
      // Generate S3 key
      const functionName = lambdaNode.config?.functionName || lambdaNode.name || `lambda-${lambdaNode.id}`;
      const sanitizedName = functionName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
      const s3Key = `lambda-code/${deploymentContext.workflowId}/${sanitizedName}-${Date.now()}.zip`;
      
      // Upload to S3
      const bucketName = process.env.LAMBDA_CODE_BUCKET;
      if (!bucketName) {
        throw new Error('LAMBDA_CODE_BUCKET environment variable not set');
      }
      
      await uploadToS3(zipBuffer, bucketName, s3Key);
      
      codeUploads.push({
        nodeId: lambdaNode.id,
        functionName: sanitizedName,
        s3Bucket: bucketName,
        s3Key: s3Key,
        originalCode: code
      });
      
      console.log(`✅ PRE-UPLOAD: Uploaded code for ${lambdaNode.id} to s3://${bucketName}/${s3Key}`);
      
    } catch (error) {
      console.error(`❌ PRE-UPLOAD: Failed to upload code for Lambda node ${lambdaNode.id}:`, error);
      
      // Check if this is a jszip-related error
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('jszip') || errorMessage.includes('Cannot find module')) {
        throw new Error(`jszip dependency not available for ZIP creation: ${errorMessage}`);
      }
      
      throw new Error(`Failed to upload Lambda code for node ${lambdaNode.id}: ${errorMessage}`);
    }
  }
  
  console.log(`✅ PRE-UPLOAD: Successfully uploaded ${codeUploads.length} Lambda functions to S3`);
  return codeUploads;
}

/**
 * Create ZIP buffer from Lambda code
 */
async function createCodeZipBuffer(code: string, lambdaNode: any): Promise<Buffer> {
  try {
    console.log('📦 PRE-UPLOAD: Attempting to create ZIP file with jszip');
    const JSZip = await import('jszip');
    
    if (!JSZip || !JSZip.default) {
      throw new Error('jszip module loaded but default export not available');
    }
    
    const zip = new JSZip.default();
    
    // Determine file name based on runtime
    const runtime = lambdaNode.config?.runtime || 'python3.12';
    const fileName = runtime.includes('python') ? 'lambda_function.py' : 
                    runtime.includes('nodejs') ? 'index.js' : 
                    'handler.py';
    
    console.log(`📦 PRE-UPLOAD: Adding file ${fileName} to ZIP`);
    zip.file(fileName, code);
    
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    console.log(`✅ PRE-UPLOAD: ZIP created successfully, size: ${zipBuffer.length} bytes`);
    
    return zipBuffer;
    
  } catch (error) {
    console.error('❌ PRE-UPLOAD: Failed to create ZIP with jszip:', error);
    
    // For now, throw the error to trigger the fallback to inline code
    // In the future, we could implement a manual ZIP creation here
    throw new Error(`ZIP creation failed - jszip not available: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Upload buffer to S3
 */
async function uploadToS3(buffer: Buffer, bucketName: string, s3Key: string): Promise<void> {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
  
  await s3Client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: s3Key,
    Body: buffer,
    ContentType: 'application/zip'
  }));
}

/**
 * Get default Lambda code for a node
 */
function getDefaultLambdaCodeForNode(lambdaNode: any): string {
  return `
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    """
    Default Lambda function for workflow node: ${lambdaNode.name || lambdaNode.id}
    """
    logger.info(f"Processing event: {json.dumps(event)}")
    
    # TODO: Implement your business logic here
    result = {
        'statusCode': 200,
        'body': {
            'message': 'Lambda function executed successfully',
            'nodeId': '${lambdaNode.id}',
            'nodeName': '${lambdaNode.name || 'Unnamed'}',
            'input': event
        }
    }
    
    logger.info(f"Returning result: {json.dumps(result)}")
    return result
  `.trim();
}

/**
 * Handle Step Functions template generation request
 */
async function handleStepFunctionsTemplateGeneration(event: any): Promise<any> {
  console.log('📝 STEP FUNCTIONS: Generating CloudFormation template...');
  
  const { deploymentContext, workflow, lambdaCodeUploads } = event;
  
  try {
    // Generate CloudFormation template with pre-uploaded Lambda code
    const template = await CloudFormationTemplateGenerator.generateTemplate(workflow, deploymentContext, lambdaCodeUploads);
    
    if (!template || template.length === 0) {
      throw new Error('Generated CloudFormation template is empty');
    }

    // Create stack name based on workflow ID for consistency
    // This ensures updates target the same stack instead of creating new ones
    const stackName = `workflow-${deploymentContext.workflowId}`;
    
    console.log('✅ STEP FUNCTIONS: Template generated successfully');
    console.log('📊 STEP FUNCTIONS: Template size:', template.length, 'characters');
    console.log('🏷️ STEP FUNCTIONS: Stack name:', stackName);

    return {
      statusCode: 200,
      stackName,
      template,
      parameters: [
        {
          ParameterKey: 'WorkflowId',
          ParameterValue: deploymentContext.workflowId
        },
        {
          ParameterKey: 'DeploymentId',
          ParameterValue: deploymentContext.deploymentId
        },
        {
          ParameterKey: 'Environment',
          ParameterValue: deploymentContext.environment
        }
      ],
      tags: [
        {
          Key: 'WorkflowId',
          Value: deploymentContext.workflowId
        },
        {
          Key: 'DeploymentId', 
          Value: deploymentContext.deploymentId
        },
        {
          Key: 'Environment',
          Value: deploymentContext.environment
        },
        {
          Key: 'DeployedBy',
          Value: deploymentContext.userId
        }
      ]
    };
  } catch (error) {
    console.error('❌ STEP FUNCTIONS: Template generation failed:', error);
    
    // Return error response in the expected format for Step Functions
    return {
      statusCode: 500,
      headers: createSuccessHeaders(),
      body: JSON.stringify({
        error: 'Internal server error',
        message: `CloudFormation template generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      })
    };
  }
}

/**
 * Publish deployment status event to EventBridge
 */
async function publishDeploymentStatusEvent(
  deploymentId: string,
  status: string,
  details?: any
): Promise<void> {
  try {
    await eventBridgeClient.send(new PutEventsCommand({
      Entries: [
        {
          Source: 'workflow-builder.deployment',
          DetailType: 'Deployment Status Update',
          Detail: JSON.stringify({
            deploymentId,
            status,
            timestamp: new Date().toISOString(),
            ...details,
          }),
        },
      ],
    }));
    
    console.log('📡 Published deployment status event:', { deploymentId, status });
  } catch (error) {
    console.error('❌ Failed to publish deployment status event:', error);
    // Don't throw - this is non-critical
  }
}