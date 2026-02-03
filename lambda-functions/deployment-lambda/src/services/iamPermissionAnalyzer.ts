import { Workflow } from '../types/workflow';

/**
 * IAM Permission Analyzer - analyzes workflow nodes to determine required permissions
 */
export class IAMPermissionAnalyzer {
  /**
   * Analyze workflow and generate IAM policy statements for Step Functions role
   */
  static analyzeWorkflowPermissions(workflow: Workflow): any[] {
    console.log('🔍 IAM ANALYZER: Analyzing workflow permissions...');
    
    const policyStatements: any[] = [];
    const requiredPermissions = new Set<string>();
    const resourceArns = new Set<string>();

    // Base permissions that all Step Functions need
    policyStatements.push({
      Effect: 'Allow',
      Action: [
        'logs:CreateLogDelivery',
        'logs:GetLogDelivery',
        'logs:UpdateLogDelivery',
        'logs:DeleteLogDelivery',
        'logs:ListLogDeliveries',
        'logs:PutResourcePolicy',
        'logs:DescribeResourcePolicies',
        'logs:DescribeLogGroups',
      ],
      Resource: '*',
    });

    // Analyze each node for specific permissions
    workflow.nodes.forEach(node => {
      console.log(`  📦 Analyzing node: ${node.name || node.id} (type: ${node.type})`);
      
      const nodePermissions = this.getNodePermissions(node);
      nodePermissions.actions.forEach(action => requiredPermissions.add(action));
      nodePermissions.resources.forEach(resource => resourceArns.add(resource));
      
      console.log(`    ➡️  Required actions: ${nodePermissions.actions.join(', ')}`);
      console.log(`    🎯 Resource ARNs: ${nodePermissions.resources.join(', ')}`);
    });

    // Group permissions by service for better organization
    const servicePermissions = this.groupPermissionsByService(Array.from(requiredPermissions));
    
    // Create policy statements for each service
    Object.entries(servicePermissions).forEach(([service, actions]) => {
      if (actions.length > 0) {
        const resources = this.getResourcesForService(service, Array.from(resourceArns), workflow);
        
        policyStatements.push({
          Effect: 'Allow',
          Action: actions,
          Resource: resources.length > 0 ? resources : '*',
        });
        
        console.log(`  🔧 ${service.toUpperCase()} permissions:`, actions);
        console.log(`  🎯 ${service.toUpperCase()} resources:`, resources);
      }
    });

    console.log('✅ IAM ANALYZER: Permission analysis completed');
    console.log('📊 IAM ANALYZER: Generated policy statements:', policyStatements.length);
    
    return policyStatements;
  }

  /**
   * Get required permissions for a specific node type
   */
  private static getNodePermissions(node: any): { actions: string[], resources: string[] } {
    const nodeType = node.type;
    const config = node.config || {};

    switch (nodeType) {
      case 's3':
        return this.getS3Permissions(config);
      
      case 'lambda':
        return this.getLambdaPermissions(config);
      
      case 'database':
        return this.getDatabasePermissions(config);
      
      case 'start':
      case 'end':
        return { actions: [], resources: [] };
      
      default:
        console.log(`  ⚠️  Unknown node type: ${nodeType}, no specific permissions required`);
        return { actions: [], resources: [] };
    }
  }

  /**
   * Get S3-specific permissions based on operation
   */
  private static getS3Permissions(config: any): { actions: string[], resources: string[] } {
    const operation = config.operation || 'write';
    const bucketName = config.bucketName || '*';
    const objectKey = config.objectKey || '*';
    
    const bucketArn = `arn:aws:s3:::${bucketName}`;
    const objectArn = `arn:aws:s3:::${bucketName}/${objectKey}`;

    const operationPermissions: Record<string, string[]> = {
      read: ['s3:GetObject', 's3:GetObjectVersion'],
      write: ['s3:PutObject', 's3:PutObjectAcl'],
      list: ['s3:ListBucket'],
      delete: ['s3:DeleteObject'],
    };

    const actions = operationPermissions[operation] || operationPermissions.write;
    
    // For list operations, we need bucket permissions; for others, we need object permissions
    const resources = operation === 'list' ? [bucketArn] : [objectArn];
    
    return { actions, resources };
  }

  /**
   * Get Lambda-specific permissions
   */
  private static getLambdaPermissions(config: any): { actions: string[], resources: string[] } {
    // For Step Functions to invoke Lambda functions created by this workflow
    // We use a wildcard pattern that matches the deployment naming convention
    const functionArn = `arn:aws:lambda:*:*:function:*`;

    return {
      actions: ['lambda:InvokeFunction'],
      resources: [functionArn],
    };
  }

  /**
   * Get Database-specific permissions (DynamoDB)
   */
  private static getDatabasePermissions(config: any): { actions: string[], resources: string[] } {
    const operation = config.operation || 'read';
    const tableName = config.tableName || '*';
    const tableArn = `arn:aws:dynamodb:*:*:table/${tableName}`;

    const operationPermissions: Record<string, string[]> = {
      read: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      write: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
      delete: ['dynamodb:DeleteItem'],
    };

    const actions = operationPermissions[operation] || operationPermissions.read;
    
    return { actions, resources: [tableArn] };
  }

  /**
   * Group permissions by AWS service for better policy organization
   */
  private static groupPermissionsByService(permissions: string[]): Record<string, string[]> {
    const serviceGroups: Record<string, string[]> = {};

    permissions.forEach(permission => {
      const service = permission.split(':')[0];
      if (!serviceGroups[service]) {
        serviceGroups[service] = [];
      }
      serviceGroups[service].push(permission);
    });

    return serviceGroups;
  }

  /**
   * Get appropriate resource ARNs for a specific service
   */
  private static getResourcesForService(service: string, allResources: string[], workflow: Workflow): string[] {
    return allResources.filter(resource => resource.includes(`:${service}:`));
  }

  /**
   * Generate a comprehensive IAM policy document for the Step Functions role
   */
  static generateIAMPolicyDocument(workflow: Workflow): any {
    const policyStatements = this.analyzeWorkflowPermissions(workflow);
    
    return {
      Version: '2012-10-17',
      Statement: policyStatements,
    };
  }
}