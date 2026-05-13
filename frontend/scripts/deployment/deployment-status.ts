#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import { readEnvironmentConfig } from './configure-environment.js';
import { quickValidationCheck } from './validate-backend.js';
import { getBuildStats } from './build-frontend.js';
import { existsSync } from 'fs';
import path from 'path';

interface StatusOptions {
  environment: string;
  verbose?: boolean;
  json?: boolean;
}

interface DeploymentStatus {
  environment: string;
  timestamp: string;
  frontend: {
    configured: boolean;
    built: boolean;
    buildStats?: any;
    lastBuild?: string;
  };
  backend: {
    available: boolean;
    hasCredentials: boolean;
    validated: boolean;
  };
  aws: {
    cliAvailable: boolean;
    region?: string;
    profile?: string;
  };
  deployment: {
    ready: boolean;
    issues: string[];
    warnings: string[];
  };
}

class DeploymentStatusChecker {
  private options: StatusOptions;

  constructor(options: StatusOptions) {
    this.options = options;
  }

  async checkStatus(): Promise<DeploymentStatus> {
    const status: DeploymentStatus = {
      environment: this.options.environment,
      timestamp: new Date().toISOString(),
      frontend: {
        configured: false,
        built: false
      },
      backend: {
        available: false,
        hasCredentials: false,
        validated: false
      },
      aws: {
        cliAvailable: false
      },
      deployment: {
        ready: false,
        issues: [],
        warnings: []
      }
    };

    // Check frontend status
    await this.checkFrontendStatus(status);

    // Check backend status
    await this.checkBackendStatus(status);

    // Check AWS status
    await this.checkAWSStatus(status);

    // Determine overall deployment readiness
    this.determineDeploymentReadiness(status);

    return status;
  }

