import chalk from 'chalk';
import { validateBackendDeployment, checkAWSCLI, getAWSConfig, listAvailableStacks } from './backend-integration.js';

function isStackDeployed(status: string): boolean {
  const deployedStatuses = [
    'CREATE_COMPLETE',
    'UPDATE_COMPLETE',
    'UPDATE_ROLLBACK_COMPLETE'
  ];
  
  return deployedStatuses.includes(status);
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

export async function validateBackendDeployment(environment: string): Promise<boolean> {
  console.log(chalk.blue(`Validating backend deployment for ${environment} environment...`));
  
  const validation = await performComprehensiveValidation(environment);
  
  // Display validation results
  displayValidationResults(validation);
  
  if (!validation.isValid) {
    throw new Error('Backend deployment validation failed. Please address the errors above.');
  }
  
  return true;
}

async function performComprehensiveValidation(environment: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];
  
  // Step 1: Check AWS CLI availability
  if (!checkAWSCLI()) {
    errors.push('AWS CLI is not installed or not available in PATH');
    suggestions.push('Install AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html');
    
    return {
      isValid: false,
      errors,
      warnings,
      suggestions
    };
  }
  
  // Step 2: Check AWS credentials and configuration
  const awsConfig = getAWSConfig();
  
  if (!awsConfig.hasCredentials) {
    errors.push('AWS credentials are not configured');
    suggestions.push('Configure AWS credentials using: aws configure');
    suggestions.push('Or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables');
  }
  
  if (!awsConfig.region) {
    warnings.push('AWS region is not configured');
    suggestions.push('Set AWS region using: aws configure set region <your-region>');
  }
  
  // Step 3: Check backend deployment
  try {
    const { getStackDetails, getStackResources } = await import('./backend-integration.js');
    
    // Get detailed stack information
    const stackDetails = await getStackDetails(environment);
    
    console.log(chalk.blue(`Stack: ${stackDetails.stackName}`));
    console.log(chalk.blue(`Status: ${stackDetails.stackStatus}`));
    console.log(chalk.blue(`Outputs: ${stackDetails.outputs.length} found`));
    
    // Validate stack status
    if (!isStackDeployed(stackDetails.stackStatus)) {
      errors.push(`Backend stack is not in a deployed state. Current status: ${stackDetails.stackStatus}`);
    }
    
    // Check for required outputs
    const hasApiGateway = stackDetails.outputs.some(output => 
      ['ApiGatewayUrl', 'APIGatewayURL', 'RestApiUrl', 'ApiUrl'].includes(output.OutputKey)
    );
    
    const hasCognito = stackDetails.outputs.some(output => 
      ['CognitoUserPoolId', 'UserPoolId'].includes(output.OutputKey)
    );
    
    if (!hasApiGateway) {
      errors.push('API Gateway URL not found in stack outputs');
    }
    
    if (!hasCognito) {
      errors.push('Cognito configuration not found in stack outputs');
    }
    
    // Get stack resources for additional validation
    try {
      const resources = await getStackResources(environment);
      const apiGatewayResources = resources.filter(r => r.resourceType.includes('ApiGateway'));
      const cognitoResources = resources.filter(r => r.resourceType.includes('Cognito'));
      
      if (apiGatewayResources.length === 0) {
        warnings.push('No API Gateway resources found in the stack');
      }
      
      if (cognitoResources.length === 0) {
        warnings.push('No Cognito resources found in the stack');
      }
      
    } catch (error) {
      warnings.push('Could not validate stack resources');
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    errors.push(`Backend validation failed: ${errorMessage}`);
    
    if (errorMessage.includes('does not exist')) {
      suggestions.push(`Deploy the backend for ${environment} environment first:`);
      suggestions.push(`cd infrastructure && npm run deploy:${environment}`);
      
      // Try to list available stacks for suggestions
      try {
        const availableStacks = await listAvailableStacks();
        if (availableStacks.length > 0) {
          suggestions.push(`Available WorkflowBuilder stacks: ${availableStacks.join(', ')}`);
        }
      } catch (error) {
        // Ignore error when listing stacks
      }
    } else if (errorMessage.includes('credentials')) {
      suggestions.push('Check your AWS credentials and permissions');
    }
  }
  
  // Step 4: Environment-specific validation
  await validateEnvironmentSpecificRequirements(environment, errors, warnings, suggestions);
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    suggestions
  };
}

async function validateEnvironmentSpecificRequirements(
  environment: string,
  errors: string[],
  warnings: string[],
  suggestions: string[]
): Promise<void> {
  switch (environment) {
    case 'production':
      // Production-specific validations
      warnings.push('Deploying to production environment');
      suggestions.push('Ensure all changes have been tested in staging environment');
      suggestions.push('Consider creating a backup before deployment');
      break;
      
    case 'staging':
      // Staging-specific validations
      suggestions.push('Staging deployment - suitable for testing before production');
      break;
      
    case 'development':
      // Development-specific validations
      suggestions.push('Development deployment - suitable for local testing');
      break;
      
    default:
      warnings.push(`Unknown environment: ${environment}. Using default configuration.`);
      suggestions.push('Supported environments: development, staging, production');
      break;
  }
}

function displayValidationResults(validation: ValidationResult): void {
  console.log('');
  
  // Display errors
  if (validation.errors.length > 0) {
    console.log(chalk.red.bold('Validation Errors:'));
    for (const error of validation.errors) {
      console.log(chalk.red(`  • ${error}`));
    }
    console.log('');
  }
  
  // Display warnings
  if (validation.warnings.length > 0) {
    console.log(chalk.yellow.bold(' Warnings:'));
    for (const warning of validation.warnings) {
      console.log(chalk.yellow(`  • ${warning}`));
    }
    console.log('');
  }
  
  // Display suggestions
  if (validation.suggestions.length > 0) {
    console.log(chalk.blue.bold('Suggestions:'));
    for (const suggestion of validation.suggestions) {
      console.log(chalk.blue(`  • ${suggestion}`));
    }
    console.log('');
  }
  
  // Display final result
  if (validation.isValid) {
    console.log(chalk.green.bold('Backend validation passed!'));
  } else {
    console.log(chalk.red.bold('Backend validation failed!'));
  }
  
  console.log('');
}

// Utility function for quick validation check
export async function quickValidationCheck(environment: string): Promise<{
  hasAWSCLI: boolean;
  hasCredentials: boolean;
  hasBackendDeployment: boolean;
}> {
  return {
    hasAWSCLI: checkAWSCLI(),
    hasCredentials: getAWSConfig().hasCredentials,
    hasBackendDeployment: await validateBackendDeployment(environment).catch(() => false)
  };
}