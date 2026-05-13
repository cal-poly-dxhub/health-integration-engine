# Quick Deployment Guide

## 🚀 Deploy to S3 + CloudFront (Recommended)

### Option 1: Full Deployment (Recommended)
```bash
npm run deploy:s3
```
This runs a production build and deploys to S3 + CloudFront.

### Option 2: Quick Deploy (if build already exists)
```bash
npm run deploy:s3-quick
```
This skips the build step and just deploys existing dist folder.

### Option 3: Simple Deployment (if OAI issues)
```bash
npm run deploy:s3-simple
```
This uses a simpler CloudFront setup without OAI complications.

### Option 4: Using Different AWS Profile/Region
```bash
# Windows CMD
set AWS_PROFILE=mr && set AWS_REGION=us-east-1 && npm run deploy:s3-simple

# PowerShell
$env:AWS_PROFILE="mr"; $env:AWS_REGION="us-east-1"; npm run deploy:s3-simple

# Or set them separately
set AWS_PROFILE=mr
set AWS_REGION=us-east-1
npm run deploy:s3-simple
```

### Option 3: Step by Step
```bash
npm run deploy-build    # Build for production
npm run deploy:s3-quick # Deploy to AWS
```

## 🧪 Testing & Development

### Test Build (with TypeScript check)
```bash
npm run test-build
```
This runs full validation including TypeScript checks.

### Build Only (skip TypeScript check)
```bash
npm run deploy-build
```
This builds for production without TypeScript validation.

### Local Development
```bash
npm run dev
```
This starts the local development server (unchanged).

## 📋 Environment Setup

Make sure your `.env` file contains:
```env
VITE_AWS_REGION=us-east-1
VITE_API_BASE_URL=https://your-api-gateway-url/v1
VITE_API_GATEWAY_URL=https://your-api-gateway-url/v1/
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_COGNITO_IDENTITY_POOL_ID=us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
VITE_COGNITO_DOMAIN=your-domain.auth.us-east-1.amazoncognito.com
VITE_WEBSOCKET_URL=wss://your-websocket-api-url/prod
```

## ⚠️ Important Notes

1. **Local Development**: All changes preserve local development functionality
2. **TypeScript Errors**: Deployment works even with TypeScript errors (for faster deployment)
3. **Environment Variables**: Uses fallback values so local development continues to work
4. **AWS CLI Required**: Make sure AWS CLI is installed and configured

## 🔒 Security Features

- **Private S3 Bucket**: S3 bucket is kept private (no public access)
- **CloudFront OAI**: CloudFront uses Origin Access Identity to securely access S3
- **HTTPS Only**: CloudFront enforces HTTPS redirects
- **No Direct S3 Access**: Files can only be accessed through CloudFront

## 🔧 Troubleshooting

### If deployment fails:
1. Check AWS CLI: `aws sts get-caller-identity`
2. Verify environment: `npm run setup-env`
3. Try build only: `npm run deploy-build`
4. Check IAM permissions for CloudFront and S3

### If local development breaks:
1. The app should work exactly as before
2. Environment variables have fallback values
3. All existing functionality is preserved

### Common Issues:
- **IAM Permissions**: Ensure your AWS user has CloudFront and S3 permissions
- **Region Issues**: Make sure AWS_REGION is set correctly
- **Profile Issues**: Verify AWS_PROFILE is configured properly

## 📁 Generated Files

After deployment, you'll find:
- `deployment-info.json` - Contains S3 and CloudFront URLs
- `.env.production` - Production environment configuration
- `dist/` - Built application files

## 🌐 Accessing Your App

After deployment:
1. **S3 Website URL**: Available immediately
2. **CloudFront URL**: Takes 10-15 minutes to deploy
3. **Custom Domain**: Can be configured later

Check `deployment-info.json` for the exact URLs.