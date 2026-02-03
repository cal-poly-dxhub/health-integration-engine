#!/usr/bin/env node

import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join } from 'path';

interface DeploymentConfirmationOptions {
  environment: string;
  skipConfirmation?: boolean;
  autoApprove?: boolean;
}

interface DeploymentRisk {
  level: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  mitigation?: string;
}

interface DeploymentImpact {
  userFacing: boolean;
  dataChanges: boolean;
  serviceInterruption: boolean;
  rollbackComplexity: 'simple' | 'moderate' | 'complex';
  estimatedDowntime: string;
}

export class DeploymentConfirmation {
  private static readonly ENVIRONMENT_RISKS: Record<string, DeploymentRisk[]> = {
    development: [
      {
        level: 'low',
        description: 'Development environment deployment',
        mitigation: 'Limited impact, suitable for testing'
      }
    ],
    staging: [
      {
        level: 'medium',
        description: 'Staging environment deployment',
        mitigation: 'Pre-production testing environment'
      },
      {
        level: 'medium',
        description: 'May affect integration testing',
        mitigation: 'Coordinate with QA team'
      }
    ],
    production: [
      {
        level: 'critical',
        description: 'Production environment deployment',
        mitigation: 'Affects live users and systems'
      },
      {
        level: 'high',
        description: 'Potential service interruption',
        mitigation: 'Monitor deployment closely'
      },
      {
        level: 'high',
        description: 'CloudFront cache invalidation required',
        mitigation: 'Users may see cached content temporarily'
      },
      {
        level: 'medium',
        description: 'S3 bucket updates may cause brief unavailability',
        mitigation: 'Deployment is atomic where possible'
      }
    ]
  };

  private static readonly DEPLOYMENT_IMPACTS: Record<string, DeploymentImpact> = {
    development: {
      userFacing: false,
      dataChanges: false,
      serviceInterruption: false,
      rollbackComplexity: 'simple',
      estimatedDowntime: '< 1 minute'
    },
    staging: {
      userFacing: false,
      dataChanges: false,
      serviceInterruption: true,
      rollbackComplexity: 'simple',
      estimatedDowntime: '2-3 minutes'
    },
    production: {
      userFacing: true,
      dataChanges: false,
      serviceInterruption: true,
      rollbackComplexity: 'moderate',
      estimatedDowntime: '3-5 minutes'
    }
  };

  static async confirmDeployment(options: DeploymentConfirmationOptions): Promise<boolean> {
    if (options.skipConfirmation || options.autoApprove) {
      console.log(chalk.yellow('⚠️  Deployment confirmation skipped'));
      return true;
    }

    const risks = this.ENVIRONMENT_RISKS[options.environment] || [];
    const impact = this.DEPLOYMENT_IMPACTS[options.environment];

    console.log('');
    console.log(chalk.cyan.bold('🚀 DEPLOYMENT CONFIRMATION'));
    console.log('');
    console.log(`Environment: ${chalk.bold(options.environment.toUpperCase())}`);
    console.log('');

    // Display deployment impact
    this.displayDeploymentImpact(impact);

    // Display risks
    this.displayDeploymentRisks(risks);

    // Display pre-deployment checklist
    this.displayPreDeploymentChecklist(options.environment);

    // Get confirmation
    return await this.getDeploymentConfirmation(options.environment);
  }

  private static displayDeploymentImpact(impact: DeploymentImpact): void {
    console.log(chalk.blue.bold('📊 Deployment Impact:'));
    console.log('');

    const yesNo = (value: boolean) => value ? chalk.red('Yes') : chalk.green('No');
    const complexityColor = (complexity: string) => {
      switch (complexity) {
        case 'simple': return chalk.green(complexity);
        case 'moderate': return chalk.yellow(complexity);
        case 'complex': return chalk.red(complexity);
        default: return chalk.gray(complexity);
      }
    };

    console.log(`  User-facing changes: ${yesNo(impact.userFacing)}`);
    console.log(`  Data changes: ${yesNo(impact.dataChanges)}`);
    console.log(`  Service interruption: ${yesNo(impact.serviceInterruption)}`);
    console.log(`  Rollback complexity: ${complexityColor(impact.rollbackComplexity)}`);
    console.log(`  Estimated downtime: ${chalk.cyan(impact.estimatedDowntime)}`);
    console.log('');
  }

  private static displayDeploymentRisks(risks: DeploymentRisk[]): void {
    if (risks.length === 0) return;

    console.log(chalk.yellow.bold('⚠️  Deployment Risks:'));
    console.log('');

    for (const risk of risks) {
      const levelColor = this.getRiskLevelColor(risk.level);
      console.log(`  ${levelColor(`[${risk.level.toUpperCase()}]`)} ${risk.description}`);
      if (risk.mitigation) {
        console.log(`    ${chalk.gray(`Mitigation: ${risk.mitigation}`)}`);
      }
    }
    console.log('');
  }

