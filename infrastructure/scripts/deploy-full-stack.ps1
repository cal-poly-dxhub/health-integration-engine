# Full Stack Deployment Script for Windows PowerShell
param(
    [string]$Environment = "development",
    [string]$Region = "us-west-2",
    [string]$Profile = "default"
)

Write-Host "🚀 Starting full-stack deployment..." -ForegroundColor Green

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InfraDir = Split-Path -Parent $ScriptDir
$ProjectRoot = Split-Path -Parent $InfraDir
$FrontendDir = Join-Path $ProjectRoot "frontend"

Write-Host "Environment: $Environment" -ForegroundColor Blue
Write-Host "Region: $Region" -ForegroundColor Blue
Write-Host "Profile: $Profile" -ForegroundColor Blue

# Step 1: Deploy CDK Infrastructure
Write-Host "`nStep 1: Deploying CDK infrastructure..." -ForegroundColor Green
Set-Location $InfraDir
$env:NODE_ENV = $Environment
npm run deploy

# Step 2: Get Stack Outputs
Write-Host "`nStep 2: Retrieving stack outputs..." -ForegroundColor Green
$StackName = "WorkflowBuilderStack"

$FrontendBucket = aws cloudformation describe-stacks `
    --stack-name $StackName `
    --region $Region `
    --profile $Profile `
    --query 'Stacks[0].Outputs[?OutputKey==`FrontendBucketName`].OutputValue' `
    --output text

$CloudFrontUrl = aws cloudformation describe-stacks `
    --stack-name $StackName `
    --region $Region `
    --profile $Profile `
    --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontUrl`].OutputValue' `
    --output text

$CloudFrontDistId = aws cloudformation describe-stacks `
    --stack-name $StackName `
    --region $Region `
    --profile $Profile `
    --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionId`].OutputValue' `
    --output text

Write-Host "Frontend Bucket: $FrontendBucket"
Write-Host "CloudFront URL: $CloudFrontUrl"
Write-Host "Distribution ID: $CloudFrontDistId"

# Step 3: Build Frontend
Write-Host "`nStep 3: Building frontend..." -ForegroundColor Green
Set-Location $FrontendDir
npm run build

# Step 4: Deploy to S3
Write-Host "`nStep 4: Deploying frontend to S3..." -ForegroundColor Green
aws s3 sync dist/ s3://$FrontendBucket `
    --region $Region `
    --profile $Profile `
    --delete `
    --cache-control "no-cache"

# Step 5: Invalidate CloudFront Cache
Write-Host "`nStep 5: Invalidating CloudFront cache..." -ForegroundColor Green
aws cloudfront create-invalidation `
    --distribution-id $CloudFrontDistId `
    --paths "/*" `
    --profile $Profile `
    --region $Region

Write-Host "`n✅ Deployment complete!" -ForegroundColor Green
Write-Host "`nAccess your application at:" -ForegroundColor Blue
Write-Host $CloudFrontUrl -ForegroundColor Green
