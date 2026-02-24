/**
 * Validates that an IAM role ARN is appropriate for the given service type
 */
export async function validateIAMRoleArn(
  roleArn: string, 
  serviceType: 'lambda' | 'stepfunctions'
): Promise<{ valid: boolean; error?: string }> {
  if (!roleArn) {
    return { valid: false, error: 'Role ARN is required' };
  }

  // Extract role name from ARN (arn:aws:iam::account:role/RoleName)
  const roleNameMatch = roleArn.match(/role\/([^/]+)$/);
  if (!roleNameMatch) {
    return { valid: false, error: 'Invalid role ARN format' };
  }

  const roleName = roleNameMatch[1];

  try {
    const { IAMClient, GetRoleCommand } = await import('@aws-sdk/client-iam');
    const iamClient = new IAMClient({});
    
    const response = await iamClient.send(new GetRoleCommand({ RoleName: roleName }));
    
    if (!response.Role) {
      return { valid: false, error: 'Role not found' };
    }
    
    // Reject AWS service roles (path-based check)
    const rolePath = response.Role.Path || '';
    if (rolePath.includes('/aws-service-role/')) {
      return { valid: false, error: 'Cannot use AWS service roles' };
    }
    
    // Reject CDK-generated roles by suffix pattern
    const cdkSuffixPattern = /-[A-Za-z0-9]{12,}$/;
    if (cdkSuffixPattern.test(roleName)) {
      return { valid: false, error: 'Cannot use CDK-generated infrastructure roles' };
    }
    
    // Validate trust policy
    if (!response.Role.AssumeRolePolicyDocument) {
      return { valid: false, error: 'Role has no trust policy' };
    }
    
    const trustPolicy = JSON.parse(decodeURIComponent(response.Role.AssumeRolePolicyDocument));
    const principals: string[] = [];
    
    for (const statement of trustPolicy.Statement || []) {
      if (statement.Principal?.Service) {
        if (Array.isArray(statement.Principal.Service)) {
          principals.push(...statement.Principal.Service);
        } else {
          principals.push(statement.Principal.Service);
        }
      }
    }
    
    // Validate service-specific trust policy
    if (serviceType === 'lambda') {
      if (!principals.includes('lambda.amazonaws.com')) {
        return { valid: false, error: 'Role must trust lambda.amazonaws.com' };
      }
    } else if (serviceType === 'stepfunctions') {
      if (!principals.includes('states.amazonaws.com')) {
        return { valid: false, error: 'Role must trust states.amazonaws.com' };
      }
    }
    
    return { valid: true };
  } catch (error) {
    console.error('Error validating IAM role:', error);
    if ((error as any).name === 'NoSuchEntityException') {
      return { valid: false, error: 'Role does not exist' };
    }
    return { valid: false, error: 'Failed to validate IAM role' };
  }
}
