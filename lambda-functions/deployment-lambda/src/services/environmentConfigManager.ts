import * as fs from 'fs/promises';
import * as path from 'path';
import { EnvironmentConfig, EnvironmentConfigDynamoDBItem, isEnvironmentConfig } from '../types';

/**
 * Environment Configuration Manager
 * Handles .env file updates and environment-specific configuration management
 */
export class EnvironmentConfigManager {
  private readonly validEnvironments = ['development', 'staging', 'production'];
  private readonly requiredFields = ['apiGatewayUrl', 'cognitoUserPoolId', 'cognitoClientId', 'region'];

  /**
   * Generate environment file content from configuration
   */
  generateEnvContent(config: EnvironmentConfig): string {
    this.validateEnvironmentConfig(config);

    const envLines = [
      `# Environment configuration for ${config.environment}`,
      `# Generated on ${new Date().toISOString()}`,
      '',
      '# Core API Configuration',
      `REACT_APP_API_GATEWAY_URL=${config.apiGatewayUrl}`,
      '',
      '# AWS Cognito Configuration',
      `REACT_APP_COGNITO_USER_POOL_ID=${config.cognitoUserPoolId}`,
      `REACT_APP_COGNITO_CLIENT_ID=${config.cognitoClientId}`,
      '',
      '# AWS Region',
      `REACT_APP_AWS_REGION=${config.region}`,
      '',
      '# Environment',
      `REACT_APP_ENVIRONMENT=${config.environment}`,
      ''
    ];

    // Add custom variables if they exist
    if (config.customVariables && Object.keys(config.customVariables).length > 0) {
      envLines.push('# Custom Variables');
      
      Object.entries(config.customVariables)
        .sort(([a], [b]) => a.localeCompare(b)) // Sort alphabetically
        .forEach(([key, value]) => {
          // Ensure custom variables have REACT_APP_ prefix
          const envKey = key.startsWith('REACT_APP_') ? key : `REACT_APP_${key}`;
          envLines.push(`${envKey}=${value}`);
        });
      
      envLines.push('');
    }

    return envLines.join('\n');
  }

  /**
   * Update environment file with new configuration
   */
  async updateEnvironmentFile(
    environment: string, 
    config: EnvironmentConfig, 
    projectPath?: string
  ): Promise<void> {
    this.validateEnvironment(environment);
    this.validateEnvironmentConfig(config);

    if (config.environment !== environment) {
      throw new Error(`Configuration environment (${config.environment}) does not match target environment (${environment})`);
    }

    const envFileName = `.env.${environment}`;
    const envFilePath = projectPath ? path.join(projectPath, envFileName) : envFileName;
    
    try {
      const envContent = this.generateEnvContent(config);
      await fs.writeFile(envFilePath, envContent, 'utf8');
      
      console.log(`Environment file updated: ${envFilePath}`);
    } catch (error) {
      throw new Error(`Failed to update environment file ${envFilePath}: ${error.message}`);
    }
  }

  /**
   * Read existing environment file
   */
  async readEnvironmentFile(environment: string, projectPath?: string): Promise<Record<string, string>> {
    this.validateEnvironment(environment);

    const envFileName = `.env.${environment}`;
    const envFilePath = projectPath ? path.join(projectPath, envFileName) : envFileName;
    
    try {
      const content = await fs.readFile(envFilePath, 'utf8');
      return this.parseEnvContent(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {}; // File doesn't exist, return empty config
      }
      throw new Error(`Failed to read environment file ${envFilePath}: ${error.message}`);
    }
  }

  /**
   * Parse environment file content into key-value pairs
   */
  parseEnvContent(content: string): Record<string, string> {
    const config: Record<string, string> = {};
    
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }
      
      // Parse key=value pairs
      const equalIndex = trimmedLine.indexOf('=');
      if (equalIndex > 0) {
        const key = trimmedLine.substring(0, equalIndex).trim();
        const value = trimmedLine.substring(equalIndex + 1).trim();
        
        // Remove quotes if present
        const unquotedValue = value.replace(/^["']|["']$/g, '');
        config[key] = unquotedValue;
      }
    }
    
    return config;
  }

  /**
   * Convert environment file content to EnvironmentConfig
   */
  envContentToConfig(envContent: Record<string, string>, environment: string): EnvironmentConfig {
    const config: EnvironmentConfig = {
      environment,
      apiGatewayUrl: envContent.REACT_APP_API_GATEWAY_URL || '',
      cognitoUserPoolId: envContent.REACT_APP_COGNITO_USER_POOL_ID || '',
      cognitoClientId: envContent.REACT_APP_COGNITO_CLIENT_ID || '',
      region: envContent.REACT_APP_AWS_REGION || process.env.AWS_REGION!,
      customVariables: {}
    };

    // Extract custom variables (those with REACT_APP_ prefix but not core fields)
    const coreFields = new Set([
      'REACT_APP_API_GATEWAY_URL',
      'REACT_APP_COGNITO_USER_POOL_ID', 
      'REACT_APP_COGNITO_CLIENT_ID',
      'REACT_APP_AWS_REGION',
      'REACT_APP_ENVIRONMENT'
    ]);

    Object.entries(envContent).forEach(([key, value]) => {
      if (key.startsWith('REACT_APP_') && !coreFields.has(key)) {
        // Remove REACT_APP_ prefix for custom variables
        const customKey = key.replace(/^REACT_APP_/, '');
        config.customVariables[customKey] = value;
      }
    });

    return config;
  }

