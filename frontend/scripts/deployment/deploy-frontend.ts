#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { buildFrontend } from './build-frontend.js';
import { configureEnvironment } from './configure-environment.js';
import { validateBackendDeployment } from './validate-backend.js';
import { DeploymentValidator } from './validate-deployment.js';
import { DeploymentConfirmation } from './deployment-confirmation.js';

interface DeploymentOptions {
  environment: string;
  skipValidation?: boolean;
  skipConfirmation?: boolean;
  autoApprove?: boolean;
  verbose?: boolean;
  skipLinting?: boolean;
}

interface DeploymentResult {
  success: boolean;
  environment: string;
  buildPath?: string;
  s3BucketName?: string;
  cloudFrontUrl?: string;
  error?: string;
}

class FrontendDeployer {
  private options: DeploymentOptions;
  private spinner: Ora;

  constructor(options: DeploymentOptions) {
    this.options = options;
    this.spinner = ora();
  }

  async deploy(): Promise<DeploymentResult> {
    try {
      console.log(chalk.blue.bold(`Starting frontend deployment for ${this.options.environment} environment`));
      console.log('Deployment options:', this.options);
      console.log('Skip validation:', this.options.skipValidation);
      console.log('');

      // Step 1: Comprehensive validation (backend, security, environment isolation)
      if (!this.options.skipValidation) {
        console.log('Running validation...');
        await this.performComprehensiveValidation();
      } else {
        console.log(chalk.yellow('Skipping validation as requested'));
      }

      // Step 2: Deployment confirmation (especially important for production)
      const confirmed = await DeploymentConfirmation.confirmDeployment({
        environment: this.options.environment,
        skipConfirmation: this.options.skipConfirmation,
        autoApprove: this.options.autoApprove
      });

      if (!confirmed) {
        console.log(chalk.yellow('Deployment cancelled by user'));
        return {
          success: false,
          environment: this.options.environment,
          error: 'Deployment cancelled by user'
        };
      }

      // Step 3: Configure environment
      await this.configureEnvironment();

      // Step 4: Build frontend
      const buildResult = await this.buildFrontend();

      // Step 5: Deploy to AWS (placeholder for now)
      await this.deployToAWS(buildResult.buildPath);

      console.log('');
      console.log(chalk.green.bold('Frontend deployment completed successfully!'));
      
      return {
        success: true,
        environment: this.options.environment,
        buildPath: buildResult.buildPath,
        // TODO: Add actual S3 and CloudFront URLs when AWS deployment is implemented
        s3BucketName: `workflow-builder-frontend-${this.options.environment}`,
        cloudFrontUrl: `https://d123456789.cloudfront.net`
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.log('');
      console.log(chalk.red.bold('Frontend deployment failed!'));
      console.log(chalk.red(`Error: ${errorMessage}`));
      
      return {
        success: false,
        environment: this.options.environment,
        error: errorMessage
      };
    }
  }

  private async performComprehensiveValidation(): Promise<void> {
    this.spinner.start('Performing comprehensive deployment validation...');
    
    try {
      const validator = new DeploymentValidator({
        environment: this.options.environment,
        verbose: this.options.verbose
      });

      const validationResult = await validator.validate();
      
      if (!validationResult.success) {
        throw new Error('Deployment validation failed. Please address the issues above.');
      }
      
      this.spinner.succeed('Comprehensive validation completed');
    } catch (error) {
      this.spinner.fail('Deployment validation failed');
      throw error;
    }
  }



  private async configureEnvironment(): Promise<void> {
    this.spinner.start('Configuring environment variables...');
    
    try {
      await configureEnvironment(this.options.environment);
      this.spinner.succeed('Environment configuration updated');
    } catch (error) {
      this.spinner.fail('Environment configuration failed');
      throw error;
    }
  }

  private async buildFrontend(): Promise<{ buildPath: string; buildTime: number }> {
    this.spinner.start('Building frontend application...');
    
    try {
      const result = await buildFrontend(this.options.environment, {
        verbose: this.options.verbose,
        skipLinting: this.options.skipLinting
      });
      
      this.spinner.succeed(`Frontend build completed in ${result.buildTime}ms`);
      return result;
    } catch (error) {
      this.spinner.fail('Frontend build failed');
      throw error;
    }
  }

  private async deployToAWS(buildPath: string): Promise<void> {
    this.spinner.start('Deploying to AWS...');
    
    try {
      // Import AWS SDK
      const AWS = await import('aws-sdk');
      
      // Get backend configuration to find the deployment Lambda function
      const { getLatestDeploymentOutputs } = await import('./backend-integration.js');
      const backendOutputs = await getLatestDeploymentOutputs(this.options.environment);
      
      if (!backendOutputs.region) {
        throw new Error('AWS region not found in backend configuration');
      }

      // Configure AWS SDK - use default export for CommonJS module
      const lambda = new AWS.default.Lambda({ region: backendOutputs.region });

      // Prepare deployment request
      const deploymentRequest = {
        environment: this.options.environment,
        buildPath: buildPath,
        userId: process.env.USER || process.env.USERNAME || 'default-user',
        customVariables: {},
        domainName: undefined, // Can be configured later
        certificateArn: undefined // Can be configured later
      };

      let result: any;
      
      // Try to invoke the deployment Lambda function directly first
      try {
        const functionName = `WorkflowBuilder-FrontendDeployment-${this.options.environment}`;
        console.log(`Attempting to invoke deployment function: ${functionName}`);
        
        const lambdaResponse = await lambda.invoke({
          FunctionName: functionName,
          Payload: JSON.stringify({
            action: 'deploy',
            ...deploymentRequest
          }),
          InvocationType: 'RequestResponse'
        }).promise();

        if (lambdaResponse.FunctionError) {
          const errorPayload = lambdaResponse.Payload ? JSON.parse(lambdaResponse.Payload.toString()) : {};
          throw new Error(`Lambda function error: ${errorPayload.errorMessage || 'Unknown error'}`);
        }

        result = lambdaResponse.Payload ? JSON.parse(lambdaResponse.Payload.toString()) : {};
        
      } catch (lambdaError) {
        console.log(chalk.yellow(`Direct Lambda invocation failed, trying API Gateway: ${lambdaError instanceof Error ? lambdaError.message : 'Unknown error'}`));
        
        // Fallback to API Gateway endpoint
        if (!backendOutputs.apiGatewayUrl) {
          throw new Error('No API Gateway URL found and direct Lambda invocation failed');
        }
        
        // Let's test what routes actually exist in your API Gateway
        const baseUrl = backendOutputs.apiGatewayUrl.replace(/\/$/, '');
        console.log(chalk.yellow(`Testing API Gateway routes...`));
        
        // Test common routes that might exist
        const testRoutes = [
          '',
          '/health',
          '/api',
          '/workflows',
          '/deploy',
          '/deployment'
        ];
        
        for (const route of testRoutes) {
          try {
            const testUrl = `${baseUrl}${route}`;
            const testResponse = await fetch(testUrl);
            console.log(chalk.blue(`${testUrl} -> ${testResponse.status} ${testResponse.statusText}`));
            
            if (testResponse.ok) {
              const testData = await testResponse.text();
              console.log(chalk.green(`  Response: ${testData.substring(0, 100)}...`));
            }
          } catch (error) {
            console.log(chalk.gray(`  ${baseUrl}${route} -> Error: ${error.message}`));
          }
        }
        
        // Now try the deployment endpoint
        const apiUrl = `${baseUrl}/frontend/deploy`;
        console.log(chalk.yellow(`Trying deployment endpoint: ${apiUrl}`));
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(deploymentRequest)
        });

        console.log(chalk.blue(`Deployment endpoint status: ${response.status}`));
        
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'No response body');
          console.log(chalk.red(`Response body: ${errorText}`));
          throw new Error(`API Gateway deployment failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        result = await response.json();
      }
      
      if (result.status === 'failed') {
        throw new Error(`Deployment failed: ${result.error?.message || 'Unknown error'}`);
      }

      console.log(`\n${chalk.green('Deployment successful!')}`);
      console.log(`${chalk.blue('Deployment ID:')} ${result.deploymentId}`);
      console.log(`${chalk.blue('S3 Bucket:')} ${result.s3BucketName}`);
      console.log(`${chalk.blue('CloudFront URL:')} ${result.cloudFrontUrl}`);
      if (result.customDomainUrl) {
        console.log(`${chalk.blue('Custom Domain:')} ${result.customDomainUrl}`);
      }
      
      this.spinner.succeed('Deployed to AWS successfully');
    } catch (error) {
      this.spinner.fail('AWS deployment failed');
      console.log(chalk.red(`Error details: ${error instanceof Error ? error.message : 'Unknown error'}`));
      throw error;
    }
  }
}

// CLI Configuration
const program = new Command();

program
  .name('deploy-frontend')
  .description('Deploy the frontend application to AWS')
  .version('1.0.0');

program
  .option('-e, --env <environment>', 'Target environment (development, staging, production)', 'development')
  .option('--skip-validation', 'Skip comprehensive deployment validation (backend, security, environment isolation)')
  .option('--skip-confirmation', 'Skip deployment confirmation prompts')
  .option('--auto-approve', 'Automatically approve deployment (use with caution)')
  .option('--skip-linting', 'Skip ESLint checks during build')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options: any) => {
    console.log('CLI options received:', options);
    console.log('skipValidation:', options.skipValidation);
    
    const deployer = new FrontendDeployer({
      environment: options.env,
      skipValidation: options.skipValidation,
      skipConfirmation: options.skipConfirmation,
      autoApprove: options.autoApprove,
      verbose: options.verbose,
      skipLinting: options.skipLinting
    });

    const result = await deployer.deploy();
    
    // Display deployment summary
    DeploymentConfirmation.displayDeploymentSummary(options.env, result.success);
    
    if (!result.success) {
      // Prompt for rollback if deployment failed
      const shouldRollback = await DeploymentConfirmation.promptForRollback(options.env);
      if (shouldRollback) {
        console.log(chalk.yellow('Please run the rollback script manually: npm run rollback:frontend'));
      }
      process.exit(1);
    }
  });

// Handle direct execution - force parsing for tsx compatibility
program.parse();

export { FrontendDeployer, type DeploymentOptions, type DeploymentResult };