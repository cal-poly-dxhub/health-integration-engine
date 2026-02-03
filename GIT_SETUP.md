# Git Setup Guide for MessageRouterSolution

## Quick Start

```bash
# Initialize git repository
git init

# Add all files (respecting .gitignore)
git add .

# Create initial commit
git commit -m "Initial commit: AWS Step Functions Workflow Builder"

# Add remote repository (replace with your repo URL)
git remote add origin https://github.com/yourusername/MessageRouterSolution.git

# Push to GitHub
git push -u origin main
```

## What's Ignored (Won't Be Committed)

The `.gitignore` file prevents these sensitive/unnecessary files from being committed:

### 🔒 Critical - Never Commit These
- ❌ `.env` files (contain AWS credentials and secrets)
- ❌ `deployment-info.json` (contains account-specific data)
- ❌ `*.pem`, `*.key` files (private keys)
- ❌ `credentials.json`, `secrets.json` (sensitive data)

### 📦 Build Artifacts (Can Be Regenerated)
- ❌ `node_modules/` (dependencies - reinstall with `npm install`)
- ❌ `dist/`, `build/` (build outputs)
- ❌ `cdk.out/` (CDK synthesized templates)
- ❌ `*.zip` (Lambda packages)

### 💻 IDE and OS Files
- ❌ `.vscode/`, `.idea/` (IDE settings)
- ❌ `.DS_Store`, `Thumbs.db` (OS files)

### ✅ What IS Committed
- ✅ Source code (`src/`, `lib/`)
- ✅ Configuration files (`package.json`, `tsconfig.json`, `cdk.json`)
- ✅ `.env.example` (template for environment variables)
- ✅ Documentation (`README.md`, `*.md`)
- ✅ Scripts (`scripts/`)

## Before First Commit - Checklist

### 1. Verify No Secrets Are Staged
```bash
# Check what will be committed
git status

# Review specific files
git diff --cached

# If you see any .env files or secrets, remove them:
git reset HEAD .env
git reset HEAD deployment-info.json
```

### 2. Ensure .env.example Exists
```bash
# Check if .env.example exists
ls frontend/.env.example

# If not, create it from .env (remove actual values)
# Copy .env to .env.example and replace real values with placeholders
```

### 3. Clean Up Unnecessary Files
```bash
# Remove node_modules if accidentally added
git rm -r --cached node_modules

# Remove build artifacts
git rm -r --cached dist cdk.out
```

## Creating .env.example Files

For each `.env` file, create a corresponding `.env.example`:

**frontend/.env.example:**
```env
# AWS Configuration
VITE_AWS_REGION=us-east-1
VITE_API_GATEWAY_URL=https://your-api-gateway-url/v1/

# Cognito Configuration (get from CDK outputs after deployment)
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_COGNITO_IDENTITY_POOL_ID=us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
VITE_COGNITO_DOMAIN=your-domain.auth.us-east-1.amazoncognito.com

# Development Configuration
VITE_NODE_ENV=development

# Feature Flags
VITE_ENABLE_DEBUG=true
VITE_ENABLE_MOCK_DATA=false

# WebSocket Configuration
VITE_WEBSOCKET_URL=wss://your-websocket-api-url/prod
```

## Git Workflow

### Daily Development
```bash
# Check status
git status

# Add specific files
git add src/components/NewComponent.tsx

# Or add all changes
git add .

# Commit with descriptive message
git commit -m "feat: Add new workflow node type"

# Push to remote
git push
```

### Branch Strategy
```bash
# Create feature branch
git checkout -b feature/new-feature

# Work on feature...
git add .
git commit -m "feat: Implement new feature"

# Push feature branch
git push -u origin feature/new-feature

# Merge to main (after review)
git checkout main
git merge feature/new-feature
git push
```

## Common Git Commands

### Checking Status
```bash
# See what's changed
git status

# See detailed changes
git diff

# See commit history
git log --oneline
```

### Undoing Changes
```bash
# Discard changes in working directory
git checkout -- filename

# Unstage file
git reset HEAD filename

# Undo last commit (keep changes)
git reset --soft HEAD~1

# Undo last commit (discard changes)
git reset --hard HEAD~1
```

