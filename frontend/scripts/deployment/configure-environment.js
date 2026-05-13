import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { getLatestDeploymentOutputs } from './backend-integration.js';
export async function configureEnvironment(environment) {
    try {
        console.log(chalk.blue(`Configuring environment for: ${environment}`));
        // Get backend deployment outputs
        const backendOutputs = await getLatestDeploymentOutputs(environment);
        // Generate environment configuration
        const config = await generateEnvironmentConfig(environment, backendOutputs);
        // Update environment file
        await updateEnvironmentFile(environment, config);
        console.log(chalk.green(`✓ Environment configuration updated for ${environment}`));
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to configure environment: ${errorMessage}`);
    }
}
async function generateEnvironmentConfig(environment, backendOutputs) {
    // Default configuration
    const defaultConfig = {
        environment,
        apiGatewayUrl: '',
        cognitoUserPoolId: '',
        cognitoClientId: '',
        cognitoIdentityPoolId: '',
        cognitoDomain: '',
        websocketUrl: '',
        region: process.env.AWS_REGION,
        customVariables: {}
    };
    // Merge with backend outputs
    const config = {
        ...defaultConfig,
        apiGatewayUrl: backendOutputs.apiGatewayUrl || defaultConfig.apiGatewayUrl,
        cognitoUserPoolId: backendOutputs.cognitoUserPoolId || defaultConfig.cognitoUserPoolId,
        cognitoClientId: backendOutputs.cognitoClientId || defaultConfig.cognitoClientId,
        cognitoIdentityPoolId: backendOutputs.cognitoIdentityPoolId || defaultConfig.cognitoIdentityPoolId,
        cognitoDomain: backendOutputs.cognitoDomain || defaultConfig.cognitoDomain,
        websocketUrl: backendOutputs.websocketUrl || defaultConfig.websocketUrl,
        region: backendOutputs.region || defaultConfig.region
    };
    // Add environment-specific custom variables
    switch (environment) {
        case 'development':
            config.customVariables = {
                ENABLE_DEBUG: 'true',
                ENABLE_MOCK_DATA: 'false',
                LOG_LEVEL: 'debug'
            };
            break;
        case 'staging':
            config.customVariables = {
                ENABLE_DEBUG: 'true',
                ENABLE_MOCK_DATA: 'false',
                LOG_LEVEL: 'info'
            };
            break;
        case 'production':
            config.customVariables = {
                ENABLE_DEBUG: 'false',
                ENABLE_MOCK_DATA: 'false',
                LOG_LEVEL: 'error'
            };
            break;
    }
    return config;
}
async function updateEnvironmentFile(environment, config) {
    const frontendDir = process.cwd();
    const envFileName = environment === 'development' ? '.env' : `.env.${environment}`;
    const envFilePath = path.join(frontendDir, envFileName);
    // Generate environment file content
    const envContent = generateEnvFileContent(config);
    // Backup existing file if it exists
    if (existsSync(envFilePath)) {
        const backupPath = `${envFilePath}.backup.${Date.now()}`;
        try {
            const existingContent = readFileSync(envFilePath, 'utf-8');
            writeFileSync(backupPath, existingContent);
            console.log(chalk.yellow(`Backed up existing ${envFileName} to ${path.basename(backupPath)}`));
        }
        catch (error) {
            console.log(chalk.yellow(`Warning: Could not backup existing ${envFileName}`));
        }
    }
    // Write new environment file
    writeFileSync(envFilePath, envContent);
    console.log(chalk.green(`✓ Updated ${envFileName}`));
}
function generateEnvFileContent(config) {
    const lines = [];
    // Header comment
    lines.push(`# Environment configuration for ${config.environment}`);
    lines.push(`# Generated on ${new Date().toISOString()}`);
    lines.push('');
    // AWS Configuration
    lines.push('# AWS Configuration');
    lines.push(`VITE_AWS_REGION=${config.region}`);
    lines.push(`VITE_API_BASE_URL=${config.apiGatewayUrl}`);
    lines.push(`VITE_API_GATEWAY_URL=${config.apiGatewayUrl}`);
    lines.push('');
    // Cognito Configuration
    lines.push('# Cognito Configuration');
    lines.push(`VITE_COGNITO_USER_POOL_ID=${config.cognitoUserPoolId}`);
    lines.push(`VITE_COGNITO_USER_POOL_CLIENT_ID=${config.cognitoClientId}`);
    lines.push(`VITE_COGNITO_IDENTITY_POOL_ID=${config.cognitoIdentityPoolId}`);
    lines.push(`VITE_COGNITO_DOMAIN=${config.cognitoDomain}`);
    lines.push('');
    // Environment Configuration
    lines.push('# Environment Configuration');
    lines.push(`VITE_NODE_ENV=${config.environment}`);
    lines.push('');
    // WebSocket Configuration
    if (config.websocketUrl) {
        lines.push('# WebSocket Configuration');
        lines.push(`VITE_WEBSOCKET_URL=${config.websocketUrl}`);
        lines.push('');
    }
    // Custom Variables
    if (Object.keys(config.customVariables).length > 0) {
        lines.push('# Feature Flags and Custom Configuration');
        for (const [key, value] of Object.entries(config.customVariables)) {
            lines.push(`VITE_${key}=${value}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}
// Utility function to validate environment configuration
export function validateEnvironmentConfig(config) {
    const errors = [];
    const warnings = [];
    // Required fields validation
    if (!config.apiGatewayUrl) {
        errors.push('API Gateway URL is required');
    }
    else if (!config.apiGatewayUrl.startsWith('https://')) {
        warnings.push('API Gateway URL should use HTTPS');
    }
    if (!config.cognitoUserPoolId) {
        errors.push('Cognito User Pool ID is required');
    }
    if (!config.cognitoClientId) {
        errors.push('Cognito Client ID is required');
    }
    if (!config.region) {
        errors.push('AWS Region is required');
    }
    // Environment-specific validation
    if (config.environment === 'production') {
        if (config.customVariables.ENABLE_DEBUG === 'true') {
            warnings.push('Debug mode is enabled in production environment');
        }
        if (config.customVariables.ENABLE_MOCK_DATA === 'true') {
            warnings.push('Mock data is enabled in production environment');
        }
    }
    return {
        isValid: errors.length === 0,
        errors,
        warnings
    };
}
// Utility function to read existing environment configuration
export function readEnvironmentConfig(environment) {
    try {
        const frontendDir = process.cwd();
        const envFileName = environment === 'development' ? '.env' : `.env.${environment}`;
        const envFilePath = path.join(frontendDir, envFileName);
        if (!existsSync(envFilePath)) {
            return null;
        }
        const content = readFileSync(envFilePath, 'utf-8');
        const config = { environment };
        // Parse environment variables
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const [key, ...valueParts] = trimmed.split('=');
                const value = valueParts.join('=');
                switch (key) {
                    case 'VITE_AWS_REGION':
                        config.region = value;
                        break;
                    case 'VITE_API_GATEWAY_URL':
                        config.apiGatewayUrl = value;
                        break;
                    case 'VITE_COGNITO_USER_POOL_ID':
                        config.cognitoUserPoolId = value;
                        break;
                    case 'VITE_COGNITO_USER_POOL_CLIENT_ID':
                        config.cognitoClientId = value;
                        break;
                    case 'VITE_COGNITO_IDENTITY_POOL_ID':
                        config.cognitoIdentityPoolId = value;
                        break;
                    case 'VITE_COGNITO_DOMAIN':
                        config.cognitoDomain = value;
                        break;
                    case 'VITE_WEBSOCKET_URL':
                        config.websocketUrl = value;
                        break;
                }
            }
        }
        return config;
    }
    catch (error) {
        return null;
    }
}
