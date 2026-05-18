import { Workflow } from '../types/workflow';

/**
 * IAM Permission Analyzer - analyzes workflow nodes to determine required permissions
 */
export class IAMPermissionAnalyzer {
  /**
   * Analyze workflow and generate IAM policy statements for Step Functions role
   */
  static analyzeWorkflowPermissions(workflow: Workflow): any[] {
    const policyStatements: any[] = [];
    const requiredPermissions = new Set<string>();
    const resourceArns = new Set<string>();

    // CloudWatch Logs delivery actions require Resource: '*' — AWS does not support
    // resource-level restrictions for these specific log delivery APIs.
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

    workflow.nodes.forEach(node => {
      const nodePermissions = this.getNodePermissions(node, workflow.id);
      nodePermissions.actions.forEach(action => requiredPermissions.add(action));
      nodePermissions.resources.forEach(resource => resourceArns.add(resource));
    });

    const servicePermissions = this.groupPermissionsByService(Array.from(requiredPermissions));

    Object.entries(servicePermissions).forEach(([service, actions]) => {
      if (actions.length > 0) {
        const resources = this.getResourcesForService(service, Array.from(resourceArns), workflow);

        // Refuse to fall back to a global wildcard — require explicit ARNs
        if (resources.length === 0) return;

        policyStatements.push({
          Effect: 'Allow',
          Action: actions,
          Resource: resources,
        });
      }
    });

    return policyStatements;
  }

  /**
   * Get required permissions for a specific node type
   */
  private static getNodePermissions(node: any, workflowId: string): { actions: string[], resources: string[] } {
    const nodeType = node.type;
    const config = node.config || {};

    switch (nodeType) {
      case 's3':
        return this.getS3Permissions(config);

      case 'lambda':
        return this.getLambdaPermissions(workflowId);

      case 'database':
        return this.getDatabasePermissions(config);

      case 'opensearch':
        return this.getOpenSearchPermissions(workflowId);

      case 'start':
      case 'end':
        return { actions: [], resources: [] };

      default:
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
      read: ['s3:GetObject', 's3:GetObjectVersion', 's3:ListBucket'],
      write: ['s3:PutObject', 's3:PutObjectAcl'],
      list: ['s3:ListBucket'],
      delete: ['s3:DeleteObject'],
    };

    const actions = operationPermissions[operation] || operationPermissions.write;
    
    // For read/list operations, we need both bucket and object permissions
    const resources = operation === 'list' ? [bucketArn] : 
                      operation === 'read' ? [bucketArn, objectArn] : [objectArn];
    
    return { actions, resources };
  }

  /**
   * Get Lambda-specific permissions
   */
  private static getLambdaPermissions(workflowId: string): { actions: string[], resources: string[] } {
    // workflowId is already in the form "workflow-<id>", so use it directly as the prefix
    const functionArn = `arn:aws:lambda:*:*:function:${workflowId}-*`;
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
   * Get OpenSearch-specific permissions
   */
  private static getOpenSearchPermissions(workflowId: string): { actions: string[], resources: string[] } {
    // workflowId is already in the form "workflow-<id>", so use it directly
    return {
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:*:*:function:${workflowId}-opensearch`],
    };
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