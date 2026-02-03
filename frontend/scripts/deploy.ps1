# Frontend deployment script for Windows PowerShell

Write-Host "Starting frontend deployment..." -ForegroundColor Green

# Check if we're in the frontend directory
if (!(Test-Path "package.json")) {
    Write-Host "Error: package.json not found. Please run this script from the frontend directory." -ForegroundColor Red
    exit 1
}

# Run type check
Write-Host "Running type check..." -ForegroundColor Yellow
npm run type-check
if ($LASTEXITCODE -ne 0) {
    Write-Host "Type check failed. Please fix TypeScript errors before deploying." -ForegroundColor Red
    exit 1
}

# Run linting
Write-Host "Running linter..." -ForegroundColor Yellow
npm run lint
if ($LASTEXITCODE -ne 0) {
    Write-Host "Linting failed. Please fix linting errors before deploying." -ForegroundColor Red
    exit 1
}

# Build the application
Write-Host "Building application..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed. Please check the build errors." -ForegroundColor Red
    exit 1
}

Write-Host "Frontend build completed successfully!" -ForegroundColor Green
Write-Host "Built files are in the 'dist' directory." -ForegroundColor Cyan

# Optional: Start preview server
$startPreview = Read-Host "Would you like to start the preview server? (y/n)"
if ($startPreview -eq "y" -or $startPreview -eq "Y") {
    Write-Host "Starting preview server..." -ForegroundColor Yellow
    npm run preview
}