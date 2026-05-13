param(
    [string]$Profile = "",
    [string]$Region = ""
)

$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path "$PSScriptRoot\..").Path

# Read region from config.yaml (if set)
$ConfigYaml = Get-Content "$RootDir\infrastructure\config.yaml" -Raw
$ConfigRegion = if ($ConfigYaml -match '(?m)^region:\s*["'']?([a-z0-9-]+)') { $Matches[1] } else { "" }

# Resolve region: config + CLI must match if both set; else config > CLI > profile > error
if ($Region -ne "" -and $ConfigRegion -ne "" -and $Region -ne $ConfigRegion) {
    throw "Region mismatch. config.yaml: $ConfigRegion, -Region: $Region"
}
if ($Region -eq "") { $Region = $ConfigRegion }
if ($Region -eq "") {
    $Region = if ($Profile -ne "") { (aws configure get region --profile $Profile 2>$null) } else { (aws configure get region 2>$null) }
}
if ([string]::IsNullOrWhiteSpace($Region)) {
    throw "Region is required. Set in config.yaml, pass -Region, or configure your AWS profile."
}

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

Set-Location $RootDir

# Build AWS CLI args for profile/region
$AwsArgs = @("--region", $Region)
$CdkArgs = @("deploy", "--require-approval", "never", "--outputs-file", "cdk-outputs.json")
if ($Profile) {
  $AwsArgs += @("--profile", $Profile)
  $CdkArgs += @("--profile", $Profile)
  Write-Host "Using AWS profile: $Profile"
}
Write-Host "Using region: $Region"

Write-Host "=== Installing Dependencies ==="
npm run install:all
Assert-ExitCode "npm install:all"

Write-Host "=== Building Lambda Functions ==="
Set-Location "$RootDir\lambda-functions\workflow-lambda"
npm install
Assert-ExitCode "workflow-lambda npm install"
npm run build
Assert-ExitCode "workflow-lambda build"

Set-Location "$RootDir\lambda-functions\deployment-lambda"
npm run build
Assert-ExitCode "deployment-lambda build"

Set-Location "$RootDir\lambda-functions\websocket-lambda"
npm install
Assert-ExitCode "websocket-lambda npm install"
npm run build
Assert-ExitCode "websocket-lambda build"

Set-Location $RootDir

Write-Host "=== Installing Infrastructure Dependencies ==="
Set-Location "$RootDir\infrastructure"
npm install
Assert-ExitCode "infrastructure npm install"
Set-Location $RootDir

Write-Host "=== Deploying CDK Infrastructure ==="
Set-Location "$RootDir\infrastructure"
$env:CDK_DEFAULT_REGION = $Region
if ($Profile) {
  $env:AWS_PROFILE = $Profile
}
npx cdk @CdkArgs
Assert-ExitCode "CDK deploy"

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
"@ | Out-File -FilePath .env -Encoding utf8

Write-Host "=== Building Frontend ==="
npm run build
Assert-ExitCode "frontend build"

Write-Host "=== Deploying to S3 ==="
aws s3 sync dist/ "s3://$S3Bucket/" --delete @AwsArgs
Assert-ExitCode "S3 sync"

Write-Host "=== Invalidating CloudFront Cache ==="
aws cloudfront create-invalidation --distribution-id $CloudFrontId --paths "/*" @AwsArgs
Assert-ExitCode "CloudFront invalidation"

Write-Host ""
Write-Host "=== Deployment Complete ==="
Write-Host "Frontend URL: $CloudFrontUrl"
