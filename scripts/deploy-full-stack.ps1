$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
Set-Location $RootDir

$Region = "us-west-2"

Write-Host "=== Installing Dependencies ==="
npm run install:all

Write-Host "=== Building Lambda Functions ==="
Set-Location "$RootDir\lambda-functions\workflow-lambda"
npm install
npm run build
Set-Location "$RootDir\lambda-functions\deployment-lambda"
npm run build
Set-Location "$RootDir\lambda-functions\websocket-lambda"
npm install
npm run build
Set-Location $RootDir

Write-Host "=== Installing Infrastructure Dependencies ==="
Set-Location "$RootDir\infrastructure"
npm install
Set-Location $RootDir

Write-Host "=== Deploying CDK Infrastructure ==="
Set-Location "$RootDir\infrastructure"
cdk deploy --require-approval never --outputs-file cdk-outputs.json

Write-Host "=== Extracting CDK Outputs ==="
$CdkOutputs = Get-Content cdk-outputs.json | ConvertFrom-Json
$Stack = $CdkOutputs.WorkflowBuilderStack

$ApiUrl = $Stack.ApiGatewayUrl
$UserPoolId = $Stack.UserPoolId
$UserPoolClientId = $Stack.UserPoolClientId
$IdentityPoolId = $Stack.IdentityPoolId
$CognitoDomain = $Stack.CognitoDomain
$WebSocketUrl = $Stack.WebSocketApiUrl

$S3Bucket = ($Stack.PSObject.Properties | Where-Object { $_.Name -like "FrontendHostingFrontendBucketName*" }).Value
$CloudFrontId = ($Stack.PSObject.Properties | Where-Object { $_.Name -like "FrontendHostingCloudFrontDistributionId*" }).Value
$CloudFrontUrl = ($Stack.PSObject.Properties | Where-Object { $_.Name -like "FrontendHostingCloudFrontUrl*" }).Value

Write-Host "=== Updating Frontend .env ==="
Set-Location "$RootDir\frontend"
@"
VITE_AWS_REGION=$Region
VITE_API_BASE_URL=$ApiUrl
VITE_API_GATEWAY_URL=$ApiUrl
VITE_COGNITO_USER_POOL_ID=$UserPoolId
VITE_COGNITO_USER_POOL_CLIENT_ID=$UserPoolClientId
VITE_COGNITO_IDENTITY_POOL_ID=$IdentityPoolId
VITE_COGNITO_DOMAIN=$CognitoDomain
VITE_WEBSOCKET_URL=$WebSocketUrl
VITE_NODE_ENV=development
VITE_ENABLE_DEBUG=true
VITE_ENABLE_MOCK_DATA=false
"@ | Out-File -FilePath .env -Encoding utf8

Write-Host "=== Building Frontend ==="
npm run build

Write-Host "=== Deploying to S3 ==="
aws s3 sync dist/ "s3://$S3Bucket/" --delete --region $Region

Write-Host "=== Invalidating CloudFront Cache ==="
aws cloudfront create-invalidation --distribution-id $CloudFrontId --paths "/*"

Write-Host ""
Write-Host "=== Deployment Complete ==="
Write-Host "Frontend URL: $CloudFrontUrl"
