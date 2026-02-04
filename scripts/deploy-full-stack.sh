#!/bin/bash
set -e

REGION="us-west-2"

echo "=== Installing Dependencies ==="
npm run install:all

echo "=== Building Lambda Functions ==="
cd lambda-functions/deployment-lambda && npm run build && cd ../..
cd lambda-functions/websocket-lambda && npm install && npm run build && cd ../..

echo "=== Deploying CDK Infrastructure ==="
cd infrastructure
cdk deploy --require-approval never --outputs-file cdk-outputs.json

echo "=== Extracting CDK Outputs ==="
API_URL=$(jq -r '.WorkflowBuilderStack.ApiGatewayUrl' cdk-outputs.json)
USER_POOL_ID=$(jq -r '.WorkflowBuilderStack.UserPoolId' cdk-outputs.json)
USER_POOL_CLIENT_ID=$(jq -r '.WorkflowBuilderStack.UserPoolClientId' cdk-outputs.json)
IDENTITY_POOL_ID=$(jq -r '.WorkflowBuilderStack.IdentityPoolId' cdk-outputs.json)
COGNITO_DOMAIN=$(jq -r '.WorkflowBuilderStack.CognitoDomain' cdk-outputs.json)
WEBSOCKET_URL=$(jq -r '.WorkflowBuilderStack.WebSocketApiUrl' cdk-outputs.json)
S3_BUCKET=$(jq -r '.WorkflowBuilderStack.FrontendHostingFrontendBucketName5F8AA9EC' cdk-outputs.json)
CLOUDFRONT_ID=$(jq -r '.WorkflowBuilderStack.FrontendHostingCloudFrontDistributionId39D3E489' cdk-outputs.json)
CLOUDFRONT_URL=$(jq -r '.WorkflowBuilderStack.FrontendHostingCloudFrontUrlAA25A79A' cdk-outputs.json)

echo "=== Updating Frontend .env ==="
cd ../frontend
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
aws s3 sync dist/ "s3://$S3_BUCKET/" --delete --region $REGION

echo "=== Invalidating CloudFront Cache ==="
aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_ID" --paths "/*"

echo ""
echo "=== Deployment Complete ==="
echo "Frontend URL: $CLOUDFRONT_URL"
