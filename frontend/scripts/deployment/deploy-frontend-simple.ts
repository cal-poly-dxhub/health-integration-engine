#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';

console.log('Starting simple deployment script...');

interface DeploymentOptions {
  environment: string;
  skipValidation?: boolean;
  skipConfirmation?: boolean;
  autoApprove?: boolean;
  verbose?: boolean;
}

class SimpleFrontendDeployer {
  private options: DeploymentOptions;
  private spinner: Ora;

  constructor(options: DeploymentOptions) {
    this.options = options;
    this.spinner = ora();
    console.log(`Deployer initialized with options:`, options);
  }

  async deploy(): Promise<void> {
    try {
      console.log(chalk.blue.bold(`Starting frontend deployment for ${this.options.environment} environment`));
      
      // Step 1: Test backend integration
      console.log('Step 1: Testing backend integration...');
      await this.testBackendIntegration();
      
      // Step 2: Test deployment confirmation
      console.log('Step 2: Testing deployment confirmation...');
      await this.testDeploymentConfirmation();
      
      console.log(chalk.green.bold('Simple deployment test completed successfully!'));
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.log(chalk.red.bold('Simple deployment test failed!'));
      console.log(chalk.red(`Error: ${errorMessage}`));
      console.error('Full error:', error);
      throw error;
    }
  }

  private async testBackendIntegration(): Promise<void> {
    this.spinner.start('Testing backend integration...');
    
    try {
      const { getLatestDeploymentOutputs } = await import('./backend-integration.js');
      console.log('Backend integration module loaded');
      
      // Try to get backend outputs
      const backendOutputs = await getLatestDeploymentOutputs(this.options.environment);
      console.log('Backend outputs retrieved:', backendOutputs);
      
      this.spinner.succeed('Backend integration test completed');
    } catch (error) {
      this.spinner.fail('Backend integration test failed');
      console.log('Backend integration error:', error);
      // Don't throw here, just log the error
    }
  }

  private async testDeploymentConfirmation(): Promise<void> {
    this.spinner.start('Testing deployment confirmation...');
    
    try {
      const { DeploymentConfirmation } = await import('./deployment-confirmation.js');
      console.log('DeploymentConfirmation module loaded');
      
      // Test confirmation with auto-approve
      const confirmed = await DeploymentConfirmation.confirmDeployment({
        environment: this.options.environment,
        skipConfirmation: true, // Skip for testing
        autoApprove: true
      });
      
      console.log('Deployment confirmation result:', confirmed);
      
      this.spinner.succeed('Deployment confirmation test completed');
    } catch (error) {
      this.spinner.fail('Deployment confirmation test failed');
      console.log('Deployment confirmation error:', error);
      throw error;
    }
  }
}

// CLI Configuration
const program = new Command();

program
  .name('deploy-frontend-simple')
  .description('Simple test deployment script')
  .version('1.0.0');

program
  .option('-e, --env <environment>', 'Target environment (development, staging, production)', 'production')
  .option('--skip-validation', 'Skip comprehensive deployment validation')
  .option('--skip-confirmation', 'Skip deployment confirmation prompts')
  .option('--auto-approve', 'Automatically approve deployment')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options: any) => {
    console.log('Command action triggered with options:', options);
    
    try {
      const deployer = new SimpleFrontendDeployer({
        environment: options.env,
        skipValidation: options.skipValidation,
        skipConfirmation: options.skipConfirmation,
        autoApprove: options.autoApprove,
        verbose: options.verbose
      });

      await deployer.deploy();
      console.log('Deployment completed successfully');
      
    } catch (error) {
      console.error('Deployment failed:', error);
      process.exit(1);
    }
  });

console.log('About to parse command line arguments...');
console.log('Process argv:', process.argv);

// Handle direct execution
console.log('import.meta.url:', import.meta.url);
console.log('process.argv[1]:', process.argv[1]);
console.log('file URL:', `file://${process.argv[1]}`);

// Force execution for testing
console.log('Forcing script execution...');
program.parse();

console.log('Script setup completed');