  /**
   * Merge configurations with priority to the new config
   */
  mergeConfigurations(existingConfig: EnvironmentConfig, newConfig: Partial<EnvironmentConfig>): EnvironmentConfig {
    return {
      environment: newConfig.environment || existingConfig.environment,
      apiGatewayUrl: newConfig.apiGatewayUrl || existingConfig.apiGatewayUrl,
      cognitoUserPoolId: newConfig.cognitoUserPoolId || existingConfig.cognitoUserPoolId,
      cognitoClientId: newConfig.cognitoClientId || existingConfig.cognitoClientId,
      region: newConfig.region || existingConfig.region,
      customVariables: {
        ...existingConfig.customVariables,
        ...newConfig.customVariables
      }
    };
  }

  /**
   * Create default configuration for environment
   */
  createDefaultConfig(environment: string): EnvironmentConfig {
    this.validateEnvironment(environment);

    return {
      environment,
      apiGatewayUrl: '',
      cognitoUserPoolId: '',
      cognitoClientId: '',
      region: process.env.AWS_REGION!,
      customVariables: {}
    };
  }

  /**
   * Validate environment name
   */
  validateEnvironment(environment: string): void {
    if (!environment || typeof environment !== 'string') {
      throw new Error('Environment must be a non-empty string');
    }

    if (!this.validEnvironments.includes(environment)) {
      throw new Error(`Invalid environment: ${environment}. Must be one of: ${this.validEnvironments.join(', ')}`);
    }
  }

  /**
   * Validate environment configuration
   */
  validateEnvironmentConfig(config: EnvironmentConfig): void {
    if (!isEnvironmentConfig(config)) {
      throw new Error('Invalid environment configuration format');
    }

    // Check required fields
    const missingFields = this.requiredFields.filter(field => !config[field as keyof EnvironmentConfig]);
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    // Validate URLs
    if (config.apiGatewayUrl && !this.isValidUrl(config.apiGatewayUrl)) {
      throw new Error('Invalid API Gateway URL format');
    }

    // Validate AWS region format
    if (config.region && !/^[a-z]{2}-[a-z]+-\d+$/.test(config.region)) {
      throw new Error('Invalid AWS region format');
    }

    // Validate Cognito User Pool ID format
    if (config.cognitoUserPoolId && !/^[a-z0-9-]+_[a-zA-Z0-9]+$/.test(config.cognitoUserPoolId)) {
      throw new Error('Invalid Cognito User Pool ID format');
    }

    // Validate custom variables
    if (config.customVariables) {
      Object.entries(config.customVariables).forEach(([key, value]) => {
        if (typeof key !== 'string' || typeof value !== 'string') {
          throw new Error('Custom variables must be string key-value pairs');
        }
        
        if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
          throw new Error(`Invalid custom variable key: ${key}. Must be uppercase with underscores only`);
        }
      });
    }
  }

  /**
   * Check if URL is valid
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get environment-specific defaults
   */
  getEnvironmentDefaults(environment: string): Partial<EnvironmentConfig> {
    this.validateEnvironment(environment);

    const defaults: Record<string, Partial<EnvironmentConfig>> = {
      development: {
        customVariables: {
          DEBUG: 'true',
          LOG_LEVEL: 'debug'
        }
      },
      staging: {
        customVariables: {
          DEBUG: 'false',
          LOG_LEVEL: 'info'
        }
      },
      production: {
        customVariables: {
          DEBUG: 'false',
          LOG_LEVEL: 'warn'
        }
      }
    };

    return defaults[environment] || {};
  }

  /**
   * Backup existing environment file
   */
  async backupEnvironmentFile(environment: string, projectPath?: string): Promise<string | null> {
    this.validateEnvironment(environment);

    const envFileName = `.env.${environment}`;
    const envFilePath = projectPath ? path.join(projectPath, envFileName) : envFileName;
    
    try {
      // Check if file exists
      await fs.access(envFilePath);
      
      // Create backup with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `.env.${environment}.backup.${timestamp}`;
      const backupFilePath = projectPath ? path.join(projectPath, backupFileName) : backupFileName;
      
      await fs.copyFile(envFilePath, backupFilePath);
      
      console.log(`Environment file backed up: ${backupFilePath}`);
      return backupFilePath;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null; // File doesn't exist, no backup needed
      }
      throw new Error(`Failed to backup environment file: ${error.message}`);
    }
  }

  /**
   * Convert DynamoDB item to EnvironmentConfig
   */
  dynamoDBItemToConfig(item: EnvironmentConfigDynamoDBItem): EnvironmentConfig {
    return {
      environment: item.environment,
      apiGatewayUrl: item.apiGatewayUrl,
      cognitoUserPoolId: item.cognitoUserPoolId,
      cognitoClientId: item.cognitoClientId,
      region: item.region,
      customVariables: item.customVariables || {}
    };
  }

  /**
   * Convert EnvironmentConfig to DynamoDB item
   */
  configToDynamoDBItem(config: EnvironmentConfig, userId: string): EnvironmentConfigDynamoDBItem {
    return {
      PK: `USER#${userId}`,
      SK: `ENV_CONFIG#${config.environment}`,
      userId,
      environment: config.environment,
      apiGatewayUrl: config.apiGatewayUrl,
      cognitoUserPoolId: config.cognitoUserPoolId,
      cognitoClientId: config.cognitoClientId,
      region: config.region,
      customVariables: config.customVariables,
      lastUpdated: new Date().toISOString(),
      isActive: true
    };
  }
}