import * as cdk from 'aws-cdk-lib';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { getConfig, StackConfig, PROJECT } from './config';
import * as path from 'path';

export class AmplifyStack extends cdk.Stack {
  public readonly amplifyApp: amplify.CfnApp;
  public readonly bucket: s3.Bucket;
  public readonly bucketDeployment: s3deploy.BucketDeployment;
  private readonly config: StackConfig;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Load configuration based on environment
    this.config = getConfig(process.env.NODE_ENV || 'development');

    // Create S3 bucket for source code
    this.bucket = this.createSourceBucket();
    
    // Deploy frontend source to S3
    this.bucketDeployment = this.deploySourceFiles();
    
    // Create Amplify app
    this.amplifyApp = this.createAmplifyApp();
    
    // Create outputs
    this.createOutputs();
  }

  private createSourceBucket(): s3.Bucket {
    const bucket = new s3.Bucket(this, 'AmplifySourceBucket', {
      bucketName: `${PROJECT.s3.amplifySourceBucket}-${this.config.environment}-${this.account}`,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: this.config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: this.config.environment !== 'production',
      versioned: true, // Enable versioning for Amplify deployments
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    return bucket;
  }

  private deploySourceFiles(): s3deploy.BucketDeployment {
    const deployment = new s3deploy.BucketDeployment(this, 'AmplifySourceDeployment', {
      sources: [
        // Deploy the entire frontend directory (source code, not built files)
        s3deploy.Source.asset(path.join(__dirname, '../../frontend'), {
          exclude: ['node_modules/**', 'dist/**', '.env*']
        })
      ],
      destinationBucket: this.bucket,
      destinationKeyPrefix: 'source/',
      prune: true,
      memoryLimit: 512,
      ephemeralStorageSize: cdk.Size.mebibytes(512),
    });

    return deployment;
  }

  private createAmplifyApp(): amplify.CfnApp {
    const app = new amplify.CfnApp(this, `${PROJECT.projectNamePascal}AmplifyApp`, {
      name: `${PROJECT.amplify.appName}-${this.config.environment}`,
      description: `AWS Step Functions Workflow Builder - ${this.config.environment}`,
      
      // Build settings for React/Vite app
      buildSpec: `
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
      `,
      
      // Environment variables
      environmentVariables: [
        {
          name: 'NODE_ENV',
          value: this.config.environment
        },
        {
          name: '_LIVE_UPDATES',
          value: '[{"name":"Amplify CLI","pkg":"@aws-amplify/cli","type":"npm","version":"latest"}]'
        }
      ],
      
      // Let Amplify handle SPA routing automatically
      // customRules: [],
      
      // Platform settings
      platform: 'WEB',
      
      // IAM service role (Amplify will create one if not specified)
      // We'll let Amplify handle this automatically
    });

    // Create a branch for deployment
    const branch = new amplify.CfnBranch(this, 'AmplifyMainBranch', {
      appId: app.attrAppId,
      branchName: 'main',
      description: `Main branch for ${this.config.environment} environment`,
      
      // Enable auto-build (we'll trigger manually via API)
      enableAutoBuild: false,
      
      // Performance mode
      enablePerformanceMode: false,
      
      // Environment variables specific to this branch
      environmentVariables: [
        {
          name: 'AMPLIFY_DIFF_DEPLOY',
          value: 'false'
        },
        {
          name: 'AMPLIFY_MONOREPO_APP_ROOT',
          value: '.'
        }
      ]
    });

    return app;
  }

  private createOutputs(): void {
    // Amplify app outputs
    new cdk.CfnOutput(this, 'AmplifyAppId', {
      value: this.amplifyApp.attrAppId,
      description: 'Amplify App ID',
      exportName: `${this.stackName}-AmplifyAppId`,
    });

    new cdk.CfnOutput(this, 'AmplifyAppArn', {
      value: this.amplifyApp.attrArn,
      description: 'Amplify App ARN',
      exportName: `${this.stackName}-AmplifyAppArn`,
    });

    new cdk.CfnOutput(this, 'AmplifyDefaultDomain', {
      value: this.amplifyApp.attrDefaultDomain,
      description: 'Amplify default domain',
      exportName: `${this.stackName}-AmplifyDefaultDomain`,
    });

    new cdk.CfnOutput(this, 'AmplifyAppUrl', {
      value: `https://main.${this.amplifyApp.attrDefaultDomain}`,
      description: 'Amplify application URL (use this to access your app)',
      exportName: `${this.stackName}-AmplifyAppUrl`,
    });

    // S3 source bucket outputs
    new cdk.CfnOutput(this, 'AmplifySourceBucketName', {
      value: this.bucket.bucketName,
      description: 'Name of the S3 bucket containing Amplify source code',
      exportName: `${this.stackName}-AmplifySourceBucketName`,
    });

    // Environment-specific outputs
    new cdk.CfnOutput(this, 'Environment', {
      value: this.config.environment,
      description: 'Deployment environment',
    });

    new cdk.CfnOutput(this, 'DeploymentTimestamp', {
      value: new Date().toISOString(),
      description: 'Deployment timestamp',
    });

    // Deployment instructions
    new cdk.CfnOutput(this, 'DeploymentInstructions', {
      value: 'After stack deployment, run: npm run deploy:amplify:trigger to start the build',
      description: 'Next steps for deployment',
    });
  }
}