#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface DeploymentOptions {
  environment: string;
  bucketName?: string;
  distributionId?: string;
  region?: string;
  verbose?: boolean;
}

interface DeploymentResult {
  success: boolean;
  environment: string;
  buildPath?: string;
  s3BucketName?: string;
  cloudFrontUrl?: string;
  error?: string;
}

class DirectFrontendDeployer {
  private options: DeploymentOptions;
  private spinner: Ora;

  constructor(options: DeploymentOptions) {
    this.options = options;
    this.spinner = ora();
  }

  async deploy(): Promise<DeploymentResult> {
    try {
      console.log(chalk.blue.bold(`🚀 Starting direct frontend deployment for ${this.options.environment} environment`));
      console.log('');

      // Step 1: Build frontend
      const buildPath = await this.buildFrontend();

      // Step 2: Deploy to S3
      const s3BucketName = await this.deployToS3(buildPath);

      // Step 3: Create or update CloudFront distribution
      const cloudFrontUrl = await this.setupCloudFront(s3BucketName);

      console.log('');
      console.log(chalk.green.bold('✅ Frontend deployment completed successfully!'));
      console.log(chalk.blue(`S3 Bucket: ${s3BucketName}`));
      if (cloudFrontUrl) {
        console.log(chalk.blue(`CloudFront URL: ${cloudFrontUrl}`));
      }
      
      return {
        success: true,
        environment: this.options.environment,
        buildPath,
        s3BucketName,
        cloudFrontUrl
      };

    } catch (error) {
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

  private async buildFrontend(): Promise<string> {
    this.spinner.start('Building frontend application...');
    
    try {
      // Determine the correct frontend directory
      let frontendDir = process.cwd();
      
      // If we're in the project root, go to frontend subdirectory
      if (fs.existsSync(path.join(process.cwd(), 'frontend'))) {
        frontendDir = path.join(process.cwd(), 'frontend');
      }
      // If we're already in frontend directory, use current directory
      else if (fs.existsSync(path.join(process.cwd(), 'package.json'))) {
        const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
        if (packageJson.name === 'aws-stepfunctions-workflow-builder-frontend') {
          frontendDir = process.cwd();
        }
      }

      if (this.options.verbose) {
        console.log(chalk.gray(`Using frontend directory: ${frontendDir}`));
      }

      // Verify package.json exists
      if (!fs.existsSync(path.join(frontendDir, 'package.json'))) {
        throw new Error('package.json not found. Please run this script from the frontend directory or project root.');
      }

      // Run build command
      execSync('npm run build', { 
        cwd: frontendDir, 
        stdio: this.options.verbose ? 'inherit' : 'pipe' 
      });

      const buildPath = path.join(frontendDir, 'dist');
      
      if (!fs.existsSync(buildPath)) {
        throw new Error('Build directory not found. Build may have failed.');
      }

      this.spinner.succeed('Frontend build completed');
      return buildPath;
    } catch (error) {
      this.spinner.fail('Frontend build failed');
      throw error;
    }
  }

  private async deployToS3(buildPath: string): Promise<string> {
    this.spinner.start('Uploading to S3...');
    
    try {
      // Determine bucket name with account ID for global uniqueness
      let bucketName = this.options.bucketName;
      
      if (!bucketName) {
        // Try to get AWS account ID
        let accountId = '';
        try {
          const stsResult = execSync('aws sts get-caller-identity --query Account --output text', { stdio: 'pipe' });
          accountId = stsResult.toString().trim();
        } catch {
          // If we can't get account ID, use a random suffix
          accountId = Math.random().toString(36).substring(2, 8);
        }
        
        bucketName = `workflow-builder-frontend-${this.options.environment}-${accountId}`;
      }
      
      // Check if AWS CLI is available
      try {
        execSync('aws --version', { stdio: 'pipe' });
      } catch {
        throw new Error('AWS CLI not found. Please install AWS CLI and configure your credentials.');
      }

      // Check if bucket exists, create if it doesn't
      this.spinner.text = 'Checking S3 bucket...';
      
      try {
        execSync(`aws s3 ls s3://${bucketName}`, { stdio: 'pipe' });
        if (this.options.verbose) {
          console.log(chalk.gray(`Bucket ${bucketName} exists`));
        }
      } catch {
        // Bucket doesn't exist, create it
        this.spinner.text = 'Creating S3 bucket...';
        
        if (this.options.verbose) {
          console.log(chalk.gray(`Creating bucket: ${bucketName}`));
        }

        // Create bucket
        execSync(`aws s3 mb s3://${bucketName}`, { 
          stdio: this.options.verbose ? 'inherit' : 'pipe' 
        });

        // Configure bucket for static website hosting
        const websiteConfig = {
          IndexDocument: { Suffix: 'index.html' },
          ErrorDocument: { Key: 'index.html' }
        };

        // Write website config to temporary file to avoid Windows command line JSON issues
        const websiteConfigFile = path.join(process.cwd(), 'temp-website-config.json');
        fs.writeFileSync(websiteConfigFile, JSON.stringify(websiteConfig));

        try {
          execSync(`aws s3api put-bucket-website --bucket ${bucketName} --website-configuration file://${websiteConfigFile}`, {
            stdio: this.options.verbose ? 'inherit' : 'pipe'
          });
        } finally {
          // Clean up temp file
          if (fs.existsSync(websiteConfigFile)) {
            fs.unlinkSync(websiteConfigFile);
          }
        }

        // Make bucket public for static website hosting
        const bucketPolicy = {
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'PublicReadGetObject',
              Effect: 'Allow',
              Principal: '*',
              Action: 's3:GetObject',
              Resource: `arn:aws:s3:::${bucketName}/*`
            }
          ]
        };

        // Write bucket policy to temporary file
        const bucketPolicyFile = path.join(process.cwd(), 'temp-bucket-policy.json');
        fs.writeFileSync(bucketPolicyFile, JSON.stringify(bucketPolicy));

        try {
          execSync(`aws s3api put-bucket-policy --bucket ${bucketName} --policy file://${bucketPolicyFile}`, {
            stdio: this.options.verbose ? 'inherit' : 'pipe'
          });
        } finally {
          // Clean up temp file
          if (fs.existsSync(bucketPolicyFile)) {
            fs.unlinkSync(bucketPolicyFile);
          }
        }

        // Disable block public access
        execSync(`aws s3api put-public-access-block --bucket ${bucketName} --public-access-block-configuration BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false`, {
          stdio: this.options.verbose ? 'inherit' : 'pipe'
        });

        console.log(chalk.green(`✅ Created S3 bucket: ${bucketName}`));
      }

      // Sync files to S3
      this.spinner.text = 'Uploading files to S3...';
      const syncCommand = `aws s3 sync "${buildPath}" s3://${bucketName} --delete`;
      
      if (this.options.verbose) {
        console.log(chalk.gray(`Running: ${syncCommand}`));
      }

      execSync(syncCommand, { 
        stdio: this.options.verbose ? 'inherit' : 'pipe' 
      });

      this.spinner.succeed(`Uploaded to S3 bucket: ${bucketName}`);
      
      // Display S3 website URL
      const s3WebsiteUrl = `http://${bucketName}.s3-website-us-east-1.amazonaws.com`;
      console.log(chalk.blue(`S3 Website URL: ${s3WebsiteUrl}`));
      
      return bucketName;
    } catch (error) {
      this.spinner.fail('S3 upload failed');
      throw error;
    }
  }

