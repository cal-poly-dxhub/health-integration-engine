#!/usr/bin/env node

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';

interface DeploymentConfig {
  environment: string;
  accountId: string;
  region: string;
}

async function deployFrontendFiles() {
  try {
    console.log(chalk.blue.bold('🚀 Deploying frontend files to S3...'));

    // Get AWS account ID and region
    const accountId = execSync('aws sts get-caller-identity --query Account --output text', { stdio: 'pipe' }).toString().trim();
    const region = execSync('aws configure get region', { stdio: 'pipe' }).toString().trim() || 'us-east-1';
    const environment = process.env.NODE_ENV || 'production';

    const config: DeploymentConfig = {
      environment,
      accountId,
      region
    };

    console.log(chalk.gray(`Environment: ${config.environment}`));
    console.log(chalk.gray(`Account ID: ${config.accountId}`));
    console.log(chalk.gray(`Region: ${config.region}`));

    // Build frontend if dist doesn't exist
    const frontendDir = path.resolve(__dirname, '../../frontend');
    const distDir = path.join(frontendDir, 'dist');

    if (!fs.existsSync(distDir)) {
      console.log(chalk.yellow('📦 Building frontend...'));
      execSync('npm run build', { cwd: frontendDir, stdio: 'inherit' });
    }

    // Sync files to S3
    const bucketName = `workflow-builder-frontend-${config.environment}-${config.accountId}`;
    console.log(chalk.blue(`📤 Uploading files to S3 bucket: ${bucketName}`));

    execSync(`aws s3 sync "${distDir}" s3://${bucketName} --delete --region ${config.region}`, {
      stdio: 'inherit'
    });

    // Get CloudFront distribution ID from CDK outputs
    try {
      const stackName = `WorkflowBuilderFrontend-${config.environment}`;
      const outputsResult = execSync(`aws cloudformation describe-stacks --stack-name ${stackName} --query "Stacks[0].Outputs" --output json --region ${config.region}`, {
        stdio: 'pipe'
      });
      
      const outputs = JSON.parse(outputsResult.toString());
      const distributionIdOutput = outputs.find((output: any) => output.OutputKey === 'FrontendDistributionId');
      
      if (distributionIdOutput) {
        const distributionId = distributionIdOutput.OutputValue;
        console.log(chalk.blue(`🔄 Invalidating CloudFront cache: ${distributionId}`));
        
        execSync(`aws cloudfront create-invalidation --distribution-id ${distributionId} --paths "/*" --region ${config.region}`, {
          stdio: 'inherit'
        });
      }
    } catch (error) {
      console.log(chalk.yellow('⚠️ Could not invalidate CloudFront cache automatically'));
      console.log(chalk.gray('You can manually invalidate cache in AWS Console'));
    }

    console.log(chalk.green.bold('✅ Frontend deployment completed successfully!'));
    console.log(chalk.blue(`🌐 Your app should be available at the CloudFront URL from CDK outputs`));

  } catch (error) {
    console.error(chalk.red.bold('❌ Frontend deployment failed!'));
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  deployFrontendFiles();
}

export { deployFrontendFiles };