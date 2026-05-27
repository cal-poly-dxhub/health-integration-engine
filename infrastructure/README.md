# AWS Step Functions Workflow Builder - Infrastructure

This directory contains the AWS CDK infrastructure code for the Step Functions Workflow Builder application.

## Architecture Overview

The infrastructure includes:

- **Amazon Cognito User Pool**: User authentication and authorization
- **API Gateway**: RESTful API with Lambda integration
- **Lambda Functions**: Backend business logic
- **S3 + CloudFront**: Frontend hosting with global CDN
- **DynamoDB**: Workflow and deployment data storage
- **Step Functions**: Workflow orchestration
- **WebSocket API**: Real-time deployment updates
- **CloudWatch**: Logging and monitoring
- **IAM Roles and Policies**: Security and permissions

## Prerequisites

1. **AWS CLI**: Install and configure with your AWS credentials
   ```bash
   aws configure
   ```

2. **Node.js**: Version 18 or later
   ```bash
   node --version
   ```

3. **AWS CDK**: Install globally
   ```bash
   npm install -g aws-cdk
   ```

4. **Dependencies**: Install project dependencies
   ```bash
   npm install
   ```

## Quick Start

### 1. Bootstrap CDK (First time only)

Before deploying, you need to bootstrap CDK in your AWS account and region:

**PowerShell (Windows):**
```powershell
.\scripts\deploy.ps1 -Bootstrap
```

**Batch (Windows):**
```cmd
scripts\deploy.bat --bootstrap
```

**Bash (Linux/Mac):**
```bash
./scripts/deploy.sh --bootstrap
```

### 2. Deploy Full Stack (Infrastructure + Frontend)

**Recommended: One-command deployment**

**Bash (Linux/Mac):**
```bash
./scripts/deploy-full-stack.sh
```

**PowerShell (Windows):**
```powershell
.\scripts\deploy-full-stack.ps1
```

This will:
1. Deploy CDK infrastructure (S3, CloudFront, API Gateway, etc.)
2. Build the frontend
3. Upload frontend to S3
4. Invalidate CloudFront cache
5. Display the CloudFront URL to access your app

### 2b. Deploy Infrastructure Only

If you only want to deploy infrastructure without the frontend:

**PowerShell (Windows):**
```powershell
.\scripts\deploy.ps1 -Environment development
```

**Batch (Windows):**
```cmd
scripts\deploy.bat --environment development
```

**Bash (Linux/Mac):**
```bash
./scripts/deploy.sh --environment development
```

## Configuration

The infrastructure supports multiple environments (development, staging, production) with different configurations:

- **Development**: Local development with relaxed CORS and shorter log retention
- **Staging**: Pre-production environment with staging domain
- **Production**: Production environment with strict security settings

Configuration is managed in `lib/config.ts`.

## Deployment Scripts

### PowerShell Script (`scripts/deploy.ps1`)

```powershell
# Deploy to development
.\scripts\deploy.ps1

# Deploy to staging with specific profile
.\scripts\deploy.ps1 -Environment staging -Profile my-aws-profile

# Deploy to production in eu-west-1
.\scripts\deploy.ps1 -Environment production -Region eu-west-1

# Destroy the stack
.\scripts\deploy.ps1 -Destroy
```

### Batch Script (`scripts/deploy.bat`)

```cmd
# Deploy to development
scripts\deploy.bat

# Deploy with specific options
scripts\deploy.bat --environment staging --profile my-aws-profile

# Destroy the stack
scripts\deploy.bat --destroy
```

### Manual CDK Commands

If you prefer to use CDK commands directly:

```bash
# Build the project
npm run build

# Synthesize CloudFormation template
npm run synth

# Deploy the stack
npm run deploy

# Destroy the stack
npm run destroy

# Show differences
npm run diff
```

## Stack Outputs

After successful deployment, the stack will output important values:

- **UserPoolId**: Cognito User Pool ID for frontend configuration
- **UserPoolClientId**: Cognito User Pool Client ID for frontend configuration
- **ApiGatewayUrl**: API Gateway endpoint URL
- **ApiGatewayId**: API Gateway ID for Lambda integrations
- **CognitoAuthorizerArn**: Authorizer ARN for protected endpoints

## Security Features

### Cognito User Pool
- Email-based authentication
- Strong password policy (8+ chars, mixed case, numbers, symbols)
- Email verification required
- Account recovery via email only

### API Gateway
- Rate limiting (1000 requests/second, 2000 burst)
- CloudWatch logging enabled
- CORS configured for cross-origin requests
- Cognito JWT token validation

### CloudWatch Logging
- Structured logging for all components
- Configurable log retention periods
- Detailed API Gateway access logs

## Environment Variables

The following environment variables are used:

- `NODE_ENV`: Environment (development/staging/production)
- `CDK_DEFAULT_REGION`: AWS region for deployment
- `CDK_DEFAULT_ACCOUNT`: AWS account ID
- `AWS_PROFILE`: AWS profile to use (optional)

## Troubleshooting

### Common Issues

1. **CDK Bootstrap Required**
   ```
   Error: Need to perform AWS CDK bootstrap
   ```
   Solution: Run the bootstrap command for your account/region

2. **AWS Credentials Not Found**
   ```
   Error: Unable to locate credentials
   ```
   Solution: Configure AWS credentials using `aws configure`

3. **Permission Denied**
   ```
   Error: User is not authorized to perform action
   ```
   Solution: Ensure your AWS user has sufficient permissions for CDK deployment

4. **Stack Already Exists**
   ```
   Error: Stack already exists
   ```
   Solution: Use `cdk diff` to see changes, then `cdk deploy` to update

### Useful Commands

```bash
# Check CDK version
cdk --version

# List all stacks
cdk list

# Show stack template
cdk synth WorkflowBuilderStack

# Show differences before deployment
cdk diff WorkflowBuilderStack

# View stack events
aws cloudformation describe-stack-events --stack-name WorkflowBuilderStack
```

## Cost Optimization

The infrastructure is designed with cost optimization in mind:

- CloudWatch log retention set to 1 week for development
- Lambda functions configured with appropriate memory/timeout
- API Gateway throttling to prevent unexpected costs
- Cognito User Pool with reasonable limits

For production deployments, consider:
- Adjusting log retention periods
- Implementing CloudWatch alarms for cost monitoring
- Using Reserved Capacity for predictable workloads

## Next Steps

After deploying the infrastructure:

1. Note the stack outputs (User Pool ID, API Gateway URL, etc.)
2. Configure the frontend application with these values
3. Deploy Lambda functions using the provided helper methods
4. Test the authentication flow
5. Set up monitoring and alerting

## Support

For issues with the infrastructure:

1. Check the CloudFormation events in AWS Console
2. Review CloudWatch logs for detailed error messages
3. Use `cdk diff` to understand what changes will be made
4. Consult the AWS CDK documentation for specific construct issues