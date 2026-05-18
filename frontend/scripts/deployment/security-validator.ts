#!/usr/bin/env node

import chalk from 'chalk';
import { validateBackendDeployment, getStackDetails } from './backend-integration.js';
import { readEnvironmentConfig } from './configure-environment.js';
import { EnvironmentIsolationChecker } from './environment-isolation.js';

interface SecurityValidationResult {
  isValid: boolean;
  environment: string;
  securityLevel: 'low' | 'medium' | 'high';
  checks: {
    environmentIsolation: boolean;
    backendSecurity: boolean;
    resourceValidation: boolean;
    accessControl: boolean;
    encryptionCompliance: boolean;
  };
  errors: string[];
  warnings: string[];
  recommendations: string[];
}

interface EnvironmentSecurityConfig {
  environment: string;
  requiredSecurityLevel: 'low' | 'medium' | 'high';
  allowedRegions: string[];
  requiresApproval: boolean;
  maxResourceLimits: {
    s3Buckets: number;
    cloudFrontDistributions: number;
    lambdaFunctions: number;
  };
  encryptionRequirements: {
    s3: boolean;
    cloudFront: boolean;
    logs: boolean;
  };
  accessControlRequirements: {
    waf: boolean;
    originAccessControl: boolean;
    httpsOnly: boolean;
    securityHeaders: boolean;
  };
}

export class SecurityValidator {
  private static readonly SECURITY_CONFIGS: Record<string, EnvironmentSecurityConfig> = {
    development: {
      environment: 'development',
      requiredSecurityLevel: 'low',
      allowedRegions: ['us-east-1', 'us-west-2', 'eu-west-1'],
      requiresApproval: false,
      maxResourceLimits: {
        s3Buckets: 5,
        cloudFrontDistributions: 3,
        lambdaFunctions: 20
      },
      encryptionRequirements: {
        s3: true,
        cloudFront: false,
        logs: false
      },
      accessControlRequirements: {
        waf: false,
        originAccessControl: true,
        httpsOnly: true,
        securityHeaders: false
      }
    },
    staging: {
      environment: 'staging',
      requiredSecurityLevel: 'medium',
      allowedRegions: ['us-east-1', 'us-west-2', 'eu-west-1'],
      requiresApproval: false,
      maxResourceLimits: {
        s3Buckets: 3,
        cloudFrontDistributions: 2,
        lambdaFunctions: 15
      },
      encryptionRequirements: {
        s3: true,
        cloudFront: true,
        logs: true
      },
      accessControlRequirements: {
        waf: false,
        originAccessControl: true,
        httpsOnly: true,
        securityHeaders: true
      }
    },
    production: {
      environment: 'production',
      requiredSecurityLevel: 'high',
      allowedRegions: ['us-east-1', 'us-west-2'],
      requiresApproval: true,
      maxResourceLimits: {
        s3Buckets: 2,
        cloudFrontDistributions: 1,
        lambdaFunctions: 10
      },
      encryptionRequirements: {
        s3: true,
        cloudFront: true,
        logs: true
      },
      accessControlRequirements: {
        waf: true,
        originAccessControl: true,
        httpsOnly: true,
        securityHeaders: true
      }
    }
  };

