# AWS Step Functions Workflow Builder

A comprehensive web application that enables users to create, edit, and deploy AWS Step Functions workflows through an intuitive drag-and-drop interface. Features a production-ready CloudFormation-based deployment system with extensible node architecture.

## 🏗️ Architecture Overview

The system uses a modern, scalable architecture:

- **Frontend**: React TypeScript with drag-and-drop workflow editor
- **Backend**: AWS Lambda functions with CloudFormation deployment
- **Infrastructure**: AWS CDK for infrastructure as code
- **Deployment**: CloudFormation templates with automatic rollback
- **Extensibility**: Plugin-based node handler system

## 📁 Project Structure

```
├── frontend/                           # React TypeScript frontend
│   ├── src/components/workflow/        # Workflow editor components
│   ├── src/services/                   # API and deployment services
│   └── src/types/                      # TypeScript type definitions
├── lambda-functions/                   # AWS Lambda functions
│   ├── workflow-lambda/                # Workflow CRUD operations
│   └── deployment-lambda/              # CloudFormation deployment system
│       ├── src/services/               # Core deployment services
│       └── src/services/nodeHandlers/  # Extensible node handlers
├── infrastructure/                     # AWS CDK infrastructure
│   ├── lib/workflow-builder-stack.ts  # Main infrastructure stack
│   └── scripts/                        # Deployment scripts
└── scripts/                           # Utility scripts
```

## 🚀 Deployment System

### CloudFormation-Based Deployment

The system uses AWS CloudFormation for reliable, production-ready deployments:

- **✅ Automatic Rollback**: Failed deployments automatically roll back
- **✅ Audit Trail**: Complete deployment history and change tracking
- **✅ Resource Management**: Proper IAM roles and permissions per workflow
- **✅ Scalability**: Handles complex workflows with many resources
- **✅ Reliability**: No Lambda timeout issues or manual resource management

### Extensible Node Architecture

Adding new node types is simple with our plugin-based system:

```typescript
// 1. Create a handler file
export const snsHandler: NodeHandler = (node, nextState) => ({
  Type: 'Task',
  Resource: 'arn:aws:states:::sns:publish',
  Parameters: {
    TopicArn: node.config?.topicArn,
    Message: node.config?.message,
  },
  Next: nextState || 'End',
});

// 2. Register the handler
NodeHandlerRegistry.register('sns', snsHandler);

// 3. Add to workflow types - Done!
```

### Supported Node Types

Currently supported workflow nodes:

- **Start/End**: Workflow entry and exit points
- **Lambda**: AWS Lambda function invocation
- **Database**: DynamoDB and RDS Data API operations
- **S3**: S3 operations (get, put, list, delete) with event-driven triggers

**Easy to add**: Wait, Choice, Parallel, SNS, SQS, and more!

### S3 Event-Triggered Workflows

Workflows can be automatically triggered when files are uploaded to an S3 bucket. The system uses EventBridge to detect `Object Created` events and start the Step Function execution.

**How it works:**
1. Add an S3 node (read operation) as the input — configure the bucket name and optional folder prefix
2. Add an S3 node (write operation) as the output — configure a **different** output bucket
3. Add Lambda nodes in between to process the file
4. Deploy the workflow — EventBridge notifications are automatically enabled on the input bucket

**Data flow through the workflow:**
- The **Start** node preserves the original EventBridge event in `$.originalEvent`
- The **S3 read** node fetches the uploaded file and stores its content in `$.s3Result.Body`
- **Lambda** nodes receive the full state as `event.input` — access the file content at `event['input']['s3Result']['Body']`
- The **S3 write** node writes the Lambda output (as JSON) to the output bucket with a `.json` extension

**Important notes for Lambda functions:**
- File content from the S3 trigger is at `event['input']['s3Result']['Body']`, not `event['Body']`
- The original S3 event metadata (bucket, key, size) is at `event['input']['originalEvent']['detail']`
- The output S3 bucket **must** be different from the input trigger bucket to prevent infinite loops
- The output file name matches the input file name with a `.json` extension (e.g. `HL7Message.txt` → `HL7Message.json`)

## 🛠️ Prerequisites

- Node.js >= 18.0.0
- npm >= 8.0.0
- AWS CLI configured with appropriate permissions
- AWS CDK CLI installed globally: `npm install -g aws-cdk`

## 🚀 Quick Start

### 1. Install Dependencies

```bash
# Install all dependencies for all workspaces
npm run install:all
```

### 2. Configure AWS

```bash
# Configure AWS credentials (if not already done)
aws configure

# Bootstrap CDK (first time only)
cd infrastructure
npx cdk bootstrap
```

### 3. Deploy Infrastructure

```bash
# Deploy the complete stack (infrastructure + frontend)
./scripts/deploy-full-stack.sh
```

