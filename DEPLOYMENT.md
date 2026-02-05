# Deployment Guide

## For New Team Members

### Initial Setup

1. **Install Dependencies**
   ```bash
   cd health-integration-engine
   npm install
   ```

2. **Configure AWS Credentials**
   ```bash
   aws configure
   # Enter your AWS Access Key ID, Secret Access Key, and region (us-west-2)
   ```

3. **Bootstrap CDK (First time only)**
   ```bash
   cd infrastructure
   npm install
   npx cdk bootstrap
   ```

### Customizing Resource Names

All resource names are configured in `infrastructure/config.yaml`. Edit this file to deploy with different names:

```yaml
# Project prefix - used for all resource names
projectName: "workflow-builder"        # Change this for a different project name
projectNamePascal: "WorkflowBuilder"   # PascalCase version

# Stack configuration
stack:
  name: "WorkflowBuilderStack"         # CloudFormation stack name

# Cognito
cognito:
  userPoolName: "workflow-builder-user-pool"
  
# API Gateway
apiGateway:
  name: "workflow-builder-api"

# DynamoDB tables
dynamodb:
  deploymentsTable: "WorkflowBuilder-Deployments"
  workflowsTable: "WorkflowBuilder-Workflows"

# Lambda functions
lambda:
  deployment: "workflow-builder-deployment"
  # ... and more
```

### Deploying the Stack

```bash
cd infrastructure
npx cdk deploy WorkflowBuilderStack
```

The CDK will automatically:
- Run `build.sh` for deployment-lambda (bundles all dependencies)
- Deploy all 18 Lambda functions with proper dependencies
- Configure API Gateway, Cognito, DynamoDB, Step Functions, etc.

### Common Issues & Solutions

#### Issue: Lambda Missing Dependencies (502 Error)

**Symptoms:**
- API returns 502 Bad Gateway
- Lambda logs show: `Cannot find module 'zod'` or similar

**Cause:**
npm workspaces hoist some dependencies to the parent `node_modules` directory.

**Solution:**
This is automatically handled by the CDK. If you still encounter this:
1. Ensure `build.sh` exists in `lambda-functions/deployment-lambda/`
2. Redeploy: `npx cdk deploy WorkflowBuilderStack --force`

**Manual fix (if needed):**
```bash
cd lambda-functions/deployment-lambda
./build.sh
cd dist
zip -r deployment-lambda.zip .
# Update each affected Lambda function
aws lambda update-function-code \
  --function-name <FUNCTION_NAME> \
  --zip-file fileb://deployment-lambda.zip \
  --region us-west-2
```

#### Issue: Token Expired (401 Error)

**Symptoms:**
- API returns 401 Unauthorized
- Error message: "The incoming token has expired"

**Solution:**
Get a fresh token from Cognito:

```bash
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <CLIENT_ID> \
  --auth-parameters USERNAME=<username>,PASSWORD=<password> \
  --region us-west-2
```

Use the `IdToken` from the response in your Authorization header.

### Viewing Logs

**API Gateway Logs:**
```bash
aws logs tail "API-Gateway-Execution-Logs_<API_ID>/v1" --since 5m --follow --region us-west-2
```

**Lambda Logs:**
```bash
aws logs tail "/aws/lambda/workflow-builder-deployment" --since 5m --follow --region us-west-2
```

### Architecture

- **API Gateway**: REST API with Cognito authorizer
- **Lambda Functions**: 18 functions using deployment-lambda code
- **DynamoDB**: Workflows and Deployments tables
- **Cognito**: User authentication
- **S3**: Lambda code storage
- **Step Functions**: Workflow orchestration

### Lambda Functions

All these functions use `deployment-lambda` code:
- workflow-builder-deployment
- workflow-builder-deployment-status
- workflow-builder-deployment-status-update
- workflow-builder-deployment-history
- workflow-builder-workflow-status-update
- workflow-builder-delete-cloudformation-stack
- workflow-builder-delete-database-records
- And 11 more...

### Development Workflow

1. Make changes to Lambda code in `lambda-functions/deployment-lambda/src/`
2. Deploy: `npx cdk deploy WorkflowBuilderStack`
3. CDK automatically rebuilds and redeploys all affected functions
4. Test your changes

No manual build steps required!
