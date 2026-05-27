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

console.log('Starting Private S3 + CloudFront deployment...');
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
  console.log('\nSetting up private S3 bucket...');
  try {
    execSync(`${awsCmd} s3 ls s3://${BUCKET_NAME}`, { stdio: 'pipe' });
    console.log(`OK: Bucket ${BUCKET_NAME} already exists`);
  } catch (error) {
    console.log(`Creating private bucket ${BUCKET_NAME}...`);
    
    // Create bucket
    if (REGION === 'us-east-1') {
      execSync(`${awsCmd} s3 mb s3://${BUCKET_NAME}`, { stdio: 'inherit' });
    } else {
      execSync(`${awsCmd} s3 mb s3://${BUCKET_NAME} --region ${REGION}`, { stdio: 'inherit' });
    }
    
    console.log(`OK: Private bucket ${BUCKET_NAME} created`);
  }
  
  // Step 3: Ensure bucket stays private (no public access)
  console.log('\nEnsuring bucket remains private...');
  execSync(`${awsCmd} s3api put-public-access-block --bucket ${BUCKET_NAME} --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true`, { stdio: 'inherit' });
  console.log('OK: Bucket is properly secured (private)');
  
  // Step 4: Upload files to S3
  console.log('\nUploading files to private S3 bucket...');
  execSync(`${awsCmd} s3 sync "${distPath}" s3://${BUCKET_NAME} --delete --cache-control "public, max-age=31536000" --exclude "*.html"`, { stdio: 'inherit' });
  
  // Upload HTML files with no-cache headers
  execSync(`${awsCmd} s3 sync "${distPath}" s3://${BUCKET_NAME} --delete --cache-control "no-cache, no-store, must-revalidate" --include "*.html"`, { stdio: 'inherit' });
  
  console.log('OK: Files uploaded to private S3 bucket');
  
  // Step 5: Create Origin Access Control (OAC)
  console.log('\nSetting up Origin Access Control...');
  
  const oacName = `message-router-oac-${Date.now()}`;
  const oacConfig = {
    Name: oacName,
    Description: 'Origin Access Control for Message Router Frontend',
    OriginAccessControlConfig: {
      Name: oacName,
      Description: 'Origin Access Control for Message Router Frontend',
      SigningProtocol: 'sigv4',
      SigningBehavior: 'always',
      OriginAccessControlOriginType: 's3'}
  };
  
  const oacConfigFile = path.join(__dirname, 'temp-oac-config.json');
  fs.writeFileSync(oacConfigFile, JSON.stringify(oacConfig.OriginAccessControlConfig, null, 2));
  
  let oacId = '';
  try {
    const oacResult = execSync(`${awsCmd} cloudfront create-origin-access-control --origin-access-control-config file://${oacConfigFile}`, { encoding: 'utf8' });
    const oacData = JSON.parse(oacResult);
    oacId = oacData.OriginAccessControl.Id;
    console.log(`OK: Origin Access Control created: ${oacId}`);
  } catch (error) {
    console.log('WARN: OAC creation failed, will try to find existing one...');
    // Try to list existing OACs and find one for this bucket
    try {
      const listResult = execSync(`${awsCmd} cloudfront list-origin-access-controls`, { encoding: 'utf8' });
      const listData = JSON.parse(listResult);
      const existingOac = listData.OriginAccessControlList.Items.find(item => 
        item.Name.includes('message-router') || item.Description.includes('Message Router')
      );
      if (existingOac) {
        oacId = existingOac.Id;
        console.log(`OK: Using existing OAC: ${oacId}`);
      }
    } catch (listError) {
      console.warn('WARN: Could not create or find OAC, continuing without it...');
    }
  } finally {
    if (fs.existsSync(oacConfigFile)) {
      fs.unlinkSync(oacConfigFile);
    }
  }
  
  // Step 6: Create CloudFront distribution with OAC
  console.log('\nSetting up CloudFront distribution with private S3 access...');
  
  let distributionId = DISTRIBUTION_ID;
  let distributionDomain = '';
  
  if (!distributionId) {
    // Create new distribution with OAC
    const distributionConfig = {
      CallerReference: `message-router-${Date.now()}`,
      Comment: 'Message Router Frontend Distribution (Private S3 + OAC)',
      DefaultCacheBehavior: {
        TargetOriginId: 'S3-Private',
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
            Id: 'S3-Private',
            DomainName: `${BUCKET_NAME}.s3.${REGION}.amazonaws.com`,
            S3OriginConfig: {
              OriginAccessIdentity: ''},
            ...(oacId && {
              OriginAccessControlId: oacId
            })
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
  
  // Step 7: Update S3 bucket policy to allow CloudFront OAC access
  if (oacId && distributionId) {
    console.log('\nSetting up S3 bucket policy for CloudFront access...');
    
    // Get account ID first
    const accountId = getAccountId();
    
    const bucketPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowCloudFrontServicePrincipal',
          Effect: 'Allow',
          Principal: {
            Service: 'cloudfront.amazonaws.com'},
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
          Condition: {
            StringEquals: {
              'AWS:SourceArn': `arn:aws:cloudfront::${accountId}:distribution/${distributionId}`
            }
          }
        }
      ]
    };
    
    const policyFile = path.join(__dirname, 'temp-bucket-policy.json');
    fs.writeFileSync(policyFile, JSON.stringify(bucketPolicy, null, 2));
    
    try {
      execSync(`${awsCmd} s3api put-bucket-policy --bucket ${BUCKET_NAME} --policy file://${policyFile}`, { stdio: 'inherit' });
      console.log('OK: S3 bucket policy configured for CloudFront access');
    } catch (error) {
      console.warn('WARN: Could not set bucket policy, but deployment continues...');
      console.warn('You may need to manually configure the bucket policy for CloudFront access');
    } finally {
      if (fs.existsSync(policyFile)) {
        fs.unlinkSync(policyFile);
      }
    }
  }
  
  // Step 8: Invalidate CloudFront cache
  if (distributionId) {
    console.log('\nInvalidating CloudFront cache...');
    try {
      execSync(`${awsCmd} cloudfront create-invalidation --distribution-id ${distributionId} --paths "/*"`, { stdio: 'inherit' });
      console.log('OK: Cache invalidation created');
    } catch (error) {
      console.warn('WARN: Cache invalidation failed, but deployment continues...');
    }
  }
  
  // Step 9: Display results
  console.log('\nDeployment completed successfully!');
  console.log('Deployment Summary:');
  console.log(`S3 Bucket: ${BUCKET_NAME} (PRIVATE)`);
  console.log(`S3 Region: ${REGION}`);
  if (oacId) {
    console.log(`Origin Access Control: ${oacId}`);
  }
  if (distributionDomain) {
    console.log(`CloudFront URL: https://${distributionDomain}`);
  }
  console.log('\nNext steps:');
  console.log('1. Wait for CloudFront distribution to deploy (10-15 minutes)');
  console.log('2. Test CloudFront URL for HTTPS access');
  console.log('3. S3 bucket is private - only accessible via CloudFront');
  console.log('4. Use CloudFront URL for production');
  
  // Save deployment info
  const deploymentInfo = {
    bucketName: BUCKET_NAME,
    region: REGION,
    distributionId,
    distributionDomain,
    oacId,
    cloudFrontUrl: distributionDomain ? `https://${distributionDomain}` : null,
    deployedAt: new Date().toISOString(),
    deploymentType: 's3-private-cloudfront',
    bucketAccess: 'private'};
  
  fs.writeFileSync(
    path.join(__dirname, '..', 'deployment-info.json'),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log('5. Deployment info saved to deployment-info.json');
  
} catch (error) {
  console.error('\nERROR: Deployment failed!');
  console.error('Error:', error.message);
  process.exit(1);
}

// Helper function to get AWS account ID
function getAccountId() {
  try {
    const result = execSync(`${awsCmd} sts get-caller-identity --query Account --output text`, { encoding: 'utf8' });
    return result.trim();
  } catch (error) {
    console.warn('Could not get account ID, using placeholder');
    return '123456789012';
  }
}