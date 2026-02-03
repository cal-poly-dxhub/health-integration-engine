#!/usr/bin/env node

import { execSync } from 'child_process';
import chalk from 'chalk';

async function checkS3Bucket() {
  try {
    // Get AWS account ID and region
    const accountId = execSync('aws sts get-caller-identity --query Account --output text', { stdio: 'pipe' }).toString().trim();
    const region = execSync('aws configure get region', { stdio: 'pipe' }).toString().trim() || 'us-east-1';
    const environment = process.env.NODE_ENV || 'production';

    const bucketName = `workflow-builder-frontend-${environment}-${accountId}`;
    
    console.log(chalk.blue(`🔍 Checking S3 bucket: ${bucketName}`));
    console.log(chalk.gray(`Region: ${region}`));
    
    // List bucket contents
    const result = execSync(`aws s3 ls s3://${bucketName} --recursive --region ${region}`, {
      stdio: 'pipe'
    });
    
    const files = result.toString().trim();
    
    if (files) {
      console.log(chalk.green('✅ Files found in bucket:'));
      console.log(files);
    } else {
      console.log(chalk.yellow('⚠️ No files found in bucket'));
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Error checking bucket:'));
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
  }
}

checkS3Bucket();