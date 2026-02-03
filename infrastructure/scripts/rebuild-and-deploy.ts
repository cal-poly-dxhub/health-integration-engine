#!/usr/bin/env node

import { execSync } from 'child_process';
import chalk from 'chalk';
import * as path from 'path';

async function rebuildAndDeploy() {
  try {
    console.log(chalk.blue.bold('🔄 Rebuilding and redeploying frontend...'));

    const frontendDir = path.resolve(__dirname, '../../frontend');
    const infraDir = path.resolve(__dirname, '..');

    // Step 1: Clean and rebuild frontend
    console.log(chalk.blue('📦 Cleaning and rebuilding frontend...'));
    execSync('npm run build', { cwd: frontendDir, stdio: 'inherit' });

    // Step 2: Redeploy CDK stack (this will update the S3 bucket)
    console.log(chalk.blue('🚀 Redeploying CDK stack...'));
    execSync('npm run deploy:frontend:prod', { cwd: infraDir, stdio: 'inherit' });

    // Step 3: Invalidate CloudFront cache
    console.log(chalk.blue('🔄 Invalidating CloudFront cache...'));
    execSync('npm run invalidate-cache', { cwd: infraDir, stdio: 'inherit' });

    console.log(chalk.green.bold('✅ Rebuild and deployment completed!'));
    console.log(chalk.yellow('⏳ Cache invalidation may take 5-15 minutes to complete'));

  } catch (error) {
    console.error(chalk.red.bold('❌ Rebuild and deployment failed!'));
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
    process.exit(1);
  }
}

rebuildAndDeploy();