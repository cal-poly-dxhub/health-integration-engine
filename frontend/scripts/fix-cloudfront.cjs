#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const AWS_PROFILE = process.env.AWS_PROFILE;
const REGION = process.env.AWS_REGION || 'us-east-1';

// Build AWS CLI command prefix
const awsCmd = AWS_PROFILE ? `aws --profile ${AWS_PROFILE}` : 'aws';

console.log('🔧 Fixing CloudFront distribution to use S3 website endpoint...');

try {
  // Read deployment info to get distribution ID and bucket name
  const deploymentInfoPath = path.join(__dirname, '..', 'deployment-info.json');
  if (!fs.existsSync(deploymentInfoPath)) {
    throw new Error('deployment-info.json not found. Please run deployment first.');
  }
  
  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentInfoPath, 'utf8'));
  const distributionId = deploymentInfo.distributionId;
  const bucketName = deploymentInfo.bucketName;
  
  if (!distributionId || !bucketName) {
    throw new Error('Distribution ID or bucket name not found in deployment-info.json');
  }
  
  console.log(`Distribution ID: ${distributionId}`);
  console.log(`Bucket Name: ${bucketName}`);
  
  // Step 1: Configure S3 bucket for static website hosting
  console.log('\n🪣 Configuring S3 bucket for static website hosting...');
  
  // Configure website hosting
  const websiteConfig = {
    IndexDocument: { Suffix: 'index.html' },
    ErrorDocument: { Key: 'index.html' }
  };
  
  const configFile = path.join(__dirname, 'temp-website-config.json');
  fs.writeFileSync(configFile, JSON.stringify(websiteConfig, null, 2));
  
  try {
    execSync(`${awsCmd} s3api put-bucket-website --bucket ${bucketName} --website-configuration file://${configFile}`, { stdio: 'inherit' });
  } finally {
    if (fs.existsSync(configFile)) {
      fs.unlinkSync(configFile);
    }
  }
  
  // Disable block public access
  execSync(`${awsCmd} s3api put-public-access-block --bucket ${bucketName} --public-access-block-configuration BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false`, { stdio: 'inherit' });
  
  // Set bucket policy for public read access
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
  
  const policyFile = path.join(__dirname, 'temp-bucket-policy.json');
  fs.writeFileSync(policyFile, JSON.stringify(bucketPolicy, null, 2));
  
  try {
    execSync(`${awsCmd} s3api put-bucket-policy --bucket ${bucketName} --policy file://${policyFile}`, { stdio: 'inherit' });
    console.log('✅ S3 static website hosting configured');
  } finally {
    if (fs.existsSync(policyFile)) {
      fs.unlinkSync(policyFile);
    }
  }
  
  // Step 2: Get current CloudFront distribution configuration
  console.log('\n☁️ Updating CloudFront distribution...');
  
  const distResult = execSync(`${awsCmd} cloudfront get-distribution-config --id ${distributionId}`, { encoding: 'utf8' });
  const distData = JSON.parse(distResult);
  const config = distData.DistributionConfig;
  const etag = distData.ETag;
  
  // Update origin to use S3 website endpoint
  const s3WebsiteEndpoint = REGION === 'us-east-1' 
    ? `${bucketName}.s3-website-us-east-1.amazonaws.com`
    : `${bucketName}.s3-website-${REGION}.amazonaws.com`;
  
  config.Origins.Items[0] = {
    Id: 'S3-Website',
    DomainName: s3WebsiteEndpoint,
    CustomOriginConfig: {
      HTTPPort: 80,
      HTTPSPort: 443,
      OriginProtocolPolicy: 'http-only'
    }
  };
  
  // Update default cache behavior to use new origin
  config.DefaultCacheBehavior.TargetOriginId = 'S3-Website';
  
  // Save updated config
  const updatedConfigFile = path.join(__dirname, 'temp-updated-distribution-config.json');
  fs.writeFileSync(updatedConfigFile, JSON.stringify(config, null, 2));
  
  try {
    execSync(`${awsCmd} cloudfront update-distribution --id ${distributionId} --distribution-config file://${updatedConfigFile} --if-match ${etag}`, { stdio: 'inherit' });
    console.log('✅ CloudFront distribution updated to use S3 website endpoint');
  } finally {
    if (fs.existsSync(updatedConfigFile)) {
      fs.unlinkSync(updatedConfigFile);
    }
  }
  
  // Step 3: Invalidate CloudFront cache
  console.log('\n🔄 Invalidating CloudFront cache...');
  try {
    execSync(`${awsCmd} cloudfront create-invalidation --distribution-id ${distributionId} --paths "/*"`, { stdio: 'inherit' });
    console.log('✅ Cache invalidation created');
  } catch (error) {
    console.warn('⚠️ Cache invalidation failed, but fix continues...');
  }
  
  // Step 4: Display results
  console.log('\n🎉 CloudFront fix completed successfully!');
  console.log('📋 Updated Configuration:');
  console.log(`   S3 Bucket: ${bucketName} (now configured for static website hosting)`);
  console.log(`   S3 Website URL: http://${s3WebsiteEndpoint}`);
  console.log(`   CloudFront URL: https://${deploymentInfo.distributionDomain}`);
  console.log('\n💡 Next steps:');
  console.log('   1. Test S3 website URL immediately (should work now)');
  console.log('   2. Wait 5-10 minutes for CloudFront update to propagate');
  console.log('   3. Test CloudFront URL (should work after propagation)');
  
  // Update deployment info
  deploymentInfo.s3WebsiteUrl = `http://${s3WebsiteEndpoint}`;
  deploymentInfo.lastUpdated = new Date().toISOString();
  deploymentInfo.deploymentType = 's3-website-cloudfront-fixed';
  
  fs.writeFileSync(deploymentInfoPath, JSON.stringify(deploymentInfo, null, 2));
  console.log('   4. Deployment info updated');
  
} catch (error) {
  console.error('\n❌ CloudFront fix failed!');
  console.error('Error:', error.message);
  process.exit(1);
}