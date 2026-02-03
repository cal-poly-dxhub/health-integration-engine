#!/usr/bin/env pwsh

# AWS Step Functions Workflow Builder - Infrastructure Deployment Script (PowerShell)

param(
    [Parameter(HelpMessage="Environment (development|staging|production)")]
    [ValidateSet("development", "staging", "production")]
    [string]$Environment = "development",
    
    [Parameter(HelpMessage="AWS region")]
    [string]$Region = "us-east-1",
    
    [Parameter(HelpMessage="AWS profile to use")]
    [string]$Profile = "",
    
    [Parameter(HelpMessage="Bootstrap CDK in the account/region")]
    [switch]$Bootstrap,
    
    [Parameter(HelpMessage="Destroy the stack instead of deploying")]
    [switch]$Destroy,
    
    [Parameter(HelpMessage="Show help message")]
    [switch]$Help
)

# Function to print colored output
function Write-Status {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

# Function to show usage
function Show-Usage {
    Write-Host "AWS Step Functions Workflow Builder - Infrastructure Deployment"
    Write-Host ""
    Write-Host "Usage: .\deploy.ps1 [OPTIONS]"
    Write-Host ""
    Write-Host "Parameters:"
    Write-Host "  -Environment    Environment (development|staging|production) [default: development]"
    Write-Host "  -Region         AWS region [default: us-east-1]"
    Write-Host "  -Profile        AWS profile to use"
    Write-Host "  -Bootstrap      Bootstrap CDK in the account/region"
    Write-Host "  -Destroy        Destroy the stack instead of deploying"
    Write-Host "  -Help           Show this help message"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  .\deploy.ps1 -Environment development -Region us-east-1"
    Write-Host "  .\deploy.ps1 -Bootstrap -Profile my-aws-profile"
    Write-Host "  .\deploy.ps1 -Destroy -Environment staging"
}

# Show help if requested
if ($Help) {
    Show-Usage
    exit 0
}

# Set AWS profile if provided
if ($Profile) {
    $env:AWS_PROFILE = $Profile
    Write-Status "Using AWS profile: $Profile"
}

# Set environment variables
$env:NODE_ENV = $Environment
$env:CDK_DEFAULT_REGION = $Region

Write-Status "Environment: $Environment"
Write-Status "Region: $Region"

# Check if AWS CLI is installed
try {
    $null = Get-Command aws -ErrorAction Stop
} catch {
    Write-Error "AWS CLI is not installed. Please install it first."
    exit 1
}

# Check if CDK is installed
try {
    $null = Get-Command cdk -ErrorAction Stop
} catch {
    Write-Error "AWS CDK is not installed. Please install it first."
    Write-Error "Run: npm install -g aws-cdk"
    exit 1
}

# Check AWS credentials
try {
    $null = aws sts get-caller-identity 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "AWS credentials check failed"
    }
} catch {
    Write-Error "AWS credentials not configured or invalid."
    Write-Error "Please configure your AWS credentials using 'aws configure' or set environment variables."
    exit 1
}

# Get account ID
try {
    $AccountId = aws sts get-caller-identity --query Account --output text
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to get account ID"
    }
    $env:CDK_DEFAULT_ACCOUNT = $AccountId
    Write-Status "AWS Account: $AccountId"
} catch {
    Write-Error "Failed to get AWS account ID"
    exit 1
}

# Change to infrastructure directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InfraDir = Split-Path -Parent $ScriptDir
Set-Location $InfraDir

# Install dependencies
Write-Status "Installing dependencies..."
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to install dependencies"
    exit 1
}

# Build the project
Write-Status "Building CDK project..."
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to build CDK project"
    exit 1
}

# Bootstrap CDK if requested
if ($Bootstrap) {
    Write-Status "Bootstrapping CDK in account $AccountId, region $Region..."
    cdk bootstrap "aws://$AccountId/$Region"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "CDK bootstrap failed"
        exit 1
    }
}

# Deploy or destroy
if ($Destroy) {
    Write-Warning "This will destroy the WorkflowBuilderStack and all its resources."
    $confirmation = Read-Host "Are you sure you want to continue? (y/N)"
    if ($confirmation -match "^[Yy]$") {
        Write-Status "Destroying stack..."
        cdk destroy WorkflowBuilderStack --force
        if ($LASTEXITCODE -eq 0) {
            Write-Status "Stack destroyed successfully!"
        } else {
            Write-Error "Stack destruction failed!"
            exit 1
        }
    } else {
        Write-Status "Destruction cancelled."
    }
} else {
    Write-Status "Deploying WorkflowBuilderStack..."
    cdk deploy WorkflowBuilderStack --require-approval never
    
    if ($LASTEXITCODE -eq 0) {
        Write-Status "Deployment completed successfully!"
        Write-Status ""
        Write-Status "Stack outputs:"
        aws cloudformation describe-stacks --stack-name WorkflowBuilderStack --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' --output table
    } else {
        Write-Error "Deployment failed!"
        exit 1
    }
}