import { execSync } from 'child_process';
import path from 'path';
import chalk from 'chalk';

interface BackendOutputs {
  apiGatewayUrl?: string;
  cognitoUserPoolId?: string;
  cognitoClientId?: string;
  cognitoIdentityPoolId?: string;
  cognitoDomain?: string;
  websocketUrl?: string;
  region?: string;
}

interface CloudFormationOutput {
  OutputKey: string;
  OutputValue: string;
  Description?: string;
}

interface CloudFormationStack {
  StackName: string;
  StackStatus: string;
  Outputs?: CloudFormationOutput[];
}

export async function getLatestDeploymentOutputs(environment: string): Promise<BackendOutputs> {
  try {
    console.log(chalk.blue(`Fetching backend deployment outputs for ${environment}...`));
    
    // Validate AWS CLI and credentials first
    if (!checkAWSCLI()) {
      throw new Error('AWS CLI is not installed or not available in PATH');
    }
    
    const awsConfig = getAWSConfig();
    if (!awsConfig.hasCredentials) {
      throw new Error('AWS credentials are not configured. Run "aws configure" to set up credentials.');
    }
    
    // Get CloudFormation stack outputs
    const stackOutputs = await getCloudFormationOutputs(environment);
    
    // Parse outputs into backend configuration
    const backendOutputs = parseStackOutputs(stackOutputs);
    
    // Validate that we got the essential outputs
    validateBackendOutputs(backendOutputs, environment);
    
    console.log(chalk.green(`✓ Retrieved backend configuration for ${environment}`));
    
    return backendOutputs;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to get backend deployment outputs: ${errorMessage}`);
  }
}

async function getCloudFormationOutputs(environment: string): Promise<CloudFormationOutput[]> {
  try {
    // Determine stack name based on environment
    const stackName = getStackName(environment);
    
    console.log(chalk.yellow(`Checking CloudFormation stack: ${stackName}`));
    
    // Execute AWS CLI command to describe stack
    const command = `aws cloudformation describe-stacks --stack-name ${stackName} --query "Stacks[0]" --output json`;
    
    const result = execSync(command, { 
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    
    const stack: CloudFormationStack = JSON.parse(result);
    
    // Validate stack status
    if (!isStackDeployed(stack.StackStatus)) {
      throw new Error(`Stack ${stackName} is not in a deployed state. Status: ${stack.StackStatus}`);
    }
    
    return stack.Outputs || [];
    
  } catch (error) {
    if (error instanceof Error && error.message.includes('does not exist')) {
      throw new Error(`Backend stack not found for ${environment} environment. Please deploy the backend first.`);
    }
    throw error;
  }
}

function getStackName(environment: string): string {
  // Map environment to stack name
  // Based on your deployment, all environments use the same stack name
  switch (environment) {
    case 'development':
    case 'dev':
    case 'staging':
    case 'production':
    case 'prod':
    default:
      return 'WorkflowBuilderStack';
  }
}

function isStackDeployed(status: string): boolean {
  const deployedStatuses = [
    'CREATE_COMPLETE',
    'UPDATE_COMPLETE',
    'UPDATE_ROLLBACK_COMPLETE'
  ];
  
  return deployedStatuses.includes(status);
}

function parseStackOutputs(outputs: CloudFormationOutput[]): BackendOutputs {
  const backendOutputs: BackendOutputs = {};
  
  console.log(chalk.yellow(`Found ${outputs.length} CloudFormation outputs:`));
  
  for (const output of outputs) {
    console.log(chalk.gray(`  ${output.OutputKey}: ${output.OutputValue}`));
    
    switch (output.OutputKey) {
      // API Gateway URL variations
      case 'ApiGatewayUrl':
      case 'APIGatewayURL':
      case 'RestApiUrl':
      case 'ApiUrl':
      case 'APIUrl':
        backendOutputs.apiGatewayUrl = output.OutputValue;
        break;
        
      // Cognito User Pool variations
      case 'CognitoUserPoolId':
      case 'UserPoolId':
      case 'CognitoUserPool':
        backendOutputs.cognitoUserPoolId = output.OutputValue;
        break;
        
      // Cognito Client variations
      case 'CognitoUserPoolClientId':
      case 'UserPoolClientId':
      case 'CognitoClientId':
      case 'UserPoolClient':
        backendOutputs.cognitoClientId = output.OutputValue;
        break;
        
      // Cognito Identity Pool variations
      case 'CognitoIdentityPoolId':
      case 'IdentityPoolId':
      case 'CognitoIdentityPool':
        backendOutputs.cognitoIdentityPoolId = output.OutputValue;
        break;
        
      // Cognito Domain variations
      case 'CognitoDomain':
      case 'UserPoolDomain':
      case 'CognitoUserPoolDomain':
        backendOutputs.cognitoDomain = output.OutputValue;
        break;
        
      // WebSocket URL variations
      case 'WebSocketUrl':
      case 'WebSocketApiUrl':
      case 'WebSocketAPI':
      case 'WSApiUrl':
        backendOutputs.websocketUrl = output.OutputValue;
        break;
        
      // Region variations
      case 'Region':
      case 'AWSRegion':
      case 'DeploymentRegion':
        backendOutputs.region = output.OutputValue;
        break;
    }
  }
  
  // Set default region if not found in outputs
  if (!backendOutputs.region) {
    const awsConfig = getAWSConfig();
    backendOutputs.region = awsConfig.region || process.env.AWS_REGION;
  }
  
  return backendOutputs;
}

// Utility function to validate backend deployment
export async function validateBackendDeployment(environment: string): Promise<boolean> {
  try {
    const outputs = await getLatestDeploymentOutputs(environment);
    
    // Check for required outputs
    const requiredFields = ['apiGatewayUrl', 'cognitoUserPoolId', 'cognitoClientId'];
    const missingFields = requiredFields.filter(field => !outputs[field as keyof BackendOutputs]);
    
    if (missingFields.length > 0) {
      console.log(chalk.yellow(`Warning: Missing backend outputs: ${missingFields.join(', ')}`));
      return false;
    }
    
    return true;
    
  } catch (error) {
    console.log(chalk.red(`Backend validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
    return false;
  }
}

