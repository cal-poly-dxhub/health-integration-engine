param(
    [string]$Profile = "",
    [string]$Region = "us-east-1"
)

$ErrorActionPreference = "Stop"

# Build AWS CLI flags
$awsArgs = @()
if ($Profile -ne "") {
    $awsArgs += "--profile", $Profile
    $env:AWS_PROFILE = $Profile
    Write-Host "Using AWS profile: $Profile"
}

# Set region env vars early so all tools (CDK, AWS CLI) pick it up
$env:CDK_DEFAULT_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region
$env:AWS_REGION = $Region
Write-Host "Using region: $Region"

$RootDir = (Resolve-Path "$PSScriptRoot\..").Path

Set-Location $RootDir

Write-Host "=== Installing Dependencies ==="
npm run install:all
if ($LASTEXITCODE -ne 0) { throw "install:all failed" }

Write-Host "=== Building Lambda Functions ==="
Set-Location "$RootDir\lambda-functions\workflow-lambda"
npm install; if ($LASTEXITCODE -ne 0) { throw "workflow-lambda install failed" }
npm run build; if ($LASTEXITCODE -ne 0) { throw "workflow-lambda build failed" }

Set-Location "$RootDir\lambda-functions\deployment-lambda"
npm run build; if ($LASTEXITCODE -ne 0) { throw "deployment-lambda build failed" }

Set-Location "$RootDir\lambda-functions\websocket-lambda"
npm install; if ($LASTEXITCODE -ne 0) { throw "websocket-lambda install failed" }
npm run build; if ($LASTEXITCODE -ne 0) { throw "websocket-lambda build failed" }

Write-Host "=== Installing Infrastructure Dependencies ==="
Set-Location "$RootDir\infrastructure"
npm install; if ($LASTEXITCODE -ne 0) { throw "infrastructure install failed" }

Write-Host "=== Deploying CDK Infrastructure ==="
Set-Location "$RootDir\infrastructure"
Remove-Item -Recurse -Force "cdk.out" -ErrorAction SilentlyContinue
$cdkCmd = "npx cdk deploy --require-approval never --outputs-file cdk-outputs.json $($awsArgs -join ' ')"
Invoke-Expression $cdkCmd
if ($LASTEXITCODE -ne 0) { throw "CDK deploy failed" }

Write-Host "=== Extracting CDK Outputs ==="
$outputs = Get-Content cdk-outputs.json | ConvertFrom-Json
$stack = $outputs.WorkflowBuilderStack

$ApiUrl = $stack.ApiGatewayUrl
$UserPoolId = $stack.UserPoolId
$UserPoolClientId = $stack.UserPoolClientId
$IdentityPoolId = $stack.IdentityPoolId
$CognitoDomain = $stack.CognitoDomain
$WebSocketUrl = $stack.WebSocketApiUrl

$stackProps = $stack.PSObject.Properties
$S3Bucket = ($stackProps | Where-Object { $_.Name -like "FrontendHostingFrontendBucketName*" }).Value
$CloudFrontId = ($stackProps | Where-Object { $_.Name -like "FrontendHostingCloudFrontDistributionId*" }).Value
$CloudFrontUrl = ($stackProps | Where-Object { $_.Name -like "FrontendHostingCloudFrontUrl*" }).Value

Write-Host "=== Reading config flags ==="
$configYaml = Get-Content "$RootDir\infrastructure\config.yaml" -Raw
if ($configYaml -match 'enableOpenSearch:\s*(true|false)') { $EnableOpenSearch = $Matches[1] } else { $EnableOpenSearch = "true" }

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
VITE_ENABLE_OPENSEARCH=$EnableOpenSearch
"@ | Set-Content .env -Encoding UTF8

Write-Host "=== Building Frontend ==="
npm run build; if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }

Write-Host "=== Deploying to S3 ==="
aws s3 sync dist/ "s3://$S3Bucket/" --delete --region $Region @awsArgs
if ($LASTEXITCODE -ne 0) { throw "S3 sync failed" }

Write-Host "=== Invalidating CloudFront Cache ==="
aws cloudfront create-invalidation --distribution-id $CloudFrontId --paths "/*" @awsArgs
if ($LASTEXITCODE -ne 0) { throw "CloudFront invalidation failed" }

Write-Host ""
Write-Host "=== Deployment Complete ==="
Write-Host "Frontend URL: $CloudFrontUrl"
