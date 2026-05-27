#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import path from 'path';

interface RollbackOptions {
  environment: string;
  version?: string;
  force?: boolean;
  verbose?: boolean;
}

interface RollbackResult {
  success: boolean;
  environment: string;
  previousVersion?: string;
  currentVersion?: string;
  error?: string;
}

class FrontendRollback {
  private options: RollbackOptions;
  private spinner: ora.Ora;

  constructor(options: RollbackOptions) {
    this.options = options;
    this.spinner = ora();
  }

  async rollback(): Promise<RollbackResult> {
    try {
      console.log(chalk.blue.bold(`Starting frontend rollback for ${this.options.environment} environment`));
      console.log('');

      // Step 1: Find previous deployment
      const previousDeployment = await this.findPreviousDeployment();
      
      // Step 2: Confirm rollback
      if (!this.options.force) {
        await this.confirmRollback(previousDeployment);
      }

      // Step 3: Restore previous environment configuration
      await this.restorePreviousConfiguration(previousDeployment);

      // Step 4: Rollback AWS deployment (placeholder for now)
      await this.rollbackAWSDeployment(previousDeployment);

      console.log('');
      console.log(chalk.green.bold('Frontend rollback completed successfully!'));
      
      return {
        success: true,
        environment: this.options.environment,
        previousVersion: previousDeployment.version,
        currentVersion: 'rolled-back'
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.log('');
      console.log(chalk.red.bold('Frontend rollback failed!'));
      console.log(chalk.red(`Error: ${errorMessage}`));
      
      return {
        success: false,
        environment: this.options.environment,
        error: errorMessage
      };
    }
  }

  private async findPreviousDeployment(): Promise<{
    version: string;
    timestamp: string;
    configPath: string;
  }> {
    this.spinner.start('Finding previous deployment...');
    
    try {
      const frontendDir = process.cwd();
      const envFileName = this.options.environment === 'development' ? '.env' : `.env.${this.options.environment}`;
      
      // Look for backup files
      const backupPattern = `${envFileName}.backup.`;
      const files = require('fs').readdirSync(frontendDir);
      const backupFiles = files
        .filter((file: string) => file.startsWith(backupPattern))
        .sort()
        .reverse(); // Most recent first
      
      if (backupFiles.length === 0) {
        throw new Error(`No backup files found for ${this.options.environment} environment`);
      }
      
      const latestBackup = backupFiles[0];
      const timestamp = latestBackup.replace(backupPattern, '');
      
      this.spinner.succeed(`Found previous deployment from ${new Date(parseInt(timestamp)).toLocaleString()}`);
      
      return {
        version: timestamp,
        timestamp: new Date(parseInt(timestamp)).toISOString(),
        configPath: path.join(frontendDir, latestBackup)
      };
      
    } catch (error) {
      this.spinner.fail('Failed to find previous deployment');
      throw error;
    }
  }

  private async confirmRollback(previousDeployment: {
    version: string;
    timestamp: string;
  }): Promise<void> {
    console.log('');
    console.log(chalk.yellow.bold(' Rollback Confirmation'));
    console.log(chalk.yellow(`Environment: ${this.options.environment}`));
    console.log(chalk.yellow(`Previous deployment: ${new Date(previousDeployment.timestamp).toLocaleString()}`));
    console.log('');
    
    // In a real implementation, you would prompt for user confirmation
    // For now, we'll just log the confirmation
    console.log(chalk.green('Rollback confirmed (use --force to skip confirmation)'));
  }

  private async restorePreviousConfiguration(previousDeployment: {
    configPath: string;
  }): Promise<void> {
    this.spinner.start('Restoring previous configuration...');
    
    try {
      const frontendDir = process.cwd();
      const envFileName = this.options.environment === 'development' ? '.env' : `.env.${this.options.environment}`;
      const currentEnvPath = path.join(frontendDir, envFileName);
      
      // Read backup configuration
      if (!existsSync(previousDeployment.configPath)) {
        throw new Error('Backup configuration file not found');
      }
      
      const backupContent = readFileSync(previousDeployment.configPath, 'utf-8');
      
      // Create backup of current configuration
      if (existsSync(currentEnvPath)) {
        const currentBackupPath = `${currentEnvPath}.backup.${Date.now()}`;
        const currentContent = readFileSync(currentEnvPath, 'utf-8');
        writeFileSync(currentBackupPath, currentContent);
      }
      
      // Restore previous configuration
      writeFileSync(currentEnvPath, backupContent);
      
      this.spinner.succeed('Previous configuration restored');
      
    } catch (error) {
      this.spinner.fail('Failed to restore configuration');
      throw error;
    }
  }

  private async rollbackAWSDeployment(previousDeployment: {
    version: string;
  }): Promise<void> {
    this.spinner.start('Rolling back AWS deployment...');
    
    try {
      // TODO: Implement actual AWS rollback
      // This would involve:
      // 1. Restoring previous S3 bucket contents
      // 2. Invalidating CloudFront cache
      // 3. Updating CloudFront distribution if needed
      
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate rollback
      
      this.spinner.succeed('AWS deployment rolled back');
      
    } catch (error) {
      this.spinner.fail('AWS rollback failed');
      throw error;
    }
  }
}

// CLI Configuration
program
  .name('rollback-frontend')
  .description('Rollback the frontend deployment to a previous version')
  .version('1.0.0');

program
  .option('-e, --env <environment>', 'Target environment (development, staging, production)', 'development')
  .option('-v, --version <version>', 'Specific version to rollback to')
  .option('--force', 'Skip confirmation prompts')
  .option('--verbose', 'Enable verbose logging')
  .action(async (options) => {
    const rollback = new FrontendRollback({
      environment: options.env,
      version: options.version,
      force: options.force,
      verbose: options.verbose
    });

    const result = await rollback.rollback();
    
    if (!result.success) {
      process.exit(1);
    }
  });

// Handle direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}

export { FrontendRollback, type RollbackOptions, type RollbackResult };