  private static displayPreDeploymentChecklist(environment: string): void {
    console.log(chalk.green.bold('✅ Pre-deployment Checklist:'));
    console.log('');

    const commonChecks = [
      'Backend deployment is validated and healthy',
      'Security validation has passed',
      'Environment isolation is confirmed',
      'AWS credentials and permissions are correct'
    ];

    const environmentChecks: Record<string, string[]> = {
      development: [
        'Development environment is ready for testing'
      ],
      staging: [
        'Changes have been tested locally',
        'QA team has been notified (if applicable)'
      ],
      production: [
        'All changes have been tested in staging',
        'Deployment has been approved by appropriate stakeholders',
        'Monitoring and alerting systems are active',
        'Rollback plan is prepared and understood',
        'Support team has been notified of the deployment'
      ]
    };

    const allChecks = [...commonChecks, ...(environmentChecks[environment] || [])];

    for (const check of allChecks) {
      console.log(`  ${chalk.green('□')} ${check}`);
    }
    console.log('');
  }

  private static async getDeploymentConfirmation(environment: string): Promise<boolean> {
    console.log(chalk.cyan.bold('🤔 Deployment Confirmation:'));
    console.log('');

    if (environment === 'production') {
      console.log(chalk.red.bold('⚠️  PRODUCTION DEPLOYMENT WARNING'));
      console.log(chalk.yellow('This deployment will affect the live production environment.'));
      console.log(chalk.yellow('Please ensure you have completed all pre-deployment checks.'));
      console.log('');
    }

    console.log(chalk.white('Do you want to proceed with this deployment?'));
    console.log('');
    console.log(chalk.gray('Options:'));
    console.log(chalk.gray('  y, yes - Proceed with deployment'));
    console.log(chalk.gray('  n, no  - Cancel deployment'));
    console.log(chalk.gray('  i, info - Show additional deployment information'));
    console.log('');

    // In a real implementation, you would use a proper prompt library like inquirer
    // For now, we'll simulate the confirmation process
    console.log(chalk.yellow('Interactive confirmation not implemented in this script.'));
    console.log(chalk.yellow('Assuming deployment is approved for demonstration purposes.'));
    console.log('');
    
    // Simulate user input based on environment
    const shouldProceed = environment !== 'production' || process.env.AUTO_APPROVE_PRODUCTION === 'true';
    
    if (shouldProceed) {
      console.log(chalk.green('✅ Deployment confirmed'));
    } else {
      console.log(chalk.red('❌ Deployment cancelled'));
    }
    
    return shouldProceed;
  }

  private static getRiskLevelColor(level: string): (text: string) => string {
    switch (level) {
      case 'low': return chalk.green;
      case 'medium': return chalk.yellow;
      case 'high': return chalk.red;
      case 'critical': return chalk.red.bold;
      default: return chalk.gray;
    }
  }

  static displayDeploymentSummary(environment: string, success: boolean): void {
    console.log('');
    console.log(chalk.cyan.bold('📋 Deployment Summary:'));
    console.log('');
    console.log(`Environment: ${chalk.bold(environment.toUpperCase())}`);
    console.log(`Status: ${success ? chalk.green.bold('SUCCESS') : chalk.red.bold('FAILED')}`);
    console.log(`Timestamp: ${chalk.gray(new Date().toISOString())}`);
    console.log('');

    if (success) {
      console.log(chalk.green.bold('🎉 Deployment completed successfully!'));
      
      if (environment === 'production') {
        console.log('');
        console.log(chalk.yellow.bold('📊 Post-deployment Actions:'));
        console.log(chalk.yellow('  • Monitor application metrics and logs'));
        console.log(chalk.yellow('  • Verify user-facing functionality'));
        console.log(chalk.yellow('  • Check CloudFront cache invalidation status'));
        console.log(chalk.yellow('  • Notify stakeholders of successful deployment'));
      }
    } else {
      console.log(chalk.red.bold('❌ Deployment failed!'));
      console.log('');
      console.log(chalk.yellow.bold('🔧 Next Steps:'));
      console.log(chalk.yellow('  • Review deployment logs for error details'));
      console.log(chalk.yellow('  • Check AWS CloudFormation stack status'));
      console.log(chalk.yellow('  • Verify AWS credentials and permissions'));
      console.log(chalk.yellow('  • Consider rolling back if necessary'));
    }
    
    console.log('');
  }

  static async promptForRollback(environment: string): Promise<boolean> {
    if (environment === 'development') {
      return false; // No rollback needed for development
    }

    console.log('');
    console.log(chalk.red.bold('🔄 ROLLBACK CONFIRMATION'));
    console.log('');
    console.log(chalk.yellow('The deployment has failed or encountered issues.'));
    console.log(chalk.yellow('Would you like to initiate a rollback?'));
    console.log('');

    // In a real implementation, you would use a proper prompt library
    console.log(chalk.yellow('Interactive rollback confirmation not implemented in this script.'));
    console.log(chalk.yellow('Please use the rollback script manually if needed.'));
    console.log('');

    return false; // Placeholder
  }
}

// Export types for use in other modules
export { type DeploymentConfirmationOptions, type DeploymentRisk, type DeploymentImpact };