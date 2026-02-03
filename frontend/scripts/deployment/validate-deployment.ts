#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import { validateBackendDeployment } from './validate-backend.js';
import { validateEnvironmentConfig, readEnvironmentConfig } from './configure-environment.js';
import { SecurityValidator } from './security-validator.js';

interface ValidationOptions {
  environment: string;
  skipBackend?: boolean;
  skipFrontend?: boolean;
  verbose?: boolean;
}

interface ValidationResult {
  success: boolean;
  environment: string;
  checks: {
    backend: boolean;
    frontend: boolean;
    environment: boolean;
    security: boolean;
  };
  errors: string[];
  warnings: string[];
}

class DeploymentValidator {
  private options: ValidationOptions;

  constructor(options: ValidationOptions) {
    this.options = options;
  }

  async validate(): Promise<ValidationResult> {
    const result: ValidationResult = {
      success: false,
      environment: this.options.environment,
      checks: {
        backend: false,
        frontend: false,
        environment: false,
        security: false
      },
      errors: [],
      warnings: []
    };

    console.log(chalk.blue.bold(`🔍 Validating deployment for ${this.options.environment} environment`));
    console.log('');

    try {
      // Validate backend deployment
      if (!this.options.skipBackend) {
        result.checks.backend = await this.validateBackend(result);
      } else {
        result.checks.backend = true;
        result.warnings.push('Backend validation skipped');
      }

      // Validate frontend configuration
      if (!this.options.skipFrontend) {
        result.checks.environment = await this.validateFrontendConfig(result);
      } else {
        result.checks.environment = true;
        result.warnings.push('Frontend configuration validation skipped');
      }

      // Validate security requirements
      result.checks.security = await this.validateSecurity(result);

      // Overall validation
      result.success = result.checks.backend && result.checks.environment && result.checks.security;

      this.displayResults(result);

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Validation failed: ${errorMessage}`);
      result.success = false;

      this.displayResults(result);
      return result;
    }
  }

  private async validateBackend(result: ValidationResult): Promise<boolean> {
    try {
      console.log(chalk.yellow('Validating backend deployment...'));
      
      const isValid = await validateBackendDeployment(this.options.environment);
      
      if (isValid) {
        console.log(chalk.green('✓ Backend deployment validation passed'));
        return true;
      } else {
        result.errors.push('Backend deployment validation failed');
        return false;
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Backend validation error: ${errorMessage}`);
      return false;
    }
  }

  private async validateFrontendConfig(result: ValidationResult): Promise<boolean> {
    try {
      console.log(chalk.yellow('Validating frontend configuration...'));
      
      // Read existing environment configuration
      const envConfig = readEnvironmentConfig(this.options.environment);
      
      if (!envConfig) {
        result.warnings.push('Frontend environment not configured - will be configured during deployment');
        return true; // Not an error, just needs configuration
      }

      // Validate configuration
      const validation = validateEnvironmentConfig(envConfig);
      
      if (validation.errors.length > 0) {
        result.errors.push(...validation.errors.map(error => `Frontend config: ${error}`));
      }

      if (validation.warnings.length > 0) {
        result.warnings.push(...validation.warnings.map(warning => `Frontend config: ${warning}`));
      }

      if (validation.isValid) {
        console.log(chalk.green('✓ Frontend configuration validation passed'));
        return true;
      } else {
        console.log(chalk.red('✗ Frontend configuration validation failed'));
        return false;
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Frontend validation error: ${errorMessage}`);
      return false;
    }
  }

  private async validateSecurity(result: ValidationResult): Promise<boolean> {
    try {
      console.log(chalk.yellow('Validating security requirements...'));
      
      const securityResult = await SecurityValidator.validateDeploymentSecurity(this.options.environment);
      
      if (securityResult.errors.length > 0) {
        result.errors.push(...securityResult.errors.map(error => `Security: ${error}`));
      }

      if (securityResult.warnings.length > 0) {
        result.warnings.push(...securityResult.warnings.map(warning => `Security: ${warning}`));
      }

      if (securityResult.isValid) {
        console.log(chalk.green('✓ Security validation passed'));
        
        // Check if production approval is required
        if (this.options.environment === 'production') {
          const approved = await SecurityValidator.promptForProductionApproval(this.options.environment);
          if (!approved) {
            result.errors.push('Production deployment not approved');
            return false;
          }
        }
        
        return true;
      } else {
        console.log(chalk.red('✗ Security validation failed'));
        return false;
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Security validation error: ${errorMessage}`);
      return false;
    }
  }

  private displayResults(result: ValidationResult): void {
    console.log('');
    console.log(chalk.cyan.bold('📋 Validation Results:'));
    console.log('');

    // Display check results
    console.log(`Backend deployment: ${this.getCheckIcon(result.checks.backend)} ${result.checks.backend ? 'Valid' : 'Invalid'}`);
    console.log(`Frontend configuration: ${this.getCheckIcon(result.checks.environment)} ${result.checks.environment ? 'Valid' : 'Invalid'}`);
    console.log(`Security requirements: ${this.getCheckIcon(result.checks.security)} ${result.checks.security ? 'Valid' : 'Invalid'}`);
    console.log('');

    // Display errors
    if (result.errors.length > 0) {
      console.log(chalk.red.bold('❌ Errors:'));
      for (const error of result.errors) {
        console.log(chalk.red(`  • ${error}`));
      }
      console.log('');
    }

    // Display warnings
    if (result.warnings.length > 0) {
      console.log(chalk.yellow.bold('⚠️  Warnings:'));
      for (const warning of result.warnings) {
        console.log(chalk.yellow(`  • ${warning}`));
      }
      console.log('');
    }

    // Display final result
    if (result.success) {
      console.log(chalk.green.bold('✅ Validation passed! Deployment is ready.'));
    } else {
      console.log(chalk.red.bold('❌ Validation failed! Please address the errors above.'));
    }

    console.log('');
  }

  private getCheckIcon(passed: boolean): string {
    return passed ? chalk.green('✓') : chalk.red('✗');
  }
}

// CLI Configuration
program
  .name('validate-deployment')
  .description('Validate deployment readiness')
  .version('1.0.0');

program
  .option('-e, --env <environment>', 'Target environment (development, staging, production)', 'development')
  .option('--skip-backend', 'Skip backend deployment validation')
  .option('--skip-frontend', 'Skip frontend configuration validation')
  .option('-v, --verbose', 'Enable verbose output')
  .action(async (options) => {
    const validator = new DeploymentValidator({
      environment: options.env,
      skipBackend: options.skipBackend,
      skipFrontend: options.skipFrontend,
      verbose: options.verbose
    });

    const result = await validator.validate();
    
    if (!result.success) {
      process.exit(1);
    }
  });

// Handle direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}

export { DeploymentValidator, type ValidationOptions, type ValidationResult };