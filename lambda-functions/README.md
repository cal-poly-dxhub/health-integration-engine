# Lambda Functions

AWS Lambda functions for the Step Functions Workflow Builder backend.

## Functions

### workflow-lambda
Handles workflow management operations:
- Create, read, update, delete workflows
- Workflow validation
- User authorization

### deployment-lambda
Handles AWS deployment operations:
- Deploy Step Functions
- Create Lambda functions
- Manage IAM roles and policies
- Deployment status tracking

## Development

Each Lambda function is a separate TypeScript project with its own:
- `package.json` with dependencies and scripts
- `tsconfig.json` for TypeScript configuration
- `.eslintrc.js` for linting rules
- `.prettierrc` for code formatting

### Build and Package

```bash
# Build a specific function
cd workflow-lambda && npm run build

# Package for deployment
cd workflow-lambda && npm run package

# Build all functions from root
npm run build:lambda

# Package all functions from root
npm run package:lambda
```

## Deployment

Lambda functions are deployed via AWS CDK infrastructure stack. The built and packaged functions are referenced in the CDK stack configuration.