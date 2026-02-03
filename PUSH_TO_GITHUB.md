# Push MessageRouterSolution to GitHub

## Quick Commands

```bash
cd MessageRouterSolution

# Initialize git (if not already done)
git init

# Add all files (respecting .gitignore)
git add .

# Check what will be committed (verify no .env files or secrets)
git status

# Create initial commit
git commit -m "Initial commit: AWS Step Functions Workflow Builder"

# Add your GitHub repository as remote
git remote add origin https://github.com/yourusername/health-integration-engine.git

# Push to GitHub (main branch)
git push -u origin main
```

## If You Get "Branch Already Exists" Error

If the repository already has content:

```bash
# Option 1: Pull first, then push
git pull origin main --allow-unrelated-histories
git push -u origin main

# Option 2: Force push (WARNING: This will overwrite remote)
git push -u origin main --force

# Option 3: Push to a new branch
git checkout -b messagerouter-solution
git push -u origin messagerouter-solution
```

## Verify Before Pushing

**CRITICAL: Check that no secrets are being committed!**

```bash
# See what files will be committed
git status

# Check for .env files (should NOT appear)
git status | findstr ".env"

# If you see .env files, they should NOT be committed
# Remove them from staging:
git reset HEAD frontend/.env
git reset HEAD .env.production
```

## Expected Files to Be Committed

✅ **Should be committed:**
- Source code (`src/`, `lib/`)
- Configuration (`package.json`, `tsconfig.json`, `cdk.json`)
- Documentation (`README.md`, `*.md`)
- Scripts (`scripts/`)
- `.env.example` files
- `.gitignore`

❌ **Should NOT be committed:**
- `.env` files
- `node_modules/`
- `dist/`, `build/`, `cdk.out/`
- `deployment-info.json`
- Any files with credentials or secrets

## After Pushing

Your colleague can clone and set up:

```bash
# Clone the repository
git clone https://github.com/yourusername/health-integration-engine.git
cd health-integration-engine

# Set up environment
cp frontend/.env.example frontend/.env
# Edit frontend/.env with their AWS credentials

# Install dependencies
npm run install:all

# Deploy infrastructure
cd infrastructure
npm install
npx cdk bootstrap --profile their-profile
npx cdk deploy --profile their-profile

# Start development
cd ../frontend
npm run dev
```

## Troubleshooting

### "Remote already exists"
```bash
# Remove existing remote
git remote remove origin

# Add correct remote
git remote add origin https://github.com/yourusername/health-integration-engine.git
```

### "Authentication failed"
```bash
# Use GitHub Personal Access Token
# Go to: GitHub → Settings → Developer settings → Personal access tokens
# Generate new token with 'repo' scope
# Use token as password when prompted
```

### "I accidentally committed .env"
```bash
# Remove from git but keep local file
git rm --cached frontend/.env
git commit -m "Remove .env from git"
git push

# IMPORTANT: Rotate all credentials in that .env file!
```

## Repository Structure on GitHub

After pushing, your repository will look like:

```
health-integration-engine/
├── .gitignore
├── README.md
├── SHARING_PACKAGE.md
├── GIT_SETUP.md
├── package.json
├── frontend/
│   ├── src/
│   ├── public/
│   ├── scripts/
│   ├── .env.example
│   ├── package.json
│   └── ...
├── infrastructure/
│   ├── lib/
│   ├── bin/
│   ├── scripts/
│   ├── package.json
│   └── ...
└── lambda-functions/
    ├── cognito-triggers/
    ├── deployment-lambda/
    ├── websocket-lambda/
    └── workflow-lambda/
```

## Next Steps

1. ✅ Push code to GitHub
2. ✅ Share repository URL with colleague
3. ✅ Colleague clones repository
4. ✅ Colleague sets up their own `.env` file
5. ✅ Colleague deploys to their AWS account