  private async checkFrontendStatus(status: DeploymentStatus): Promise<void> {
    try {
      // Check if environment is configured
      const envConfig = readEnvironmentConfig(this.options.environment);
      status.frontend.configured = envConfig !== null;

      // Check if build exists
      const frontendDir = process.cwd();
      const buildPath = path.join(frontendDir, 'dist');
      status.frontend.built = existsSync(buildPath);

      if (status.frontend.built) {
        try {
          status.frontend.buildStats = getBuildStats(buildPath);
          
          // Get build timestamp from dist directory
          const distStats = require('fs').statSync(buildPath);
          status.frontend.lastBuild = distStats.mtime.toISOString();
        } catch (error) {
          // Ignore errors when getting build stats
        }
      }

    } catch (error) {
      status.deployment.issues.push(`Frontend status check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async checkBackendStatus(status: DeploymentStatus): Promise<void> {
    try {
      const validation = await quickValidationCheck(this.options.environment);
      
      status.backend.available = validation.hasBackendDeployment;
      status.backend.hasCredentials = validation.hasCredentials;
      status.backend.validated = validation.hasBackendDeployment && validation.hasCredentials;

      if (!validation.hasBackendDeployment) {
        status.deployment.issues.push(`Backend deployment not found for ${this.options.environment} environment`);
      }

      if (!validation.hasCredentials) {
        status.deployment.issues.push('AWS credentials not configured');
      }

    } catch (error) {
      status.deployment.issues.push(`Backend validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async checkAWSStatus(status: DeploymentStatus): Promise<void> {
    try {
      const { checkAWSCLI, getAWSConfig } = await import('./backend-integration.js');
      
      status.aws.cliAvailable = checkAWSCLI();
      
      if (status.aws.cliAvailable) {
        const awsConfig = getAWSConfig();
        status.aws.region = awsConfig.region;
        status.aws.profile = awsConfig.profile;
      } else {
        status.deployment.issues.push('AWS CLI not available');
      }

    } catch (error) {
      status.deployment.issues.push(`AWS status check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private determineDeploymentReadiness(status: DeploymentStatus): void {
    // Check for critical issues
    const criticalIssues = [
      !status.aws.cliAvailable,
      !status.backend.hasCredentials,
      !status.backend.available
    ];

    status.deployment.ready = !criticalIssues.some(issue => issue);

    // Add warnings for non-critical issues
    if (!status.frontend.configured) {
      status.deployment.warnings.push('Frontend environment not configured - will be configured during deployment');
    }

    if (!status.frontend.built) {
      status.deployment.warnings.push('Frontend not built - will be built during deployment');
    }

    if (status.frontend.built && status.frontend.buildStats) {
      const stats = status.frontend.buildStats;
      if (stats.totalSize > 10 * 1024 * 1024) { // 10MB
        status.deployment.warnings.push(`Large build size: ${(stats.totalSize / 1024 / 1024).toFixed(2)}MB`);
      }
    }
  }

  displayStatus(status: DeploymentStatus): void {
    if (this.options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    console.log(chalk.blue.bold(`📊 Deployment Status for ${status.environment} environment`));
    console.log(chalk.gray(`Checked at: ${new Date(status.timestamp).toLocaleString()}`));
    console.log('');

    // Frontend Status
    console.log(chalk.cyan.bold('Frontend:'));
    console.log(`  Environment configured: ${this.getStatusIcon(status.frontend.configured)} ${status.frontend.configured ? 'Yes' : 'No'}`);
    console.log(`  Build available: ${this.getStatusIcon(status.frontend.built)} ${status.frontend.built ? 'Yes' : 'No'}`);
    
    if (status.frontend.built && status.frontend.buildStats) {
      const stats = status.frontend.buildStats;
      console.log(`  Build size: ${(stats.totalSize / 1024 / 1024).toFixed(2)}MB (${stats.fileCount} files)`);
      console.log(`  Last build: ${status.frontend.lastBuild ? new Date(status.frontend.lastBuild).toLocaleString() : 'Unknown'}`);
    }
    console.log('');

    // Backend Status
    console.log(chalk.cyan.bold('Backend:'));
    console.log(`  Deployment available: ${this.getStatusIcon(status.backend.available)} ${status.backend.available ? 'Yes' : 'No'}`);
    console.log(`  AWS credentials: ${this.getStatusIcon(status.backend.hasCredentials)} ${status.backend.hasCredentials ? 'Configured' : 'Not configured'}`);
    console.log(`  Validation passed: ${this.getStatusIcon(status.backend.validated)} ${status.backend.validated ? 'Yes' : 'No'}`);
    console.log('');

    // AWS Status
    console.log(chalk.cyan.bold('AWS:'));
    console.log(`  CLI available: ${this.getStatusIcon(status.aws.cliAvailable)} ${status.aws.cliAvailable ? 'Yes' : 'No'}`);
    if (status.aws.region) {
      console.log(`  Region: ${status.aws.region}`);
    }
    if (status.aws.profile) {
      console.log(`  Profile: ${status.aws.profile}`);
    }
    console.log('');

    // Overall Status
    console.log(chalk.cyan.bold('Deployment Readiness:'));
    console.log(`  Ready to deploy: ${this.getStatusIcon(status.deployment.ready)} ${status.deployment.ready ? 'Yes' : 'No'}`);
    console.log('');

    // Issues
    if (status.deployment.issues.length > 0) {
      console.log(chalk.red.bold('❌ Issues:'));
      for (const issue of status.deployment.issues) {
        console.log(chalk.red(`  • ${issue}`));
      }
      console.log('');
    }

    // Warnings
    if (status.deployment.warnings.length > 0) {
      console.log(chalk.yellow.bold('⚠️  Warnings:'));
      for (const warning of status.deployment.warnings) {
        console.log(chalk.yellow(`  • ${warning}`));
      }
      console.log('');
    }

    // Summary
    if (status.deployment.ready) {
      console.log(chalk.green.bold('✅ Ready to deploy! Run: npm run deploy:frontend'));
    } else {
      console.log(chalk.red.bold('❌ Not ready to deploy. Please address the issues above.'));
    }
  }

  private getStatusIcon(status: boolean): string {
    return status ? chalk.green('✓') : chalk.red('✗');
  }
}

// CLI Configuration
program
  .name('deployment-status')
  .description('Check the current deployment status')
  .version('1.0.0');

program
  .option('-e, --env <environment>', 'Target environment (development, staging, production)', 'development')
  .option('-v, --verbose', 'Enable verbose output')
  .option('--json', 'Output status as JSON')
  .action(async (options) => {
    const checker = new DeploymentStatusChecker({
      environment: options.env,
      verbose: options.verbose,
      json: options.json
    });

    const status = await checker.checkStatus();
    checker.displayStatus(status);
    
    if (!status.deployment.ready) {
      process.exit(1);
    }
  });

// Handle direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}

export { DeploymentStatusChecker, type StatusOptions, type DeploymentStatus };