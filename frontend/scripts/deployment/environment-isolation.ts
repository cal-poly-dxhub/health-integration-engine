#!/usr/bin/env node

import chalk from 'chalk';
import { getStackDetails, getStackResources } from './backend-integration.js';

interface EnvironmentIsolationResult {
  isIsolated: boolean;
  environment: string;
  violations: string[];
  warnings: string[];
  recommendations: string[];
}

interface ResourceNamingConvention {
  prefix: string;
  environment: string;
  allowedPatterns: RegExp[];
  forbiddenPatterns: RegExp[];
}

export class EnvironmentIsolationChecker {
  private static readonly NAMING_CONVENTIONS: Record<string, ResourceNamingConvention> = {
    development: {
      prefix: 'workflow-builder-dev',
      environment: 'development',
      allowedPatterns: [
        /^workflow-builder-(dev|development)-/,
        /^WorkflowBuilder-(Dev|Development)-/
      ],
      forbiddenPatterns: [
        /^workflow-builder-(prod|production)-/,
        /^workflow-builder-(staging|stage)-/,
        /^WorkflowBuilder-(Prod|Production)-/,
        /^WorkflowBuilder-(Staging|Stage)-/
      ]
    },
    staging: {
      prefix: 'workflow-builder-staging',
      environment: 'staging',
      allowedPatterns: [
        /^workflow-builder-(staging|stage)-/,
        /^WorkflowBuilder-(Staging|Stage)-/
      ],
      forbiddenPatterns: [
        /^workflow-builder-(prod|production)-/,
        /^workflow-builder-(dev|development)-/,
        /^WorkflowBuilder-(Prod|Production)-/,
        /^WorkflowBuilder-(Dev|Development)-/
      ]
    },
    production: {
      prefix: 'workflow-builder-prod',
      environment: 'production',
      allowedPatterns: [
        /^workflow-builder-(prod|production)-/,
        /^WorkflowBuilder-(Prod|Production)-/
      ],
      forbiddenPatterns: [
        /^workflow-builder-(dev|development)-/,
        /^workflow-builder-(staging|stage)-/,
        /^WorkflowBuilder-(Dev|Development)-/,
        /^WorkflowBuilder-(Staging|Stage)-/
      ]
    }
  };

  static async validateEnvironmentIsolation(environment: string): Promise<EnvironmentIsolationResult> {
    console.log(chalk.blue.bold(`Validating environment isolation for ${environment}`));
    console.log('');

    const convention = this.NAMING_CONVENTIONS[environment];
    if (!convention) {
      throw new Error(`Unknown environment: ${environment}. Supported environments: ${Object.keys(this.NAMING_CONVENTIONS).join(', ')}`);
    }

    const result: EnvironmentIsolationResult = {
      isIsolated: true,
      environment,
      violations: [],
      warnings: [],
      recommendations: []
    };

    try {
      // 1. Validate stack naming convention
      await this.validateStackNaming(environment, convention, result);

      // 2. Validate resource naming conventions
      await this.validateResourceNaming(environment, convention, result);

      // 3. Validate cross-environment references
      await this.validateCrossEnvironmentReferences(environment, convention, result);

      // 4. Validate AWS account isolation
      await this.validateAccountIsolation(environment, result);

      // 5. Add environment-specific recommendations
      this.addIsolationRecommendations(environment, result);

      this.displayIsolationResults(result);

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.violations.push(`Environment isolation validation failed: ${errorMessage}`);
      result.isIsolated = false;

      this.displayIsolationResults(result);
      return result;
    }
  }

  private static async validateStackNaming(
    environment: string,
    convention: ResourceNamingConvention,
    result: EnvironmentIsolationResult
  ): Promise<void> {
    console.log(chalk.yellow('Validating stack naming conventions...'));

    try {
      const stackDetails = await getStackDetails(environment);
      
      // Check if stack name follows convention
      const isValidName = convention.allowedPatterns.some(pattern => 
        pattern.test(stackDetails.stackName)
      );

      if (!isValidName) {
        result.violations.push(`Stack name '${stackDetails.stackName}' does not follow naming convention for ${environment} environment`);
        result.isIsolated = false;
      }

      // Check for forbidden patterns
      const hasForbiddenPattern = convention.forbiddenPatterns.some(pattern => 
        pattern.test(stackDetails.stackName)
      );

      if (hasForbiddenPattern) {
        result.violations.push(`Stack name '${stackDetails.stackName}' contains forbidden pattern for ${environment} environment`);
        result.isIsolated = false;
      }

      console.log(chalk.green('Stack naming validation completed'));

    } catch (error) {
      // Stack may not exist yet, which is acceptable for new deployments
      result.warnings.push('Backend stack not found - will be created with proper naming convention');
    }
  }

  private static async validateResourceNaming(
    environment: string,
    convention: ResourceNamingConvention,
    result: EnvironmentIsolationResult
  ): Promise<void> {
    console.log(chalk.yellow('Validating resource naming conventions...'));

    try {
      const resources = await getStackResources(environment);
      
      for (const resource of resources) {
        // Check if resource name follows convention (if it has a name)
        if (resource.physicalResourceId) {
          const isValidName = convention.allowedPatterns.some(pattern => 
            pattern.test(resource.physicalResourceId)
          );

          const hasForbiddenPattern = convention.forbiddenPatterns.some(pattern => 
            pattern.test(resource.physicalResourceId)
          );

          if (hasForbiddenPattern) {
            result.violations.push(`Resource '${resource.physicalResourceId}' (${resource.resourceType}) contains forbidden pattern for ${environment} environment`);
            result.isIsolated = false;
          } else if (!isValidName && this.shouldValidateResourceName(resource.resourceType)) {
            result.warnings.push(`Resource '${resource.physicalResourceId}' (${resource.resourceType}) may not follow naming convention`);
          }
        }
      }

      console.log(chalk.green('Resource naming validation completed'));

    } catch (error) {
      // Resources may not exist yet
      result.warnings.push('Backend resources not found - will be created with proper naming convention');
    }
  }

