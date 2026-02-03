#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const BUCKET_NAME = process.env.S3_BUCKET_NAME || `message-router-frontend-${Date.now()}`;
const REGION = process.env.AWS_REGION || 'us-east-1';
const DISTRIBUTION_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID;
const AWS_PROFILE = process.env.AWS_PROFILE;

// Build AWS CLI command prefix
const awsCmd = AWS_PROFILE ? `aws --profile ${AWS_PROFILE}` : 'aws';

console.log('🚀 Starting S3 Static Website + CloudFront deployment...');
console.log(`Bucket: ${BUCKET_NAME}`);
console.log(`Region: ${REGION}`);
if (AWS_PROFILE) {
  console.log(`AWS Profile: ${AWS_PROFILE}`);
}

try {
  // Step 1: Verify build exists
  console.log('\n📦 Verifying build output...');
  const distPath = path.join(__dirname, '..', 'dist');
  if (!fs.existsSync(distPath)) {
    throw new Error('Build not found - please run npm run deploy-build first');
  }
  console.log('✅ Build output found');
  
  // Step 2: Check if bucket exists, create if not
  console.log('\n🪣 Setting up S3 bucket for static website hosting...');
  try {
    execSync(`${awsCmd} s3 ls s3://${BUCKET_NAME}`, { stdio: 'pipe' });
    console.log(`✅ Bucket ${BUCKET_NAME} already exists`);
  } catch (error) {
    console.log(`Creating bucket ${BUCKET_NAME}...`);
    
    // Create bucket
    if (REGION === 'us-east-1') {
      execSync(`${awsCmd} s3 mb s3://${BUCKET_NAME}`, { stdio: 'inherit' });
    } else {
      execSync(`${awsCmd} s3 mb s3://${BUCKET_NAME} --region ${REGION}`, { stdio: 'inherit' });
    }
    
    console.log(`✅ Bucket ${BUCKET_NAME} created`);
  }
  
  // Step 3: Configure bucket for static website hosting
  console.log('\n🌐 Configuring S3 static website hosting...');
  
  // Configure website hosting
  const websiteConfig = {
    IndexDocument: { Suffix: 'index.html' },
    ErrorDocument: { Key: 'index.html' }
  };
  
  const configFile = path.join(__dirname, 'temp-website-config.json');
  fs.writeFileSync(configFile, JSON.stringify(websiteConfig, null, 2));
  
  try {
    execSync(`${awsCmd} s3api put-bucket-website --bucket ${BUCKET_NAME} --website-configuration file://${configFile}`, { stdio: 'inherit' });
  } finally {
    if (fs.existsSync(configFile)) {
      fs.unlinkSync(configFile);
    }
  }
  
  // Disable block public access
  execSync(`${awsCmd} s3api put-public-access-block --bucket ${BUCKET_NAME} --public-access-block-configuration BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false`, { stdio: 'inherit' });
  
  // Set bucket policy for public read access
  const bucketPolicy = {
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
  
  const policyFile = path.join(__dirname, 'temp-bucket-policy.json');
  fs.writeFileSync(policyFile, JSON.stringify(bucketPolicy, null, 2));
  
  try {
    execSync(`${awsCmd} s3api put-bucket-policy --bucket ${BUCKET_NAME} --policy file://${policyFile}`, { stdio: 'inherit' });
    console.log('✅ S3 static website hosting configured');
  } finally {
    if (fs.existsSync(policyFile)) {
      fs.unlinkSync(policyFile);
    }
  }
  
  // Step 4: Upload files to S3
  console.log('\n📤 Uploading files to S3...');
  execSync(`${awsCmd} s3 sync "${distPath}" s3://${BUCKET_NAME} --delete --cache-control "public, max-age=31536000" --exclude "*.html"`, { stdio: 'inherit' });
  
  // Upload HTML files with no-cache headers
  execSync(`${awsCmd} s3 sync "${distPath}" s3://${BUCKET_NAME} --delete --cache-control "no-cache, no-store, must-revalidate" --include "*.html"`, { stdio: 'inherit' });
  
  console.log('✅ Files uploaded to S3');
  
  // Step 5: Create or update CloudFront distribution
  console.log('\n☁️ Setting up CloudFront distribution...');
  
  let distributionId = DISTRIBUTION_ID;
  let distributionDomain = '';
  
  const s3WebsiteEndpoint = REGION === 'us-east-1' 
    ? `${BUCKET_NAME}.s3-website-us-east-1.amazonaws.com`
    : `${BUCKET_NAME}.s3-website-${REGION}.amazonaws.com`;
  
  if (!distributionId) {
    // Create new distribution
    const distributionConfig = {
      CallerReference: `message-router-${Date.now()}`,
      Comment: 'Message Router Frontend Distribution (S3 Website)',
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
      PriceClass: 'PriceClass_100'
    };
    
    const distConfigFile = path.join(__dirname, 'temp-distribution-config.json');
    fs.writeFileSync(distConfigFile, JSON.stringify(distributionConfig, null, 2));
    
    try {
      const result = execSync(`${awsCmd} cloudfront create-distribution --distribution-config file://${distConfigFile}`, { encoding: 'utf8' });
      const distribution = JSON.parse(result);
      distributionId = distribution.Distribution.Id;
      distributionDomain = distribution.Distribution.DomainName;
      
      console.log(`✅ CloudFront distribution created: ${distributionId}`);
      console.log(`🌐 Distribution domain: ${distributionDomain}`);
      console.log('⏳ Distribution is deploying... This may take 10-15 minutes to be fully available.');
      
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
    console.log(`✅ Using existing CloudFront distribution: ${distributionId}`);
  }
  
  // Step 6: Invalidate CloudFront cache
  if (distributionId) {
    console.log('\n🔄 Invalidating CloudFront cache...');
    try {
      execSync(`${awsCmd} cloudfront create-invalidation --distribution-id ${distributionId} --paths "/*"`, { stdio: 'inherit' });
      console.log('✅ Cache invalidation created');
    } catch (error) {
      console.warn('⚠️ Cache invalidation failed, but deployment continues...');
    }
  }
  
  // Step 7: Display results
  console.log('\n🎉 Deployment completed successfully!');
  console.log('📋 Deployment Summary:');
  console.log(`   S3 Bucket: ${BUCKET_NAME}`);
  console.log(`   S3 Website URL: http://${s3WebsiteEndpoint}`);
  if (distributionDomain) {
    console.log(`   CloudFront URL: https://${distributionDomain}`);
  }
  console.log('\n💡 Next steps:');
  console.log('   1. Test S3 website URL immediately (works right away)');
  console.log('   2. Wait for CloudFront distribution to deploy (10-15 minutes)');
  console.log('   3. Test CloudFront URL for HTTPS and global CDN');
  console.log('   4. Use CloudFront URL for production');
  
  // Save deployment info
  const deploymentInfo = {
    bucketName: BUCKET_NAME,
    region: REGION,
    distributionId,
    distributionDomain,
    s3WebsiteUrl: `http://${s3WebsiteEndpoint}`,
    cloudFrontUrl: distributionDomain ? `https://${distributionDomain}` : null,
    deployedAt: new Date().toISOString(),
    deploymentType: 's3-website-cloudfront'
  };
  
  fs.writeFileSync(
    path.join(__dirname, '..', 'deployment-info.json'),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log('   5. Deployment info saved to deployment-info.json');
  
} catch (error) {
  console.error('\n❌ Deployment failed!');
  console.error('Error:', error.message);
  process.exit(1);
}