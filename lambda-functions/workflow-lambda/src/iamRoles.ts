import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { IAMClient, ListRolesCommand, Role } from '@aws-sdk/client-iam';
import { ResourceGroupsTaggingAPIClient, GetResourcesCommand } from '@aws-sdk/client-resource-groups-tagging-api';

const iamClient = new IAMClient({});
const taggingClient = new ResourceGroupsTaggingAPIClient({});

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const serviceType = event.queryStringParameters?.serviceType || 'lambda';
    
    console.log('Fetching IAM roles for service type:', serviceType);
    
    // Batch query roles to exclude (app-managed and CDK-created)
    const [workflowRoles, cfRoles] = await Promise.all([
      // Roles with WorkflowId or Project=WorkflowBuilder tags
      taggingClient.send(new GetResourcesCommand({
        ResourceTypeFilters: ['iam:role'],
        TagFilters: [{ Key: 'WorkflowId' }]
      })),
      // Roles created by CloudFormation
      taggingClient.send(new GetResourcesCommand({
        ResourceTypeFilters: ['iam:role'],
        TagFilters: [{ Key: 'aws:cloudformation:stack-name' }]
      }))
    ]);
    
    const excludeRoleArns = new Set([
      ...(workflowRoles.ResourceTagMappingList?.map(r => r.ResourceARN) || []),
      ...(cfRoles.ResourceTagMappingList?.map(r => r.ResourceARN) || [])
    ]);
    
    console.log(`Found ${excludeRoleArns.size} app-managed/CDK roles to exclude`);
    console.log('Sample excluded ARNs:', Array.from(excludeRoleArns).slice(0, 3));
    
    // Fetch all IAM roles
    const command = new ListRolesCommand({});
    const response = await iamClient.send(command);
    
    console.log(`Found ${response.Roles?.length || 0} total roles`);
    
    // Filter roles based on service type
    const filteredRoles: Role[] = [];
    
    for (const role of response.Roles || []) {
      try {
        if (!role.AssumeRolePolicyDocument || !role.RoleName || !role.Arn) continue;
        
        // Skip tagged app roles
        if (excludeRoleArns.has(role.Arn)) {
          console.log(`Excluding tagged role: ${role.RoleName}`);
          continue;
        }
        
        // Skip AWS service roles (path-based)
        const rolePath = role.Path || '';
        if (rolePath.includes('/aws-service-role/')) {
          continue;
        }
        
        // Skip CDK generated roles
        const cdkSuffixPattern = /-[A-Za-z0-9]{12,}$/;
        if (cdkSuffixPattern.test(role.RoleName)) {
          continue;
        }
        
        const trustPolicy = JSON.parse(decodeURIComponent(role.AssumeRolePolicyDocument));
        
        if (!trustPolicy.Statement || !Array.isArray(trustPolicy.Statement)) continue;
        
        // Extract all service principals from the trust policy
        const principals: string[] = [];
        for (const statement of trustPolicy.Statement) {
          if (statement.Principal?.Service) {
            if (Array.isArray(statement.Principal.Service)) {
              principals.push(...statement.Principal.Service);
            } else {
              principals.push(statement.Principal.Service);
            }
          }
        }
        
        // Match based on service type
        let matches = false;
        switch (serviceType) {
          case 'lambda':
            matches = principals.includes('lambda.amazonaws.com') && 
                     !principals.includes('states.amazonaws.com');
            break;
          case 's3':
            matches = (principals.includes('states.amazonaws.com') ||  principals.includes('dynamodb.amazonaws.com'))  && 
                     !principals.includes('events.amazonaws.com') &&
                     !principals.includes('lambda.amazonaws.com');
            break;
          case 'database':
            matches = (principals.includes('states.amazonaws.com') ||  principals.includes('s3.amazonaws.com'))  && 
                     !principals.includes('events.amazonaws.com') &&
                     !principals.includes('lambda.amazonaws.com');
            break;
          default:
            matches = true;
        }
        
        if (matches) {
          filteredRoles.push(role);
        }
      } catch (error) {
        console.error(`Error processing role ${role.RoleName}:`, error);
        continue;
      }
    }
    
    console.log(`Filtered to ${filteredRoles.length} roles for ${serviceType}`);
    
    // Map to simplified format
    const roles = filteredRoles.map((role: Role) => ({
      arn: role.Arn,
      name: role.RoleName,
      description: role.Description || '',
    }));
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
      },
      body: JSON.stringify({ roles }),
    };
  } catch (error) {
    console.error('Error fetching IAM roles:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
      },
      body: JSON.stringify({ 
        error: 'Failed to fetch IAM roles',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
};
