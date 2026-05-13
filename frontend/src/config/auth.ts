// Authentication configuration
// These values should be populated from environment variables or CDK outputs

export interface AuthConfig {
  userPoolId: string;
  userPoolClientId: string;
  identityPoolId: string;
  region: string;
  domain?: string;
}

// Default configuration - these will be replaced with actual values from CDK deployment
const defaultConfig: AuthConfig = {
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
  userPoolClientId: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID || '',
  identityPoolId: import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID || '',
  region: import.meta.env.VITE_AWS_REGION || '',
  domain: import.meta.env.VITE_COGNITO_DOMAIN || undefined,
};

// Validate configuration
const validateConfig = (config: AuthConfig): void => {
  const requiredFields = ['userPoolId', 'userPoolClientId', 'identityPoolId', 'region'];
  const missingFields = requiredFields.filter(field => !config[field as keyof AuthConfig]);
  
  if (missingFields.length > 0) {
    console.error('Missing required authentication configuration:', missingFields);
    throw new Error(`Missing required authentication configuration: ${missingFields.join(', ')}`);
  }
};

// Get authentication configuration
export const getAuthConfig = (): AuthConfig => {
  // In development, you might want to use hardcoded values for testing
  if (import.meta.env.DEV && !defaultConfig.userPoolId) {
    console.warn('Missing authentication configuration. Run the deploy script to populate .env with CDK outputs.');
  }

  validateConfig(defaultConfig);
  return defaultConfig;
};

// Environment-specific configurations
export const getEnvironmentConfig = (environment: 'development' | 'staging' | 'production' = 'development'): AuthConfig => {
  const baseConfig = getAuthConfig();
  
  switch (environment) {
    case 'production':
      return {
        ...baseConfig,
        // Production-specific overrides can be added here
      };
    
    case 'staging':
      return {
        ...baseConfig,
        // Staging-specific overrides can be added here
      };
    
    default:
      return baseConfig;
  }
};

export default getAuthConfig;