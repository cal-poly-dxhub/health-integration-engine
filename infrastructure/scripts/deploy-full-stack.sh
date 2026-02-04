#!/bin/bash
set -e

echo "🚀 Starting full-stack deployment..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$INFRA_DIR")"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

# Parse arguments
ENVIRONMENT="${1:-development}"
AWS_REGION="${AWS_REGION:-us-west-2}"

# Don't use AWS_PROFILE if not set
if [ -z "$AWS_PROFILE" ]; then
  PROFILE_ARG=""
else
  PROFILE_ARG="--profile $AWS_PROFILE"
fi

echo -e "${BLUE}Environment: $ENVIRONMENT${NC}"
echo -e "${BLUE}Region: $AWS_REGION${NC}"

# Step 1: Deploy CDK Infrastructure
echo -e "\n${GREEN}Step 1: Deploying CDK infrastructure...${NC}"
cd "$INFRA_DIR"
NODE_ENV=$ENVIRONMENT npm run deploy

# Step 2: Get Stack Outputs
echo -e "\n${GREEN}Step 2: Retrieving stack outputs...${NC}"
STACK_NAME="WorkflowBuilderStack"

FRONTEND_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $AWS_REGION \
  $PROFILE_ARG \
  --query 'Stacks[0].Outputs[?OutputKey==`FrontendHostingFrontendBucketName5F8AA9EC`].OutputValue' \
  --output text)

CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $AWS_REGION \
  $PROFILE_ARG \
  --query 'Stacks[0].Outputs[?OutputKey==`FrontendHostingCloudFrontUrlAA25A79A`].OutputValue' \
  --output text)

CLOUDFRONT_DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $AWS_REGION \
  $PROFILE_ARG \
  --query 'Stacks[0].Outputs[?OutputKey==`FrontendHostingCloudFrontDistributionId39D3E489`].OutputValue' \
  --output text)

echo "Frontend Bucket: $FRONTEND_BUCKET"
echo "CloudFront URL: $CLOUDFRONT_URL"
echo "Distribution ID: $CLOUDFRONT_DIST_ID"

# Step 3: Build Frontend
echo -e "\n${GREEN}Step 3: Building frontend...${NC}"
cd "$FRONTEND_DIR"
npm run build

# Step 4: Deploy to S3
echo -e "\n${GREEN}Step 4: Deploying frontend to S3...${NC}"
aws s3 sync dist/ s3://$FRONTEND_BUCKET \
  --region $AWS_REGION \
  $PROFILE_ARG \
  --delete \
  --cache-control "no-cache"

# Step 5: Invalidate CloudFront Cache
echo -e "\n${GREEN}Step 5: Invalidating CloudFront cache...${NC}"
aws cloudfront create-invalidation \
  --distribution-id $CLOUDFRONT_DIST_ID \
  --paths "/*" \
  $PROFILE_ARG

echo -e "\n${GREEN}✅ Deployment complete!${NC}"
echo -e "\n${BLUE}Access your application at:${NC}"
echo -e "${GREEN}$CLOUDFRONT_URL${NC}"