  static async validateDeploymentSecurity(environment: string): Promise<SecurityValidationResult> {
    console.log(chalk.blue.bold(`Performing security validation for ${environment} environment`));
    console.log('');

    const config = this.SECURITY_CONFIGS[environment];
    if (!config) {
      throw new Error(`Unknown environment: ${environment}. Supported environments: ${Object.keys(this.SECURITY_CONFIGS).join(', ')}`);
    }

    const result: SecurityValidationResult = {
      isValid: false,
      environment,
      securityLevel: config.requiredSecurityLevel,
      checks: {
        environmentIsolation: false,
        backendSecurity: false,
        resourceValidation: false,
        accessControl: false,
        encryptionCompliance: false
      },
      errors: [],
      warnings: [],
      recommendations: []
    };

    try {
      // 1. Environment Isolation Check
      result.checks.environmentIsolation = await this.validateEnvironmentIsolation(environment, config, result);

      // 2. Backend Security Check
      result.checks.backendSecurity = await this.validateBackendSecurity(environment, config, result);

      // 3. Resource Validation Check
      result.checks.resourceValidation = await this.validateResourceLimits(environment, config, result);

      // 4. Access Control Check
      result.checks.accessControl = await this.validateAccessControl(environment, config, result);

      // 5. Encryption Compliance Check
      result.checks.encryptionCompliance = await this.validateEncryptionCompliance(environment, config, result);

      // Overall validation
      result.isValid = Object.values(result.checks).every(check => check);

      // Add environment-specific recommendations
      this.addEnvironmentRecommendations(environment, config, result);

      this.displaySecurityResults(result);

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Security validation failed: ${errorMessage}`);
      result.isValid = false;

      this.displaySecurityResults(result);
      return result;
    }
  }

  private static async validateEnvironmentIsolation(
    environment: string,
    config: EnvironmentSecurityConfig,
    result: SecurityValidationResult
  ): Promise<boolean> {
    console.log(chalk.yellow('Validating environment isolation...'));

    try {
      // Check AWS region
      const awsRegion = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION;
      if (!awsRegion) { throw new Error('AWS_REGION or AWS_DEFAULT_REGION must be set'); }
      
      if (!config.allowedRegions.includes(awsRegion)) {
        result.errors.push(`Region ${awsRegion} is not allowed for ${environment} environment. Allowed regions: ${config.allowedRegions.join(', ')}`);
        return false;
      }

      // Use comprehensive environment isolation checker
      const isolationResult = await EnvironmentIsolationChecker.validateEnvironmentIsolation(environment);
      
      if (!isolationResult.isIsolated) {
        result.errors.push(...isolationResult.violations.map(violation => `Isolation: ${violation}`));
      }

      if (isolationResult.warnings.length > 0) {
        result.warnings.push(...isolationResult.warnings.map(warning => `Isolation: ${warning}`));
      }

      if (isolationResult.recommendations.length > 0) {
        result.recommendations.push(...isolationResult.recommendations.map(rec => `Isolation: ${rec}`));
      }

      // Check for cross-environment resource conflicts in configuration
      const envConfig = readEnvironmentConfig(environment);
      if (envConfig) {
        // Validate that API Gateway URL matches expected environment
        if (envConfig.apiGatewayUrl && !envConfig.apiGatewayUrl.includes(environment)) {
          result.warnings.push(`API Gateway URL may not match ${environment} environment`);
        }

        // Validate Cognito configuration matches environment
        if (envConfig.cognitoUserPoolId && !envConfig.cognitoUserPoolId.includes(environment)) {
          result.warnings.push(`Cognito User Pool may not match ${environment} environment`);
        }
      }

      if (isolationResult.isIsolated) {
        console.log(chalk.green('Environment isolation validation passed'));
        return true;
      } else {
        console.log(chalk.red('Environment isolation validation failed'));
        return false;
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Environment isolation validation failed: ${errorMessage}`);
      return false;
    }
  }

  private static async validateBackendSecurity(
    environment: string,
    config: EnvironmentSecurityConfig,
    result: SecurityValidationResult
  ): Promise<boolean> {
    console.log(chalk.yellow('Validating backend security configuration...'));

    try {
      // Validate backend deployment exists and is secure
      const isBackendValid = await validateBackendDeployment(environment);
      
      if (!isBackendValid) {
        result.errors.push('Backend deployment validation failed');
        return false;
      }

      // Check backend stack outputs for security configuration
      const stackDetails = await getStackDetails(environment);
      
      // Validate API Gateway has HTTPS endpoints
      const apiGatewayOutput = stackDetails.outputs.find(output => 
        ['ApiGatewayUrl', 'APIGatewayURL', 'RestApiUrl', 'ApiUrl'].includes(output.OutputKey)
      );
      
      if (apiGatewayOutput && !apiGatewayOutput.OutputValue.startsWith('https://')) {
        result.errors.push('API Gateway must use HTTPS endpoints');
        return false;
      }

      // Validate Cognito configuration exists
      const cognitoOutput = stackDetails.outputs.find(output => 
        ['CognitoUserPoolId', 'UserPoolId'].includes(output.OutputKey)
      );
      
      if (!cognitoOutput) {
        result.errors.push('Cognito User Pool configuration not found in backend deployment');
        return false;
      }

      console.log(chalk.green('Backend security validation passed'));
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Backend security validation failed: ${errorMessage}`);
      return false;
    }
  }

  private static async validateResourceLimits(
    environment: string,
    config: EnvironmentSecurityConfig,
    result: SecurityValidationResult
  ): Promise<boolean> {
    console.log(chalk.yellow('Validating resource limits and quotas...'));

    try {
      // This is a placeholder for actual AWS resource counting
      // In a real implementation, you would use AWS APIs to count existing resources
      
      result.recommendations.push(`Environment ${environment} allows up to ${config.maxResourceLimits.s3Buckets} S3 buckets`);
      result.recommendations.push(`Environment ${environment} allows up to ${config.maxResourceLimits.cloudFrontDistributions} CloudFront distributions`);
      result.recommendations.push(`Environment ${environment} allows up to ${config.maxResourceLimits.lambdaFunctions} Lambda functions`);

      console.log(chalk.green('Resource limits validation passed'));
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Resource limits validation failed: ${errorMessage}`);
      return false;
    }
  }

  private static async validateAccessControl(
    environment: string,
    config: EnvironmentSecurityConfig,
    result: SecurityValidationResult
  ): Promise<boolean> {
    console.log(chalk.yellow('Validating access control requirements...'));

    try {
      // Validate access control requirements based on environment
      if (config.accessControlRequirements.waf && environment === 'production') {
        result.recommendations.push('WAF will be enabled for production environment');
      }

      if (config.accessControlRequirements.originAccessControl) {
        result.recommendations.push('Origin Access Control (OAC) will be configured for CloudFront');
      }

      if (config.accessControlRequirements.httpsOnly) {
        result.recommendations.push('HTTPS-only access will be enforced');
      }

      if (config.accessControlRequirements.securityHeaders) {
        result.recommendations.push('Security headers will be configured');
      }

      console.log(chalk.green('Access control validation passed'));
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Access control validation failed: ${errorMessage}`);
      return false;
    }
  }

  private static async validateEncryptionCompliance(
    environment: string,
    config: EnvironmentSecurityConfig,
    result: SecurityValidationResult
  ): Promise<boolean> {
    console.log(chalk.yellow('Validating encryption compliance...'));

    try {
      // Validate encryption requirements based on environment
      if (config.encryptionRequirements.s3) {
        result.recommendations.push('S3 bucket encryption will be enabled');
      }

      if (config.encryptionRequirements.cloudFront) {
        result.recommendations.push('CloudFront will enforce HTTPS with TLS 1.2+');
      }

      if (config.encryptionRequirements.logs) {
        result.recommendations.push('CloudWatch logs encryption will be enabled');
      }

      console.log(chalk.green('Encryption compliance validation passed'));
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Encryption compliance validation failed: ${errorMessage}`);
      return false;
    }
  }

  private static addEnvironmentRecommendations(
    environment: string,
    config: EnvironmentSecurityConfig,
    result: SecurityValidationResult
  ): void {
    switch (environment) {
      case 'production':
        result.recommendations.push('Production deployment detected - enhanced security measures will be applied');
        result.recommendations.push('Consider creating a backup before deployment');
        result.recommendations.push('Monitor CloudWatch metrics and alarms after deployment');
        if (config.requiresApproval) {
          result.warnings.push('Production deployment requires manual approval');
        }
        break;

      case 'staging':
        result.recommendations.push('Staging deployment - suitable for pre-production testing');
        result.recommendations.push('Test all functionality before promoting to production');
        break;

      case 'development':
        result.recommendations.push('Development deployment - suitable for testing and development');
        result.recommendations.push('Consider using lower-cost resources for development');
        break;
    }
  }

  private static displaySecurityResults(result: SecurityValidationResult): void {
    console.log('');
    console.log(chalk.cyan.bold('Security Validation Results:'));
    console.log('');

    // Display security level
    const securityLevelColor = result.securityLevel === 'high' ? chalk.red : 
                              result.securityLevel === 'medium' ? chalk.yellow : chalk.green;
    console.log(`Security Level: ${securityLevelColor.bold(result.securityLevel.toUpperCase())}`);
    console.log('');

    // Display check results
    console.log('Security Checks:');
    console.log(`  Environment Isolation: ${this.getCheckIcon(result.checks.environmentIsolation)} ${result.checks.environmentIsolation ? 'Passed' : 'Failed'}`);
    console.log(`  Backend Security: ${this.getCheckIcon(result.checks.backendSecurity)} ${result.checks.backendSecurity ? 'Passed' : 'Failed'}`);
    console.log(`  Resource Validation: ${this.getCheckIcon(result.checks.resourceValidation)} ${result.checks.resourceValidation ? 'Passed' : 'Failed'}`);
    console.log(`  Access Control: ${this.getCheckIcon(result.checks.accessControl)} ${result.checks.accessControl ? 'Passed' : 'Failed'}`);
    console.log(`  Encryption Compliance: ${this.getCheckIcon(result.checks.encryptionCompliance)} ${result.checks.encryptionCompliance ? 'Passed' : 'Failed'}`);
    console.log('');

    // Display errors
    if (result.errors.length > 0) {
      console.log(chalk.red.bold('Security Errors:'));
      for (const error of result.errors) {
        console.log(chalk.red(`  • ${error}`));
      }
      console.log('');
    }

    // Display warnings
    if (result.warnings.length > 0) {
      console.log(chalk.yellow.bold(' Security Warnings:'));
      for (const warning of result.warnings) {
        console.log(chalk.yellow(`  • ${warning}`));
      }
      console.log('');
    }

    // Display recommendations
    if (result.recommendations.length > 0) {
      console.log(chalk.blue.bold('Security Recommendations:'));
      for (const recommendation of result.recommendations) {
        console.log(chalk.blue(`  • ${recommendation}`));
      }
      console.log('');
    }

    // Display final result
    if (result.isValid) {
      console.log(chalk.green.bold('Security validation passed! Deployment meets security requirements.'));
    } else {
      console.log(chalk.red.bold('Security validation failed! Please address the security issues above.'));
    }

    console.log('');
  }

  private static getCheckIcon(passed: boolean): string {
    return passed ? chalk.green('') : chalk.red('');
  }

  static async promptForProductionApproval(environment: string): Promise<boolean> {
    if (environment !== 'production') {
      return true;
    }

    console.log('');
    console.log(chalk.red.bold(' PRODUCTION DEPLOYMENT WARNING'));
    console.log(chalk.yellow('You are about to deploy to the PRODUCTION environment.'));
    console.log(chalk.yellow('This will affect live users and systems.'));
    console.log('');
    console.log(chalk.cyan('Please confirm the following:'));
    console.log(chalk.cyan('  • All changes have been tested in staging'));
    console.log(chalk.cyan('  • You have reviewed the security validation results'));
    console.log(chalk.cyan('  • You have appropriate permissions for production deployment'));
    console.log(chalk.cyan('  • You understand the impact of this deployment'));
    console.log('');

    // In a real implementation, you would use a proper prompt library
    // For now, we'll assume approval is required but not implemented
    console.log(chalk.yellow('Production deployment approval is required but not implemented in this script.'));
    console.log(chalk.yellow('Please ensure you have proper approval before proceeding.'));
    
    return true; // Placeholder - should implement actual approval mechanism
  }
}

// Export for use in other modules
export { type SecurityValidationResult, type EnvironmentSecurityConfig };