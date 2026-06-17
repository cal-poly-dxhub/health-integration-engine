import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

// Load project configuration from config.yaml
const configPath = path.join(__dirname, '..', 'config.yaml');
const configFile = fs.readFileSync(configPath, 'utf8');
const projectConfig = yaml.parse(configFile);

export const PROJECT = projectConfig;

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
    region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION!,
    account: process.env.CDK_DEFAULT_ACCOUNT,
    
    cognito: {
      userPoolName: PROJECT.cognito.userPoolName,
      userPoolClientName: PROJECT.cognito.userPoolClientName,
      domainPrefix: `${PROJECT.cognito.domainPrefix}-${environment}-${process.env.CDK_DEFAULT_ACCOUNT?.slice(-4) || 'dev'}`,
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
      name: PROJECT.apiGateway.name,
      stageName: PROJECT.apiGateway.stageName,
      throttling: {
        rateLimit: 1000,
        burstLimit: 2000,
      },
      cors: {
        // NOTE: this block is a placeholder and is NOT what the deployed API
        // uses. The live API Gateway scopes CORS to the CloudFront
        // distribution origin (plus localhost for dev) — see
        // `defaultCorsPreflightOptions` in workflow-builder-stack.ts. A
        // wildcard (`*`) origin must never be used here; keep it scoped.
        allowOrigins: ['http://localhost:3000'],
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
      logRetentionDays: 7,
      enableDetailedMonitoring: true,
    },
  };

  switch (environment) {
    case 'production':
      return {
        ...baseConfig,
        cognito: {
          ...baseConfig.cognito,
          domainPrefix: `${PROJECT.cognito.domainPrefix}-prod-${Date.now().toString().slice(-6)}`,
          callbackUrls: ['https://your-production-domain.com'],
          logoutUrls: ['https://your-production-domain.com'],
        },
        apiGateway: {
          ...baseConfig.apiGateway,
          cors: {
            ...baseConfig.apiGateway.cors,
            allowOrigins: ['https://your-production-domain.com'],
          },
        },
        cloudWatch: {
          ...baseConfig.cloudWatch,
          logRetentionDays: 30,
        },
      };
      
    case 'staging':
      return {
        ...baseConfig,
        cognito: {
          ...baseConfig.cognito,
          domainPrefix: `${PROJECT.cognito.domainPrefix}-staging-${process.env.CDK_DEFAULT_ACCOUNT?.slice(-4) || 'stg'}`,
          callbackUrls: ['https://your-staging-domain.com'],
          logoutUrls: ['https://your-staging-domain.com'],
        },
        apiGateway: {
          ...baseConfig.apiGateway,
          cors: {
            ...baseConfig.apiGateway.cors,
            allowOrigins: ['https://your-staging-domain.com'],
          },
        },
        cloudWatch: {
          ...baseConfig.cloudWatch,
          logRetentionDays: 14,
        },
      };
      
    default:
      return baseConfig;
  }
};