### Cleaning Up
```bash
# Remove untracked files (dry run)
git clean -n

# Remove untracked files
git clean -f

# Remove untracked files and directories
git clean -fd
```

## GitHub Setup

### 1. Create Repository on GitHub
1. Go to https://github.com/new
2. Name: `MessageRouterSolution` (or your preferred name)
3. Description: "AWS Step Functions Workflow Builder"
4. Choose Public or Private
5. **DO NOT** initialize with README (we already have one)
6. Click "Create repository"

### 2. Connect Local Repository
```bash
# Add remote
git remote add origin https://github.com/yourusername/MessageRouterSolution.git

# Verify remote
git remote -v

# Push to GitHub
git push -u origin main
```

### 3. Set Up Branch Protection (Optional)
On GitHub:
1. Go to Settings → Branches
2. Add rule for `main` branch
3. Enable:
   - Require pull request reviews
   - Require status checks to pass
   - Require branches to be up to date

## Collaborating with Your Colleague

### For You (Repository Owner)
```bash
# After colleague clones
# They need to:
# 1. Copy .env.example to .env
# 2. Fill in their AWS credentials
# 3. Run npm install
```

### For Your Colleague
```bash
# Clone repository
git clone https://github.com/yourusername/MessageRouterSolution.git
cd MessageRouterSolution

# Set up environment
cp frontend/.env.example frontend/.env
# Edit frontend/.env with their AWS values

# Install dependencies
npm run install:all

# Create their own branch
git checkout -b colleague-name/feature-name

# Make changes and push
git add .
git commit -m "feat: Add feature"
git push -u origin colleague-name/feature-name
```

## Security Best Practices

### ✅ DO
- ✅ Always use `.env.example` for templates
- ✅ Review changes before committing (`git diff`)
- ✅ Use descriptive commit messages
- ✅ Keep `.gitignore` up to date
- ✅ Use branch protection on main branch

### ❌ DON'T
- ❌ Never commit `.env` files
- ❌ Never commit AWS credentials
- ❌ Never commit `deployment-info.json`
- ❌ Never commit private keys (`.pem`, `.key`)
- ❌ Never force push to main (`git push -f`)

## Troubleshooting

### "I accidentally committed .env file!"
```bash
# Remove from git but keep local file
git rm --cached frontend/.env

# Commit the removal
git commit -m "Remove .env from git"

# Push
git push

# If already pushed, you may need to:
# 1. Rotate all credentials in the .env file
# 2. Use git filter-branch or BFG Repo-Cleaner to remove from history
```

### "My .gitignore isn't working"
```bash
# Git might be tracking files before .gitignore was added
# Remove from git cache
git rm -r --cached .
git add .
git commit -m "Fix .gitignore"
```

### "I have merge conflicts"
```bash
# See conflicted files
git status

# Edit files to resolve conflicts
# Look for <<<<<<< HEAD markers

# After resolving
git add resolved-file.ts
git commit -m "Resolve merge conflicts"
```

## Useful Git Aliases

Add to `~/.gitconfig`:
```ini
[alias]
    st = status
    co = checkout
    br = branch
    ci = commit
    unstage = reset HEAD --
    last = log -1 HEAD
    visual = log --oneline --graph --decorate --all
```

## Additional Resources

- [Git Documentation](https://git-scm.com/doc)
- [GitHub Guides](https://guides.github.com/)
- [Git Cheat Sheet](https://education.github.com/git-cheat-sheet-education.pdf)
- [Conventional Commits](https://www.conventionalcommits.org/)

## Commit Message Convention

Use conventional commits for better history:

```
feat: Add new feature
fix: Fix bug
docs: Update documentation
style: Format code
refactor: Refactor code
test: Add tests
chore: Update dependencies
```

Examples:
```bash
git commit -m "feat: Add S3 node type to workflow builder"
git commit -m "fix: Resolve empty email in signup confirmation"
git commit -m "docs: Update deployment instructions"
git commit -m "chore: Update AWS SDK dependencies"
```
