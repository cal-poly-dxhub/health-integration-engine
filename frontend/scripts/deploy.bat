@echo off
REM Frontend deployment script for Windows Command Prompt

echo Starting frontend deployment...

REM Check if we're in the frontend directory
if not exist package.json (
    echo Error: package.json not found. Please run this script from the frontend directory.
    exit /b 1
)

REM Run type check
echo Running type check...
call npm run type-check
if %errorlevel% neq 0 (
    echo Type check failed. Please fix TypeScript errors before deploying.
    exit /b 1
)

REM Run linting
echo Running linter...
call npm run lint
if %errorlevel% neq 0 (
    echo Linting failed. Please fix linting errors before deploying.
    exit /b 1
)

REM Build the application
echo Building application...
call npm run build
if %errorlevel% neq 0 (
    echo Build failed. Please check the build errors.
    exit /b 1
)

echo Frontend build completed successfully!
echo Built files are in the 'dist' directory.

REM Optional: Start preview server
set /p startPreview="Would you like to start the preview server? (y/n): "
if /i "%startPreview%"=="y" (
    echo Starting preview server...
    call npm run preview
)