import { execSync } from 'child_process';
import chalk from 'chalk';
export async function getLatestDeploymentOutputs(environment) {
    try {
        console.log(chalk.blue(`Fetching backend deployment outputs for ${environment}...`));
        // Get CloudFormation stack outputs
        const stackOutputs = await getCloudFormationOutputs(environment);
        // Parse outputs into backend configuration
        const backendOutputs = parseStackOutputs(stackOutputs);
        console.log(chalk.green(`✓ Retrieved backend configuration for ${environment}`));
        return backendOutputs;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to get backend deployment outputs: ${errorMessage}`);
    }
}
async function getCloudFormationOutputs(environment) {
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
        const stack = JSON.parse(result);
        // Validate stack status
        if (!isStackDeployed(stack.StackStatus)) {
            throw new Error(`Stack ${stackName} is not in a deployed state. Status: ${stack.StackStatus}`);
        }
        return stack.Outputs || [];
    }
    catch (error) {
        if (error instanceof Error && error.message.includes('does not exist')) {
            throw new Error(`Backend stack not found for ${environment} environment. Please deploy the backend first.`);
        }
        throw error;
    }
}
function getStackName(environment) {
    // Map environment to stack name
    switch (environment) {
        case 'development':
        case 'dev':
            return 'WorkflowBuilderStack';
        case 'staging':
            return 'WorkflowBuilderStack-Staging';
        case 'production':
        case 'prod':
            return 'WorkflowBuilderStack-Production';
        default:
            return 'WorkflowBuilderStack';
    }
}
function isStackDeployed(status) {
    const deployedStatuses = [
        'CREATE_COMPLETE',
        'UPDATE_COMPLETE',
        'UPDATE_ROLLBACK_COMPLETE'
    ];
    return deployedStatuses.includes(status);
}
function parseStackOutputs(outputs) {
    const backendOutputs = {};
    for (const output of outputs) {
        switch (output.OutputKey) {
            case 'ApiGatewayUrl':
            case 'APIGatewayURL':
            case 'RestApiUrl':
                backendOutputs.apiGatewayUrl = output.OutputValue;
                break;
            case 'CognitoUserPoolId':
            case 'UserPoolId':
                backendOutputs.cognitoUserPoolId = output.OutputValue;
                break;
            case 'CognitoUserPoolClientId':
            case 'UserPoolClientId':
                backendOutputs.cognitoClientId = output.OutputValue;
                break;
            case 'CognitoIdentityPoolId':
            case 'IdentityPoolId':
                backendOutputs.cognitoIdentityPoolId = output.OutputValue;
                break;
            case 'CognitoDomain':
            case 'UserPoolDomain':
                backendOutputs.cognitoDomain = output.OutputValue;
                break;
            case 'WebSocketUrl':
            case 'WebSocketApiUrl':
                backendOutputs.websocketUrl = output.OutputValue;
                break;
            case 'Region':
            case 'AWSRegion':
                backendOutputs.region = output.OutputValue;
                break;
        }
    }
    // Set default region if not found in outputs
    if (!backendOutputs.region) {
        backendOutputs.region = 'us-east-1';
    }
    return backendOutputs;
}
// Utility function to validate backend deployment
export async function validateBackendDeployment(environment) {
    try {
        const outputs = await getLatestDeploymentOutputs(environment);
        // Check for required outputs
        const requiredFields = ['apiGatewayUrl', 'cognitoUserPoolId', 'cognitoClientId'];
        const missingFields = requiredFields.filter(field => !outputs[field]);
        if (missingFields.length > 0) {
            console.log(chalk.yellow(`Warning: Missing backend outputs: ${missingFields.join(', ')}`));
            return false;
        }
        return true;
    }
    catch (error) {
        console.log(chalk.red(`Backend validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
        return false;
    }
}
// Utility function to check if AWS CLI is available
export function checkAWSCLI() {
    try {
        execSync('aws --version', { stdio: 'pipe' });
        return true;
    }
    catch (error) {
        return false;
    }
}
// Utility function to get AWS CLI configuration
export function getAWSConfig() {
    try {
        const region = execSync('aws configure get region', { encoding: 'utf-8', stdio: 'pipe' }).trim();
        const profile = process.env.AWS_PROFILE || 'default';
        // Check if credentials are configured
        let hasCredentials = false;
        try {
            execSync('aws sts get-caller-identity', { stdio: 'pipe' });
            hasCredentials = true;
        }
        catch (error) {
            hasCredentials = false;
        }
        return {
            region: region || undefined,
            profile,
            hasCredentials
        };
    }
    catch (error) {
        return {
            hasCredentials: false
        };
    }
}
// Utility function to list available stacks
export async function listAvailableStacks() {
    try {
        const command = 'aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query "StackSummaries[].StackName" --output json';
        const result = execSync(command, {
            encoding: 'utf-8',
            stdio: 'pipe'
        });
        const stacks = JSON.parse(result);
        return stacks.filter(stack => stack.includes('WorkflowBuilder'));
    }
    catch (error) {
        return [];
    }
}
