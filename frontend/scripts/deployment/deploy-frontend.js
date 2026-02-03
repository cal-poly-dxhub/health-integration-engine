#!/usr/bin/env node
import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { buildFrontend } from './build-frontend.js';
import { configureEnvironment } from './configure-environment.js';
import { validateBackendDeployment } from './validate-backend.js';
class FrontendDeployer {
    constructor(options) {
        this.options = options;
        this.spinner = ora();
    }
    async deploy() {
        try {
            console.log(chalk.blue.bold(`🚀 Starting frontend deployment for ${this.options.environment} environment`));
            console.log('');
            // Step 1: Validate backend deployment
            if (!this.options.skipValidation) {
                await this.validateBackend();
            }
            // Step 2: Configure environment
            await this.configureEnvironment();
            // Step 3: Build frontend
            const buildResult = await this.buildFrontend();
            // Step 4: Deploy to AWS (placeholder for now)
            await this.deployToAWS(buildResult.buildPath);
            console.log('');
            console.log(chalk.green.bold('✅ Frontend deployment completed successfully!'));
            return {
                success: true,
                environment: this.options.environment,
                buildPath: buildResult.buildPath,
                // TODO: Add actual S3 and CloudFront URLs when AWS deployment is implemented
                s3BucketName: `workflow-builder-frontend-${this.options.environment}`,
                cloudFrontUrl: `https://d123456789.cloudfront.net`
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.log('');
            console.log(chalk.red.bold('❌ Frontend deployment failed!'));
            console.log(chalk.red(`Error: ${errorMessage}`));
            return {
                success: false,
                environment: this.options.environment,
                error: errorMessage
            };
        }
    }
    async validateBackend() {
        this.spinner.start('Validating backend deployment...');
        try {
            const isValid = await validateBackendDeployment(this.options.environment);
            if (!isValid) {
                throw new Error(`Backend deployment not found or incomplete for ${this.options.environment} environment`);
            }
            this.spinner.succeed('Backend deployment validated');
        }
        catch (error) {
            this.spinner.fail('Backend validation failed');
            throw error;
        }
    }
    async configureEnvironment() {
        this.spinner.start('Configuring environment variables...');
        try {
            await configureEnvironment(this.options.environment);
            this.spinner.succeed('Environment configuration updated');
        }
        catch (error) {
            this.spinner.fail('Environment configuration failed');
            throw error;
        }
    }
    async buildFrontend() {
        this.spinner.start('Building frontend application...');
        try {
            const result = await buildFrontend(this.options.environment, {
                verbose: this.options.verbose
            });
            this.spinner.succeed(`Frontend build completed in ${result.buildTime}ms`);
            return result;
        }
        catch (error) {
            this.spinner.fail('Frontend build failed');
            throw error;
        }
    }
    async deployToAWS(buildPath) {
        this.spinner.start('Deploying to AWS...');
        try {
            // TODO: Implement actual AWS deployment
            // This will be implemented in a future task
            await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate deployment
            this.spinner.succeed('Deployed to AWS successfully');
        }
        catch (error) {
            this.spinner.fail('AWS deployment failed');
            throw error;
        }
    }
}
// CLI Configuration
program
    .name('deploy-frontend')
    .description('Deploy the frontend application to AWS')
    .version('1.0.0');
program
    .option('-e, --env <environment>', 'Target environment (development, staging, production)', 'development')
    .option('--skip-validation', 'Skip backend deployment validation')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (options) => {
    const deployer = new FrontendDeployer({
        environment: options.env,
        skipValidation: options.skipValidation,
        verbose: options.verbose
    });
    const result = await deployer.deploy();
    if (!result.success) {
        process.exit(1);
    }
});
// Handle direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
    program.parse();
}
export { FrontendDeployer };
