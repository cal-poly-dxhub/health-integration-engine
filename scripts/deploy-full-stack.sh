#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

REGION=""
PROFILE=""

# Parse CLI arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --region|-r) REGION="$2"; shift 2 ;;
    --profile|-p) PROFILE="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Resolve region: CLI param > AWS profile > error
if [ -z "$REGION" ]; then
  if [ -n "$PROFILE" ]; then
    REGION=$(aws configure get region --profile "$PROFILE" 2>/dev/null || true)
  else
    REGION=$(aws configure get region 2>/dev/null || true)
  fi
fi
if [ -z "$REGION" ]; then
  echo "Error: Region is required. Pass --region or configure it in your AWS profile."
  exit 1
fi

# Build AWS CLI flags
AWS_FLAGS="--region $REGION"
CDK_FLAGS=""
if [ -n "$PROFILE" ]; then
  AWS_FLAGS="$AWS_FLAGS --profile $PROFILE"
  CDK_FLAGS="--profile $PROFILE"
fi

echo "=== Deploying with Region=$REGION ${PROFILE:+Profile=$PROFILE} ==="

echo "=== Installing Dependencies ==="
npm run install:all

echo "=== Building Lambda Functions ==="
cd "$ROOT_DIR/lambda-functions/workflow-lambda" && npm install && npm run build && cd "$ROOT_DIR"
cd "$ROOT_DIR/lambda-functions/deployment-lambda" && npm run build && cd "$ROOT_DIR"
cd "$ROOT_DIR/lambda-functions/websocket-lambda" && npm install && npm run build && cd "$ROOT_DIR"

echo "=== Installing Infrastructure Dependencies ==="
cd "$ROOT_DIR/infrastructure" && npm install && cd "$ROOT_DIR"

echo "=== Deploying CDK Infrastructure ==="
cd "$ROOT_DIR/infrastructure"
cdk deploy --require-approval never --outputs-file cdk-outputs.json $CDK_FLAGS

echo "=== Extracting CDK Outputs ==="
API_URL=$(jq -r '.WorkflowBuilderStack.ApiGatewayUrl' cdk-outputs.json)
USER_POOL_ID=$(jq -r '.WorkflowBuilderStack.UserPoolId' cdk-outputs.json)
USER_POOL_CLIENT_ID=$(jq -r '.WorkflowBuilderStack.UserPoolClientId' cdk-outputs.json)
IDENTITY_POOL_ID=$(jq -r '.WorkflowBuilderStack.IdentityPoolId' cdk-outputs.json)
COGNITO_DOMAIN=$(jq -r '.WorkflowBuilderStack.CognitoDomain' cdk-outputs.json)
WEBSOCKET_URL=$(jq -r '.WorkflowBuilderStack.WebSocketApiUrl' cdk-outputs.json)
S3_BUCKET=$(jq -r '.WorkflowBuilderStack | to_entries[] | select(.key | startswith("FrontendHostingFrontendBucketName")) | .value' cdk-outputs.json)
CLOUDFRONT_ID=$(jq -r '.WorkflowBuilderStack | to_entries[] | select(.key | startswith("FrontendHostingCloudFrontDistributionId")) | .value' cdk-outputs.json)
CLOUDFRONT_URL=$(jq -r '.WorkflowBuilderStack | to_entries[] | select(.key | startswith("FrontendHostingCloudFrontUrl")) | .value' cdk-outputs.json)

echo "=== Updating Frontend .env ==="
cd "$ROOT_DIR/frontend"
cat > .env << EOF
VITE_AWS_REGION=$REGION
VITE_API_BASE_URL=$API_URL
VITE_API_GATEWAY_URL=$API_URL
VITE_COGNITO_USER_POOL_ID=$USER_POOL_ID
VITE_COGNITO_USER_POOL_CLIENT_ID=$USER_POOL_CLIENT_ID
VITE_COGNITO_IDENTITY_POOL_ID=$IDENTITY_POOL_ID
VITE_COGNITO_DOMAIN=$COGNITO_DOMAIN
VITE_WEBSOCKET_URL=$WEBSOCKET_URL
VITE_NODE_ENV=development
VITE_ENABLE_DEBUG=true
VITE_ENABLE_MOCK_DATA=false
EOF

echo "=== Building Frontend ==="
npm run build

echo "=== Deploying to S3 ==="
aws s3 sync dist/ "s3://$S3_BUCKET/" --delete $AWS_FLAGS

echo "=== Invalidating CloudFront Cache ==="
aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_ID" --paths "/*" $AWS_FLAGS

echo ""
echo "=== Deployment Complete ==="
echo "Frontend URL: $CLOUDFRONT_URL"
