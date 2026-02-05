# Deployment Lambda

Lambda functions for workflow deployment and management.

## Development

### Prerequisites
- Node.js 18.x or later
- npm
- Bash (for build script on macOS/Linux)

### Installation

```bash
npm install
```

### Building

**macOS/Linux:**
```bash
npm run build
```

**Windows:**
```bash
npm run build:windows
```

This will:
1. Clean the dist directory
2. Compile TypeScript to JavaScript
3. Bundle all dependencies including hoisted packages (zod, jszip, etc.)

### Important Notes

**Dependency Management:**
- This project uses npm workspaces which hoists some dependencies to the parent `node_modules`
- The build script (`build.sh`) automatically copies hoisted dependencies to `dist/node_modules`
- Dependencies like `zod`, `jszip`, `jsonwebtoken`, `jwks-rsa`, `mime-types` are explicitly handled

**CDK Deployment:**
- The CDK stack automatically runs `build.sh` before deploying
- No manual build step is required when deploying via CDK
- All 18 Lambda functions using this code will be properly bundled

### Hoisted Dependencies

The following dependencies may be hoisted by npm and are explicitly copied during build:
- zod
- jszip  
- jsonwebtoken
- jwks-rsa
- mime-types
- pako
- jws
- jwa
- buffer-equal-constant-time
- ecdsa-sig-formatter
- safe-buffer
- semver
- lru-memoizer

### Manual Deployment (not recommended)

If you need to manually deploy:

```bash
npm run build
cd dist
zip -r deployment-lambda.zip .
aws lambda update-function-code \
  --function-name <FUNCTION_NAME> \
  --zip-file fileb://deployment-lambda.zip \
  --region us-west-2
```

## Testing

```bash
npm test
```

## Linting

```bash
npm run lint
```
