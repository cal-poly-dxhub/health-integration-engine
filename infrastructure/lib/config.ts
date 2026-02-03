export interface StackConfig {
  environment: 'development' | 'staging' | 'production';
  region: string;
  account?: string;
  
  // Cognito configuration
  cognito: {
    userPoolName: string;
    userPoolClientName: string;
    domainPrefix: string;
    callbackUrls: string[];
    logoutUrls: string[];
    passwordPolicy: {
      minLength: number;
      requireLowercase: boolean;
      requireUppercase: boolean;
      requireDigits: boolean;
      requireSymbols: boolean;
    };
  };
  
  // API Gateway configuration
  apiGateway: {
    name: string;
    stageName: string;
    throttling: {
      rateLimit: number;
      burstLimit: number;
    };
    cors: {
      allowOrigins: string[];
      allowMethods: string[];
      allowHeaders: string[];
    };
  };
  
  // CloudWatch configuration
  cloudWatch: {
    logRetentionDays: number;
    enableDetailedMonitoring: boolean;
  };
}

export const getConfig = (environment: string = 'development'): StackConfig => {
  const baseConfig: StackConfig = {
    environment: environment as 'development' | 'staging' | 'production',
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    account: process.env.CDK_DEFAULT_ACCOUNT,
    
    cognito: {
      userPoolName: 'workflow-builder-user-pool',
      userPoolClientName: 'workflow-builder-client',
      domainPrefix: `workflow-builder-${environment}-${process.env.CDK_DEFAULT_ACCOUNT?.slice(-4) || 'dev'}`,
      callbackUrls: ['http://localhost:3000'],
      logoutUrls: ['http://localhost:3000'],
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
    },
    
    apiGateway: {
      name: 'workflow-builder-api',
      stageName: 'v1',
      throttling: {
        rateLimit: 1000,
        burstLimit: 2000,
      },
      cors: {
        allowOrigins: ['*'], // Restrict in production
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'X-Amz-User-Agent',
        ],
      },
    },
    
    cloudWatch: {
      logRetentionDays: 7, // 1 week for development
      enableDetailedMonitoring: true,
    },
  };

  // Environment-specific overrides
  switch (environment) {
    case 'production':
      return {
        ...baseConfig,
        cognito: {
          ...baseConfig.cognito,
          domainPrefix: `workflow-builder-prod-${Date.now().toString().slice(-6)}`,
          callbackUrls: [
            // Production URLs will be added when domain is available
            'https://your-production-domain.com',
          ],
          logoutUrls: [
            'https://your-production-domain.com',
          ],
        },
        apiGateway: {
          ...baseConfig.apiGateway,
          cors: {
            ...baseConfig.apiGateway.cors,
            allowOrigins: [
              'https://your-production-domain.com',
            ],
          },
        },
        cloudWatch: {
          ...baseConfig.cloudWatch,
          logRetentionDays: 30, // 1 month for production
        },
      };
      
    case 'staging':
      return {
        ...baseConfig,
        cognito: {
          ...baseConfig.cognito,
          domainPrefix: `workflow-builder-staging-${process.env.CDK_DEFAULT_ACCOUNT?.slice(-4) || 'stg'}`,
          callbackUrls: [
            'https://your-staging-domain.com',
          ],
          logoutUrls: [
            'https://your-staging-domain.com',
          ],
        },
        apiGateway: {
          ...baseConfig.apiGateway,
          cors: {
            ...baseConfig.apiGateway.cors,
            allowOrigins: [
              'https://your-staging-domain.com',
            ],
          },
        },
        cloudWatch: {
          ...baseConfig.cloudWatch,
          logRetentionDays: 14, // 2 weeks for staging
        },
      };
      
    default:
      return baseConfig;
  }
};