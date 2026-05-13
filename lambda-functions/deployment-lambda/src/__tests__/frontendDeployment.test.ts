import { EnvironmentConfigManager } from '../services/environmentConfigManager';
import { FrontendInfrastructureTemplate } from '../services/frontendInfrastructureTemplate';
import { S3UploadService } from '../services/s3UploadService';
import { EnvironmentConfig } from '../types';

// Mock AWS SDK
jest.mock('aws-sdk', () => ({
  S3: jest.fn().mockImplementation(() => ({
    upload: jest.fn().mockReturnValue({
      promise: jest.fn().mockResolvedValue({
        ETag: '"mock-etag"',
        Location: 'https://mock-bucket.s3.amazonaws.com/mock-key'
      })
    }),
    headBucket: jest.fn().mockReturnValue({
      promise: jest.fn().mockResolvedValue({})
    })
  })),
  CloudFront: jest.fn(),
  CloudFormation: jest.fn(),
  DynamoDB: {
    DocumentClient: jest.fn()
  },
  STS: jest.fn()
}));

describe('Frontend Deployment Infrastructure', () => {
  describe('EnvironmentConfigManager', () => {
    let configManager: EnvironmentConfigManager;

    beforeEach(() => {
      configManager = new EnvironmentConfigManager();
    });

    test('should generate valid environment content', () => {
      const config: EnvironmentConfig = {
        environment: 'development',
        apiGatewayUrl: 'https://api.example.com',
        cognitoUserPoolId: 'us-east-1_ABC123',
        cognitoClientId: 'abc123def456',
        region: 'us-east-1',
        customVariables: {
          DEBUG: 'true',
          LOG_LEVEL: 'debug'
        }
      };

      const envContent = configManager.generateEnvContent(config);

      expect(envContent).toContain('REACT_APP_API_GATEWAY_URL=https://api.example.com');
      expect(envContent).toContain('REACT_APP_COGNITO_USER_POOL_ID=us-east-1_ABC123');
      expect(envContent).toContain('REACT_APP_COGNITO_CLIENT_ID=abc123def456');
      expect(envContent).toContain('REACT_APP_AWS_REGION=us-east-1');
      expect(envContent).toContain('REACT_APP_ENVIRONMENT=development');
      expect(envContent).toContain('REACT_APP_DEBUG=true');
      expect(envContent).toContain('REACT_APP_LOG_LEVEL=debug');
    });

    test('should validate environment configuration', () => {
      const validConfig: EnvironmentConfig = {
        environment: 'production',
        apiGatewayUrl: 'https://api.example.com',
        cognitoUserPoolId: 'us-east-1_ABC123',
        cognitoClientId: 'abc123def456',
        region: 'us-east-1',
        customVariables: {}
      };

      expect(() => configManager.validateEnvironmentConfig(validConfig)).not.toThrow();

      const invalidConfig = { ...validConfig, apiGatewayUrl: '' };
      expect(() => configManager.validateEnvironmentConfig(invalidConfig as EnvironmentConfig)).toThrow();
    });

    test('should parse environment content correctly', () => {
      const envContent = `
# Environment configuration
REACT_APP_API_GATEWAY_URL=https://api.example.com
REACT_APP_COGNITO_USER_POOL_ID=us-east-1_ABC123
REACT_APP_COGNITO_CLIENT_ID=abc123def456
REACT_APP_AWS_REGION=us-east-1
REACT_APP_ENVIRONMENT=development
REACT_APP_DEBUG=true
`;

      const parsed = configManager.parseEnvContent(envContent);

      expect(parsed['REACT_APP_API_GATEWAY_URL']).toBe('https://api.example.com');
      expect(parsed['REACT_APP_COGNITO_USER_POOL_ID']).toBe('us-east-1_ABC123');
      expect(parsed['REACT_APP_DEBUG']).toBe('true');
    });

    test('should convert env content to config', () => {
      const envContent = {
        'REACT_APP_API_GATEWAY_URL': 'https://api.example.com',
        'REACT_APP_COGNITO_USER_POOL_ID': 'us-east-1_ABC123',
        'REACT_APP_COGNITO_CLIENT_ID': 'abc123def456',
        'REACT_APP_AWS_REGION': 'us-east-1',
        'REACT_APP_ENVIRONMENT': 'development',
        'REACT_APP_DEBUG': 'true',
        'REACT_APP_LOG_LEVEL': 'debug'
      };

      const config = configManager.envContentToConfig(envContent, 'development');

      expect(config.environment).toBe('development');
      expect(config.apiGatewayUrl).toBe('https://api.example.com');
      expect(config.customVariables.DEBUG).toBe('true');
      expect(config.customVariables.LOG_LEVEL).toBe('debug');
    });
  });

  describe('FrontendInfrastructureTemplate', () => {
    test('should generate valid CloudFormation template', () => {
      const template = FrontendInfrastructureTemplate.generateTemplate({
        environment: 'development'
      });

      expect(template.AWSTemplateFormatVersion).toBe('2010-09-09');
      expect(template.Resources.S3Bucket).toBeDefined();
      expect(template.Resources.CloudFrontDistribution).toBeDefined();
      expect(template.Resources.OriginAccessControl).toBeDefined();
      expect(template.Resources.BucketPolicy).toBeDefined();
      expect(template.Outputs.S3BucketName).toBeDefined();
      expect(template.Outputs.CloudFrontUrl).toBeDefined();
      expect(template.Outputs.DistributionId).toBeDefined();
    });

    test('should generate template with custom domain', () => {
      const template = FrontendInfrastructureTemplate.generateTemplate({
        environment: 'production',
        domainName: 'app.example.com',
        certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012'
      });

      expect(template.Resources.CloudFrontDistribution.Properties.DistributionConfig.Aliases).toBeDefined();
      expect(template.Resources.CloudFrontDistribution.Properties.DistributionConfig.ViewerCertificate).toBeDefined();
      expect(template.Conditions.HasCustomDomain).toBeDefined();
      expect(template.Conditions.HasCertificate).toBeDefined();
    });

    test('should validate template parameters', () => {
      expect(() => FrontendInfrastructureTemplate.validateParameters({
        environment: 'development'
      })).not.toThrow();

      expect(() => FrontendInfrastructureTemplate.validateParameters({
        environment: 'invalid' as any
      })).toThrow();

      expect(() => FrontendInfrastructureTemplate.validateParameters({
        environment: 'production',
        domainName: 'app.example.com'
        // Missing certificateArn
      })).toThrow();
    });

    test('should generate correct stack name', () => {
      const stackName = FrontendInfrastructureTemplate.generateStackName('development', 'user123');
      expect(stackName).toBe('workflow-builder-frontend-development-user123');
    });

    test('should generate correct resource names', () => {
      const names = FrontendInfrastructureTemplate.generateResourceNames('production', '123456789012');
      expect(names.s3BucketName).toBe('workflow-builder-frontend-production-123456789012');
      expect(names.originAccessControlName).toBe('OAC-production-123456789012');
    });
  });

  describe('S3UploadService', () => {
    let s3Service: S3UploadService;

    beforeEach(() => {
      s3Service = new S3UploadService('us-east-1');
    });

    test('should get correct content type for files', () => {
      expect(s3Service.getContentType('index.html')).toBe('text/html');
      expect(s3Service.getContentType('main.js')).toBe('application/javascript');
      expect(s3Service.getContentType('styles.css')).toBe('text/css');
      expect(s3Service.getContentType('logo.png')).toBe('image/png');
      expect(s3Service.getContentType('data.json')).toBe('application/json');
      expect(s3Service.getContentType('font.woff2')).toBe('font/woff2');
      expect(s3Service.getContentType('unknown.unknownext')).toBe('application/octet-stream');
    });

    test('should get correct cache control headers', () => {
      // HTML files should not be cached
      expect(s3Service.getCacheControl('index.html')).toBe('public, max-age=0, must-revalidate');
      
      // Hashed files should be cached for a long time
      expect(s3Service.getCacheControl('main.12345678.js')).toBe('public, max-age=31536000, immutable');
      expect(s3Service.getCacheControl('styles.abcdef12.css')).toBe('public, max-age=31536000, immutable');
      
      // Regular static assets should have medium cache
      expect(s3Service.getCacheControl('logo.png')).toBe('public, max-age=86400');
      expect(s3Service.getCacheControl('main.js')).toBe('public, max-age=86400');
      
      // Service worker should have short cache
      expect(s3Service.getCacheControl('service-worker.js')).toBe('public, max-age=300');
      expect(s3Service.getCacheControl('sw.js')).toBe('public, max-age=300');
      
      // JSON files should have short cache
      expect(s3Service.getCacheControl('manifest.json')).toBe('public, max-age=3600');
    });

    test('should validate upload configuration', () => {
      const validConfig = {
        bucketName: 'my-bucket',
        region: 'us-east-1'
      };

      expect(() => s3Service['validateUploadConfig'](validConfig)).not.toThrow();

      const invalidConfig = {
        bucketName: '',
        region: 'us-east-1'
      };

      expect(() => s3Service['validateUploadConfig'](invalidConfig)).toThrow();
    });
  });
});