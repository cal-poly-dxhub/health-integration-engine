#!/usr/bin/env node

import { execSync } from 'child_process';
import chalk from 'chalk';

async function invalidateCloudFront() {
  try {
    const region = execSync('aws configure get region', { stdio: 'pipe' }).toString().trim() || 'us-east-1';
    const environment = process.env.NODE_ENV || 'production';
    const stackName = `WorkflowBuilderFrontend-${environment}`;

    console.log(chalk.blue(`🔍 Getting CloudFront distribution ID from stack: ${stackName}`));

    // Get CloudFront distribution ID from CDK outputs
    const outputsResult = execSync(`aws cloudformation describe-stacks --stack-name ${stackName} --query "Stacks[0].Outputs" --output json --region ${region}`, {
      stdio: 'pipe'
    });
    
    const outputs = JSON.parse(outputsResult.toString());
    console.log(chalk.gray('Stack outputs:'));
    outputs.forEach((output: any) => {
      console.log(chalk.gray(`  ${output.OutputKey}: ${output.OutputValue}`));
    });

    const distributionIdOutput = outputs.find((output: any) => output.OutputKey === 'FrontendDistributionId');
    const distributionUrlOutput = outputs.find((output: any) => output.OutputKey === 'FrontendUrl');
    
    if (distributionIdOutput) {
      const distributionId = distributionIdOutput.OutputValue;
      console.log(chalk.blue(`🔄 Invalidating CloudFront cache: ${distributionId}`));
      
      const invalidationResult = execSync(`aws cloudfront create-invalidation --distribution-id ${distributionId} --paths "/*" --region ${region}`, {
        stdio: 'pipe'
      });
      
      const invalidation = JSON.parse(invalidationResult.toString());
      console.log(chalk.green(`✅ Invalidation created: ${invalidation.Invalidation.Id}`));
      
      if (distributionUrlOutput) {
        console.log(chalk.blue(`🌐 Your app URL: ${distributionUrlOutput.OutputValue}`));
        console.log(chalk.yellow('⏳ Cache invalidation may take 5-15 minutes to complete'));
      }
    } else {
      console.log(chalk.red('❌ Could not find CloudFront distribution ID in stack outputs'));
    }

  } catch (error) {
    console.error(chalk.red('❌ Error invalidating CloudFront cache:'));
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
  }
}

invalidateCloudFront();