// Utility function to check if AWS CLI is available
export function checkAWSCLI(): boolean {
  try {
    execSync('aws --version', { stdio: 'pipe' });
    return true;
  } catch (error) {
    return false;
  }
}

// Utility function to get AWS CLI configuration
export function getAWSConfig(): {
  region?: string;
  profile?: string;
  hasCredentials: boolean;
} {
  try {
    const region = execSync('aws configure get region', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    const profile = process.env.AWS_PROFILE || 'default';
    
    // Check if credentials are configured
    let hasCredentials = false;
    try {
      execSync('aws sts get-caller-identity', { stdio: 'pipe' });
      hasCredentials = true;
    } catch (error) {
      hasCredentials = false;
    }
    
    return {
      region: region || undefined,
      profile,
      hasCredentials
    };
    
  } catch (error) {
    return {
      hasCredentials: false
    };
  }
}

// Utility function to validate backend outputs
function validateBackendOutputs(outputs: BackendOutputs, environment: string): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check for required outputs
  if (!outputs.apiGatewayUrl) {
    errors.push('API Gateway URL not found in CloudFormation outputs');
  } else if (!outputs.apiGatewayUrl.startsWith('https://')) {
    warnings.push('API Gateway URL does not use HTTPS');
  }
  
  if (!outputs.cognitoUserPoolId) {
    errors.push('Cognito User Pool ID not found in CloudFormation outputs');
  }
  
  if (!outputs.cognitoClientId) {
    errors.push('Cognito User Pool Client ID not found in CloudFormation outputs');
  }
  
  // Display warnings
  if (warnings.length > 0) {
    console.log(chalk.yellow('⚠️  Backend Output Warnings:'));
    for (const warning of warnings) {
      console.log(chalk.yellow(`  • ${warning}`));
    }
  }
  
  // Throw error if critical outputs are missing
  if (errors.length > 0) {
    console.log(chalk.red('❌ Backend Output Errors:'));
    for (const error of errors) {
      console.log(chalk.red(`  • ${error}`));
    }
    throw new Error(`Backend deployment for ${environment} is missing required outputs: ${errors.join(', ')}`);
  }
}

// Utility function to get CloudFormation stack details
export async function getStackDetails(environment: string): Promise<{
  stackName: string;
  stackStatus: string;
  creationTime?: string;
  lastUpdatedTime?: string;
  outputs: CloudFormationOutput[];
}> {
  try {
    const stackName = getStackName(environment);
    const command = `aws cloudformation describe-stacks --stack-name ${stackName} --query "Stacks[0]" --output json`;
    
    const result = execSync(command, { 
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    
    const stack: CloudFormationStack & { 
      CreationTime?: string; 
      LastUpdatedTime?: string; 
    } = JSON.parse(result);
    
    return {
      stackName: stack.StackName,
      stackStatus: stack.StackStatus,
      creationTime: stack.CreationTime,
      lastUpdatedTime: stack.LastUpdatedTime,
      outputs: stack.Outputs || []
    };
    
  } catch (error) {
    throw new Error(`Failed to get stack details: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Utility function to list available stacks
export async function listAvailableStacks(): Promise<string[]> {
  try {
    const command = 'aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query "StackSummaries[].StackName" --output json';
    
    const result = execSync(command, { 
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    
    const stacks: string[] = JSON.parse(result);
    return stacks.filter(stack => stack.includes('WorkflowBuilder'));
    
  } catch (error) {
    return [];
  }
}

// Utility function to get stack resources
export async function getStackResources(environment: string): Promise<Array<{
  logicalResourceId: string;
  physicalResourceId: string;
  resourceType: string;
  resourceStatus: string;
}>> {
  try {
    const stackName = getStackName(environment);
    const command = `aws cloudformation list-stack-resources --stack-name ${stackName} --query "StackResourceSummaries[].{LogicalResourceId:LogicalResourceId,PhysicalResourceId:PhysicalResourceId,ResourceType:ResourceType,ResourceStatus:ResourceStatus}" --output json`;
    
    const result = execSync(command, { 
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    
    return JSON.parse(result);
    
  } catch (error) {
    console.log(chalk.yellow(`Warning: Could not retrieve stack resources: ${error instanceof Error ? error.message : 'Unknown error'}`));
    return [];
  }
}