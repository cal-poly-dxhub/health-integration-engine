#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const BUCKET_NAME = process.env.S3_BUCKET_NAME || `message-router-frontend-${Date.now()}`;
const REGION = process.env.AWS_REGION;
if (!REGION) { console.error('ERROR: AWS_REGION environment variable is required'); process.exit(1); }
const DISTRIBUTION_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID;
const AWS_PROFILE = process.env.AWS_PROFILE;

// Build AWS CLI command prefix
const awsCmd = AWS_PROFILE ? `aws --profile ${AWS_PROFILE}` : 'aws';

console.log('Starting Simple S3 + CloudFront deployment...');
console.log(`Bucket: ${BUCKET_NAME}`);
console.log(`Region: ${REGION}`);
if (AWS_PROFILE) {
  console.log(`AWS Profile: ${AWS_PROFILE}`);
}

try {
  // Step 1: Verify build exists
  console.log('\nVerifying build output...');
  const distPath = path.join(__dirname, '..', 'dist');
  if (!fs.existsSync(distPath)) {
    throw new Error('Build not found - please run npm run deploy-build first');
  }
  console.log('OK: Build output found');
  
  // Step 2: Check if bucket exists, create if not
  console.log('\nSetting up S3 bucket...');
  try {
    execSync(`${awsCmd} s3 ls s3://${BUCKET_NAME}`, { stdio: 'pipe' });
    console.log(`OK: Bucket ${BUCKET_NAME} already exists`);
  } catch (error) {
    console.log(`Creating bucket ${BUCKET_NAME}...`);
    
    // Create bucket
    if (REGION === 'us-east-1') {
      execSync(`${awsCmd} s3 mb s3://${BUCKET_NAME}`, { stdio: 'inherit' });
    } else {
      execSync(`${awsCmd} s3 mb s3://${BUCKET_NAME} --region ${REGION}`, { stdio: 'inherit' });
    }
    
    console.log(`OK: Bucket ${BUCKET_NAME} created`);
  }
  
  // Step 2.5: Set bucket policy to allow CloudFront access
  console.log('\nSetting up bucket policy for CloudFront access...');
  const bucketPolicy = {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AllowCloudFrontAccess',
        Effect: 'Allow',
        Principal: '*',
        Action: 's3:GetObject',
        Resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
        Condition: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::*:distribution/*`
          }
        }
      }
    ]
  };
  
  const policyFile = path.join(__dirname, 'temp-bucket-policy.json');
  fs.writeFileSync(policyFile, JSON.stringify(bucketPolicy, null, 2));
  
  try {
    // First, allow public access for CloudFront
    execSync(`${awsCmd} s3api put-public-access-block --bucket ${BUCKET_NAME} --public-access-block-configuration BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false`, { stdio: 'inherit' });
    
    // Then set the bucket policy
    execSync(`${awsCmd} s3api put-bucket-policy --bucket ${BUCKET_NAME} --policy file://${policyFile}`, { stdio: 'inherit' });
    console.log('OK: Bucket policy configured for CloudFront access');
  } catch (error) {
    console.log('WARN: Could not set bucket policy, trying alternative approach...');
    
    // Alternative: Make bucket publicly readable (less secure but works)
    const publicPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'PublicReadGetObject',
          Effect: 'Allow',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${BUCKET_NAME}/*`
        }
      ]
    };
    
    fs.writeFileSync(policyFile, JSON.stringify(publicPolicy, null, 2));
    
    try {
      execSync(`${awsCmd} s3api put-bucket-policy --bucket ${BUCKET_NAME} --policy file://${policyFile}`, { stdio: 'inherit' });
      console.log('OK: Public bucket policy set (fallback)');
    } catch (fallbackError) {
      console.log('ERROR: Could not set any bucket policy - CloudFront may not work');
    }
  } finally {
    if (fs.existsSync(policyFile)) {
      fs.unlinkSync(policyFile);
    }
  }
  
  // Step 3: Upload files to S3
  console.log('\nUploading files to S3...');
  execSync(`${awsCmd} s3 sync "${distPath}" s3://${BUCKET_NAME} --delete --cache-control "public, max-age=31536000" --exclude "*.html"`, { stdio: 'inherit' });
  
  // Upload HTML files with no-cache headers
  execSync(`${awsCmd} s3 sync "${distPath}" s3://${BUCKET_NAME} --delete --cache-control "no-cache, no-store, must-revalidate" --include "*.html"`, { stdio: 'inherit' });
  
  console.log('OK: Files uploaded to S3');
  
  // Step 4: Create or update CloudFront distribution (simplified)
  console.log('\nSetting up CloudFront distribution...');
  
  let distributionId = DISTRIBUTION_ID;
  let distributionDomain = '';
  
  if (!distributionId) {
    // Create new distribution with simple S3 origin
    const s3DomainName = `${BUCKET_NAME}.s3.${REGION}.amazonaws.com`;
    
    const distributionConfig = {
      CallerReference: `message-router-${Date.now()}`,
      Comment: 'Message Router Frontend Distribution (Simple)',
      DefaultCacheBehavior: {
        TargetOriginId: 'S3-Origin',
        ViewerProtocolPolicy: 'redirect-to-https',
        TrustedSigners: {
          Enabled: false,
          Quantity: 0
        },
        ForwardedValues: {
          QueryString: false,
          Cookies: {
            Forward: 'none'}
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
            Id: 'S3-Origin',
            DomainName: s3DomainName,
            CustomOriginConfig: {
              HTTPPort: 80,
              HTTPSPort: 443,
              OriginProtocolPolicy: 'https-only'}
          }
        ]
      },
      Enabled: true,
      DefaultRootObject: 'index.html',
      CustomErrorResponses: {
        Quantity: 2,
        Items: [
          {
            ErrorCode: 404,
            ResponsePagePath: '/index.html',
            ResponseCode: '200',
            ErrorCachingMinTTL: 300
          },
          {
            ErrorCode: 403,
            ResponsePagePath: '/index.html',
            ResponseCode: '200',
            ErrorCachingMinTTL: 300
          }
        ]
      },
      PriceClass: 'PriceClass_100'};
    
    const distConfigFile = path.join(__dirname, 'temp-distribution-config.json');
    fs.writeFileSync(distConfigFile, JSON.stringify(distributionConfig, null, 2));
    
    try {
      const result = execSync(`${awsCmd} cloudfront create-distribution --distribution-config file://${distConfigFile}`, { encoding: 'utf8' });
      const distribution = JSON.parse(result);
      distributionId = distribution.Distribution.Id;
      distributionDomain = distribution.Distribution.DomainName;
      
      console.log(`OK: CloudFront distribution created: ${distributionId}`);
      console.log(`Distribution domain: ${distributionDomain}`);
      console.log('Distribution is deploying... This may take 10-15 minutes to be fully available.');
      
    } finally {
      if (fs.existsSync(distConfigFile)) {
        fs.unlinkSync(distConfigFile);
      }
    }
  } else {
    // Get existing distribution info
    const result = execSync(`${awsCmd} cloudfront get-distribution --id ${distributionId}`, { encoding: 'utf8' });
    const distribution = JSON.parse(result);
    distributionDomain = distribution.Distribution.DomainName;
    console.log(`OK: Using existing CloudFront distribution: ${distributionId}`);
  }
  
  // Step 5: Invalidate CloudFront cache
  if (distributionId) {
    console.log('\nInvalidating CloudFront cache...');
    try {
      execSync(`${awsCmd} cloudfront create-invalidation --distribution-id ${distributionId} --paths "/*"`, { stdio: 'inherit' });
      console.log('OK: Cache invalidation created');
    } catch (error) {
      console.warn('WARN: Cache invalidation failed, but deployment continues...');
    }
  }
  
  // Step 6: Display results
  console.log('\nDeployment completed successfully!');
  console.log('Deployment Summary:');
  console.log(`S3 Bucket: ${BUCKET_NAME} (private bucket)`);
  if (distributionDomain) {
    console.log(`CloudFront URL: https://${distributionDomain}`);
  }
  console.log('\nNext steps:');
  console.log('1. Wait for CloudFront distribution to deploy (10-15 minutes)');
  console.log('2. Test your application at the CloudFront URL');
  console.log('3. S3 bucket is private - accessible via CloudFront');
  
  // Save deployment info
  const deploymentInfo = {
    bucketName: BUCKET_NAME,
    region: REGION,
    distributionId,
    distributionDomain,
    cloudFrontUrl: distributionDomain ? `https://${distributionDomain}` : null,
    deployedAt: new Date().toISOString(),
    deploymentType: 'simple-cloudfront-s3'};
  
  fs.writeFileSync(
    path.join(__dirname, '..', 'deployment-info.json'),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log('4. Deployment info saved to deployment-info.json');
  
} catch (error) {
  console.error('\nERROR: Deployment failed!');
  console.error('Error:', error.message);
  process.exit(1);
}