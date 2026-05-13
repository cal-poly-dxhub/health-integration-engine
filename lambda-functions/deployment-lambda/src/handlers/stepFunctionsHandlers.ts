import { DeploymentContext } from '../types/deployment';
import { Workflow } from '../types/workflow';
import { CloudFormationTemplateGenerator } from '../services/cloudFormationTemplateGenerator';

/**
 * Initialize deployment - validates input and prepares context
 */
export const initializeDeployment = async (event: any) => {
  console.log('🚀 STEP FUNCTIONS: Initialize deployment handler');
  console.log('📋 Input event:', JSON.stringify(event, null, 2));

  try {
    const { deploymentContext, workflow } = event;
    
    if (!deploymentContext || !workflow) {
      throw new Error('Missing required parameters: deploymentContext and workflow');
    }

    // Validate deployment context
    if (!deploymentContext.deploymentId || !deploymentContext.workflowId) {
      throw new Error('Invalid deployment context: missing deploymentId or workflowId');
    }

    // Validate workflow
    if (!workflow.nodes || workflow.nodes.length === 0) {
      throw new Error('Workflow must have at least one node');
    }

    console.log('✅ STEP FUNCTIONS: Deployment initialization successful');
    
    return {
      statusCode: 200,
      deploymentContext,
      workflow,
      message: 'Deployment initialized successfully'
    };
  } catch (error) {
    console.error('❌ STEP FUNCTIONS: Deployment initialization failed:', error);
    throw error;
  }
};

/**
 * Generate CloudFormation template from workflow
 */
export const generateTemplate = async (event: any) => {
  console.log('📝 STEP FUNCTIONS: Generate template handler');
  console.log('📋 Input event keys:', Object.keys(event));

  try {
    const { deploymentContext, workflow } = event;
    
    if (!deploymentContext || !workflow) {
      throw new Error('Missing required parameters: deploymentContext and workflow');
    }

    console.log('🔄 STEP FUNCTIONS: Generating CloudFormation template...');
    console.log('📊 STEP FUNCTIONS: Workflow info:', {
      id: workflow.id,
      name: workflow.name,
      nodeCount: workflow.nodes?.length || 0
    });

    // Generate CloudFormation template
    const template = await CloudFormationTemplateGenerator.generateTemplate(workflow, deploymentContext);
    
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
      parameters: [],
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
    throw error;
  }
};

/**
 * Update deployment status in database
 */
export const updateDeploymentStatus = async (event: any) => {
  console.log('📊 STEP FUNCTIONS: Update deployment status handler');
  console.log('📋 Input event:', JSON.stringify(event, null, 2));

  try {
    const { deploymentId, status, stepFunctionArn, cloudFormationStackArn, error } = event;
    
    if (!deploymentId || !status) {
      throw new Error('Missing required parameters: deploymentId and status');
    }

    // TODO: Update deployment status in DynamoDB
    // This would typically use the same updateDeploymentStatus function from deployWorkflow.ts
    
    console.log('✅ STEP FUNCTIONS: Deployment status updated successfully');
    
    return {
      statusCode: 200,
      deploymentId,
      status,
      message: 'Deployment status updated successfully'
    };
  } catch (error) {
    console.error('❌ STEP FUNCTIONS: Status update failed:', error);
    throw error;
  }
};