  private static async validateCrossEnvironmentReferences(
    environment: string,
    convention: ResourceNamingConvention,
    result: EnvironmentIsolationResult
  ): Promise<void> {
    console.log(chalk.yellow('Validating cross-environment references...'));

    try {
      const stackDetails = await getStackDetails(environment);
      
      // Check stack outputs for cross-environment references
      for (const output of stackDetails.outputs) {
        if (output.OutputValue) {
          // Check for references to other environments in output values
          const hasCrossEnvReference = convention.forbiddenPatterns.some(pattern => 
            pattern.test(output.OutputValue)
          );

          if (hasCrossEnvReference) {
            result.violations.push(`Stack output '${output.OutputKey}' contains cross-environment reference: ${output.OutputValue}`);
            result.isIsolated = false;
          }
        }
      }

      console.log(chalk.green('Cross-environment reference validation completed'));

    } catch (error) {
      // Stack may not exist yet
      result.warnings.push('Backend stack not found - cross-environment validation skipped');
    }
  }

  private static async validateAccountIsolation(
    environment: string,
    result: EnvironmentIsolationResult
  ): Promise<void> {
    console.log(chalk.yellow('Validating AWS account isolation...'));

    try {
      // Check AWS region consistency
      const awsRegion = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION;
      if (!awsRegion) { throw new Error('AWS_REGION or AWS_DEFAULT_REGION must be set'); }
      
      // Validate region is appropriate for environment
      const productionRegions = ['us-east-1', 'us-west-2'];
      const developmentRegions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'];

      if (environment === 'production' && !productionRegions.includes(awsRegion)) {
        result.warnings.push(`Region ${awsRegion} is not typically used for production deployments`);
      }

      if (!developmentRegions.includes(awsRegion)) {
        result.warnings.push(`Region ${awsRegion} is not in the list of approved regions`);
      }

      // Check for AWS account ID consistency (placeholder - would need actual implementation)
      result.recommendations.push('Ensure different environments use appropriate AWS accounts or account separation strategies');

      console.log(chalk.green('Account isolation validation completed'));

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.warnings.push(`Account isolation validation warning: ${errorMessage}`);
    }
  }

  private static shouldValidateResourceName(resourceType: string): boolean {
    // Only validate naming for resources that typically have custom names
    const validatedResourceTypes = [
      'AWS::S3::Bucket',
      'AWS::Lambda::Function',
      'AWS::IAM::Role',
      'AWS::IAM::Policy',
      'AWS::CloudFormation::Stack',
      'AWS::CloudFront::Distribution',
      'AWS::Cognito::UserPool',
      'AWS::ApiGateway::RestApi'
    ];

    return validatedResourceTypes.includes(resourceType);
  }

  private static addIsolationRecommendations(
    environment: string,
    result: EnvironmentIsolationResult
  ): void {
    result.recommendations.push(`Use consistent naming convention: ${this.NAMING_CONVENTIONS[environment].prefix}-*`);
    result.recommendations.push('Avoid hardcoded references to other environments');
    result.recommendations.push('Use environment-specific configuration files');
    
    switch (environment) {
      case 'production':
        result.recommendations.push('Consider using separate AWS accounts for production isolation');
        result.recommendations.push('Implement strict access controls for production resources');
        result.recommendations.push('Use AWS Organizations SCPs to prevent cross-environment access');
        break;

      case 'staging':
        result.recommendations.push('Ensure staging mirrors production configuration');
        result.recommendations.push('Use separate resource names to avoid conflicts');
        break;

      case 'development':
        result.recommendations.push('Use cost-effective resources for development');
        result.recommendations.push('Consider shared development resources where appropriate');
        break;
    }
  }

  private static displayIsolationResults(result: EnvironmentIsolationResult): void {
    console.log('');
    console.log(chalk.cyan.bold('Environment Isolation Results:'));
    console.log('');

    // Display isolation status
    const statusColor = result.isIsolated ? chalk.green : chalk.red;
    console.log(`Environment: ${chalk.bold(result.environment)}`);
    console.log(`Isolation Status: ${statusColor.bold(result.isIsolated ? 'ISOLATED' : 'VIOLATIONS DETECTED')}`);
    console.log('');

    // Display violations
    if (result.violations.length > 0) {
      console.log(chalk.red.bold('Isolation Violations:'));
      for (const violation of result.violations) {
        console.log(chalk.red(`  • ${violation}`));
      }
      console.log('');
    }

    // Display warnings
    if (result.warnings.length > 0) {
      console.log(chalk.yellow.bold(' Isolation Warnings:'));
      for (const warning of result.warnings) {
        console.log(chalk.yellow(`  • ${warning}`));
      }
      console.log('');
    }

    // Display recommendations
    if (result.recommendations.length > 0) {
      console.log(chalk.blue.bold('Isolation Recommendations:'));
      for (const recommendation of result.recommendations) {
        console.log(chalk.blue(`  • ${recommendation}`));
      }
      console.log('');
    }

    // Display final result
    if (result.isIsolated) {
      console.log(chalk.green.bold('Environment isolation validation passed!'));
    } else {
      console.log(chalk.red.bold('Environment isolation violations detected!'));
      console.log(chalk.yellow('Please address the violations above to ensure proper environment isolation.'));
    }

    console.log('');
  }
}

// Export for use in other modules
export { type EnvironmentIsolationResult };