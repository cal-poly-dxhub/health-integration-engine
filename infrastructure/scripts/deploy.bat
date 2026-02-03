@echo off
REM AWS Step Functions Workflow Builder - Infrastructure Deployment Script (Batch)

setlocal enabledelayedexpansion

REM Default values
set ENVIRONMENT=development
set REGION=us-east-1
set PROFILE=
set BOOTSTRAP=false
set DESTROY=false

REM Parse command line arguments
:parse_args
if "%~1"=="" goto end_parse
if "%~1"=="--environment" (
    set ENVIRONMENT=%~2
    shift
    shift
    goto parse_args
)
if "%~1"=="--region" (
    set REGION=%~2
    shift
    shift
    goto parse_args
)
if "%~1"=="--profile" (
    set PROFILE=%~2
    shift
    shift
    goto parse_args
)
if "%~1"=="--bootstrap" (
    set BOOTSTRAP=true
    shift
    goto parse_args
)
if "%~1"=="--destroy" (
    set DESTROY=true
    shift
    goto parse_args
)
if "%~1"=="--help" (
    goto show_usage
)
shift
goto parse_args

:end_parse

REM Set AWS profile if provided
if not "%PROFILE%"=="" (
    set AWS_PROFILE=%PROFILE%
    echo [INFO] Using AWS profile: %PROFILE%
)

REM Set environment variables
set NODE_ENV=%ENVIRONMENT%
set CDK_DEFAULT_REGION=%REGION%

echo [INFO] Environment: %ENVIRONMENT%
echo [INFO] Region: %REGION%

REM Check if AWS CLI is installed
aws --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] AWS CLI is not installed. Please install it first.
    exit /b 1
)

REM Check if CDK is installed
cdk --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] AWS CDK is not installed. Please install it first.
    echo [ERROR] Run: npm install -g aws-cdk
    exit /b 1
)

REM Check AWS credentials
aws sts get-caller-identity >nul 2>&1
if errorlevel 1 (
    echo [ERROR] AWS credentials not configured or invalid.
    echo [ERROR] Please configure your AWS credentials using 'aws configure' or set environment variables.
    exit /b 1
)

REM Get account ID
for /f "tokens=*" %%i in ('aws sts get-caller-identity --query Account --output text') do set ACCOUNT_ID=%%i
set CDK_DEFAULT_ACCOUNT=%ACCOUNT_ID%
echo [INFO] AWS Account: %ACCOUNT_ID%

REM Change to infrastructure directory
cd /d "%~dp0\.."

REM Install dependencies
echo [INFO] Installing dependencies...
call npm install
if errorlevel 1 (
    echo [ERROR] Failed to install dependencies
    exit /b 1
)

REM Build the project
echo [INFO] Building CDK project...
call npm run build
if errorlevel 1 (
    echo [ERROR] Failed to build CDK project
    exit /b 1
)

REM Bootstrap CDK if requested
if "%BOOTSTRAP%"=="true" (
    echo [INFO] Bootstrapping CDK in account %ACCOUNT_ID%, region %REGION%...
    call cdk bootstrap aws://%ACCOUNT_ID%/%REGION%
    if errorlevel 1 (
        echo [ERROR] CDK bootstrap failed
        exit /b 1
    )
)

REM Deploy or destroy
if "%DESTROY%"=="true" (
    echo [WARNING] This will destroy the WorkflowBuilderStack and all its resources.
    set /p confirmation="Are you sure you want to continue? (y/N): "
    if /i "!confirmation!"=="y" (
        echo [INFO] Destroying stack...
        call cdk destroy WorkflowBuilderStack --force
        if errorlevel 1 (
            echo [ERROR] Stack destruction failed!
            exit /b 1
        ) else (
            echo [INFO] Stack destroyed successfully!
        )
    ) else (
        echo [INFO] Destruction cancelled.
    )
) else (
    echo [INFO] Deploying WorkflowBuilderStack...
    call cdk deploy WorkflowBuilderStack --require-approval never
    
    if errorlevel 1 (
        echo [ERROR] Deployment failed!
        exit /b 1
    ) else (
        echo [INFO] Deployment completed successfully!
        echo.
        echo [INFO] Stack outputs:
        aws cloudformation describe-stacks --stack-name WorkflowBuilderStack --query "Stacks[0].Outputs[*].[OutputKey,OutputValue]" --output table
    )
)

goto end

:show_usage
echo AWS Step Functions Workflow Builder - Infrastructure Deployment
echo.
echo Usage: deploy.bat [OPTIONS]
echo.
echo Options:
echo   --environment    Environment (development^|staging^|production) [default: development]
echo   --region         AWS region [default: us-east-1]
echo   --profile        AWS profile to use
echo   --bootstrap      Bootstrap CDK in the account/region
echo   --destroy        Destroy the stack instead of deploying
echo   --help           Show this help message
echo.
echo Examples:
echo   deploy.bat --environment development --region us-east-1
echo   deploy.bat --bootstrap --profile my-aws-profile
echo   deploy.bat --destroy --environment staging

:end
endlocal