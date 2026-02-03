import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as fs from 'fs';
import { Construct } from 'constructs';
import { getConfig, StackConfig } from './config';

export class WorkflowBuilderStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly identityPool: cognito.CfnIdentityPool;
  public readonly api: apigateway.RestApi;
  private _cognitoAuthorizer?: apigateway.CognitoUserPoolsAuthorizer;
  private readonly config: StackConfig;
  private workflowsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Load configuration based on environment
    this.config = getConfig(process.env.NODE_ENV || 'development');

    // Create API Gateway first (needed for Identity Pool permissions)
    this.api = this.createApiGateway();
    
    // Create Cognito User Pool
    this.userPool = this.createUserPool();
    
    // Create Cognito User Pool Client
    this.userPoolClient = this.createUserPoolClient();
    
    // Create Cognito Identity Pool
    this.identityPool = this.createIdentityPool();
    
    // Cognito authorizer will be created lazily when needed
    
    // Set up CORS configuration
    this.setupCorsConfiguration();
    
    // Create deployment endpoints
    this.createDeploymentEndpoints();
    
    // Create WebSocket API for real-time deployment updates
    this.createWebSocketApi();
    
    // Output important values
    this.createOutputs();
  }

  private createUserPool(): cognito.UserPool {
    const userPool = new cognito.UserPool(this, 'WorkflowBuilderUserPool', {
      userPoolName: this.config.cognito.userPoolName,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        givenName: {
          required: false,
          mutable: true,
        },
        familyName: {
          required: false,
          mutable: true,
        },
      },
      customAttributes: {
        'user_role': new cognito.StringAttribute({ 
          minLen: 1, 
          maxLen: 50, 
          mutable: true 
        }),
        'organization': new cognito.StringAttribute({ 
          minLen: 1, 
          maxLen: 100, 
          mutable: true 
        }),
      },
      passwordPolicy: this.config.cognito.passwordPolicy,
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // MFA Configuration
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: true,
        otp: true,
      },
      // Advanced security features can be enabled later through the AWS Console
      // Email configuration (using default Cognito email for now)
      // Device tracking
      deviceTracking: {
        challengeRequiredOnNewDevice: true,
        deviceOnlyRememberedOnUserPrompt: false,
      },
      removalPolicy: this.config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Add Cognito domain for hosted UI
    userPool.addDomain('WorkflowBuilderDomain', {
      cognitoDomain: {
        domainPrefix: this.config.cognito.domainPrefix,
      },
    });

    return userPool;
  }

  private createUserPoolClient(): cognito.UserPoolClient {
    return new cognito.UserPoolClient(this, 'WorkflowBuilderUserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: this.config.cognito.userPoolClientName,
      generateSecret: false, // For SPA applications
      authFlows: {
        userSrp: true,
        userPassword: true, // Enable for username/password authentication
        adminUserPassword: false,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false, // Disabled for security
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: this.config.cognito.callbackUrls,
        logoutUrls: this.config.cognito.logoutUrls,
      },
      preventUserExistenceErrors: true,
      refreshTokenValidity: cdk.Duration.days(30),
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      // Enable token revocation
      enableTokenRevocation: true,
      // Supported identity providers
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
    });
  }

  private createIdentityPool(): cognito.CfnIdentityPool {
    // Create Identity Pool using CFN construct
    const identityPool = new cognito.CfnIdentityPool(this, 'WorkflowBuilderIdentityPool', {
      identityPoolName: 'workflow-builder-identity-pool',
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
        },
      ],
    });

    // Create IAM roles for authenticated users
    const authenticatedRole = new iam.Role(this, 'CognitoAuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      inlinePolicies: {
        WorkflowBuilderUserPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'execute-api:Invoke',
              ],
              resources: [
                `${this.api.arnForExecuteApi()}/*`,
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cognito-identity:GetCredentialsForIdentity',
                'cognito-identity:GetId',
              ],
              resources: ['*'],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'states:ListStateMachines',
                'states:DescribeStateMachine',
                'states:CreateStateMachine',
                'states:UpdateStateMachine',
                'states:DeleteStateMachine',
                'states:StartExecution',
                'states:StopExecution',
                'states:DescribeExecution',
                'states:ListExecutions',
                'states:GetExecutionHistory',
              ],
              resources: [
                `arn:aws:states:${this.region}:${this.account}:stateMachine:workflow-builder-*`,
                `arn:aws:states:${this.region}:${this.account}:execution:workflow-builder-*:*`,
              ],
            }),
          ],
        }),
      },
    });

    // Create unauthenticated role (even though we don't allow unauthenticated identities)
    const unauthenticatedRole = new iam.Role(this, 'CognitoUnauthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'unauthenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });

    // Attach roles to identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
        unauthenticated: unauthenticatedRole.roleArn,
      },
    });

    return identityPool;
  }

  private createApiGateway(): apigateway.RestApi {
    // Create CloudWatch log group for API Gateway
    const apiLogGroup = new logs.LogGroup(this, 'ApiGatewayLogGroup', {
      logGroupName: '/aws/apigateway/workflow-builder',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const api = new apigateway.RestApi(this, 'WorkflowBuilderApi', {
      restApiName: 'workflow-builder-api',
      description: 'API for AWS Step Functions Workflow Builder',
      deployOptions: {
        stageName: 'v1',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
        accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          caller: true,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: true,
        }),
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS, // Restrict in production
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'X-Amz-User-Agent',
        ],
        allowCredentials: true,
      },
      cloudWatchRole: true,
    });

    return api;
  }

  private setupCorsConfiguration(): void {
    // CORS is already configured in the API Gateway creation
    // Additional CORS configuration can be added here if needed
    
    // Add a gateway response for CORS on 4xx errors
    this.api.addGatewayResponse('Default4xxResponse', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    // Add a gateway response for CORS on 5xx errors
    this.api.addGatewayResponse('Default5xxResponse', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });
  }

  private createDeploymentEndpoints(): void {
    // Create DynamoDB tables for deployments
    const deploymentsTable = new dynamodb.Table(this, 'DeploymentsTable', {
      tableName: 'WorkflowBuilder-Deployments',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: this.config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Add GSI for querying deployments by workflow
    deploymentsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    // Create workflows table if it doesn't exist
    this.workflowsTable = new dynamodb.Table(this, 'WorkflowsTable', {
      tableName: 'WorkflowBuilder-Workflows',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: this.config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Create S3 bucket for Lambda code storage
    const lambdaCodeBucket = new s3.Bucket(this, 'LambdaCodeBucket', {
      bucketName: `workflow-builder-lambda-code-${this.account}-${this.region}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: this.config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          id: 'DeleteOldVersions',
          enabled: true,
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
    });

    // Create deployment Lambda function
    const deploymentLambda = this.createLambdaFunction(
      'DeploymentLambda',
      'workflow-builder-deployment',
      '../lambda-functions/deployment-lambda/dist',
      'index.deployWorkflow',
      {
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        WORKFLOWS_TABLE: this.workflowsTable.tableName,
        AWS_ACCOUNT_ID: this.account,
        LAMBDA_CODE_BUCKET: lambdaCodeBucket.bucketName,
      }
    );

    // Create deployment status Lambda function
    const deploymentStatusLambda = this.createLambdaFunction(
      'DeploymentStatusLambda',
      'workflow-builder-deployment-status',
      '../lambda-functions/deployment-lambda/dist',
      'index.getDeploymentStatus',
      {
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        AWS_ACCOUNT_ID: this.account,
      }
    );

    // Create deployment status update Lambda function (for Step Functions)
    const deploymentStatusUpdateLambda = this.createLambdaFunction(
      'DeploymentStatusUpdateLambda',
      'workflow-builder-deployment-status-update',
      '../lambda-functions/deployment-lambda/dist',
      'index.updateDeploymentStatus',
      {
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        WORKFLOWS_TABLE: this.workflowsTable.tableName,
        AWS_ACCOUNT_ID: this.account,
      }
    );

    // Create workflow status update Lambda function (for Step Functions)
    const workflowStatusUpdateLambda = this.createLambdaFunction(
      'WorkflowStatusUpdateLambda',
      'workflow-builder-workflow-status-update',
      '../lambda-functions/deployment-lambda/dist',
      'index.updateWorkflowStatus',
      {
        WORKFLOWS_TABLE: this.workflowsTable.tableName,
        AWS_ACCOUNT_ID: this.account,
      }
    );

    // Grant permissions to Lambda functions
    deploymentsTable.grantReadWriteData(deploymentLambda);
    deploymentsTable.grantReadWriteData(deploymentStatusLambda);
    deploymentsTable.grantReadWriteData(deploymentStatusUpdateLambda);
    this.workflowsTable.grantReadWriteData(deploymentLambda); // Changed from grantReadData to grantReadWriteData for deletion
    this.workflowsTable.grantReadWriteData(deploymentStatusUpdateLambda);
    this.workflowsTable.grantReadWriteData(workflowStatusUpdateLambda);

    // Grant CloudFormation permissions to status update Lambda
    deploymentStatusUpdateLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:DescribeStacks',
        ],
        resources: [
          `arn:aws:cloudformation:${this.region}:${this.account}:stack/workflow-*/*`,
        ],
      })
    );

    // CloudFormation will handle all resource creation, so we just need CloudFormation permissions

    // Grant CloudFormation permissions
    deploymentLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:CreateStack',
          'cloudformation:UpdateStack',
          'cloudformation:DeleteStack',
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:DescribeStackResources',
          'cloudformation:GetTemplate',
          'cloudformation:ValidateTemplate',
        ],
        resources: [
          `arn:aws:cloudformation:${this.region}:${this.account}:stack/workflow-*/*`,
        ],
      })
    );

    // Grant permissions for CloudFormation to create resources on our behalf
    deploymentLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          // IAM permissions for CloudFormation to create roles
          'iam:CreateRole',
          'iam:GetRole',
          'iam:DeleteRole',
          'iam:PutRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:AttachRolePolicy',
          'iam:DetachRolePolicy',
          'iam:PassRole',
          'iam:TagRole',
          'iam:UntagRole',
          // Step Functions permissions
          'states:CreateStateMachine',
          'states:UpdateStateMachine',
          'states:DeleteStateMachine',
          'states:DescribeStateMachine',
          'states:TagResource',
          'states:UntagResource',
          // CloudWatch Logs permissions
          'logs:CreateLogGroup',
          'logs:DeleteLogGroup',
          'logs:DescribeLogGroups',
          'logs:TagLogGroup',
          'logs:UntagLogGroup',
          'logs:PutRetentionPolicy',
          // Lambda permissions for CloudFormation to create Lambda functions
          'lambda:CreateFunction',
          'lambda:UpdateFunctionCode',
          'lambda:UpdateFunctionConfiguration',
          'lambda:DeleteFunction',
          'lambda:GetFunction',
          'lambda:TagResource',
          'lambda:UntagResource',
        ],
        resources: [
          '*', // CloudFormation needs broad permissions to create resources
          `arn:aws:iam::${this.account}:role/SF-Role-*`, // For Step Functions roles created by direct deployment
        ]
      })
    );

    // Grant S3 permissions for Lambda code storage
    lambdaCodeBucket.grantReadWrite(deploymentLambda);

    // Grant EventBridge permissions to deployment Lambda
    deploymentLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'events:PutEvents',
        ],
        resources: ['*'], // EventBridge doesn't support resource-level permissions
      })
    );

    // Grant Step Functions permissions to deployment Lambda (broad permissions for direct deployment)
    deploymentLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'states:StartExecution',
          'states:DescribeExecution',
          'states:StopExecution',
          'states:ListExecutions',
          'states:GetExecutionHistory',
          'states:CreateStateMachine',
          'states:UpdateStateMachine',
          'states:DescribeStateMachine',
          'states:ListStateMachines',
          'states:TagResource',
          'states:UntagResource',
        ],
        resources: [
          `arn:aws:states:${this.region}:${this.account}:stateMachine:workflow-builder-deployment`,
          `arn:aws:states:${this.region}:${this.account}:stateMachine:SF-*`, // For new direct deployment
          `arn:aws:states:${this.region}:${this.account}:execution:workflow-builder-deployment:*`,
          `arn:aws:states:${this.region}:${this.account}:execution:SF-*:*`, // For new direct deployment
        ],
      })
    );

    // Grant permissions to delete AWS resources (for workflow deletion)
    deploymentLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          // CloudFormation permissions
          'cloudformation:DeleteStack',
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackResources',
          'cloudformation:ListStackResources',
          // Step Functions permissions
          'states:DeleteStateMachine',
          'states:DescribeStateMachine',
          'states:ListStateMachineVersions',
          'states:PublishStateMachineVersion',
          'states:DeleteStateMachineVersion',
          'states:DeleteStateMachineAlias',
          // Lambda permissions
          'lambda:DeleteFunction',
          'lambda:ListFunctions',
          // IAM permissions
          'iam:DeleteRole',
          'iam:DeleteRolePolicy',
          'iam:DetachRolePolicy',
          'iam:ListRolePolicies',
          'iam:ListAttachedRolePolicies',
          'iam:GetRole',
          'iam:GetRolePolicy',
          // CloudWatch Logs permissions
          'logs:DeleteLogGroup',
          'logs:DescribeLogGroups',
          'logs:ListTagsLogGroup',
        ],
        resources: [
          `arn:aws:cloudformation:${this.region}:${this.account}:stack/workflow-*/*`,
          `arn:aws:states:${this.region}:${this.account}:stateMachine:SF-*`,
          `arn:aws:lambda:${this.region}:${this.account}:function:*`,
          // IAM roles - comprehensive patterns to match all generated role names
          `arn:aws:iam::${this.account}:role/SF-Role-*`,
          `arn:aws:iam::${this.account}:role/Lambda-Role-*`,
          `arn:aws:iam::${this.account}:role/*-StepFunctionRole`,
          `arn:aws:iam::${this.account}:role/*-LambdaRole`,
          `arn:aws:iam::${this.account}:role/Lambda-LambdaFunction-Role-*`,
          `arn:aws:iam::${this.account}:role/StepFunction-*`,
          `arn:aws:iam::${this.account}:role/*-workflow-*`,
          // Additional patterns for generated role names
          `arn:aws:iam::${this.account}:role/Lambda-*-Role-*`,
          `arn:aws:iam::${this.account}:role/*Role*`,
          // CloudWatch Logs
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/*`,
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/stepfunctions/*`,
        ],
      })
    );

    // Add Step Functions ARN to deployment Lambda environment (construct ARN to avoid circular dependency)
    deploymentLambda.addEnvironment('DEPLOYMENT_STATE_MACHINE_ARN', `arn:aws:states:${this.region}:${this.account}:stateMachine:workflow-builder-deployment`);

    // Create Step Functions state machine for deployment orchestration
    const deploymentStateMachine = this.createDeploymentStateMachine(
      deploymentLambda,
      deploymentStatusUpdateLambda,
      workflowStatusUpdateLambda
    );



    // CloudFormation will create IAM roles dynamically for each workflow

    // Create Step Functions API Lambda functions for each endpoint
    const listExecutionsLambda = this.createLambdaFunction(
      'ListExecutionsLambda',
      'workflow-builder-list-executions',
      '../lambda-functions/deployment-lambda/dist',
      'index.listExecutions',
      {
        AWS_ACCOUNT_ID: this.account,
      }
    );

    const describeExecutionLambda = this.createLambdaFunction(
      'DescribeExecutionLambda',
      'workflow-builder-describe-execution',
      '../lambda-functions/deployment-lambda/dist',
      'index.describeExecution',
      {
        AWS_ACCOUNT_ID: this.account,
      }
    );

    const executionHistoryLambda = this.createLambdaFunction(
      'ExecutionHistoryLambda',
      'workflow-builder-execution-history',
      '../lambda-functions/deployment-lambda/dist',
      'index.getExecutionHistory',
      {
        AWS_ACCOUNT_ID: this.account,
      }
    );

    const startExecutionLambda = this.createLambdaFunction(
      'StartExecutionLambda',
      'workflow-builder-start-execution',
      '../lambda-functions/deployment-lambda/dist',
      'index.startExecution',
      {
        AWS_ACCOUNT_ID: this.account,
      }
    );

    const stopExecutionLambda = this.createLambdaFunction(
      'StopExecutionLambda',
      'workflow-builder-stop-execution',
      '../lambda-functions/deployment-lambda/dist',
      'index.stopExecution',
      {
        AWS_ACCOUNT_ID: this.account,
      }
    );

    const describeStateMachineLambda = this.createLambdaFunction(
      'DescribeStateMachineLambda',
      'workflow-builder-describe-state-machine',
      '../lambda-functions/deployment-lambda/dist',
      'index.describeStateMachine',
      {
        AWS_ACCOUNT_ID: this.account,
      }
    );

    const describeStateMachineForExecutionLambda = this.createLambdaFunction(
      'DescribeStateMachineForExecutionLambda',
      'workflow-builder-describe-state-machine-for-execution',
      '../lambda-functions/deployment-lambda/dist',
      'index.describeStateMachineForExecution',
      {
        AWS_ACCOUNT_ID: this.account,
      }
    );

    // Grant Step Functions permissions to all API Lambdas
    const stepFunctionsLambdas = [
      listExecutionsLambda,
      describeExecutionLambda,
      executionHistoryLambda,
      startExecutionLambda,
      stopExecutionLambda,
      describeStateMachineLambda,
      describeStateMachineForExecutionLambda
    ];

    stepFunctionsLambdas.forEach(lambdaFunction => {
      lambdaFunction.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'states:ListExecutions',
            'states:DescribeExecution',
            'states:GetExecutionHistory',
            'states:StartExecution',
            'states:StopExecution',
            'states:DescribeStateMachine',
            'states:DescribeStateMachineForExecution',
          ],
          resources: [
            `arn:aws:states:${this.region}:${this.account}:stateMachine:*`,
            `arn:aws:states:${this.region}:${this.account}:execution:*:*`,
          ],
        })
      );
    });

    // Create API Gateway resources
    const deploymentsResource = this.api.root.addResource('deployments');
    const workflowsResource = this.api.root.addResource('workflows');
    
    // POST /deployments - Deploy workflow (requires auth)
    const deployMethod = this.addLambdaIntegration(deploymentsResource, 'POST', deploymentLambda, true);
    
    // GET /deployments/{deploymentId}/status - Get deployment status (requires auth)
    const deploymentIdResource = deploymentsResource.addResource('{deploymentId}');
    const statusResource = deploymentIdResource.addResource('status');
    const statusMethod = this.addLambdaIntegration(statusResource, 'GET', deploymentStatusLambda, true);

    // Add Step Functions API endpoints
    const stepFunctionsResource = deploymentsResource.addResource('step-functions');
    
    // POST /deployments/step-functions/list-executions
    const listExecutionsResource = stepFunctionsResource.addResource('list-executions');
    this.addLambdaIntegration(listExecutionsResource, 'POST', listExecutionsLambda, true);
    
    // POST /deployments/step-functions/describe-execution
    const describeExecutionResource = stepFunctionsResource.addResource('describe-execution');
    this.addLambdaIntegration(describeExecutionResource, 'POST', describeExecutionLambda, true);
    
    // POST /deployments/step-functions/execution-history
    const executionHistoryResource = stepFunctionsResource.addResource('execution-history');
    this.addLambdaIntegration(executionHistoryResource, 'POST', executionHistoryLambda, true);
    
    // POST /deployments/step-functions/start-execution
    const startExecutionResource = stepFunctionsResource.addResource('start-execution');
    this.addLambdaIntegration(startExecutionResource, 'POST', startExecutionLambda, true);
    
    // POST /deployments/step-functions/stop-execution
    const stopExecutionResource = stepFunctionsResource.addResource('stop-execution');
    this.addLambdaIntegration(stopExecutionResource, 'POST', stopExecutionLambda, true);
    
    // POST /deployments/step-functions/describe-state-machine
    const describeStateMachineResource = stepFunctionsResource.addResource('describe-state-machine');
    this.addLambdaIntegration(describeStateMachineResource, 'POST', describeStateMachineLambda, true);
    
    // POST /deployments/step-functions/describe-state-machine-for-execution
    const describeStateMachineForExecutionResource = stepFunctionsResource.addResource('describe-state-machine-for-execution');
    this.addLambdaIntegration(describeStateMachineForExecutionResource, 'POST', describeStateMachineForExecutionLambda, true);

    // Add workflow API endpoints
    
    // GET /workflows - List user's workflows
    const listWorkflowsLambda = this.createLambdaFunction(
      'ListWorkflowsLambda',
      'workflow-builder-list-workflows',
      '../lambda-functions/deployment-lambda/dist',
      'index.listWorkflows',
      {
        WORKFLOWS_TABLE: this.workflowsTable.tableName,
        AWS_ACCOUNT_ID: this.account,
        USER_POOL_ID: this.userPool.userPoolId,
        USER_POOL_CLIENT_ID: this.userPoolClient.userPoolClientId,
      }
    );

    // POST /workflows - Save/create workflow
    const saveWorkflowLambda = this.createLambdaFunction(
      'SaveWorkflowLambda',
      'workflow-builder-save-workflow',
      '../lambda-functions/deployment-lambda/dist',
      'index.saveWorkflow',
      {
        WORKFLOWS_TABLE: this.workflowsTable.tableName,
        AWS_ACCOUNT_ID: this.account,
        USER_POOL_ID: this.userPool.userPoolId,
        USER_POOL_CLIENT_ID: this.userPoolClient.userPoolClientId,
      }
    );

    // GET /workflows/{workflowId} - Get workflow details
    const workflowIdResource = workflowsResource.addResource('{workflowId}');
    
    // Create workflow Lambda function
    const workflowLambda = this.createLambdaFunction(
      'WorkflowLambda',
      'workflow-builder-workflow',
      '../lambda-functions/deployment-lambda/dist',
      'index.getWorkflow',
      {
        WORKFLOWS_TABLE: this.workflowsTable.tableName,
        AWS_ACCOUNT_ID: this.account,
        USER_POOL_ID: this.userPool.userPoolId,
        USER_POOL_CLIENT_ID: this.userPoolClient.userPoolClientId,
      }
    );

    // Grant permissions to workflow Lambdas
    this.workflowsTable.grantReadData(listWorkflowsLambda);
    this.workflowsTable.grantReadWriteData(saveWorkflowLambda);
    this.workflowsTable.grantReadData(workflowLambda);



    // Create delete workflow Lambda function
    const deleteWorkflowLambda = this.createLambdaFunction(
      'DeleteWorkflowLambda',
      'workflow-builder-delete-workflow',
      '../lambda-functions/deployment-lambda/dist',
      'index.deleteWorkflow',
      {
        WORKFLOWS_TABLE: this.workflowsTable.tableName,
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        AWS_ACCOUNT_ID: this.account,
        USER_POOL_ID: this.userPool.userPoolId,
        USER_POOL_CLIENT_ID: this.userPoolClient.userPoolClientId,
        DELETION_STATE_MACHINE_ARN: `arn:aws:states:${this.region}:${this.account}:stateMachine:workflow-builder-deletion`,
      }
    );

    // Grant permissions to delete workflow Lambda
    this.workflowsTable.grantReadWriteData(deleteWorkflowLambda);
    deploymentsTable.grantReadWriteData(deleteWorkflowLambda);

    // Grant permissions to delete AWS resources
    deleteWorkflowLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          // CloudFormation permissions
          'cloudformation:DeleteStack',
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackResources',
          'cloudformation:ListStackResources',
          // Step Functions permissions
          'states:DeleteStateMachine',
          'states:DescribeStateMachine',
          'states:ListStateMachineVersions',
          'states:PublishStateMachineVersion',
          'states:DeleteStateMachineVersion',
          'states:DeleteStateMachineAlias',
          // Lambda permissions
          'lambda:DeleteFunction',
          'lambda:ListFunctions',
          // IAM permissions
          'iam:DeleteRole',
          'iam:DeleteRolePolicy',
          'iam:DetachRolePolicy',
          'iam:ListRolePolicies',
          'iam:ListAttachedRolePolicies',
          'iam:GetRole',
          'iam:GetRolePolicy',
          // CloudWatch Logs permissions
          'logs:DeleteLogGroup',
          'logs:DescribeLogGroups',
          'logs:ListTagsLogGroup',
        ],
        resources: [
          `arn:aws:cloudformation:${this.region}:${this.account}:stack/workflow-*/*`,
          `arn:aws:states:${this.region}:${this.account}:stateMachine:SF-*`,
          `arn:aws:lambda:${this.region}:${this.account}:function:*`,
          // IAM roles - comprehensive patterns to match all generated role names
          `arn:aws:iam::${this.account}:role/SF-Role-*`,
          `arn:aws:iam::${this.account}:role/Lambda-Role-*`,
          `arn:aws:iam::${this.account}:role/*-StepFunctionRole`,
          `arn:aws:iam::${this.account}:role/*-LambdaRole`,
          `arn:aws:iam::${this.account}:role/Lambda-LambdaFunction-Role-*`,
          `arn:aws:iam::${this.account}:role/StepFunction-*`,
          `arn:aws:iam::${this.account}:role/*-workflow-*`,
          // Additional patterns for generated role names
          `arn:aws:iam::${this.account}:role/Lambda-*-Role-*`,
          `arn:aws:iam::${this.account}:role/*Role*`,
          // CloudWatch Logs
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/*`,
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/stepfunctions/*`,
        ],
      })
    );

    // Add Step Functions permissions for deletion workflow
    deleteWorkflowLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'states:StartExecution',
          'states:DescribeExecution',
          'states:ListExecutions',
        ],
        resources: [
          `arn:aws:states:${this.region}:${this.account}:stateMachine:workflow-builder-deletion`,
          `arn:aws:states:${this.region}:${this.account}:stateMachine:workflow-builder-deletion:*`,
        ],
      })
    );

    // Create Step Functions state machine for deletion orchestration
    const deletionStateMachine = this.createDeletionStateMachine(
      deleteWorkflowLambda,
      workflowStatusUpdateLambda,
      deploymentsTable
    );



    // Create deployment history Lambda function
    const deploymentHistoryLambda = this.createLambdaFunction(
      'DeploymentHistoryLambda',
      'workflow-builder-deployment-history',
      '../lambda-functions/deployment-lambda/dist',
      'getDeploymentHistory.handler',
      {
        DEPLOYMENT_TABLE_NAME: deploymentsTable.tableName,
        AWS_ACCOUNT_ID: this.account,
        USER_POOL_ID: this.userPool.userPoolId,
        USER_POOL_CLIENT_ID: this.userPoolClient.userPoolClientId,
      }
    );

    // Grant permissions to deployment history Lambda
    deploymentsTable.grantReadData(deploymentHistoryLambda);


    // Add API endpoints
    this.addLambdaIntegration(workflowsResource, 'GET', listWorkflowsLambda, true);
    this.addLambdaIntegration(workflowsResource, 'POST', saveWorkflowLambda, true);
    this.addLambdaIntegration(workflowIdResource, 'GET', workflowLambda, true);
    this.addLambdaIntegration(workflowIdResource, 'PUT', saveWorkflowLambda, true);
    this.addLambdaIntegration(workflowIdResource, 'DELETE', deleteWorkflowLambda, true);
    
    // Add deployment history endpoint: GET /workflows/{workflowId}/deployments
    const workflowDeploymentsResource = workflowIdResource.addResource('deployments');
    this.addLambdaIntegration(workflowDeploymentsResource, 'GET', deploymentHistoryLambda, true);
  }

  public get cognitoAuthorizer(): apigateway.CognitoUserPoolsAuthorizer {
    if (!this._cognitoAuthorizer) {
      this._cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
        cognitoUserPools: [this.userPool],
        authorizerName: 'workflow-builder-authorizer',
        identitySource: 'method.request.header.Authorization',
      });
    }
    return this._cognitoAuthorizer;
  }

  private createDeploymentStateMachine(
    deploymentLambda: lambda.Function,
    statusLambda: lambda.Function,
    workflowStatusLambda: lambda.Function
  ): stepfunctions.StateMachine {
    // Read the state machine definition
    const stateMachineDefinition = fs.readFileSync(
      '../lambda-functions/deployment-lambda/src/stepfunctions/deploymentStateMachine.json',
      'utf8'
    );

    // Replace placeholders with actual Lambda ARNs
    const processedDefinition = stateMachineDefinition
      .replace(/\$\{InitializeLambdaArn\}/g, deploymentLambda.functionArn)
      .replace(/\$\{TemplateGeneratorLambdaArn\}/g, deploymentLambda.functionArn)
      .replace(/\$\{StatusUpdateLambdaArn\}/g, statusLambda.functionArn)
      .replace(/\$\{WorkflowStatusUpdateLambdaArn\}/g, workflowStatusLambda.functionArn);

    // Create IAM role for Step Functions
    const stepFunctionsRole = new iam.Role(this, 'DeploymentStateMachineRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      inlinePolicies: {
        StepFunctionsExecutionPolicy: new iam.PolicyDocument({
          statements: [
            // Lambda invoke permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'lambda:InvokeFunction',
                'lambda:GetFunction',
                'lambda:ListFunctions',
                'lambda:CreateFunction',
                'lambda:DeleteFunction',
                'lambda:UpdateFunctionCode',
                'lambda:UpdateFunctionConfiguration',
                'lambda:TagResource',
                'lambda:UntagResource',
              ],
              resources: ['*'],
            }),
            // CloudFormation permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cloudformation:CreateStack',
                'cloudformation:UpdateStack',
                'cloudformation:DeleteStack',
                'cloudformation:DescribeStacks',
                'cloudformation:DescribeStackEvents',
                'cloudformation:DescribeStackResources',
                'cloudformation:GetTemplate',
                'cloudformation:ListStacks',
                'cloudformation:ValidateTemplate',
              ],
              resources: ['*'],
            }),
            // IAM permissions for CloudFormation to create roles and policies
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'iam:CreateRole',
                'iam:DeleteRole',
                'iam:GetRole',
                'iam:PassRole',
                'iam:PutRolePolicy',
                'iam:DeleteRolePolicy',
                'iam:AttachRolePolicy',
                'iam:DetachRolePolicy',
                'iam:ListRolePolicies',
                'iam:GetRolePolicy',
                'iam:TagRole',
                'iam:UntagRole',
                'iam:UpdateAssumeRolePolicy',
              ],
              resources: ['*'],
            }),
            // Step Functions permissions for CloudFormation to create state machines
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'states:CreateStateMachine',
                'states:DeleteStateMachine',
                'states:UpdateStateMachine',
                'states:DescribeStateMachine',
                'states:ListStateMachineVersions',
                'states:CreateStateMachineVersion',
                'states:PublishStateMachineVersion',
                'states:DeleteStateMachineVersion',
                'states:CreateStateMachineAlias',
                'states:DeleteStateMachineAlias',
                'states:UpdateStateMachineAlias',
                'states:TagResource',
                'states:UntagResource',
              ],
              resources: ['*'],
            }),
            // S3 permissions for CloudFormation templates and workflow resources
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:CreateBucket',
                's3:DeleteBucket',
                's3:GetBucketLocation',
                's3:GetBucketPolicy',
                's3:PutBucketPolicy',
                's3:DeleteBucketPolicy',
                's3:PutBucketNotification',
                's3:GetBucketNotification',
                's3:PutBucketVersioning',
                's3:GetBucketVersioning',
                's3:PutBucketTagging',
                's3:GetBucketTagging',
                's3:PutObject',
                's3:GetObject',
                's3:DeleteObject',
              ],
              resources: ['*'],
            }),
            // EventBridge permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['events:PutEvents'],
              resources: ['*'],
            }),
            // CloudWatch Logs permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
                'logs:DescribeLogGroups',
                'logs:DescribeLogStreams',
                'logs:DeleteLogGroup',
                'logs:PutRetentionPolicy',
                'logs:TagLogGroup',
                'logs:UntagLogGroup',
                'logs:ListTagsForResource',
                'logs:TagResource',
                'logs:UntagResource',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // Create the state machine
    const stateMachine = new stepfunctions.StateMachine(this, 'DeploymentStateMachine', {
      stateMachineName: 'workflow-builder-deployment',
      definitionBody: stepfunctions.DefinitionBody.fromString(processedDefinition),
      role: stepFunctionsRole,
      logs: {
        destination: new logs.LogGroup(this, 'DeploymentStateMachineLogGroup', {
          logGroupName: '/aws/stepfunctions/workflow-builder-deployment',
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        level: stepfunctions.LogLevel.ALL,
      },
    });

    return stateMachine;
  }

  private createDeletionStateMachine(
    deleteWorkflowLambda: lambda.Function,
    workflowStatusLambda: lambda.Function,
    deploymentsTable: dynamodb.Table
  ): stepfunctions.StateMachine {
    // Create separate Lambda functions for deletion steps (following deployment pattern)
    const deleteCloudFormationStackLambda = this.createLambdaFunction(
      'DeleteCloudFormationStackLambda',
      'workflow-builder-delete-cloudformation-stack',
      '../lambda-functions/deployment-lambda/dist',
      'handlers/deleteCloudFormationStack.handler',
      {
        WORKFLOWS_TABLE: this.workflowsTable.tableName,
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        AWS_ACCOUNT_ID: this.account,
      }
    );

    const deleteDatabaseRecordsLambda = this.createLambdaFunction(
      'DeleteDatabaseRecordsLambda', 
      'workflow-builder-delete-database-records',
      '../lambda-functions/deployment-lambda/dist',
      'handlers/deleteDatabaseRecords.handler',
      {
        WORKFLOWS_TABLE: this.workflowsTable.tableName,
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
      }
    );

    // Grant permissions to the new Lambda functions
    this.workflowsTable.grantReadWriteData(deleteCloudFormationStackLambda);
    this.workflowsTable.grantReadWriteData(deleteDatabaseRecordsLambda);
    
    // Grant permissions to access deployments table
    deploymentsTable.grantReadWriteData(deleteCloudFormationStackLambda);
    deploymentsTable.grantReadWriteData(deleteDatabaseRecordsLambda);

    // Grant CloudFormation permissions to delete stack Lambda
    deleteCloudFormationStackLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:DeleteStack',
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackResources',
          'cloudformation:ListStackResources',
        ],
        resources: ['*'],
      })
    );

    // Grant Step Functions permissions to delete state machines
    deleteCloudFormationStackLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'states:DescribeStateMachine',
          'states:DeleteStateMachine',
          'states:ListStateMachines',
        ],
        resources: ['*'],
      })
    );

    // Grant Lambda permissions to delete functions
    deleteCloudFormationStackLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'lambda:DeleteFunction',
          'lambda:GetFunction',
          'lambda:ListFunctions',
        ],
        resources: ['*'],
      })
    );

    // Grant IAM permissions to delete roles and policies created by CloudFormation
    deleteCloudFormationStackLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'iam:DeleteRole',
          'iam:DeleteRolePolicy',
          'iam:DetachRolePolicy',
          'iam:GetRole',
          'iam:ListRolePolicies',
          'iam:ListAttachedRolePolicies',
        ],
        resources: ['*'],
      })
    );

    // Grant CloudWatch Logs permissions to delete log groups
    deleteCloudFormationStackLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:DeleteLogGroup',
          'logs:DescribeLogGroups',
          'logs:ListTagsForResource',
          'logs:TagResource',
          'logs:UntagResource',
        ],
        resources: ['*'],
      })
    );

    // Read the deletion state machine definition
    const stateMachineDefinition = fs.readFileSync(
      '../lambda-functions/deployment-lambda/src/stepfunctions/deletionStateMachine.json',
      'utf8'
    );

    // Replace placeholders with actual Lambda ARNs (following deployment pattern)
    const processedDefinition = stateMachineDefinition
      .replace(/\$\{UpdateWorkflowStatusFunction\}/g, workflowStatusLambda.functionArn)
      .replace(/\$\{DeleteCloudFormationStackFunction\}/g, deleteCloudFormationStackLambda.functionArn)
      .replace(/\$\{DeleteDatabaseRecordsFunction\}/g, deleteDatabaseRecordsLambda.functionArn);

    // Create IAM role for Deletion Step Functions
    const deletionStepFunctionsRole = new iam.Role(this, 'DeletionStateMachineRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      inlinePolicies: {
        DeletionStepFunctionsExecutionPolicy: new iam.PolicyDocument({
          statements: [
            // Lambda invoke permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'lambda:InvokeFunction',
              ],
              resources: [
                deleteCloudFormationStackLambda.functionArn,
                deleteDatabaseRecordsLambda.functionArn,
                workflowStatusLambda.functionArn,
                `${deleteCloudFormationStackLambda.functionArn}:*`,
                `${deleteDatabaseRecordsLambda.functionArn}:*`,
                `${workflowStatusLambda.functionArn}:*`,
              ],
            }),
            // CloudWatch Logs permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
                'logs:DescribeLogGroups',
                'logs:DescribeLogStreams',
              ],
              resources: ['*'],
            }),
            // EventBridge permissions for publishing events
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'events:PutEvents',
              ],
              resources: ['*'], // EventBridge doesn't support resource-level permissions
            }),
          ],
        }),
      },
    });

    // Create the deletion state machine
    const deletionStateMachine = new stepfunctions.StateMachine(this, 'DeletionStateMachine', {
      stateMachineName: 'workflow-builder-deletion',
      definitionBody: stepfunctions.DefinitionBody.fromString(processedDefinition),
      role: deletionStepFunctionsRole,
      logs: {
        destination: new logs.LogGroup(this, 'DeletionStateMachineLogGroup', {
          logGroupName: '/aws/stepfunctions/workflow-builder-deletion',
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        level: stepfunctions.LogLevel.ALL,
      },
    });

    return deletionStateMachine;
  }



  private createWebSocketApi(): void {
    // Create WebSocket connections table
    const webSocketConnectionsTable = new dynamodb.Table(this, 'WebSocketConnectionsTable', {
      tableName: 'WebSocketConnections',
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: this.config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Add GSI for querying by userId
    webSocketConnectionsTable.addGlobalSecondaryIndex({
      indexName: 'UserIdIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    });

    // Add GSI for querying by deploymentId
    webSocketConnectionsTable.addGlobalSecondaryIndex({
      indexName: 'DeploymentIdIndex',
      partitionKey: { name: 'deploymentId', type: dynamodb.AttributeType.STRING },
    });

    // Create WebSocket Lambda handlers
    const connectHandler = this.createLambdaFunction(
      'WebSocketConnect',
      'websocket-connect-handler',
      '../lambda-functions/websocket-lambda/dist',
      'handlers/connect.handler',
      {
        CONNECTIONS_TABLE_NAME: webSocketConnectionsTable.tableName,
      }
    );

    const disconnectHandler = this.createLambdaFunction(
      'WebSocketDisconnect',
      'websocket-disconnect-handler',
      '../lambda-functions/websocket-lambda/dist',
      'handlers/disconnect.handler',
      {
        CONNECTIONS_TABLE_NAME: webSocketConnectionsTable.tableName,
      }
    );

    const defaultHandler = this.createLambdaFunction(
      'WebSocketDefault',
      'websocket-default-handler',
      '../lambda-functions/websocket-lambda/dist',
      'handlers/default.handler',
      {
        CONNECTIONS_TABLE_NAME: webSocketConnectionsTable.tableName,
      }
    );

    // Create EventBridge handler for Step Functions state changes (following AWS sample pattern)
    const eventBridgeHandler = this.createLambdaFunction(
      'EventBridgeHandler',
      'eventbridge-handler',
      '../lambda-functions/websocket-lambda/dist',
      'handlers/eventbridge.handler',
      {
        CONNECTIONS_TABLE_NAME: webSocketConnectionsTable.tableName,
        WEBSOCKET_ENDPOINT: '', // Will be set after WebSocket API creation
      }
    );

    // Grant DynamoDB permissions to WebSocket handlers
    webSocketConnectionsTable.grantReadWriteData(connectHandler);
    webSocketConnectionsTable.grantReadWriteData(disconnectHandler);
    webSocketConnectionsTable.grantReadWriteData(eventBridgeHandler);

    // Create WebSocket API
    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'DeploymentWebSocketApi', {
      apiName: 'workflow-deployment-websocket',
      description: 'WebSocket API for real-time deployment updates',
      connectRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
          'ConnectIntegration',
          connectHandler
        ),
      },
      disconnectRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
          'DisconnectIntegration',
          disconnectHandler
        ),
      },
      defaultRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
          'DefaultIntegration',
          defaultHandler
        ),
      },
    });

    // Create WebSocket stage
    const webSocketStage = new apigatewayv2.WebSocketStage(this, 'DeploymentWebSocketStage', {
      webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Grant API Gateway management permissions to EventBridge handler
    eventBridgeHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'execute-api:ManageConnections',
        ],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/*`,
        ],
      })
    );

    // Add WebSocket endpoint to EventBridge handler environment
    eventBridgeHandler.addEnvironment('WEBSOCKET_ENDPOINT', webSocketStage.url);
    eventBridgeHandler.addEnvironment('WEBSOCKET_API_ID', webSocketApi.apiId);

    // Create EventBridge rule to capture Step Functions state changes (following AWS sample pattern)
    const stepFunctionStateChangeRule = new events.Rule(this, 'StepFunctionStateChangeRule', {
      ruleName: 'workflow-builder-stepfunction-state-changes',
      description: 'Capture Step Functions state changes for deployment progress tracking',
      eventPattern: {
        source: ['aws.states'],
        detailType: ['Step Functions Execution Status Change'],
        detail: {
          stateMachineArn: [{
            prefix: `arn:aws:states:${this.region}:${this.account}:stateMachine:workflow-builder-deployment`
          }]
        }
      },
    });

    // Add EventBridge handler as target for EventBridge rule
    stepFunctionStateChangeRule.addTarget(new targets.LambdaFunction(eventBridgeHandler));

    // Create EventBridge rule to capture Step Functions deletion state changes
    const stepFunctionDeletionStateChangeRule = new events.Rule(this, 'StepFunctionDeletionStateChangeRule', {
      ruleName: 'workflow-builder-deletion-stepfunction-state-changes',
      description: 'Capture Step Functions deletion state changes for deletion progress tracking',
      eventPattern: {
        source: ['aws.states'],
        detailType: ['Step Functions Execution Status Change'],
        detail: {
          stateMachineArn: [{
            prefix: `arn:aws:states:${this.region}:${this.account}:stateMachine:workflow-builder-deletion`
          }]
        }
      },
    });

    // Add EventBridge handler as target for deletion Step Functions rule
    stepFunctionDeletionStateChangeRule.addTarget(new targets.LambdaFunction(eventBridgeHandler));

    // Create EventBridge rule to capture custom workflow deployment events (from state machine)
    const workflowDeploymentEventRule = new events.Rule(this, 'WorkflowDeploymentEventRule', {
      ruleName: 'workflow-builder-deployment-events',
      description: 'Capture custom workflow deployment events for real-time UI updates',
      eventPattern: {
        source: ['workflow-builder.deployment'],
        detailType: ['Deployment Status Update'],
      },
    });

    // Add EventBridge handler as target for deployment events rule
    workflowDeploymentEventRule.addTarget(new targets.LambdaFunction(eventBridgeHandler));

    // Create EventBridge rule to capture custom workflow deletion events (from state machine)
    const workflowDeletionEventRule = new events.Rule(this, 'WorkflowDeletionEventRule', {
      ruleName: 'workflow-builder-deletion-events',
      description: 'Capture custom workflow deletion events for real-time UI updates',
      eventPattern: {
        source: ['workflow-builder.deletion'],
        detailType: ['Workflow Deletion Update'],
      },
    });

    // Add EventBridge handler as target for deletion events rule
    workflowDeletionEventRule.addTarget(new targets.LambdaFunction(eventBridgeHandler));



    // Grant API Gateway management permissions to deployment Lambda
    const deploymentLambda = lambda.Function.fromFunctionName(
      this,
      'ExistingDeploymentLambda',
      `${this.stackName}-DeploymentLambda`
    );

    deploymentLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'execute-api:ManageConnections',
        ],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/*`,
        ],
      })
    );

    // Add WebSocket endpoint to deployment Lambda environment
    const existingDeploymentLambda = this.node.tryFindChild('DeploymentLambda') as lambda.Function;
    if (existingDeploymentLambda) {
      existingDeploymentLambda.addEnvironment('WEBSOCKET_ENDPOINT', webSocketStage.url);
    }

    // Output WebSocket URL
    new cdk.CfnOutput(this, 'WebSocketApiUrl', {
      value: webSocketStage.url,
      description: 'WebSocket API URL for deployment updates',
      exportName: 'WorkflowBuilderWebSocketUrl',
    });
  }

  private createOutputs(): void {
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: 'WorkflowBuilderUserPoolId',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: 'WorkflowBuilderUserPoolClientId',
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: this.api.url,
      description: 'API Gateway URL',
      exportName: 'WorkflowBuilderApiUrl',
    });

    new cdk.CfnOutput(this, 'ApiGatewayId', {
      value: this.api.restApiId,
      description: 'API Gateway ID',
      exportName: 'WorkflowBuilderApiId',
    });

    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: this.identityPool.ref,
      description: 'Cognito Identity Pool ID',
      exportName: 'WorkflowBuilderIdentityPoolId',
    });

    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: `${this.config.cognito.domainPrefix}.auth.${this.region}.amazoncognito.com`,
      description: 'Cognito Hosted UI Domain',
      exportName: 'WorkflowBuilderCognitoDomain',
    });
  }

  // Helper method to create Lambda functions with proper logging configuration
  public createLambdaFunction(
    id: string,
    functionName: string,
    codePath: string,
    handler: string,
    environment?: { [key: string]: string }
  ): lambda.Function {
    // Create CloudWatch log group for the Lambda function
    const logGroup = new logs.LogGroup(this, `${id}LogGroup`, {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const lambdaFunction = new lambda.Function(this, id, {
      functionName,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler,
      code: lambda.Code.fromAsset(codePath),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: {
        NODE_ENV: 'production',
        USER_POOL_ID: this.userPool.userPoolId,
        USER_POOL_CLIENT_ID: this.userPoolClient.userPoolClientId,
        ...environment,
      },
      logGroup,
    });

    // Grant the Lambda function permission to write to CloudWatch Logs
    lambdaFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [logGroup.logGroupArn],
      })
    );

    return lambdaFunction;
  }

  // Helper method to add Lambda integration to API Gateway with proper CORS
  public addLambdaIntegration(
    resource: apigateway.Resource,
    method: string,
    lambdaFunction: lambda.Function,
    requireAuth: boolean = true
  ): apigateway.Method {
    const integration = new apigateway.LambdaIntegration(lambdaFunction, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
      integrationResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': "'*'",
            'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
            'method.response.header.Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
          },
        },
      ],
    });

    let methodOptions: apigateway.MethodOptions = {
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true,
          },
        },
      ],
    };

    if (requireAuth) {
      methodOptions = {
        ...methodOptions,
        authorizer: this.cognitoAuthorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      };
    }

    return resource.addMethod(method, integration, methodOptions);
  }
}