import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { IAMClient, ListRolesCommand, Role } from '@aws-sdk/client-iam';

const iamClient = new IAMClient({});

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const serviceType = event.queryStringParameters?.serviceType || 'lambda';
    
    console.log('Fetching IAM roles for service type:', serviceType);
    
    // Fetch all IAM roles
    const command = new ListRolesCommand({});
    const response = await iamClient.send(command);
    
    console.log(`Found ${response.Roles?.length || 0} total roles`);
    
    // Filter roles based on service type
    const filteredRoles = (response.Roles || []).filter((role: Role) => {
      try {
        if (!role.AssumeRolePolicyDocument) return false;
        
        // Skip AWS service roles and internal roles
        // const roleName = role.RoleName || '';
        
        // if (roleName.startsWith('AWS') || 
        //     roleName.includes('BuilderStack') ||
        //     roleName.includes('AWSServiceRole') ||
        //     roleName.includes('OrganizationAccountAccessRole') ||
        //     roleName.includes('StackSet') ||
        //     roleName.includes('CloudFormation') ||
        //     role.Path?.includes('/aws-service-role/') ||
        //     role.Path?.includes('/service-role/')) {
        //   return false;
        // }
        
        const trustPolicy = JSON.parse(decodeURIComponent(role.AssumeRolePolicyDocument));
        
        if (!trustPolicy.Statement || !Array.isArray(trustPolicy.Statement)) return false;
        
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
        switch (serviceType) {
          case 'lambda':
            return principals.includes('lambda.amazonaws.com');
          case 's3':
          case 'database':
            return principals.includes('states.amazonaws.com');
          default:
            return true;
        }
      } catch (error) {
        console.error(`Error parsing trust policy for role ${role.RoleName}:`, error);
        return false;
      }
    });
    
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
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ roles }),
    };
  } catch (error) {
    console.error('Error fetching IAM roles:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ 
        error: 'Failed to fetch IAM roles',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
};
