import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';
import { getConfig, StackConfig, PROJECT } from './config';
import * as path from 'path';

export class FrontendStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly bucketDeployment: s3deploy.BucketDeployment;
  private readonly config: StackConfig;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Load configuration based on environment
    this.config = getConfig(process.env.NODE_ENV || 'development');

    // Create S3 bucket for frontend hosting
    this.bucket = this.createS3Bucket();
    
    // Create CloudFront distribution
    this.distribution = this.createCloudFrontDistribution();
    
    // Deploy frontend files
    this.bucketDeployment = this.deployFrontendFiles();
    
    // Create outputs
    this.createOutputs();
  }

  private createS3Bucket(): s3.Bucket {
    const bucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `${PROJECT.s3.frontendBucket}-${this.config.environment}-${this.account}`,
      // No website configuration needed - CloudFront will serve the files
      publicReadAccess: false, // Private bucket - CloudFront will access via OAI
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // Block all public access
      removalPolicy: this.config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: this.config.environment !== 'production',
      versioned: false, // No versioning needed for static assets
      encryption: s3.BucketEncryption.S3_MANAGED, // Server-side encryption
    });

    return bucket;
  }

  private createCloudFrontDistribution(): cloudfront.Distribution {
    // Create Origin Access Identity for secure S3 access
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: `OAI for ${PROJECT.s3.frontendBucket}-${this.config.environment}`,
    });

    // Grant CloudFront access to S3 bucket
    this.bucket.grantRead(originAccessIdentity);

    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      comment: `CloudFront distribution for ${PROJECT.s3.frontendBucket}-${this.config.environment}`,
      defaultBehavior: {
        origin: new origins.S3Origin(this.bucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // Use only North America and Europe
      enabled: true,
    });

    return distribution;
  }

  private deployFrontendFiles(): s3deploy.BucketDeployment {
    const deployment = new s3deploy.BucketDeployment(this, 'FrontendDeployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../frontend/dist'))],
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      prune: true, // Remove files that are not in the source
      retainOnDelete: this.config.environment === 'production',
      memoryLimit: 512,
      ephemeralStorageSize: cdk.Size.mebibytes(512),
    });

    return deployment;
  }

  private createOutputs(): void {
    // S3 bucket outputs
    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: this.bucket.bucketName,
      description: 'Name of the S3 bucket hosting the frontend',
      exportName: `${this.stackName}-FrontendBucketName`,
    });

    new cdk.CfnOutput(this, 'FrontendBucketArn', {
      value: this.bucket.bucketArn,
      description: 'S3 bucket ARN',
      exportName: `${this.stackName}-FrontendBucketArn`,
    });

    // CloudFront outputs
    new cdk.CfnOutput(this, 'FrontendDistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID',
      exportName: `${this.stackName}-FrontendDistributionId`,
    });

    new cdk.CfnOutput(this, 'FrontendDistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name',
      exportName: `${this.stackName}-FrontendDistributionDomainName`,
    });

    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'Frontend application URL (use this to access your app)',
      exportName: `${this.stackName}-FrontendUrl`,
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
  }
}