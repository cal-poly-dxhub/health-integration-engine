import { DeploymentContext } from '../types/deployment';
import { Workflow } from '../types/workflow';
import { NodeHandlerRegistry } from './nodeHandlers';
import { IAMPermissionAnalyzer } from './iamPermissionAnalyzer';

export class CloudFormationTemplateGenerator {
  /**
   * Extract S3 trigger configuration from workflow nodes
   */
  private static getS3TriggerConfig(workflow: Workflow): { bucketName: string; folderPrefix?: string; region?: string } | null {
    const s3Node = workflow.nodes.find(node => node.type === 's3' && node.config?.triggerOnUpload !== false);
    if (!s3Node || !s3Node.config?.bucketName) return null;
    
    return {
      bucketName: s3Node.config.bucketName,
      folderPrefix: s3Node.config.folderPrefix,
      region: s3Node.config.region || 'us-west-2',
    };
  }

  /**
   * Generate S3 EventBridge trigger resources
   */
  private static generateS3TriggerResources(workflow: Workflow): any {
    const s3Config = this.getS3TriggerConfig(workflow);
    if (!s3Config) return {};

    const resources: any = {};
    
    // EventBridge Rule to capture S3 ObjectCreated events
    resources.S3TriggerEventRule = {
      Type: 'AWS::Events::Rule',
      DependsOn: 'StepFunctionsStateMachine',
      Properties: {
        Name: { 'Fn::Sub': `S3Trigger-\${WorkflowId}` },
        Description: { 'Fn::Sub': `Trigger Step Function when objects are created in S3 bucket ${s3Config.bucketName}` },
        State: 'ENABLED',
        EventPattern: {
          source: ['aws.s3'],
          'detail-type': ['Object Created'],
          detail: {
            bucket: {
              name: [s3Config.bucketName],
            },
            ...(s3Config.folderPrefix && {
              object: {
                key: [{ prefix: s3Config.folderPrefix }],
              },
            }),
          },
        },
        Targets: [
          {
            Id: 'StepFunctionTarget',
            Arn: { Ref: 'StepFunctionsStateMachine' },
            RoleArn: { 'Fn::GetAtt': ['EventBridgeInvokeRole', 'Arn'] },
          },
        ],
      },
    };

    // IAM Role for EventBridge to invoke Step Functions
    resources.EventBridgeInvokeRole = {
      Type: 'AWS::IAM::Role',
      Properties: {
        RoleName: { 'Fn::Sub': `EventBridge-SF-Role-\${WorkflowId}` },
        AssumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: {
                Service: 'events.amazonaws.com',
              },
              Action: 'sts:AssumeRole',
            },
          ],
        },
        Policies: [
          {
            PolicyName: 'InvokeStepFunction',
            PolicyDocument: {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: 'states:StartExecution',
                  Resource: { Ref: 'StepFunctionsStateMachine' },
                },
              ],
            },
          },
        ],
      },
    };

    return resources;
  }

  /**
   * Generate S3 trigger outputs
   */
  private static generateS3TriggerOutputs(workflow: Workflow): any {
    const s3Config = this.getS3TriggerConfig(workflow);
    if (!s3Config) return {};

    return {
      S3TriggerBucket: {
        Description: 'S3 bucket that triggers the workflow',
        Value: s3Config.bucketName,
      },
      S3TriggerPrefix: {
        Description: 'S3 prefix filter for trigger',
        Value: s3Config.folderPrefix || '(entire bucket)',
      },
      EventBridgeRuleArn: {
        Description: 'ARN of the EventBridge rule',
        Value: { 'Fn::GetAtt': ['S3TriggerEventRule', 'Arn'] },
      },
    };
  }

  /**
   * Generate CloudFormation template for a workflow
   */
  static async generateTemplate(workflow: Workflow, deploymentContext: DeploymentContext, lambdaCodeUploads?: any[]): Promise<string> {
    console.log('📝 CFT GENERATOR: Starting template generation...');
    
    try {
    // Validate IAM roles for S3 and database nodes
    const { validateIAMRoleArn } = await import('./iamRoleValidator');
    for (const node of workflow.nodes) {
      if ((node.type === 's3' || node.type === 'database') && 
          node.config?.iamRole?.useExisting && 
          node.config?.iamRole?.existingRoleArn) {
        const validation = await validateIAMRoleArn(node.config.iamRole.existingRoleArn, 'stepfunctions');
        if (!validation.valid) {
          throw new Error(`Invalid IAM role for ${node.type} node ${node.name}: ${validation.error}`);
        }
        console.log(`✓ Validated existing role for ${node.type} node ${node.name}`);
      }
    }
    
    console.log('📋 CFT GENERATOR: Workflow details:', {
      name: workflow.name,
      id: workflow.id,
      nodeCount: workflow.nodes.length,
      connectionCount: workflow.connections.length,
    });
    console.log('🎯 CFT GENERATOR: Deployment context:', {
      deploymentId: deploymentContext.deploymentId,
      workflowId: deploymentContext.workflowId,
      environment: deploymentContext.environment,
    });

    // Check for S3 trigger configuration
    const s3TriggerConfig = this.getS3TriggerConfig(workflow);
    if (s3TriggerConfig) {
      console.log('🔔 CFT GENERATOR: S3 trigger detected:', s3TriggerConfig);
    }

    const template = {
      AWSTemplateFormatVersion: '2010-09-09',
      Description: `Step Functions workflow: ${workflow.name}${s3TriggerConfig ? ' (S3 event-triggered)' : ''}`,
      
      Parameters: {
        WorkflowId: {
          Type: 'String',
          Description: 'Workflow ID',
        },
        DeploymentId: {
          Type: 'String',
          Description: 'Deployment ID',
        },
        Environment: {
          Type: 'String',
          Description: 'Environment (development, staging, production)',
          Default: 'development',
        },
      },

      Resources: {
        // IAM Role for Step Functions
        StepFunctionsExecutionRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: {
              'Fn::Sub': `SF-Role-\${WorkflowId}`,
            },
            AssumeRolePolicyDocument: {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Principal: {
                    Service: 'states.amazonaws.com',
                  },
                  Action: 'sts:AssumeRole',
                },
              ],
            },
            Policies: [
              {
                PolicyName: 'StepFunctionsExecutionPolicy',
                PolicyDocument: IAMPermissionAnalyzer.generateIAMPolicyDocument(workflow),
              },
            ],
            Tags: [
              { Key: 'WorkflowId', Value: { Ref: 'WorkflowId' } },
              { Key: 'DeploymentId', Value: { Ref: 'DeploymentId' } },
              { Key: 'Environment', Value: { Ref: 'Environment' } },
            ],
          },
        },

        // CloudWatch Log Group for Step Functions
        StepFunctionsLogGroup: {
          Type: 'AWS::Logs::LogGroup',
          Properties: {
            LogGroupName: {
              'Fn::Sub': `/aws/stepfunctions/SF-\${WorkflowId}`,
            },
            RetentionInDays: 7,
            Tags: [
              { Key: 'WorkflowId', Value: { Ref: 'WorkflowId' } },
              { Key: 'DeploymentId', Value: { Ref: 'DeploymentId' } },
              { Key: 'Environment', Value: { Ref: 'Environment' } },
            ],
          },
        },

        // Generate Lambda functions and their roles
        ...(await this.generateLambdaResources(workflow, deploymentContext, lambdaCodeUploads)),

        // Step Functions State Machine
        StepFunctionsStateMachine: {
          Type: 'AWS::StepFunctions::StateMachine',
          Properties: {
            StateMachineName: {
              'Fn::Sub': `SF-\${WorkflowId}`,
            },
            StateMachineType: 'STANDARD',
            RoleArn: {
              'Fn::GetAtt': ['StepFunctionsExecutionRole', 'Arn'],
            },
            DefinitionString: this.generateStepFunctionDefinition(workflow, deploymentContext),
            LoggingConfiguration: {
              Level: 'ALL',
              IncludeExecutionData: true,
              Destinations: [
                {
                  CloudWatchLogsLogGroup: {
                    LogGroupArn: {
                      'Fn::GetAtt': ['StepFunctionsLogGroup', 'Arn'],
                    },
                  },
                },
              ],
            },
            Tags: [
              { Key: 'WorkflowId', Value: { Ref: 'WorkflowId' } },
              { Key: 'DeploymentId', Value: { Ref: 'DeploymentId' } },
              { Key: 'Environment', Value: { Ref: 'Environment' } },
              { Key: 'Version', Value: { 'Fn::Sub': 'v\${DeploymentId}' } },
            ],
          },
        },

        // S3 EventBridge trigger resources (if S3 trigger is configured)
        ...this.generateS3TriggerResources(workflow),
      },

      Outputs: {
        StepFunctionArn: {
          Description: 'ARN of the Step Functions state machine',
          Value: {
            Ref: 'StepFunctionsStateMachine',
          },
          Export: {
            Name: {
              'Fn::Sub': `SF-Arn-\${WorkflowId}`,
            },
          },
        },
        StepFunctionName: {
          Description: 'Name of the Step Functions state machine',
          Value: {
            'Fn::GetAtt': ['StepFunctionsStateMachine', 'Name'],
          },
        },
        // Note: Removed version and alias outputs for simplified deployment
        ExecutionRoleArn: {
          Description: 'ARN of the Step Functions execution role',
          Value: {
            'Fn::GetAtt': ['StepFunctionsExecutionRole', 'Arn'],
          },
        },
        // Add Lambda function outputs
        ...this.generateLambdaOutputs(workflow),
        // Add S3 trigger outputs (if configured)
        ...this.generateS3TriggerOutputs(workflow),
      },
    };

    const templateJson = JSON.stringify(template, null, 2);
    
    console.log('✅ CFT GENERATOR: Template generation completed');
    console.log('📊 CFT GENERATOR: Template size:', templateJson.length, 'characters');
    console.log('🔍 CFT GENERATOR: Template resources:', Object.keys(template.Resources));
    console.log('📄 CFT GENERATOR: Generated CloudFormation Template:');
    console.log('=' .repeat(80));
    console.log(templateJson);
    console.log('=' .repeat(80));
    
    return templateJson;
    
    } catch (error) {
      console.error('❌ CFT GENERATOR: Template generation failed:', error);
      console.error('❌ CFT GENERATOR: Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        workflowId: workflow.id,
        workflowName: workflow.name,
        nodeCount: workflow.nodes.length
      });
      throw new Error(`CloudFormation template generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate Step Functions definition from workflow using extensible node handlers
   */
  private static generateStepFunctionDefinition(workflow: Workflow, deploymentContext: DeploymentContext): string {
    console.log('🔄 CFT GENERATOR: Generating Step Functions definition...');
    
    // Find start node first to determine StartAt
    const startNode = workflow.nodes.find(node => node.type === 'start');
    if (!startNode) {
      throw new Error('Workflow must have a start node');
    }
    console.log('🚀 CFT GENERATOR: Found start node:', startNode.name || startNode.id);
    
    // Use consistent naming: always include node ID to ensure uniqueness
    const startStateName = startNode.name ? `${startNode.name}_${startNode.id}` : `${startNode.type}_${startNode.id}`;
    
    // Convert workflow nodes and connections to Step Functions ASL
    const definition = {
      Comment: `Generated Step Functions definition for workflow: ${workflow.name}`,
      StartAt: startStateName,
      States: {} as any,
    };

    // Find end node
    const endNode = workflow.nodes.find(node => node.type === 'end');
    if (!endNode) {
      throw new Error('Workflow must have an end node');
    }
    console.log('🏁 CFT GENERATOR: Found end node:', endNode.name || endNode.id);

    // Generate states for each node using the registry
    console.log('🔧 CFT GENERATOR: Processing nodes...');
    console.log('🔍 CFT GENERATOR: All workflow nodes:', workflow.nodes.map(n => ({ 
      id: n.id, 
      name: n.name, 
      type: n.type, 
      functionName: n.config?.functionName 
    })));
    
    workflow.nodes.forEach(node => {
      console.log(`  📦 Processing node: ${node.name || node.id} (type: ${node.type})`);
      console.log(`    🏷️  Node details:`, { 
        id: node.id, 
        name: node.name, 
        type: node.type, 
        functionName: node.config?.functionName 
      });
      
      const handler = NodeHandlerRegistry.getHandler(node.type);
      // Use consistent naming: always include node ID to ensure uniqueness
      const stateName = node.name ? `${node.name}_${node.id}` : `${node.type}_${node.id}`;
      const nextState = this.getNextState(node.id, workflow);
      
      console.log(`    🎯 State name: "${stateName}"`);
      console.log(`    ➡️  Next state: ${nextState || 'End'}`);
      
      // Check if state name already exists (this would indicate duplicate names)
      if (definition.States[stateName]) {
        console.warn(`⚠️  CFT GENERATOR: State name "${stateName}" already exists! This will overwrite the previous state.`);
        console.warn(`    Previous state:`, JSON.stringify(definition.States[stateName], null, 2));
      }
      
      const stateDefinition = handler(node, nextState, workflow, deploymentContext);
      definition.States[stateName] = stateDefinition;
      
      console.log(`    ✅ Generated state definition:`, JSON.stringify(stateDefinition, null, 2));
    });

    const definitionJson = JSON.stringify(definition, null, 2);
    console.log('✅ CFT GENERATOR: Step Functions definition completed');
    console.log('📄 CFT GENERATOR: Step Functions ASL Definition:');
    console.log('-' .repeat(60));
    console.log(definitionJson);
    console.log('-' .repeat(60));
    
    return definitionJson;
  }



  /**
   * Get the next state for a given node
   */
  private static getNextState(nodeId: string, workflow: Workflow): string | null {
    const connection = workflow.connections.find(conn => conn.sourceNodeId === nodeId);
    if (!connection) return null;

    const targetNode = workflow.nodes.find(node => node.id === connection.targetNodeId);
    if (!targetNode) return null;
    
    // Use the same naming convention as state generation to ensure consistency
    return targetNode.name ? `${targetNode.name}_${targetNode.id}` : `${targetNode.type}_${targetNode.id}`;
  }

  /**
   * Generate Lambda function resources with proper IAM roles based on connected nodes
   */
  private static async generateLambdaResources(workflow: Workflow, deploymentContext: DeploymentContext, lambdaCodeUploads?: any[]): Promise<any> {
    const resources: any = {};
    
    // Find all Lambda nodes
    const lambdaNodes = workflow.nodes.filter(node => node.type === 'lambda');
    
    for (const lambdaNode of lambdaNodes) {
      const nodeId = lambdaNode.id;
      const nodeName = lambdaNode.name || `Lambda${nodeId}`;
      // Use the user-specified function name from config, fallback to node name
      const functionName = lambdaNode.config?.functionName || nodeName;
      const sanitizedName = functionName.replace(/[^a-zA-Z0-9]/g, '');
      
      console.log(`🔧 CFT GENERATOR: Generating Lambda resources for node: ${nodeName}`);
      
      // Generate IAM role for this Lambda function based on connected nodes
      // Truncate sanitizedName to ensure role name stays within 64 character limit
      // Format: Lambda-{name}-Role-{workflowId} should be <= 64 chars
      // WorkflowId is ~30 chars, "Lambda-" + "-Role-" = 13 chars, so limit name to 15 chars max
      const truncatedName = sanitizedName.length > 15 ? sanitizedName.substring(0, 15) : sanitizedName;
      const lambdaRoleName = `${truncatedName}ExecutionRole`;
      const lambdaFunctionName = `${truncatedName}Function`;
      const lambdaLogGroupName = `${truncatedName}LogGroup`;
      
      // Analyze connected nodes to determine permissions
      const connectedPermissions = this.analyzeLambdaConnectedNodes(lambdaNode, workflow);
      
      // Lambda execution role
      const roleProperties: any = {
        RoleName: {
          'Fn::Sub': `Lambda-${truncatedName}-Role-\${WorkflowId}`,
        },
        AssumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: {
                Service: 'lambda.amazonaws.com',
              },
              Action: 'sts:AssumeRole',
            },
          ],
        },
        ManagedPolicyArns: [
          'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        ],
        Tags: [
          { Key: 'WorkflowId', Value: { Ref: 'WorkflowId' } },
          { Key: 'DeploymentId', Value: { Ref: 'DeploymentId' } },
          { Key: 'Environment', Value: { Ref: 'Environment' } },
          { Key: 'NodeId', Value: nodeId },
        ],
      };

      // Only add Policies if there are connected permissions
      if (connectedPermissions.length > 0) {
        roleProperties.Policies = [
          {
            PolicyName: 'LambdaExecutionPolicy',
            PolicyDocument: {
              Version: '2012-10-17',
              Statement: connectedPermissions,
            },
          },
        ];
      }

      // Check if user wants to use an existing IAM role
      let lambdaRoleArn;
      if (lambdaNode.config?.iamRole?.useExisting && lambdaNode.config?.iamRole?.existingRoleArn) {
        // Validate the role ARN
        const { validateIAMRoleArn } = await import('./iamRoleValidator');
        const validation = await validateIAMRoleArn(lambdaNode.config.iamRole.existingRoleArn, 'lambda');
        
        if (!validation.valid) {
          throw new Error(`Invalid IAM role for Lambda node ${nodeName}: ${validation.error}`);
        }
        
        // Use existing role ARN
        lambdaRoleArn = lambdaNode.config.iamRole.existingRoleArn;
        console.log(`🔧 CFT GENERATOR: Using existing IAM role for ${nodeName}: ${lambdaRoleArn}`);
      } else {
        // Create new role
        resources[lambdaRoleName] = {
          Type: 'AWS::IAM::Role',
          Properties: roleProperties,
        };
        lambdaRoleArn = { 'Fn::GetAtt': [lambdaRoleName, 'Arn'] };
      }

      // Lambda log group
      resources[lambdaLogGroupName] = {
        Type: 'AWS::Logs::LogGroup',
        Properties: {
          LogGroupName: {
            'Fn::Sub': `/aws/lambda/\${WorkflowId}-${sanitizedName}`,
          },
          RetentionInDays: 7,
          Tags: [
            { Key: 'WorkflowId', Value: { Ref: 'WorkflowId' } },
            { Key: 'DeploymentId', Value: { Ref: 'DeploymentId' } },
            { Key: 'Environment', Value: { Ref: 'Environment' } },
            { Key: 'NodeId', Value: nodeId },
          ],
        },
      };

      // Lambda function (without API Gateway trigger)
      resources[lambdaFunctionName] = {
        Type: 'AWS::Lambda::Function',
        Properties: {
          FunctionName: {
            'Fn::Sub': `\${WorkflowId}-${sanitizedName}`,
          },
          Runtime: lambdaNode.config?.runtime || 'python3.12',
          Handler: lambdaNode.config?.handler || this.getDefaultHandler(lambdaNode.config?.runtime || 'python3.12'),
          Role: lambdaRoleArn,
          Code: await this.generateLambdaCodeConfig(lambdaNode, deploymentContext, lambdaCodeUploads || []),
          Description: `Lambda function for workflow node: ${nodeName}`,
          Timeout: lambdaNode.config?.timeout || 30,
          MemorySize: lambdaNode.config?.memorySize || 128,
          Environment: {
            Variables: {
              WORKFLOW_ID: { Ref: 'WorkflowId' },
              DEPLOYMENT_ID: { Ref: 'DeploymentId' },
              ENVIRONMENT: { Ref: 'Environment' },
              NODE_ID: nodeId,
              ...lambdaNode.config?.environmentVariables,
            },
          },
          Tags: [
            { Key: 'WorkflowId', Value: { Ref: 'WorkflowId' } },
            { Key: 'DeploymentId', Value: { Ref: 'DeploymentId' } },
            { Key: 'Environment', Value: { Ref: 'Environment' } },
            { Key: 'NodeId', Value: nodeId },
          ],
        },
        DependsOn: [lambdaLogGroupName],
      };
      
      console.log(`✅ CFT GENERATOR: Generated Lambda resources for ${nodeName}:`, {
        role: lambdaRoleName,
        function: lambdaFunctionName,
        logGroup: lambdaLogGroupName,
        permissions: connectedPermissions.length,
      });
    }
    
    return resources;
  }

  /**
   * Analyze connected nodes to determine Lambda function permissions
   */
  private static analyzeLambdaConnectedNodes(lambdaNode: any, workflow: Workflow): any[] {
    const permissions: any[] = [];
    const nodeId = lambdaNode.id;
    
    console.log(`🔍 CFT GENERATOR: Analyzing connections for Lambda node: ${lambdaNode.name || nodeId}`);
    
    // Find upstream nodes (nodes that connect TO this Lambda)
    const upstreamConnections = workflow.connections.filter(conn => conn.targetNodeId === nodeId);
    const upstreamNodes = upstreamConnections.map(conn => 
      workflow.nodes.find(node => node.id === conn.sourceNodeId)
    ).filter(Boolean);
    
    // Find downstream nodes (nodes that this Lambda connects TO)
    const downstreamConnections = workflow.connections.filter(conn => conn.sourceNodeId === nodeId);
    const downstreamNodes = downstreamConnections.map(conn => 
      workflow.nodes.find(node => node.id === conn.targetNodeId)
    ).filter(Boolean);
    
    console.log(`  📥 Upstream nodes: ${upstreamNodes.map(n => n?.name || n?.id).join(', ')}`);
    console.log(`  📤 Downstream nodes: ${downstreamNodes.map(n => n?.name || n?.id).join(', ')}`);
    
    // Analyze upstream nodes for read permissions
    upstreamNodes.forEach(node => {
      if (!node) return;
      const nodePermissions = this.getLambdaPermissionsForConnectedNode(node, 'read');
      permissions.push(...nodePermissions);
      console.log(`    📥 Added read permissions for ${node.type}: ${nodePermissions.map(p => p.Action).flat().join(', ')}`);
    });
    
    // Analyze downstream nodes for write permissions
    downstreamNodes.forEach(node => {
      if (!node) return;
      const nodePermissions = this.getLambdaPermissionsForConnectedNode(node, 'write');
      permissions.push(...nodePermissions);
      console.log(`    📤 Added write permissions for ${node.type}: ${nodePermissions.map(p => p.Action).flat().join(', ')}`);
    });
    
    return permissions;
  }

  /**
   * Get Lambda permissions for a connected node
   */
  private static getLambdaPermissionsForConnectedNode(node: any, accessType: 'read' | 'write'): any[] {
    const nodeType = node.type;
    const config = node.config || {};
    
    switch (nodeType) {
      case 's3':
        return this.getS3PermissionsForLambda(config, accessType);
      
      case 'database':
        return this.getDatabasePermissionsForLambda(config, accessType);
      
      case 'lambda':
        // Lambda functions don't need invoke permissions for other Lambda functions
        // Step Functions handles Lambda-to-Lambda invocation
        return [];
      
      default:
        return [];
    }
  }

  /**
   * Get S3 permissions for Lambda function
   */
  private static getS3PermissionsForLambda(config: any, accessType: 'read' | 'write'): any[] {
    const bucketName = config.bucketName || '*';
    const objectKey = config.objectKey || '*';
    
    const bucketArn = `arn:aws:s3:::${bucketName}`;
    const objectArn = `arn:aws:s3:::${bucketName}/${objectKey}`;
    
    if (accessType === 'read') {
      return [{
        Effect: 'Allow',
        Action: ['s3:GetObject', 's3:GetObjectVersion', 's3:ListBucket'],
        Resource: [bucketArn, objectArn],
      }];
    } else {
      return [{
        Effect: 'Allow',
        Action: ['s3:PutObject', 's3:PutObjectAcl', 's3:DeleteObject'],
        Resource: [objectArn],
      }];
    }
  }

  /**
   * Get Database permissions for Lambda function
   */
  private static getDatabasePermissionsForLambda(config: any, accessType: 'read' | 'write'): any[] {
    const tableName = config.tableName || '*';
    const tableArn = `arn:aws:dynamodb:*:*:table/${tableName}`;
    
    if (accessType === 'read') {
      return [{
        Effect: 'Allow',
        Action: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
        Resource: [tableArn],
      }];
    } else {
      return [{
        Effect: 'Allow',
        Action: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
        Resource: [tableArn],
      }];
    }
  }

  /**
   * Generate Lambda function outputs
   */
  private static generateLambdaOutputs(workflow: Workflow): any {
    const outputs: any = {};
    
    const lambdaNodes = workflow.nodes.filter(node => node.type === 'lambda');
    
    lambdaNodes.forEach(lambdaNode => {
      const nodeName = lambdaNode.name || `Lambda${lambdaNode.id}`;
      // Use the user-specified function name from config, fallback to node name
      const userFunctionName = lambdaNode.config?.functionName || nodeName;
      const sanitizedName = userFunctionName.replace(/[^a-zA-Z0-9]/g, '');
      // Use same truncation logic as in resource generation
      const truncatedName = sanitizedName.length > 15 ? sanitizedName.substring(0, 15) : sanitizedName;
      const functionName = `${truncatedName}Function`;
      
      outputs[`${truncatedName}FunctionArn`] = {
        Description: `ARN of Lambda function: ${nodeName}`,
        Value: {
          'Fn::GetAtt': [functionName, 'Arn'],
        },
      };
      
      outputs[`${truncatedName}FunctionName`] = {
        Description: `Name of Lambda function: ${nodeName}`,
        Value: {
          Ref: functionName,
        },
      };
    });
    
    return outputs;
  }

  /**
   * Preserve original code exactly as user wrote it
   * This is language-agnostic and maintains all formatting
   */
  private static preserveOriginalCode(code: string): string {
    if (!code || typeof code !== 'string') {
      return code || '';
    }

    console.log('🔧 CFT GENERATOR: Preserving original Lambda code');
    console.log('📝 CFT GENERATOR: Code length:', code.length);
    
    // Simply return the code as-is, but ensure it's properly escaped for JSON
    // CloudFormation will handle it correctly
    return code;
  }

  /**
   * Generate Lambda code configuration - uses S3 for reliable code deployment
   */
  private static async generateLambdaCodeConfig(lambdaNode: any, deploymentContext: DeploymentContext, lambdaCodeUploads?: any[]): Promise<any> {
    console.log('🔧 CFT GENERATOR: Generating Lambda code config for node:', lambdaNode.id);
    
    // First, check if we have pre-uploaded S3 code for this node
    if (lambdaCodeUploads && lambdaCodeUploads.length > 0) {
      const codeUpload = lambdaCodeUploads.find(upload => upload.nodeId === lambdaNode.id);
      
      if (codeUpload) {
        console.log('✅ CFT GENERATOR: Using pre-uploaded S3 code for node:', lambdaNode.id);
        console.log('🪣 CFT GENERATOR: S3 Bucket:', codeUpload.s3Bucket);
        console.log('🔑 CFT GENERATOR: S3 Key:', codeUpload.s3Key);
        
        return {
          S3Bucket: codeUpload.s3Bucket,
          S3Key: codeUpload.s3Key
        };
      }
    }
    
    // Fallback: try to create and upload code on-the-fly (legacy behavior)
    console.warn('⚠️ CFT GENERATOR: No pre-uploaded code found, attempting on-the-fly upload for node:', lambdaNode.id);
    
    const code = lambdaNode.config?.code || this.getDefaultLambdaCode(lambdaNode);
    console.log('📝 CFT GENERATOR: Code length:', code.length);
    
    try {
      // Try S3-based deployment
      const zipBuffer = await this.createCodeZipFile(code, lambdaNode);
      const s3Key = this.generateS3CodeKey(lambdaNode, deploymentContext);
      const bucketName = this.getCodeBucketName(deploymentContext);
      
      console.log('📦 CFT GENERATOR: Using on-the-fly S3 deployment');
      console.log('🪣 CFT GENERATOR: S3 Bucket:', bucketName);
      console.log('🔑 CFT GENERATOR: S3 Key:', s3Key);
      
      // Upload code to S3 immediately
      await this.uploadCodeToS3(zipBuffer, bucketName, s3Key);
      
      return {
        S3Bucket: bucketName,
        S3Key: s3Key
      };
    } catch (error) {
      console.warn('⚠️ CFT GENERATOR: On-the-fly S3 deployment failed, falling back to inline code:', error);
      
      // Final fallback to inline code deployment
      console.log('📝 CFT GENERATOR: Using inline code deployment as final fallback');
      
      // Normalize and validate the code
      const normalizedCode = this.normalizeLambdaCode(code, lambdaNode.config?.runtime || 'python3.12');
      const validation = this.validateLambdaCode(normalizedCode, lambdaNode.config?.runtime || 'python3.12');
      
      if (!validation.isValid) {
        throw new Error(`Invalid Lambda code: ${validation.warnings.join(', ')}`);
      }
      
      if (validation.warnings.length > 0) {
        console.warn('⚠️ CFT GENERATOR: Code validation warnings:', validation.warnings);
      }
      
      return {
        ZipFile: normalizedCode
      };
    }
  }

  /**
   * Generate S3 key for Lambda code
   */
  private static generateS3CodeKey(lambdaNode: any, deploymentContext: DeploymentContext): string {
    const functionName = lambdaNode.config?.functionName || lambdaNode.name || `lambda-${lambdaNode.id}`;
    const sanitizedName = functionName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
    const timestamp = Date.now();
    
    return `lambda-code/${deploymentContext.workflowId}/${sanitizedName}-${timestamp}.zip`;
  }

  /**
   * Get the S3 bucket name for code storage
   */
  private static getCodeBucketName(deploymentContext: DeploymentContext): string {
    // Use the pre-created bucket from environment variable
    const bucketName = process.env.LAMBDA_CODE_BUCKET;
    if (!bucketName) {
      console.warn('⚠️ CFT GENERATOR: LAMBDA_CODE_BUCKET environment variable not set, S3 deployment will fail');
      throw new Error('LAMBDA_CODE_BUCKET environment variable not set');
    }
    console.log('🪣 CFT GENERATOR: Using S3 bucket for code storage:', bucketName);
    return bucketName;
  }

  /**
   * Create ZIP file from Lambda code
   */
  private static async createCodeZipFile(code: string, lambdaNode: any): Promise<Buffer> {
    try {
      console.log('📦 CFT GENERATOR: Attempting to import jszip for ZIP creation');
      const JSZip = await import('jszip');
      
      if (!JSZip || !JSZip.default) {
        throw new Error('jszip module imported but default export is not available');
      }
      
      console.log('✅ CFT GENERATOR: jszip imported successfully');
      const zip = new JSZip.default();
    
    // Determine file extension based on runtime
    const runtime = lambdaNode.config?.runtime || 'python3.12';
    const fileExtension = runtime.includes('python') ? 'py' : 
                         runtime.includes('nodejs') ? 'js' : 
                         runtime.includes('java') ? 'java' : 
                         runtime.includes('dotnet') ? 'cs' : 'py';
    
    const fileName = runtime.includes('python') ? 'lambda_function.py' : 
                    runtime.includes('nodejs') ? 'index.js' : 
                    `handler.${fileExtension}`;
    
    // Add the code file to ZIP
    zip.file(fileName, code);
    
    // Generate ZIP buffer
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    
    console.log('📦 CFT GENERATOR: Created ZIP file:', {
      fileName,
      originalSize: code.length,
      zipSize: zipBuffer.length
    });
    
      return zipBuffer;
    } catch (error) {
      console.error('❌ CFT GENERATOR: Failed to create ZIP file with jszip:', error);
      
      // Provide specific error messages for common issues
      let errorMessage = 'Failed to create ZIP file';
      if (error instanceof Error) {
        if (error.message.includes('Cannot find module')) {
          errorMessage = `jszip dependency not found: ${error.message}. This will trigger fallback to inline code deployment.`;
        } else {
          errorMessage = `ZIP creation failed: ${error.message}`;
        }
      }
      
      throw new Error(errorMessage);
    }
  }

  /**
   * Upload code ZIP to S3
   */
  private static async uploadCodeToS3(zipBuffer: Buffer, bucketName: string, s3Key: string): Promise<void> {
    try {
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
      
      // Upload ZIP file to S3 (bucket is pre-created by CDK)
      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: zipBuffer,
        ContentType: 'application/zip',
        Metadata: {
          'uploaded-by': 'workflow-builder',
          'upload-time': new Date().toISOString(),
          'workflow-id': process.env.WORKFLOW_ID || 'unknown'
        }
      }));
      
      console.log('✅ CFT GENERATOR: Successfully uploaded code to S3:', {
        bucket: bucketName,
        key: s3Key,
        size: zipBuffer.length
      });
      
    } catch (error) {
      console.error('❌ CFT GENERATOR: Failed to upload code to S3:', error);
      throw new Error(`Failed to upload Lambda code to S3: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Simple validation for Lambda code
   */
  private static validateLambdaCode(code: string, runtime: string): { isValid: boolean; warnings: string[] } {
    const warnings: string[] = [];
    
    if (!code || code.trim().length === 0) {
      warnings.push('Lambda function code is empty');
      return { isValid: false, warnings };
    }
    
    // Basic handler function check
    if (runtime.includes('python')) {
      if (!code.includes('def ') || (!code.includes('lambda_handler') && !code.includes('handler'))) {
        warnings.push('Python Lambda should have a handler function (lambda_handler or handler)');
      }
    } else if (runtime.includes('nodejs')) {
      if (!code.includes('exports.') && !code.includes('module.exports')) {
        warnings.push('Node.js Lambda should export a handler function');
      }
    }
    
    console.log('✅ CFT GENERATOR: Code validation completed', { warnings: warnings.length });
    return {
      isValid: warnings.length === 0,
      warnings
    };
  }

  /**
   * Normalize Lambda code to prevent indentation issues during deployment
   */
  private static normalizeLambdaCode(code: string, runtime: string): string {
    if (!code) return code;
    
    console.log('🔧 CFT GENERATOR: Normalizing Lambda code for runtime:', runtime);
    
    if (runtime.includes('python')) {
      // Python-specific normalization
      return this.normalizePythonCode(code);
    } else if (runtime.includes('nodejs')) {
      // Node.js-specific normalization
      return this.normalizeNodeJsCode(code);
    }
    
    // Default normalization for other runtimes
    return code.trim();
  }
  
  /**
   * Normalize Python code indentation
   */
  private static normalizePythonCode(code: string): string {
    const lines = code.split('\n');
    const normalizedLines: string[] = [];
    
    // Remove leading/trailing empty lines
    let startIndex = 0;
    let endIndex = lines.length - 1;
    
    while (startIndex < lines.length && lines[startIndex].trim() === '') {
      startIndex++;
    }
    
    while (endIndex >= 0 && lines[endIndex].trim() === '') {
      endIndex--;
    }
    
    if (startIndex > endIndex) {
      return code; // All empty lines
    }
    
    const relevantLines = lines.slice(startIndex, endIndex + 1);
    
    // Find the minimum indentation (excluding empty lines)
    let minIndent = Infinity;
    for (const line of relevantLines) {
      if (line.trim() !== '') {
        const indent = line.length - line.trimStart().length;
        minIndent = Math.min(minIndent, indent);
      }
    }
    
    // If all lines are at the same level, no adjustment needed
    if (minIndent === Infinity) minIndent = 0;
    
    // Normalize indentation
    for (const line of relevantLines) {
      if (line.trim() === '') {
        normalizedLines.push('');
      } else {
        // Remove the common indentation and ensure consistent spacing
        const dedented = line.substring(minIndent);
        normalizedLines.push(dedented);
      }
    }
    
    const result = normalizedLines.join('\n');
    console.log('🐍 CFT GENERATOR: Python code normalized');
    return result;
  }
  
  /**
   * Normalize Node.js code
   */
  private static normalizeNodeJsCode(code: string): string {
    // For Node.js, just clean up whitespace and ensure consistent formatting
    const lines = code.split('\n');
    const normalizedLines: string[] = [];
    
    for (const line of lines) {
      // Remove trailing whitespace but preserve intentional indentation
      normalizedLines.push(line.trimEnd());
    }
    
    // Remove leading and trailing empty lines
    while (normalizedLines.length > 0 && normalizedLines[0].trim() === '') {
      normalizedLines.shift();
    }
    
    while (normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1].trim() === '') {
      normalizedLines.pop();
    }
    
    const result = normalizedLines.join('\n');
    console.log('📦 CFT GENERATOR: Node.js code normalized');
    return result;
  }

  /**
   * Get default handler based on runtime
   */
  private static getDefaultHandler(runtime: string): string {
    if (runtime.includes('python')) {
      return 'index.lambda_handler';
    } else if (runtime.includes('nodejs')) {
      return 'index.handler';
    } else if (runtime.includes('java')) {
      return 'com.example.Handler::handleRequest';
    } else if (runtime.includes('dotnet')) {
      return 'Assembly::Namespace.ClassName::MethodName';
    } else {
      // Default to Python
      return 'index.lambda_handler';
    }
  }

  /**
   * Get default Lambda code for a node
   */
  private static getDefaultLambdaCode(lambdaNode: any): string {
    return `
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
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
}