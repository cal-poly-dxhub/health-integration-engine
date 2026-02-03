# Push MessageRouterSolution to GitHub
# Usage: .\push-to-github.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Push MessageRouterSolution to GitHub" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (!(Test-Path "package.json")) {
    Write-Host "ERROR: Not in MessageRouterSolution directory!" -ForegroundColor Red
    Write-Host "Please run this script from the MessageRouterSolution folder" -ForegroundColor Yellow
    exit 1
}

# Check if git is initialized
if (!(Test-Path ".git")) {
    Write-Host "Initializing git repository..." -ForegroundColor Yellow
    git init
    Write-Host "✓ Git initialized" -ForegroundColor Green
} else {
    Write-Host "✓ Git already initialized" -ForegroundColor Green
}

# Check for sensitive files
Write-Host ""
Write-Host "Checking for sensitive files..." -ForegroundColor Yellow

$sensitiveFiles = @(
    "frontend/.env",
    ".env.production",
    "deployment-info.json",
    "frontend/deployment-info.json"
)

$foundSensitive = $false
foreach ($file in $sensitiveFiles) {
    if (Test-Path $file) {
        Write-Host "⚠ WARNING: Found sensitive file: $file" -ForegroundColor Red
        $foundSensitive = $true
    }
}

if ($foundSensitive) {
    Write-Host ""
    Write-Host "IMPORTANT: These files should NOT be committed!" -ForegroundColor Red
    Write-Host "They are in .gitignore and won't be committed." -ForegroundColor Yellow
    Write-Host ""
}

# Add all files
Write-Host "Adding files to git..." -ForegroundColor Yellow
git add .

# Show what will be committed
Write-Host ""
Write-Host "Files to be committed:" -ForegroundColor Cyan
git status --short

# Check if .env files are staged (they shouldn't be)
$stagedEnv = git status --short | Select-String "\.env$"
if ($stagedEnv) {
    Write-Host ""
    Write-Host "ERROR: .env files are staged for commit!" -ForegroundColor Red
    Write-Host "This should not happen. Please check your .gitignore" -ForegroundColor Red
    exit 1
}

# Confirm before committing
Write-Host ""
$confirm = Read-Host "Do you want to commit these files? (y/n)"
if ($confirm -ne "y") {
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 0
}

# Create commit
Write-Host ""
$commitMessage = Read-Host "Enter commit message (or press Enter for default)"
if ([string]::IsNullOrWhiteSpace($commitMessage)) {
    $commitMessage = "Initial commit: AWS Step Functions Workflow Builder"
}

Write-Host "Creating commit..." -ForegroundColor Yellow
git commit -m $commitMessage

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Commit failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Commit created" -ForegroundColor Green

# Check if remote exists
$remoteExists = git remote | Select-String "origin"

if (!$remoteExists) {
    Write-Host ""
    Write-Host "Adding remote repository..." -ForegroundColor Yellow
    $repoUrl = Read-Host "Enter GitHub repository URL (e.g., https://github.com/username/health-integration-engine.git)"
    
    if ([string]::IsNullOrWhiteSpace($repoUrl)) {
        Write-Host "ERROR: Repository URL is required!" -ForegroundColor Red
        exit 1
    }
    
    git remote add origin $repoUrl
    Write-Host "✓ Remote added" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "✓ Remote 'origin' already exists" -ForegroundColor Green
    git remote -v
}

# Push to GitHub
Write-Host ""
Write-Host "Pushing to GitHub..." -ForegroundColor Yellow
Write-Host ""

$pushConfirm = Read-Host "Ready to push to GitHub? (y/n)"
if ($pushConfirm -ne "y") {
    Write-Host "Aborted. You can push later with: git push -u origin main" -ForegroundColor Yellow
    exit 0
}

git push -u origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Push failed. This might be because:" -ForegroundColor Yellow
    Write-Host "1. The branch already exists on remote" -ForegroundColor Yellow
    Write-Host "2. Authentication failed" -ForegroundColor Yellow
    Write-Host "3. Remote has content that conflicts" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Try one of these:" -ForegroundColor Cyan
    Write-Host "  git pull origin main --allow-unrelated-histories" -ForegroundColor White
    Write-Host "  git push -u origin main --force (WARNING: overwrites remote)" -ForegroundColor White
    Write-Host "  git push -u origin messagerouter-solution (push to new branch)" -ForegroundColor White
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "✓ Successfully pushed to GitHub!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Share the repository URL with your colleague" -ForegroundColor White
Write-Host "2. They should clone: git clone <repo-url>" -ForegroundColor White
Write-Host "3. They should copy .env.example to .env and configure" -ForegroundColor White
Write-Host "4. They should run: npm run install:all" -ForegroundColor White
Write-Host ""
