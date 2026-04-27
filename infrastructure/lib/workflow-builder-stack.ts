import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as fs from 'fs';
import { Construct } from 'constructs';
import { getConfig, StackConfig, PROJECT } from './config';
import { FrontendHosting } from './constructs/frontend-hosting';

export class WorkflowBuilderStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly identityPool: cognito.CfnIdentityPool;
  public readonly api: apigateway.RestApi;
  private _cognitoAuthorizer?: apigateway.CognitoUserPoolsAuthorizer;
  private readonly config: StackConfig;
  private workflowsTable: dynamodb.Table;
  public readonly frontendHosting: FrontendHosting;
  private readonly vpc: ec2.Vpc;
  private readonly lambdaSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Load configuration based on environment
    this.config = getConfig(process.env.NODE_ENV || 'development');

    // Create VPC with NAT Gateway for Lambda functions
    this.vpc = new ec2.Vpc(this, 'LambdaVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    // Free gateway endpoints for DynamoDB and S3
    this.vpc.addGatewayEndpoint('DynamoDbEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // Security group for Lambda functions
    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Lambda functions in VPC',
      allowAllOutbound: true,
    });

    // Allow HTTPS inbound from itself so Lambda can reach the OpenSearch VPC endpoint
    this.lambdaSecurityGroup.addIngressRule(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(443),
      'Allow HTTPS from Lambda to OpenSearch VPC endpoint',
    );

    // VPC stack-deletion cleanup: tears down child workflow stacks and drains
    // leftover Lambda ENIs on parent VPC subnets/SG so CFN can delete VPC cleanly.
    this.createVpcCleanupCustomResource();

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
    
    // Create Frontend Hosting (S3 + CloudFront)
    this.frontendHosting = new FrontendHosting(this, 'FrontendHosting', {
      environment: this.config.environment,
    });
    
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
    const identityPool = new cognito.CfnIdentityPool(this, `${PROJECT.projectNamePascal}IdentityPool`, {
      identityPoolName: PROJECT.cognito.identityPoolName,
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
                `arn:aws:states:${this.region}:${this.account}:stateMachine:${PROJECT.projectName}-*`,
                `arn:aws:states:${this.region}:${this.account}:execution:${PROJECT.projectName}-*:*`,
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
      logGroupName: PROJECT.apiGateway.logGroupName,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const api = new apigateway.RestApi(this, `${PROJECT.projectNamePascal}Api`, {
      restApiName: PROJECT.apiGateway.name,
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
      tableName: PROJECT.dynamodb.deploymentsTable,
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
      tableName: PROJECT.dynamodb.workflowsTable,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: this.config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Create S3 bucket for Lambda code storage
    const lambdaCodeBucket = new s3.Bucket(this, 'LambdaCodeBucket', {
      bucketName: `${PROJECT.s3.lambdaCodeBucket}-${this.account}-${this.region}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: this.config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: this.config.environment !== 'production',
      lifecycleRules: [
        {
          id: 'DeleteOldVersions',
          enabled: true,
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
    });

    // Conditionally create OpenSearch Serverless collection
    const enableOpenSearch = PROJECT.enableOpenSearch !== false;
    const opensearchCollection = enableOpenSearch
      ? this.createOpenSearchServerlessCollection()
      : undefined;

    // Create deployment Lambda function
    const deploymentLambda = this.createLambdaFunction(
      'DeploymentLambda',
      PROJECT.lambda.deployment,
      '../lambda-functions/deployment-lambda/dist',
      'index.deployWorkflow',
      {
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        WORKFLOWS_TABLE: this.workflowsTable.tableName,
        AWS_ACCOUNT_ID: this.account,
        LAMBDA_CODE_BUCKET: lambdaCodeBucket.bucketName,
        OPENSEARCH_ENDPOINT: opensearchCollection?.attrCollectionEndpoint ?? '',
        VPC_CONFIG: JSON.stringify(PROJECT.vpc || { mode: 'none' }),
        // Pass CDK VPC config for OpenSearch indexer (must be in same VPC as OpenSearch endpoint)
        OPENSEARCH_VPC_CONFIG: JSON.stringify({
          vpcId: this.vpc.vpcId,
          subnetIds: this.vpc.privateSubnets.map(s => s.subnetId),
          securityGroupIds: [this.lambdaSecurityGroup.securityGroupId],
        }),
      }
    );

    // Create deployment status Lambda function
    const deploymentStatusLambda = this.createLambdaFunction(
      'DeploymentStatusLambda',
      PROJECT.lambda.deploymentStatus,
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
      PROJECT.lambda.deploymentStatusUpdate,
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
      PROJECT.lambda.workflowStatusUpdate,
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
          'cloudformation:GetTemplate',
        ],
        resources: [
          `arn:aws:cloudformation:${this.region}:${this.account}:stack/workflow-*/*`,
        ],
      })
    );

    // Grant S3 notification permissions to status update Lambda (for enabling EventBridge on S3 buckets)
    deploymentStatusUpdateLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetBucketNotification',
          's3:PutBucketNotification',
        ],
        resources: ['*'],
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
          // EC2/VPC permissions for CloudFormation to create VPC resources and attach Lambdas to VPCs
          'ec2:CreateVpc',
          'ec2:DeleteVpc',
          'ec2:DescribeVpcs',
          'ec2:ModifyVpcAttribute',
          'ec2:CreateSubnet',
          'ec2:DeleteSubnet',
          'ec2:DescribeSubnets',
          'ec2:ModifySubnetAttribute',
          'ec2:CreateSecurityGroup',
          'ec2:DeleteSecurityGroup',
          'ec2:DescribeSecurityGroups',
          'ec2:AuthorizeSecurityGroupEgress',
          'ec2:RevokeSecurityGroupEgress',
          'ec2:CreateInternetGateway',
          'ec2:DeleteInternetGateway',
          'ec2:AttachInternetGateway',
          'ec2:DetachInternetGateway',
          'ec2:DescribeInternetGateways',
          'ec2:AllocateAddress',
          'ec2:ReleaseAddress',
          'ec2:DescribeAddresses',
          'ec2:CreateNatGateway',
          'ec2:DeleteNatGateway',
          'ec2:DescribeNatGateways',
          'ec2:CreateRouteTable',
          'ec2:DeleteRouteTable',
          'ec2:DescribeRouteTables',
          'ec2:CreateRoute',
          'ec2:DeleteRoute',
          'ec2:AssociateRouteTable',
          'ec2:DisassociateRouteTable',
          'ec2:DescribeAvailabilityZones',
          'ec2:CreateNetworkInterface',
          'ec2:DeleteNetworkInterface',
          'ec2:DescribeNetworkInterfaces',
          'ec2:CreateTags',
          'ec2:DeleteTags',
          'ec2:DescribeVpcGatewayAttachments',
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
          `arn:aws:states:${this.region}:${this.account}:stateMachine:${PROJECT.stepFunctions.deploymentStateMachine}`,
          `arn:aws:states:${this.region}:${this.account}:stateMachine:SF-*`, // For new direct deployment
          `arn:aws:states:${this.region}:${this.account}:execution:${PROJECT.stepFunctions.deploymentStateMachine}:*`,
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
          // EC2/VPC cleanup permissions (for deleting workflow VPC resources)
          'ec2:DeleteVpc',
          'ec2:DeleteSubnet',
          'ec2:DeleteSecurityGroup',
          'ec2:DeleteInternetGateway',
          'ec2:DetachInternetGateway',
          'ec2:ReleaseAddress',
          'ec2:DeleteNatGateway',
          'ec2:DeleteRouteTable',
          'ec2:DeleteRoute',
          'ec2:DisassociateRouteTable',
          'ec2:DeleteNetworkInterface',
          'ec2:DescribeVpcs',
          'ec2:DescribeSubnets',
          'ec2:DescribeSecurityGroups',
          'ec2:DescribeInternetGateways',
          'ec2:DescribeNatGateways',
          'ec2:DescribeRouteTables',
          'ec2:DescribeNetworkInterfaces',
          'ec2:DescribeAddresses',
          'ec2:DescribeVpcGatewayAttachments',
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
    deploymentLambda.addEnvironment('DEPLOYMENT_STATE_MACHINE_ARN', `arn:aws:states:${this.region}:${this.account}:stateMachine:${PROJECT.stepFunctions.deploymentStateMachine}`);

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
      PROJECT.lambda.listExecutions,
      '../lambda-functions/deployment-lambda/dist',
      'index.listExecutions',
      {
        AWS_ACCOUNT_ID: this.account,
      }
    );

    const describeExecutionLambda = this.createLambdaFunction(
      'DescribeExecutionLambda',
      PROJECT.lambda.describeExecution,
      '../lambda-functions/deployment-lambda/dist',
      'index.describeExecution',
      {
        AWS_ACCOUNT_ID: this.account,
      }
    );

    const executionHistoryLambda = this.createLambdaFunction(
      'ExecutionHistoryLambda',
      PROJECT.lambda.executionHistory,
      '../lambda-functions/deployment-lambda/dist',
      'index.getExecutionHistory',
      {
        AWS_ACCOUNT_ID: this.account,
      }
    );

    const startExecutionLambda = this.createLambdaFunction(
      'StartExecutionLambda',
      PROJECT.lambda.startExecution,
      '../lambda-functions/deployment-lambda/dist',
      'index.startExecution',
      {
        AWS_ACCOUNT_ID: this.account,
      }
    );

    const stopExecutionLambda = this.createLambdaFunction(
      'StopExecutionLambda',
      PROJECT.lambda.stopExecution,
      '../lambda-functions/deployment-lambda/dist',
      'index.stopExecution',
      {
        AWS_ACCOUNT_ID: this.account,
      }
    );

    const describeStateMachineLambda = this.createLambdaFunction(
      'DescribeStateMachineLambda',
      PROJECT.lambda.describeStateMachine,
      '../lambda-functions/deployment-lambda/dist',
      'index.describeStateMachine',
      {
        AWS_ACCOUNT_ID: this.account,
      }
    );

    const describeStateMachineForExecutionLambda = this.createLambdaFunction(
      'DescribeStateMachineForExecutionLambda',
      PROJECT.lambda.describeStateMachineForExecution,
      '../lambda-functions/deployment-lambda/dist',
      'index.describeStateMachineForExecution',
      {
        AWS_ACCOUNT_ID: this.account,
      }
    );

    const redriveExecutionLambda = this.createLambdaFunction(
      'RedriveExecutionLambda',
      PROJECT.lambda.redriveExecution,
      '../lambda-functions/deployment-lambda/dist',
      'index.redriveExecution',
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
      describeStateMachineForExecutionLambda,
      redriveExecutionLambda
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
            'states:RedriveExecution',
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

    // POST /deployments/step-functions/redrive-execution
    const redriveExecutionResource = stepFunctionsResource.addResource('redrive-execution');
    this.addLambdaIntegration(redriveExecutionResource, 'POST', redriveExecutionLambda, true);

    // Add workflow API endpoints
    
    // GET /iam/roles - List IAM roles
    const iamResource = this.api.root.addResource('iam');
    const rolesResource = iamResource.addResource('roles');
    
    const iamRolesLambda = this.createLambdaFunction(
      'IAMRolesLambda',
      'iam-roles-handler',
      '../lambda-functions/workflow-lambda/dist',
      'iamRoles.handler',
      {
        AWS_ACCOUNT_ID: this.account,
      }
    );
    
    // Grant IAM list permissions
    iamRolesLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:ListRoles', 'tag:GetResources'],
        resources: ['*'],
      })
    );
    
    this.addLambdaIntegration(rolesResource, 'GET', iamRolesLambda, true);

    // GET /vpc/list - List existing VPCs with subnets and security groups
    const vpcResource = this.api.root.addResource('vpc');
    const vpcListResource = vpcResource.addResource('list');

    const vpcListLambda = this.createLambdaFunction(
      'VPCListLambda',
      'vpc-list-handler',
      '../lambda-functions/workflow-lambda/dist',
      'vpcList.handler',
      {}
    );

    vpcListLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ec2:DescribeVpcs', 'ec2:DescribeSubnets', 'ec2:DescribeSecurityGroups'],
        resources: ['*'],
      })
    );

    this.addLambdaIntegration(vpcListResource, 'GET', vpcListLambda, true);
    
    // POST /opensearch/search - Search OpenSearch Serverless (Python Lambda)
    if (enableOpenSearch && opensearchCollection) {
    const opensearchResource = this.api.root.addResource('opensearch');
    const opensearchSearchResource = opensearchResource.addResource('search');
    
    const opensearchSearchLambda = new lambda.Function(this, 'OpenSearchSearchLambda', {
      functionName: 'opensearch-search-handler',
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromInline(this.getOpenSearchSearchCode()),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [this.lambdaSecurityGroup],
      environment: {
        OPENSEARCH_ENDPOINT: opensearchCollection.attrCollectionEndpoint,
      },
    });
    
    // Grant OpenSearch Serverless permissions
    opensearchSearchLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['aoss:APIAccessAll'],
        resources: ['*'],
      })
    );
    
    this.addLambdaIntegration(opensearchSearchResource, 'POST', opensearchSearchLambda, true);
    }
    
    // GET /workflows - List user's workflows
    const listWorkflowsLambda = this.createLambdaFunction(
      'ListWorkflowsLambda',
      PROJECT.lambda.listWorkflows,
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
      PROJECT.lambda.saveWorkflow,
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
      PROJECT.lambda.workflow,
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
      PROJECT.lambda.deleteWorkflow,
      '../lambda-functions/deployment-lambda/dist',
      'index.deleteWorkflow',
      {
        WORKFLOWS_TABLE: this.workflowsTable.tableName,
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        AWS_ACCOUNT_ID: this.account,
        USER_POOL_ID: this.userPool.userPoolId,
        USER_POOL_CLIENT_ID: this.userPoolClient.userPoolClientId,
        DELETION_STATE_MACHINE_ARN: `arn:aws:states:${this.region}:${this.account}:stateMachine:${PROJECT.stepFunctions.deletionStateMachine}`,
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
          `arn:aws:states:${this.region}:${this.account}:stateMachine:${PROJECT.stepFunctions.deletionStateMachine}`,
          `arn:aws:states:${this.region}:${this.account}:stateMachine:${PROJECT.stepFunctions.deletionStateMachine}:*`,
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
      PROJECT.lambda.deploymentHistory,
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
        authorizerName: PROJECT.apiGateway.authorizerName,
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
              actions: [
                'events:PutEvents',
                'events:PutRule',
                'events:DeleteRule',
                'events:DescribeRule',
                'events:PutTargets',
                'events:RemoveTargets',
              ],
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
            // EC2/VPC permissions for CloudFormation to create/delete VPC resources for workflows
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ec2:CreateVpc',
                'ec2:DeleteVpc',
                'ec2:DescribeVpcs',
                'ec2:ModifyVpcAttribute',
                'ec2:CreateSubnet',
                'ec2:DeleteSubnet',
                'ec2:DescribeSubnets',
                'ec2:ModifySubnetAttribute',
                'ec2:CreateSecurityGroup',
                'ec2:DeleteSecurityGroup',
                'ec2:DescribeSecurityGroups',
                'ec2:AuthorizeSecurityGroupEgress',
                'ec2:RevokeSecurityGroupEgress',
                'ec2:CreateInternetGateway',
                'ec2:DeleteInternetGateway',
                'ec2:AttachInternetGateway',
                'ec2:DetachInternetGateway',
                'ec2:DescribeInternetGateways',
                'ec2:AllocateAddress',
                'ec2:ReleaseAddress',
                'ec2:DescribeAddresses',
                'ec2:CreateNatGateway',
                'ec2:DeleteNatGateway',
                'ec2:DescribeNatGateways',
                'ec2:CreateRouteTable',
                'ec2:DeleteRouteTable',
                'ec2:DescribeRouteTables',
                'ec2:CreateRoute',
                'ec2:DeleteRoute',
                'ec2:AssociateRouteTable',
                'ec2:DisassociateRouteTable',
                'ec2:DescribeAvailabilityZones',
                'ec2:CreateNetworkInterface',
                'ec2:DeleteNetworkInterface',
                'ec2:DescribeNetworkInterfaces',
                'ec2:CreateTags',
                'ec2:DeleteTags',
                'ec2:DescribeVpcGatewayAttachments',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // Create the state machine
    const stateMachine = new stepfunctions.StateMachine(this, 'DeploymentStateMachine', {
      stateMachineName: PROJECT.stepFunctions.deploymentStateMachine,
      definitionBody: stepfunctions.DefinitionBody.fromString(processedDefinition),
      role: stepFunctionsRole,
      logs: {
        destination: new logs.LogGroup(this, 'DeploymentStateMachineLogGroup', {
          logGroupName: PROJECT.stepFunctions.deploymentLogGroup,
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
      PROJECT.lambda.deleteCloudFormationStack,
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
      PROJECT.lambda.deleteDatabaseRecords,
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

    // Grant EventBridge permissions to clean up rules before stack deletion
    deleteCloudFormationStackLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'events:ListTargetsByRule',
          'events:RemoveTargets',
          'events:DeleteRule',
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
      stateMachineName: PROJECT.stepFunctions.deletionStateMachine,
      definitionBody: stepfunctions.DefinitionBody.fromString(processedDefinition),
      role: deletionStepFunctionsRole,
      logs: {
        destination: new logs.LogGroup(this, 'DeletionStateMachineLogGroup', {
          logGroupName: PROJECT.stepFunctions.deletionLogGroup,
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
      ruleName: PROJECT.eventBridge.stepFunctionStateChanges,
      description: 'Capture Step Functions state changes for deployment progress tracking',
      eventPattern: {
        source: ['aws.states'],
        detailType: ['Step Functions Execution Status Change'],
        detail: {
          stateMachineArn: [{
            prefix: `arn:aws:states:${this.region}:${this.account}:stateMachine:${PROJECT.stepFunctions.deploymentStateMachine}`
          }]
        }
      },
    });

    // Add EventBridge handler as target for EventBridge rule
    stepFunctionStateChangeRule.addTarget(new targets.LambdaFunction(eventBridgeHandler));

    // Create EventBridge rule to capture Step Functions deletion state changes
    const stepFunctionDeletionStateChangeRule = new events.Rule(this, 'StepFunctionDeletionStateChangeRule', {
      ruleName: PROJECT.eventBridge.deletionStateChanges,
      description: 'Capture Step Functions deletion state changes for deletion progress tracking',
      eventPattern: {
        source: ['aws.states'],
        detailType: ['Step Functions Execution Status Change'],
        detail: {
          stateMachineArn: [{
            prefix: `arn:aws:states:${this.region}:${this.account}:stateMachine:${PROJECT.stepFunctions.deletionStateMachine}`
          }]
        }
      },
    });

    // Add EventBridge handler as target for deletion Step Functions rule
    stepFunctionDeletionStateChangeRule.addTarget(new targets.LambdaFunction(eventBridgeHandler));

    // Create EventBridge rule to capture custom workflow deployment events (from state machine)
    const workflowDeploymentEventRule = new events.Rule(this, 'WorkflowDeploymentEventRule', {
      ruleName: PROJECT.eventBridge.deploymentEvents,
      description: 'Capture custom workflow deployment events for real-time UI updates',
      eventPattern: {
        source: [`${PROJECT.projectName}.deployment`],
        detailType: ['Deployment Status Update'],
      },
    });

    // Add EventBridge handler as target for deployment events rule
    workflowDeploymentEventRule.addTarget(new targets.LambdaFunction(eventBridgeHandler));

    // Create EventBridge rule to capture custom workflow deletion events (from state machine)
    const workflowDeletionEventRule = new events.Rule(this, 'WorkflowDeletionEventRule', {
      ruleName: PROJECT.eventBridge.deletionEvents,
      description: 'Capture custom workflow deletion events for real-time UI updates',
      eventPattern: {
        source: [`${PROJECT.projectName}.deletion`],
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
      exportName: `${PROJECT.projectNamePascal}WebSocketUrl`,
    });
  }

  private createOutputs(): void {
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${PROJECT.projectNamePascal}UserPoolId`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `${PROJECT.projectNamePascal}UserPoolClientId`,
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: this.api.url,
      description: 'API Gateway URL',
      exportName: `${PROJECT.projectNamePascal}ApiUrl`,
    });

    new cdk.CfnOutput(this, 'ApiGatewayId', {
      value: this.api.restApiId,
      description: 'API Gateway ID',
      exportName: `${PROJECT.projectNamePascal}ApiId`,
    });

    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: this.identityPool.ref,
      description: 'Cognito Identity Pool ID',
      exportName: `${PROJECT.projectNamePascal}IdentityPoolId`,
    });

    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: `${this.config.cognito.domainPrefix}.auth.${this.region}.amazoncognito.com`,
      description: 'Cognito Hosted UI Domain',
      exportName: `${PROJECT.projectNamePascal}CognitoDomain`,
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

    // Check if this is a TypeScript Lambda (deployment-lambda)
    const isDeploymentLambda = codePath.includes('deployment-lambda');
    
    let code: lambda.Code;
    
    if (isDeploymentLambda) {
      // Use fromAsset with bundling to run build script before deployment
      // This ensures all dependencies (including hoisted ones like zod) are included
      const lambdaPath = codePath.replace('/dist', '');
      code = lambda.Code.fromAsset(lambdaPath, {
        bundling: {
          image: lambda.Runtime.NODEJS_18_X.bundlingImage,
          local: {
            tryBundle(outputDir: string): boolean {
              // Run the build script locally
              const execSync = require('child_process').execSync;
              try {
                execSync('./build.sh', { 
                  cwd: lambdaPath,
                  stdio: 'inherit'
                });
                // Copy dist contents to output
                execSync(`cp -R dist/* "${outputDir}/"`, {
                  cwd: lambdaPath,
                  stdio: 'inherit'
                });
                return true;
              } catch (e) {
                console.error('Local bundling failed:', e);
                return false;
              }
            }
          },
          command: [
            'bash', '-c', [
              'npm ci',
              './build.sh',
              'cp -R dist/* /asset-output/'
            ].join(' && ')
          ],
        },
      });
    } else {
      code = lambda.Code.fromAsset(codePath);
    }

    const lambdaFunction = new lambda.Function(this, id, {
      functionName,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler,
      code,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [this.lambdaSecurityGroup],
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

  /**
   * Create OpenSearch Serverless collection for message indexing
   */
  private createOpenSearchServerlessCollection(): cdk.aws_opensearchserverless.CfnCollection {
    const collectionName = `health-msgs-${this.account.slice(-6)}`;

    // Encryption policy (required before collection)
    const encryptionPolicy = new cdk.aws_opensearchserverless.CfnSecurityPolicy(this, 'OpenSearchEncryptionPolicy', {
      name: `health-msgs-encrypt-${this.account.slice(-6)}`,
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [{ ResourceType: 'collection', Resource: [`collection/${collectionName}`] }],
        AWSOwnedKey: true,
      }),
    });

    // Network policy — respect VPC config
    const vpcMode = (PROJECT.vpc || { mode: 'none' }).mode;
    let networkPolicyJson: string;

    if (vpcMode === 'none') {
      networkPolicyJson = JSON.stringify([{
        Rules: [
          { ResourceType: 'collection', Resource: [`collection/${collectionName}`] },
          { ResourceType: 'dashboard', Resource: [`collection/${collectionName}`] },
        ],
        AllowFromPublic: true,
      }]);
    } else {
      // Create an OpenSearch Serverless VPC endpoint
      const opensearchVpcEndpoint = new cdk.aws_opensearchserverless.CfnVpcEndpoint(this, 'OpenSearchVpcEndpoint', {
        name: `health-msgs-vpce-${this.account.slice(-6)}`,
        vpcId: this.vpc.vpcId,
        subnetIds: this.vpc.privateSubnets.map(s => s.subnetId),
        securityGroupIds: [this.lambdaSecurityGroup.securityGroupId],
      });

      networkPolicyJson = JSON.stringify([{
        Rules: [
          { ResourceType: 'collection', Resource: [`collection/${collectionName}`] },
          { ResourceType: 'dashboard', Resource: [`collection/${collectionName}`] },
        ],
        AllowFromPublic: false,
        SourceVPCEs: [opensearchVpcEndpoint.attrId],
      }]);
    }

    const networkPolicy = new cdk.aws_opensearchserverless.CfnSecurityPolicy(this, 'OpenSearchNetworkPolicy', {
      name: `health-msgs-network-${this.account.slice(-6)}`,
      type: 'network',
      policy: networkPolicyJson,
    });

    // Data access policy - allow all IAM principals in the account
    const dataAccessPolicy = new cdk.aws_opensearchserverless.CfnAccessPolicy(this, 'OpenSearchDataAccessPolicy', {
      name: `health-msgs-access-${this.account.slice(-6)}`,
      type: 'data',
      policy: JSON.stringify([{
        Rules: [
          {
            ResourceType: 'index',
            Resource: [`index/${collectionName}/*`],
            Permission: ['aoss:*'],
          },
          {
            ResourceType: 'collection',
            Resource: [`collection/${collectionName}`],
            Permission: ['aoss:*'],
          },
        ],
        Principal: [`arn:aws:iam::${this.account}:root`],
      }]),
    });

    // Create the collection
    const collection = new cdk.aws_opensearchserverless.CfnCollection(this, 'OpenSearchCollection', {
      name: collectionName,
      type: 'SEARCH',
      description: 'Shared collection for health message indexing across all workflows',
    });

    // Ensure policies are created before collection
    collection.addDependency(encryptionPolicy);
    collection.addDependency(networkPolicy);
    collection.addDependency(dataAccessPolicy);

    // Output the endpoint
    new cdk.CfnOutput(this, 'OpenSearchEndpoint', {
      value: collection.attrCollectionEndpoint,
      description: 'OpenSearch Serverless collection endpoint',
      exportName: 'OpenSearchEndpoint',
    });

    return collection;
  }

  private getOpenSearchSearchCode(): string {
    return `
import json
import os
import boto3
import urllib.request
import hashlib
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from urllib.parse import urlparse

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json'
}

def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}
    
    try:
        body = json.loads(event.get('body', '{}'))
        endpoint = os.environ.get('OPENSEARCH_ENDPOINT', '').rstrip('/')
        index_name = body.get('indexName', 'health-messages')
        query_params = body.get('query', {})
        config = body.get('searchConfig', {})
        workflow_id = body.get('workflowId', '')
        
        if not endpoint or not index_name:
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'indexName required'})}
        
        # Add workflowId filter if provided
        if workflow_id:
            query_params['workflowId'] = workflow_id
        
        query = build_query(query_params, config)
        url = f"{endpoint}/{index_name}/_search"
        data = json.dumps(query).encode('utf-8')
        body_hash = hashlib.sha256(data).hexdigest()
        
        parsed = urlparse(url)
        session = boto3.Session()
        creds = session.get_credentials().get_frozen_credentials()
        region = os.environ['AWS_REGION']
        
        headers = {'Content-Type': 'application/json', 'Host': parsed.netloc, 'x-amz-content-sha256': body_hash}
        request = AWSRequest(method='POST', url=url, data=data, headers=headers)
        SigV4Auth(creds, 'aoss', region).add_auth(request)
        
        req = urllib.request.Request(url, data=data, method='POST')
        for k, v in request.headers.items():
            req.add_header(k, v)
        
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            hits = result.get('hits', {})
            return {
                'statusCode': 200,
                'headers': CORS_HEADERS,
                'body': json.dumps({'total': hits.get('total', {}).get('value', 0), 'results': [h['_source'] for h in hits.get('hits', [])]})
            }
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        return {'statusCode': e.code, 'headers': CORS_HEADERS, 'body': json.dumps({'error': error_body})}
    except Exception as e:
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)})}

def build_query(params, config):
    must = []
    filters = []
    
    if params.get('searchText'):
        must.append({'multi_match': {'query': params['searchText'], 'fields': ['*'], 'fuzziness': 'AUTO'}})
    if params.get('dataPartnerName'):
        must.append({'match': {'dataPartnerName': {'query': params['dataPartnerName'], 'fuzziness': 'AUTO'}}})
    if params.get('messageType'):
        must.append({'match': {'Message_Type': {'query': params['messageType'], 'fuzziness': 'AUTO'}}})
    if params.get('messageControlId'):
        must.append({'match': {'Control_ID': {'query': params['messageControlId'], 'fuzziness': 'AUTO'}}})
    if params.get('fillerOrderNumber'):
        must.append({'match': {'fillerOrderNumber': {'query': params['fillerOrderNumber'], 'fuzziness': 'AUTO'}}})
    if params.get('workflowId'):
        filters.append({'term': {'workflowId.keyword': params['workflowId']}})
    
    date_field = config.get('dateRangeField', 'ingestedAt')
    date_days = config.get('dateRangeDays', 7)
    filters.append({'range': {date_field: {'gte': f'now-{date_days}d', 'lte': 'now'}}})
    
    return {'query': {'bool': {'must': must if must else [{'match_all': {}}], 'filter': filters}}, 'size': 100}
`.trim();
  }

  /**
   * Create the VPC-cleanup Custom Resource. On stack Delete it deletes all child
   * workflow stacks and drains leftover Lambda ENIs from the parent VPC so CFN
   * can then delete the VPC / subnets / SG cleanly.
   */
  private createVpcCleanupCustomResource(): void {
    // NOTE: cleanup Lambda must NOT run in the VPC it is trying to clean.
    const cleanupLambda = new lambda.Function(this, 'VpcCleanupLambda', {
      functionName: 'workflow-builder-vpc-cleanup',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.vpcCleanup',
      code: lambda.Code.fromAsset('../lambda-functions/deployment-lambda/dist'),
      timeout: cdk.Duration.minutes(15),
      memorySize: 256,
      environment: {
        CHILD_STACK_PREFIX: 'workflow-',
        SUBNET_IDS: this.vpc.privateSubnets.map((s) => s.subnetId).join(','),
        SECURITY_GROUP_ID: this.lambdaSecurityGroup.securityGroupId,
      },
    });

    cleanupLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:ListStacks',
          'cloudformation:DescribeStacks',
          'cloudformation:DeleteStack',
          'ec2:DescribeNetworkInterfaces',
          'ec2:DeleteNetworkInterface',
        ],
        resources: ['*'],
      }),
    );
    // Allow cleanup to tear down resources inside child workflow stacks.
    cleanupLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'lambda:DeleteFunction',
          'lambda:GetFunction',
          'iam:DeleteRole',
          'iam:DeleteRolePolicy',
          'iam:DetachRolePolicy',
          'iam:ListRolePolicies',
          'iam:ListAttachedRolePolicies',
          'logs:DeleteLogGroup',
          'logs:DescribeLogGroups',
          'states:DeleteStateMachine',
          'states:DescribeStateMachine',
          'states:ListStateMachines',
          'events:RemoveTargets',
          'events:DeleteRule',
          'events:ListTargetsByRule',
        ],
        resources: ['*'],
      }),
    );

    const provider = new cr.Provider(this, 'VpcCleanupProvider', {
      onEventHandler: cleanupLambda,
      // Provider waits up to 2h via async signal from CFN; our handler runs
      // synchronously under 15 min, which is fine for onEvent-only providers.
    });

    const customResource = new cdk.CustomResource(this, 'VpcCleanupResource', {
      serviceToken: provider.serviceToken,
    });

    // The CR references the VPC's subnet IDs and SG ID via env vars, so CFN
    // already sees the CR as dependent on the VPC/SG. On delete, CFN removes
    // dependents first, so the CR runs before VPC/SG teardown. No explicit
    // addDependency is needed — and adding one would create a cycle because
    // the Provider framework's Lambda itself transitively depends on IAM and
    // other stack resources that reference the VPC.
    void customResource;
  }
}