This script:
- Installs all dependencies
- Builds Lambda functions
- Deploys CDK infrastructure
- Extracts outputs (API URL, Cognito IDs, etc.)
- Updates frontend `.env` with the outputs
- Builds and deploys frontend to S3
- Invalidates CloudFront cache

### 4. Start Development

```bash
# Start the frontend development server
cd frontend
npm run dev
```

The application will be available at `http://localhost:3000`

## 📋 Available Scripts

### Root Level Scripts
- `npm run install:all` - Install dependencies for all projects
- `npm run dev` - Start development servers
- `npm run build` - Build all projects
- `npm run deploy` - Deploy complete infrastructure to AWS
- `npm run clean` - Clean build artifacts and node_modules

### Frontend Scripts
- `npm run dev` - Start Vite development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

### Lambda Functions Scripts
- `npm run build` - Compile TypeScript to JavaScript
- `npm run test` - Run unit tests
- `npm run lint` - Run ESLint

### Infrastructure Scripts
- `npm run deploy` - Deploy CDK stack to AWS
- `npm run diff` - Show differences between deployed and local stack
- `npm run destroy` - Destroy the CDK stack

## 🔧 Development Workflow

### Adding New Node Types

1. **Create Handler**: Add a new handler in `lambda-functions/deployment-lambda/src/services/nodeHandlers/`
2. **Register Handler**: Import and register in the index file
3. **Update Types**: Add the node type to workflow type definitions
4. **Frontend Support**: Add UI components for the new node type

See `lambda-functions/deployment-lambda/src/services/nodeHandlers/README.md` for detailed instructions.

### Testing Deployments

1. **Mock Mode**: Test with mock deployments (default)
2. **Real Mode**: Enable real AWS deployments:
   ```bash
   node scripts/enable-real-deployment.js
   ```
3. **Disable Real Mode**:
   ```bash
   node scripts/disable-real-deployment.js
   ```

## 🏗️ Infrastructure Components

### AWS Services Used

- **Amazon Cognito**: User authentication and authorization
- **AWS Lambda**: Serverless compute for API endpoints
- **Amazon API Gateway**: REST API management
- **Amazon DynamoDB**: NoSQL database for workflows and deployments
- **AWS Step Functions**: Workflow execution engine
- **AWS CloudFormation**: Infrastructure deployment and management
- **Amazon CloudWatch**: Logging and monitoring

### Security Features

- **Authentication**: Cognito User Pool with JWT tokens
- **Authorization**: IAM roles with least privilege access
- **Encryption**: Data encrypted at rest and in transit
- **Isolation**: Each workflow gets dedicated IAM roles
- **Audit Trail**: Complete deployment and execution history

## 🔍 Monitoring and Debugging

### CloudWatch Logs

Monitor deployment progress in CloudWatch:
- `/aws/lambda/workflow-builder-deployment` - Deployment Lambda logs
- `/aws/lambda/workflow-builder-deployment-status` - Status Lambda logs
- `/aws/stepfunctions/workflow-*` - Step Functions execution logs

### Deployment Status

Track deployment progress:
1. **Frontend**: Real-time status updates in the deployment modal
2. **DynamoDB**: Deployment records in the Deployments table
3. **CloudFormation**: Stack status in AWS Console

### Troubleshooting

Common issues and solutions:

1. **Deployment Stuck**: Check CloudFormation stack events in AWS Console
2. **Permission Errors**: Verify IAM roles have necessary permissions
3. **Template Errors**: Check CloudWatch logs for template validation issues
4. **Node Configuration**: Ensure all workflow nodes are properly configured

## 🚀 Production Deployment

### Environment Configuration

1. **Update Environment Variables**: Configure production settings in `frontend/.env`
2. **Security Settings**: Review and tighten security policies
3. **Monitoring**: Set up CloudWatch alarms and dashboards
4. **Backup**: Configure DynamoDB backups

### Scaling Considerations

- **Lambda Concurrency**: Configure reserved concurrency for production workloads
- **DynamoDB**: Enable auto-scaling for tables
- **API Gateway**: Configure throttling and caching
- **Step Functions**: Monitor execution limits and costs

## 🤝 Contributing

### Development Setup

1. Fork the repository
2. Create a feature branch
3. Make changes following the established patterns
4. Add tests for new functionality
5. Submit a pull request

### Code Standards

- **TypeScript**: Strict type checking enabled
- **ESLint**: Follow the configured linting rules
- **Prettier**: Code formatting enforced
- **Testing**: Unit tests required for new features

## 📚 Additional Resources

- [AWS Step Functions Documentation](https://docs.aws.amazon.com/step-functions/)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [CloudFormation Documentation](https://docs.aws.amazon.com/cloudformation/)
- [Node Handlers Guide](lambda-functions/deployment-lambda/src/services/nodeHandlers/README.md)

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.