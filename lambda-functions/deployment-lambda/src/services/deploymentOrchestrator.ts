import {
  DeploymentContext,
  DeploymentStatus,
} from '../types/deployment';
import { CloudFormationDeployer } from './cloudFormationDeployer';
import { CloudFormationTemplateGenerator } from './cloudFormationTemplateGenerator';
import { CloudFormationStackManager } from './cloudFormationStackManager';
import { Workflow } from '../types/workflow';
// import { WebSocketNotificationService } from './webSocketNotificationService';

export class DeploymentOrchestrator {
  /**
   * Deploy workflow using CloudFormation approach consistently
   * This is the only deployment method - no direct Step Functions deployment
   */
  async deployWorkflow(
    deploymentContext: DeploymentContext,
    workflow: Workflow,
    updateStatus: (status: Partial<DeploymentStatus>) => Promise<void>
  ): Promise<DeploymentStatus> {
    console.log('🎯 ORCHESTRATOR: Using CloudFormation deployment approach');
    console.log('🎯 ORCHESTRATOR: Starting CloudFormation-based deployment');
    console.log('📋 ORCHESTRATOR: Deployment context:', {
      deploymentId: deploymentContext.deploymentId,
      workflowId: deploymentContext.workflowId,
      userId: deploymentContext.userId,
      workflowName: workflow.name,
      nodeCount: workflow.nodes.length,
    });

    return this.deployWorkflowWithCloudFormation(deploymentContext, workflow, updateStatus);
  }

  /**
   * CloudFormation deployment method - the primary and only deployment approach
   * Uses the existing workflow-builder-deployment Step Functions state machine
   * Enhanced with proper update functionality and stack management
   */
  async deployWorkflowWithCloudFormation(
    deploymentContext: DeploymentContext,
    workflow: Workflow,
    updateStatus: (status: Partial<DeploymentStatus>) => Promise<void>
  ): Promise<DeploymentStatus> {
    console.log('🎯 ORCHESTRATOR: Starting enhanced CloudFormation deployment with update functionality');
    
    // Initialize services
    const webSocketService = null; // WebSocketNotificationService.create();
    const stackManager = new CloudFormationStackManager();

    try {
      // Send initial deployment update
      if (webSocketService) {
        await webSocketService.notifyDeploymentUpdate(deploymentContext.deploymentId, {
          status: 'IN_PROGRESS',
          message: 'Starting CloudFormation deployment with update functionality...',
          timestamp: new Date().toISOString(),
        });
      }

      // Step 1: Validate workflow update behavior
      console.log('🔍 ORCHESTRATOR: Validating workflow update behavior...');
      const updateValidation = await stackManager.validateWorkflowUpdateBehavior(
        deploymentContext.workflowId,
        deploymentContext
      );

      if (!updateValidation.isValid) {
        throw new Error(`Workflow update validation failed: ${updateValidation.issues.join(', ')}`);
      }

      console.log('✅ ORCHESTRATOR: Workflow update validation passed:', {
        stackExists: updateValidation.stackExists,
        issues: updateValidation.issues.length,
      });

      // Step 2: Generate CloudFormation template
      console.log('📝 ORCHESTRATOR: Generating CloudFormation template...');
      const template = await CloudFormationTemplateGenerator.generateTemplate(workflow, deploymentContext);
      
      // Step 3: Perform drift detection and reconciliation if stack exists
      let driftAnalysis = null;
      if (updateValidation.stackExists) {
        console.log('🌊 ORCHESTRATOR: Performing drift detection and reconciliation...');
        driftAnalysis = await stackManager.detectAndReconcileStackDrift(
          `workflow-${deploymentContext.workflowId}`,
          template
        );

        console.log('📊 ORCHESTRATOR: Drift analysis completed:', {
          hasDrift: driftAnalysis.hasDrift,
          reconciliationNeeded: driftAnalysis.reconciliationNeeded,
          actions: driftAnalysis.reconciliationActions.length,
        });

        if (driftAnalysis.reconciliationNeeded) {
          console.log('⚠️ ORCHESTRATOR: Stack drift detected, will be reconciled during update');
          driftAnalysis.reconciliationActions.forEach(action => 
            console.log(`  - ${action}`)
          );
        }
      }

      // Step 4: Deploy using enhanced CloudFormation deployer
      console.log('🚀 ORCHESTRATOR: Deploying with enhanced CloudFormation deployer...');
      const cfnDeployer = new CloudFormationDeployer();
      const result = await cfnDeployer.deployWorkflow(deploymentContext, template, updateStatus);

      // Add drift analysis to result
      if (driftAnalysis && result.changeAnalysis) {
        result.changeAnalysis = {
          ...result.changeAnalysis,
          driftAnalysis,
        };
      }

      // Send completion update
      if (webSocketService) {
        await webSocketService.notifyDeploymentUpdate(deploymentContext.deploymentId, {
          status: 'COMPLETED',
          message: updateValidation.stackExists ? 
            'CloudFormation stack updated successfully!' : 
            'CloudFormation stack created successfully!',
          timestamp: new Date().toISOString(),
          details: {
            ...result,
            updateType: updateValidation.stackExists ? 'UPDATE' : 'CREATE',
            driftReconciled: driftAnalysis?.reconciliationNeeded || false,
          },
        });
      }

      console.log('✅ ORCHESTRATOR: Enhanced CloudFormation deployment completed successfully');
      return result;

    } catch (error) {
      console.error('❌ ORCHESTRATOR: Enhanced CloudFormation deployment failed:', error);

      // Send failure update via WebSocket
      if (webSocketService) {
        await webSocketService.notifyDeploymentUpdate(deploymentContext.deploymentId, {
          status: 'FAILED',
          message: `CloudFormation deployment failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: new Date().toISOString(),
          details: error,
        });
      }

      const failedStatus: DeploymentStatus = {
        deploymentId: deploymentContext.deploymentId,
        workflowId: deploymentContext.workflowId,
        status: 'failed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: [],
        error: {
          code: 'CLOUDFORMATION_DEPLOYMENT_FAILED',
          message: error instanceof Error ? error.message : 'Unknown CloudFormation error',
          details: error,
        },
      };

      await updateStatus(failedStatus);
      return failedStatus;
    }
  }
}