  private async setupCloudFront(bucketName: string): Promise<string> {
    this.spinner.start('Setting up CloudFront distribution...');
    
    try {
      const awsRegion = await this.getAWSRegion();
      const s3WebsiteEndpoint = awsRegion === 'us-east-1' 
        ? `${bucketName}.s3-website-us-east-1.amazonaws.com`
        : `${bucketName}.s3-website-${awsRegion}.amazonaws.com`;

      // Check if distribution already exists for this bucket
      let distributionId = '';
      let distributionDomain = '';
      
      try {
        const listResult = execSync('aws cloudfront list-distributions --query "DistributionList.Items[?Comment==`workflow-builder-frontend-${this.options.environment}`]" --output json', { stdio: 'pipe' });
        const distributions = JSON.parse(listResult.toString());
        
        if (distributions && distributions.length > 0) {
          distributionId = distributions[0].Id;
          distributionDomain = distributions[0].DomainName;
          
          if (this.options.verbose) {
            console.log(chalk.gray(`Found existing CloudFront distribution: ${distributionId}`));
          }
        }
      } catch (error) {
        if (this.options.verbose) {
          console.log(chalk.gray('No existing CloudFront distribution found, creating new one...'));
        }
      }

      if (!distributionId) {
        // Create new CloudFront distribution
        this.spinner.text = 'Creating CloudFront distribution...';
        
        const distributionConfig = {
          CallerReference: `workflow-builder-${this.options.environment}-${Date.now()}`,
          Comment: `workflow-builder-frontend-${this.options.environment}`,
          DefaultCacheBehavior: {
            TargetOriginId: 'S3-Website',
            ViewerProtocolPolicy: 'redirect-to-https',
            TrustedSigners: {
              Enabled: false,
              Quantity: 0
            },
            ForwardedValues: {
              QueryString: false,
              Cookies: {
                Forward: 'none'
              }
            },
            MinTTL: 0,
            DefaultTTL: 86400,
            MaxTTL: 31536000,
            Compress: true
          },
          Origins: {
            Quantity: 1,
            Items: [
              {
                Id: 'S3-Website',
                DomainName: s3WebsiteEndpoint,
                CustomOriginConfig: {
                  HTTPPort: 80,
                  HTTPSPort: 443,
                  OriginProtocolPolicy: 'http-only'
                }
              }
            ]
          },
          Enabled: true,
          DefaultRootObject: 'index.html',
          CustomErrorResponses: {
            Quantity: 1,
            Items: [
              {
                ErrorCode: 404,
                ResponsePagePath: '/index.html',
                ResponseCode: '200',
                ErrorCachingMinTTL: 300
              }
            ]
          },
          PriceClass: 'PriceClass_100'
        };

        // Write distribution config to temporary file
        const configFile = path.join(process.cwd(), 'temp-cloudfront-config.json');
        fs.writeFileSync(configFile, JSON.stringify(distributionConfig));

        try {
          const createResult = execSync(`aws cloudfront create-distribution --distribution-config file://${configFile} --output json`, { 
            stdio: 'pipe' 
          });
          
          const distribution = JSON.parse(createResult.toString());
          distributionId = distribution.Distribution.Id;
          distributionDomain = distribution.Distribution.DomainName;
          
          console.log(chalk.green(`✅ Created CloudFront distribution: ${distributionId}`));
          console.log(chalk.yellow('⏳ Distribution is deploying... This may take 10-15 minutes to be fully available.'));
          
        } finally {
          // Clean up temp file
          if (fs.existsSync(configFile)) {
            fs.unlinkSync(configFile);
          }
        }
      }

      // Invalidate cache if distribution exists
      if (distributionId) {
        this.spinner.text = 'Invalidating CloudFront cache...';
        
        try {
          execSync(`aws cloudfront create-invalidation --distribution-id ${distributionId} --paths "/*"`, {
            stdio: this.options.verbose ? 'inherit' : 'pipe'
          });
          
          if (this.options.verbose) {
            console.log(chalk.gray('CloudFront cache invalidated'));
          }
        } catch (error) {
          // Invalidation failure is not critical
          if (this.options.verbose) {
            console.log(chalk.yellow('Cache invalidation failed, but deployment continues...'));
          }
        }
      }

      const cloudFrontUrl = `https://${distributionDomain}`;
      this.spinner.succeed(`CloudFront distribution ready: ${distributionId}`);
      
      return cloudFrontUrl;
    } catch (error) {
      this.spinner.fail('CloudFront setup failed');
      throw error;
    }
  }

  private async getAWSRegion(): Promise<string> {
    try {
      // Try to get region from AWS CLI configuration
      const region = this.options.region || 
                    process.env.AWS_REGION || 
                    process.env.AWS_DEFAULT_REGION ||
                    execSync('aws configure get region', { stdio: 'pipe' }).toString().trim() ||
                    'us-east-1'; // fallback
      
      return region;
    } catch {
      return 'us-east-1'; // fallback to us-east-1
    }
  }

  private async getAWSAccountId(): Promise<string> {
    try {
      const accountId = execSync('aws sts get-caller-identity --query Account --output text', { stdio: 'pipe' }).toString().trim();
      return accountId;
    } catch {
      // Generate a random suffix if we can't get account ID
      return Math.random().toString(36).substring(2, 8);
    }
  }
}

// CLI Configuration
const program = new Command();

program
  .name('deploy-frontend-direct')
  .description('Deploy the frontend application directly to AWS S3 and CloudFront')
  .version('1.0.0');

program
  .option('-e, --env <environment>', 'Target environment (development, staging, production)', 'production')
  .option('-b, --bucket <bucketName>', 'S3 bucket name (defaults to workflow-builder-frontend-{env}-{accountId})')
  .option('-d, --distribution <distributionId>', 'CloudFront distribution ID for cache invalidation')
  .option('-r, --region <region>', 'AWS region (defaults to configured region or us-east-1)')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options: any) => {
    const deployer = new DirectFrontendDeployer({
      environment: options.env,
      bucketName: options.bucket,
      distributionId: options.distribution,
      region: options.region,
      verbose: options.verbose
    });

    const result = await deployer.deploy();
    
    // Display deployment summary
    console.log('');
    console.log(chalk.blue.bold('📋 Deployment Summary:'));
    console.log(`Environment: ${result.environment.toUpperCase()}`);
    console.log(`Status: ${result.success ? chalk.green('SUCCESS') : chalk.red('FAILED')}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    if (result.success) {
      console.log(chalk.green.bold('✅ Deployment successful!'));
    } else {
      console.log(chalk.red.bold('❌ Deployment failed!'));
      process.exit(1);
    }
  });

// Handle direct execution
program.parse();

export { DirectFrontendDeployer, type DeploymentOptions, type DeploymentResult };