import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
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
  private teamsTable!: dynamodb.Table;
  private membershipsTable!: dynamodb.Table;
  private adminAuditLogTable!: dynamodb.Table;
  private workflowChangeLogsTable!: dynamodb.Table;
  private changelogLambda?: lambda.Function;
  public readonly frontendHosting: FrontendHosting;
  private readonly vpc: ec2.IVpc | undefined;
  private readonly lambdaSecurityGroup: ec2.ISecurityGroup | undefined;
  private readonly lambdaVpcProps: { vpc: ec2.IVpc; vpcSubnets: ec2.SubnetSelection; securityGroups: ec2.ISecurityGroup[] } | {};
  private readonly vpcConfigEnv: Record<string, string>;
  private readonly resolvedSubnetIds: string[];
  private readonly resolvedSecurityGroupIds: string[];
  // Explicit IAM role for the OpenSearch search Lambda. Created in
  // createOpenSearchServerlessCollection() so its ARN can be granted
  // narrow read-only access in the AOSS data access policy. Consumed when
  // the search Lambda function is constructed alongside the API Gateway.
  private opensearchSearchLambdaRole?: iam.Role;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Load configuration based on environment
    this.config = getConfig(process.env.NODE_ENV || 'development');

    // Conditionally create/import VPC based on config
    const vpcMode = (PROJECT.vpc || { mode: 'none' }).mode;

    if (vpcMode === 'new') {
      const newVpc = new ec2.Vpc(this, 'LambdaVpc', {
        maxAzs: 2,
        natGateways: 1,
        subnetConfiguration: [
          { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
          { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        ],
      });
      newVpc.addGatewayEndpoint('DynamoDbEndpoint', { service: ec2.GatewayVpcEndpointAwsService.DYNAMODB });
      newVpc.addGatewayEndpoint('S3Endpoint', { service: ec2.GatewayVpcEndpointAwsService.S3 });
      this.vpc = newVpc;
      const sg = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
        vpc: newVpc,
        description: 'Security group for Lambda functions in VPC',
        allowAllOutbound: true,
      });
      sg.addIngressRule(sg, ec2.Port.tcp(443), 'Allow HTTPS from Lambda to OpenSearch VPC endpoint');
      this.lambdaSecurityGroup = sg;
      this.resolvedSubnetIds = newVpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds;
      this.resolvedSecurityGroupIds = [sg.securityGroupId];
    } else if (vpcMode === 'existing') {
      const existingConfig = PROJECT.vpc?.existing;
      if (!existingConfig?.vpcId || !existingConfig?.subnetIds?.length || !existingConfig?.securityGroupIds?.length) {
        throw new Error('vpc.mode is "existing" but vpc.existing.vpcId, subnetIds, or securityGroupIds are missing or empty in config.yaml');
      }
      this.vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', { vpcId: existingConfig.vpcId });
      this.lambdaSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'ImportedSG', existingConfig.securityGroupIds[0]);
      this.resolvedSubnetIds = existingConfig.subnetIds;
      this.resolvedSecurityGroupIds = existingConfig.securityGroupIds;
    } else {
      this.vpc = undefined;
      this.lambdaSecurityGroup = undefined;
      this.resolvedSubnetIds = [];
      this.resolvedSecurityGroupIds = [];
    }

    // Pre-compute VPC props for Lambda functions and env vars
    if (this.vpc) {
      this.lambdaVpcProps = {
        vpc: this.vpc,
        vpcSubnets: vpcMode === 'existing'
          ? { subnets: this.resolvedSubnetIds.map(id => ec2.Subnet.fromSubnetId(this, `ImportedSubnet-${id}`, id)) }
          : { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [this.lambdaSecurityGroup!],
      };
      this.vpcConfigEnv = {
        VPC_CONFIG: JSON.stringify({ mode: 'existing', existing: { vpcId: this.vpc.vpcId, subnetIds: this.resolvedSubnetIds, securityGroupIds: this.resolvedSecurityGroupIds } }),
        OPENSEARCH_VPC_CONFIG: JSON.stringify({ vpcId: this.vpc.vpcId, subnetIds: this.resolvedSubnetIds, securityGroupIds: this.resolvedSecurityGroupIds }),
      };
    } else {
      this.lambdaVpcProps = {};
      this.vpcConfigEnv = { VPC_CONFIG: JSON.stringify({ mode: 'none' }) };
    }

    // Create Frontend Hosting (S3 + CloudFront) - needed for CORS origin configuration
    this.frontendHosting = new FrontendHosting(this, 'FrontendHosting', {
      environment: this.config.environment,
    });

    // Create API Gateway first (needed for Identity Pool permissions)
    this.api = this.createApiGateway();

    // Create Teams / Memberships / AdminAuditLog tables BEFORE the user pool
    // because the PreTokenGeneration trigger Lambda needs to read Memberships
    // to inject team/role claims into the JWT.
    this.createTeamTables();

    // Create Cognito User Pool
    this.userPool = this.createUserPool();

    // Add the bootstrap "admins" Cognito group. First admin must be added via
    // AWS console; subsequent admins are managed via the admin API.
    new cognito.CfnUserPoolGroup(this, 'AdminsGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'admins',
      description: 'Workflow Builder admins. Members can manage teams and users.',
    });

    // Create Cognito User Pool Client
    this.userPoolClient = this.createUserPoolClient();

    // PreTokenGeneration Lambda is wired AFTER both userPool and userPoolClient
    // exist, because createLambdaFunction injects USER_POOL_ID/CLIENT_ID env
    // vars by default. Attaching the trigger via addTrigger() keeps the order
    // legal at synth time.
    this.attachPreTokenGenerationTrigger();

    // Create Cognito Identity Pool
    this.identityPool = this.createIdentityPool();

    // Cognito authorizer will be created lazily when needed

    // Create deployment endpoints
    this.createDeploymentEndpoints();

    // Admin + me-teams API endpoints
    this.createAdminEndpoints();
    
    // Create WebSocket API for real-time deployment updates
    this.createWebSocketApi();
    
    // Set up CORS configuration (must be after frontendHosting is created)
    this.setupCorsConfiguration();
    
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
      // user_role / organization attributes are intentionally removed.
      // Roles are now derived from the Memberships table per team and
      // injected into the JWT by the PreTokenGeneration trigger.
      customAttributes: {},
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

  private attachPreTokenGenerationTrigger(): void {
    // Build this Lambda WITHOUT the createLambdaFunction helper. The helper
    // injects USER_POOL_ID/USER_POOL_CLIENT_ID env vars by default; combined
    // with userPool.addTrigger() (which makes UserPool → Lambda), those env
    // vars create a Lambda → UserPool reference and CloudFormation rejects
    // the resulting circular dependency. The PreTokenGen handler only needs
    // MEMBERSHIPS_TABLE, so a hand-rolled Lambda definition breaks the cycle.
    const logGroup = new logs.LogGroup(this, 'PreTokenGenerationLambdaLogGroup', {
      logGroupName: `/aws/lambda/${PROJECT.lambda.preTokenGeneration}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const lambdaPath = '../lambda-functions/deployment-lambda';
    const code = lambda.Code.fromAsset(lambdaPath, {
      bundling: {
        image: lambda.Runtime.NODEJS_22_X.bundlingImage,
        local: {
          tryBundle(outputDir: string): boolean {
            const execSync = require('child_process').execSync;
            const path = require('path');
            const fsLocal = require('fs');
            try {
              execSync('node build.js', { cwd: lambdaPath, stdio: 'inherit' });
              const distDir = path.join(lambdaPath, 'dist');
              const copyRecursive = (src: string, dest: string) => {
                const entries = fsLocal.readdirSync(src, { withFileTypes: true });
                fsLocal.mkdirSync(dest, { recursive: true });
                for (const entry of entries) {
                  const srcPath = path.join(src, entry.name);
                  const destPath = path.join(dest, entry.name);
                  if (entry.isDirectory()) copyRecursive(srcPath, destPath);
                  else fsLocal.copyFileSync(srcPath, destPath);
                }
              };
              copyRecursive(distDir, outputDir);
              return true;
            } catch (e) {
              console.error('PreTokenGen local bundling failed:', e);
              return false;
            }
          },
        },
        command: ['bash', '-c', ['npm ci', './build.sh', 'cp -R dist/* /asset-output/'].join(' && ')],
      },
    });

    const preTokenLambda = new lambda.Function(this, 'PreTokenGenerationLambda', {
      functionName: PROJECT.lambda.preTokenGeneration,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.preTokenGeneration',
      code,
      timeout: cdk.Duration.seconds(5),
      memorySize: 256,
      ...this.lambdaVpcProps,
      environment: {
        NODE_ENV: 'production',
        MEMBERSHIPS_TABLE: this.membershipsTable.tableName,
      },
      logGroup,
    });

    preTokenLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [logGroup.logGroupArn],
    }));
    this.membershipsTable.grantReadData(preTokenLambda);
    this.userPool.addTrigger(cognito.UserPoolOperation.PRE_TOKEN_GENERATION, preTokenLambda);
  }

  private createTeamTables(): void {
    this.teamsTable = new dynamodb.Table(this, 'TeamsTable', {
      tableName: PROJECT.dynamodb.teamsTable,
      partitionKey: { name: 'teamId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: this.config.environment === 'production'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    this.membershipsTable = new dynamodb.Table(this, 'MembershipsTable', {
      tableName: PROJECT.dynamodb.membershipsTable,
      partitionKey: { name: 'teamId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: this.config.environment === 'production'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });
    // GSI for "list teams for a given user" — used by PreTokenGen trigger.
    this.membershipsTable.addGlobalSecondaryIndex({
      indexName: 'UserIdIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'teamId', type: dynamodb.AttributeType.STRING },
    });

    this.adminAuditLogTable = new dynamodb.Table(this, 'AdminAuditLogTable', {
      tableName: PROJECT.dynamodb.adminAuditLogTable,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING }, // 'AUDIT' (single hot partition is fine for our scale)
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: this.config.environment === 'production'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });
    this.adminAuditLogTable.addGlobalSecondaryIndex({
      indexName: 'ActorIndex',
      partitionKey: { name: 'actorUserId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    // WorkflowChangeLogs — one row per mutation on any workflow.
    // PK = workflowId, SK = timestamp#uuid (newest-first queries via ScanIndexForward=false).
    // GSI on actorUserId so admins can see all changes by a specific user.
    this.workflowChangeLogsTable = new dynamodb.Table(this, 'WorkflowChangeLogsTable', {
      tableName: PROJECT.dynamodb.workflowChangeLogsTable,
      partitionKey: { name: 'workflowId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING }, // ISO timestamp#uuid
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: this.config.environment === 'production'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });
    this.workflowChangeLogsTable.addGlobalSecondaryIndex({
      indexName: 'ActorIndex',
      partitionKey: { name: 'actorUserId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    });
  }

  private createAdminEndpoints(): void {
    // Admin API Lambda — handles team and user management. Internally checks
    // that the caller is in the 'admins' Cognito group; that claim is
    // available on the API Gateway authorizer.
    const adminLambda = this.createLambdaFunction(
      'AdminLambda',
      PROJECT.lambda.adminTeams,
      '../lambda-functions/deployment-lambda/dist',
      'index.adminHandler',
      {
        TEAMS_TABLE: this.teamsTable.tableName,
        MEMBERSHIPS_TABLE: this.membershipsTable.tableName,
        ADMIN_AUDIT_LOG_TABLE: this.adminAuditLogTable.tableName,
        WORKFLOWS_TABLE: this.workflowsTable.tableName,
        USER_POOL_ID: this.userPool.userPoolId,
      }
    );

    this.teamsTable.grantReadWriteData(adminLambda);
    this.membershipsTable.grantReadWriteData(adminLambda);
    this.adminAuditLogTable.grantReadWriteData(adminLambda);
    this.workflowsTable.grantReadData(adminLambda);

    // Cognito permissions: list users + manage admins group + view membership
    adminLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cognito-idp:ListUsers',
          'cognito-idp:ListUsersInGroup',
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminRemoveUserFromGroup',
          'cognito-idp:AdminListGroupsForUser',
        ],
        resources: [this.userPool.userPoolArn],
      })
    );

    // /admin/teams (list, create), /admin/teams/{teamId}/members (add, list),
    // /admin/teams/{teamId}/members/{userId} (PATCH role, DELETE),
    // /admin/users (list), /admin/users/{userId}/admin (POST/DELETE),
    // /admin/audit-log (list)
    const adminResource = this.api.root.addResource('admin');

    const adminTeamsResource = adminResource.addResource('teams');
    this.addLambdaIntegration(adminTeamsResource, 'GET', adminLambda, true);
    this.addLambdaIntegration(adminTeamsResource, 'POST', adminLambda, true);

    const adminTeamIdResource = adminTeamsResource.addResource('{teamId}');
    this.addLambdaIntegration(adminTeamIdResource, 'GET', adminLambda, true);
    this.addLambdaIntegration(adminTeamIdResource, 'DELETE', adminLambda, true);

    const adminTeamMembersResource = adminTeamIdResource.addResource('members');
    this.addLambdaIntegration(adminTeamMembersResource, 'GET', adminLambda, true);
    this.addLambdaIntegration(adminTeamMembersResource, 'POST', adminLambda, true);

    const adminTeamMemberUserResource = adminTeamMembersResource.addResource('{userId}');
    this.addLambdaIntegration(adminTeamMemberUserResource, 'PATCH', adminLambda, true);
    this.addLambdaIntegration(adminTeamMemberUserResource, 'DELETE', adminLambda, true);

    const adminUsersResource = adminResource.addResource('users');
    this.addLambdaIntegration(adminUsersResource, 'GET', adminLambda, true);

    const adminUserIdResource = adminUsersResource.addResource('{userId}');
    const adminUserAdminResource = adminUserIdResource.addResource('admin');
    this.addLambdaIntegration(adminUserAdminResource, 'POST', adminLambda, true);
    this.addLambdaIntegration(adminUserAdminResource, 'DELETE', adminLambda, true);

    const adminAuditResource = adminResource.addResource('audit-log');
    this.addLambdaIntegration(adminAuditResource, 'GET', adminLambda, true);

    // /me/teams — any authenticated caller; returns their teams + roles
    // (so the frontend can render a team switcher and detect "pending").
    const meLambda = this.createLambdaFunction(
      'MeTeamsLambda',
      PROJECT.lambda.meTeams,
      '../lambda-functions/deployment-lambda/dist',
      'index.meTeamsHandler',
      {
        TEAMS_TABLE: this.teamsTable.tableName,
        MEMBERSHIPS_TABLE: this.membershipsTable.tableName,
      }
    );
    this.teamsTable.grantReadData(meLambda);
    this.membershipsTable.grantReadData(meLambda);

    const meResource = this.api.root.addResource('me');
    const meTeamsResource = meResource.addResource('teams');
    this.addLambdaIntegration(meTeamsResource, 'GET', meLambda, true);

    // /admin/workflow-changes — admin view of the full workflow changelog.
    // changelogLambda is created in createDeploymentEndpoints(); by the time
    // this method runs it is already defined.
    if (this.changelogLambda) {
      const adminWorkflowChangesResource = adminResource.addResource('workflow-changes');
      this.addLambdaIntegration(adminWorkflowChangesResource, 'GET', this.changelogLambda, true);
    }
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
              resources: ['*'], // Cognito Identity actions do not support resource-level permissions
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
        allowOrigins: [
          `https://${this.frontendHosting.distribution.distributionDomainName}`,
          'http://localhost:3000',
        ],
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
    
    const allowedOrigin = `https://${this.frontendHosting.distribution.distributionDomainName}`;

    // Add a gateway response for CORS on 4xx errors
    this.api.addGatewayResponse('Default4xxResponse', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${allowedOrigin}'`,
        'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    // Add a gateway response for CORS on 5xx errors
    this.api.addGatewayResponse('Default5xxResponse', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${allowedOrigin}'`,
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
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
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
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: this.config.environment === 'production'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });
    // GSI1 — list workflows for a team sorted by updatedAt (handlers query
    // GSI1PK = TEAM#<teamId>, GSI1SK begins_with 'WORKFLOW#').
    this.workflowsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    // Access-logs bucket for S3 server access logging (no public access, TLS-only).
    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      removalPolicy: this.config.environment === 'production'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: this.config.environment !== 'production',
      lifecycleRules: [
        { id: 'ExpireAccessLogs', enabled: true, expiration: cdk.Duration.days(90) },
      ],
    });

    // Create S3 bucket for Lambda code storage
    const lambdaCodeBucket = new s3.Bucket(this, 'LambdaCodeBucket', {
      bucketName: `${PROJECT.s3.lambdaCodeBucket}-${this.account}-${this.region}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'lambda-code-bucket/',
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
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: [
            `https://${this.frontendHosting.distribution.distributionDomainName}`,
            'http://localhost:3000',
          ],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
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
        MEMBERSHIPS_TABLE: this.membershipsTable.tableName,
        TEAMS_TABLE: this.teamsTable.tableName,
        WORKFLOW_CHANGE_LOGS_TABLE: this.workflowChangeLogsTable.tableName,
        AWS_ACCOUNT_ID: this.account,
        LAMBDA_CODE_BUCKET: lambdaCodeBucket.bucketName,
        OPENSEARCH_ENDPOINT: opensearchCollection?.attrCollectionEndpoint ?? '',
        OPENSEARCH_COLLECTION_ARN: opensearchCollection?.attrArn ?? '',
        ...this.vpcConfigEnv,
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
        MEMBERSHIPS_TABLE: this.membershipsTable.tableName,
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
    this.workflowsTable.grantReadWriteData(deploymentLambda);
    this.workflowsTable.grantReadWriteData(deploymentStatusUpdateLambda);
    this.workflowsTable.grantReadWriteData(workflowStatusUpdateLambda);
    this.workflowChangeLogsTable.grantReadWriteData(deploymentLambda);
    this.workflowChangeLogsTable.grantReadWriteData(deploymentStatusUpdateLambda);

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
        resources: [`arn:aws:s3:::workflow-*`],
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
    // Split into separate statements for proper resource scoping
    deploymentLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
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
        ],
        resources: [
          `arn:aws:iam::${this.account}:role/SF-Role-*`,
          `arn:aws:iam::${this.account}:role/Lambda-Role-*`,
          `arn:aws:iam::${this.account}:role/Lambda-*-Role-*`,
          `arn:aws:iam::${this.account}:role/StepFunction-*`,
          `arn:aws:iam::${this.account}:role/workflow-*`,
          `arn:aws:iam::${this.account}:role/*-workflow-*`,
        ],
      })
    );

    deploymentLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'states:CreateStateMachine',
          'states:UpdateStateMachine',
          'states:DeleteStateMachine',
          'states:DescribeStateMachine',
          'states:TagResource',
          'states:UntagResource',
        ],
        resources: [
          `arn:aws:states:${this.region}:${this.account}:stateMachine:SF-*`,
          `arn:aws:states:${this.region}:${this.account}:stateMachine:workflow-*`,
        ],
      })
    );

    deploymentLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:DeleteLogGroup',
          'logs:DescribeLogGroups',
          'logs:TagLogGroup',
          'logs:UntagLogGroup',
          'logs:PutRetentionPolicy',
        ],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/*`,
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/stepfunctions/*`,
        ],
      })
    );

    // Scope Lambda mutations to functions whose names start with `workflow-`
    // (the prefix used by the deployment pipeline; see saveWorkflow.ts and
    // cloudFormationTemplateGenerator.ts). `lambda:GetLayerVersion` covers
    // any layer the user references, so layer ARNs remain unscoped.
    deploymentLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'lambda:CreateFunction',
          'lambda:UpdateFunctionCode',
          'lambda:UpdateFunctionConfiguration',
          'lambda:DeleteFunction',
          'lambda:GetFunction',
          'lambda:GetLayerVersion',
          'lambda:TagResource',
          'lambda:UntagResource',
        ],
        resources: [
          `arn:aws:lambda:${this.region}:${this.account}:function:workflow-*`,
          `arn:aws:lambda:${this.region}:${this.account}:layer:*:*`,
        ],
      })
    );

    // EC2 permissions actually used at runtime by the deployment Lambda:
    // vpcCleanupHandler.ts calls DescribeNetworkInterfaces and
    // DeleteNetworkInterface to drain Lambda Hyperplane ENIs before VPC
    // deletion. CloudFormation templates created by this project do not
    // provision any EC2 resources, so VPC/Subnet/SG/IGW/NAT/RouteTable/EIP
    // mutations are not required. Describe* actions do not support
    // resource-level permissions; DeleteNetworkInterface is left unscoped
    // because Hyperplane ENIs are created by the Lambda service and are
    // not tagged by this project.
    deploymentLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ec2:DescribeNetworkInterfaces',
          'ec2:DescribeSubnets',
          'ec2:DescribeSecurityGroups',
          'ec2:DescribeVpcs',
          'ec2:DeleteNetworkInterface',
        ],
        resources: ['*'],
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
          `arn:aws:iam::${this.account}:role/EventBridge-SF-Role-*`,
          `arn:aws:iam::${this.account}:role/OpenSearch-Lambda-Role-*`,
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
    
    // Grant IAM list permissions (ListRoles does not support resource-level permissions)
    iamRolesLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:ListRoles', 'tag:GetResources'],
        resources: ['*'], // List operations do not support resource-level permissions
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
        resources: ['*'], // EC2 Describe actions do not support resource-level permissions
      })
    );

    this.addLambdaIntegration(vpcListResource, 'GET', vpcListLambda, true);

    // Layer management endpoints
    const layersResource = this.api.root.addResource('layers');
    const layerIdResource = layersResource.addResource('{layerId}');
    const layerUploadUrlResource = layersResource.addResource('upload-url');

    const layerLambda = this.createLambdaFunction(
      'LayerLambda',
      'workflow-builder-layer-handler',
      '../lambda-functions/deployment-lambda/dist',
      'index.layerHandler',
      {
        WORKFLOWS_TABLE: this.workflowsTable.tableName,
        LAMBDA_CODE_BUCKET: lambdaCodeBucket.bucketName,
        AWS_ACCOUNT_ID: this.account,
        USER_POOL_ID: this.userPool.userPoolId,
        USER_POOL_CLIENT_ID: this.userPoolClient.userPoolClientId,
      }
    );

    this.workflowsTable.grantReadWriteData(layerLambda);
    lambdaCodeBucket.grantReadWrite(layerLambda);

    layerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'lambda:PublishLayerVersion',
          'lambda:DeleteLayerVersion',
          'lambda:GetLayerVersion',
          'lambda:ListFunctions',
          'lambda:ListTags',
          'lambda:UpdateFunctionConfiguration',
        ],
        resources: [
          `arn:aws:lambda:${this.region}:${this.account}:function:*`,
          `arn:aws:lambda:${this.region}:${this.account}:layer:*`,
          `arn:aws:lambda:${this.region}:${this.account}:layer:*:*`,
        ],
      })
    );

    this.addLambdaIntegration(layersResource, 'GET', layerLambda, true);
    this.addLambdaIntegration(layersResource, 'POST', layerLambda, true);
    this.addLambdaIntegration(layerUploadUrlResource, 'POST', layerLambda, true);
    this.addLambdaIntegration(layerIdResource, 'DELETE', layerLambda, true);

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
      // Use the explicit role created in createOpenSearchServerlessCollection()
      // so the AOSS data access policy principal matches by exact ARN.
      role: this.opensearchSearchLambdaRole,
      ...this.lambdaVpcProps,
      environment: {
        OPENSEARCH_ENDPOINT: opensearchCollection.attrCollectionEndpoint,
        ALLOWED_ORIGIN: `https://${this.frontendHosting.distribution.distributionDomainName}`,
      },
    });
    
    // Grant OpenSearch Serverless permissions
    opensearchSearchLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['aoss:APIAccessAll'],
        resources: [opensearchCollection.attrArn],
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
        MEMBERSHIPS_TABLE: this.membershipsTable.tableName,
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
        MEMBERSHIPS_TABLE: this.membershipsTable.tableName,
        WORKFLOW_CHANGE_LOGS_TABLE: this.workflowChangeLogsTable.tableName,
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
        MEMBERSHIPS_TABLE: this.membershipsTable.tableName,
        AWS_ACCOUNT_ID: this.account,
        USER_POOL_ID: this.userPool.userPoolId,
        USER_POOL_CLIENT_ID: this.userPoolClient.userPoolClientId,
      }
    );

    // Grant permissions to workflow Lambdas
    this.workflowsTable.grantReadData(listWorkflowsLambda);
    this.workflowsTable.grantReadWriteData(saveWorkflowLambda);
    this.workflowsTable.grantReadData(workflowLambda);
    this.membershipsTable.grantReadData(listWorkflowsLambda);
    this.membershipsTable.grantReadData(saveWorkflowLambda);
    this.membershipsTable.grantReadData(workflowLambda);
    this.workflowChangeLogsTable.grantReadWriteData(saveWorkflowLambda);
    this.workflowChangeLogsTable.grantReadData(workflowLambda);



    // Create delete workflow Lambda function
    const deleteWorkflowLambda = this.createLambdaFunction(
      'DeleteWorkflowLambda',
      PROJECT.lambda.deleteWorkflow,
      '../lambda-functions/deployment-lambda/dist',
      'index.deleteWorkflow',
      {
        WORKFLOWS_TABLE: this.workflowsTable.tableName,
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        MEMBERSHIPS_TABLE: this.membershipsTable.tableName,
        WORKFLOW_CHANGE_LOGS_TABLE: this.workflowChangeLogsTable.tableName,
        AWS_ACCOUNT_ID: this.account,
        USER_POOL_ID: this.userPool.userPoolId,
        USER_POOL_CLIENT_ID: this.userPoolClient.userPoolClientId,
        DELETION_STATE_MACHINE_ARN: `arn:aws:states:${this.region}:${this.account}:stateMachine:${PROJECT.stepFunctions.deletionStateMachine}`,
      }
    );

    // Grant permissions to delete workflow Lambda
    this.workflowsTable.grantReadWriteData(deleteWorkflowLambda);
    deploymentsTable.grantReadWriteData(deleteWorkflowLambda);
    this.membershipsTable.grantReadData(deleteWorkflowLambda);
    this.workflowChangeLogsTable.grantReadWriteData(deleteWorkflowLambda);

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
          `arn:aws:iam::${this.account}:role/EventBridge-SF-Role-*`,
          `arn:aws:iam::${this.account}:role/OpenSearch-Lambda-Role-*`,
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
        WORKFLOWS_TABLE: this.workflowsTable.tableName,
        MEMBERSHIPS_TABLE: this.membershipsTable.tableName,
        AWS_ACCOUNT_ID: this.account,
        USER_POOL_ID: this.userPool.userPoolId,
        USER_POOL_CLIENT_ID: this.userPoolClient.userPoolClientId,
      }
    );

    // Grant permissions to deployment history Lambda
    deploymentsTable.grantReadData(deploymentHistoryLambda);
    this.workflowsTable.grantReadData(deploymentHistoryLambda);
    this.membershipsTable.grantReadData(deploymentHistoryLambda);


    // Add API endpoints
    this.addLambdaIntegration(workflowsResource, 'GET', listWorkflowsLambda, true);
    this.addLambdaIntegration(workflowsResource, 'POST', saveWorkflowLambda, true);
    this.addLambdaIntegration(workflowIdResource, 'GET', workflowLambda, true);
    this.addLambdaIntegration(workflowIdResource, 'PUT', saveWorkflowLambda, true);
    this.addLambdaIntegration(workflowIdResource, 'DELETE', deleteWorkflowLambda, true);
    
    // Add deployment history endpoint: GET /workflows/{workflowId}/deployments
    const workflowDeploymentsResource = workflowIdResource.addResource('deployments');
    this.addLambdaIntegration(workflowDeploymentsResource, 'GET', deploymentHistoryLambda, true);

    // GET /workflows/{workflowId}/changelog
    // Store as a class field so createAdminEndpoints() can attach the
    // /admin/workflow-changes route after the /admin resource is created.
    this.changelogLambda = this.createLambdaFunction(
      'GetWorkflowChangelogLambda',
      PROJECT.lambda.getWorkflowChangelog,
      '../lambda-functions/deployment-lambda/dist',
      'index.getWorkflowChangelog',
      {
        WORKFLOWS_TABLE: this.workflowsTable.tableName,
        MEMBERSHIPS_TABLE: this.membershipsTable.tableName,
        WORKFLOW_CHANGE_LOGS_TABLE: this.workflowChangeLogsTable.tableName,
      }
    );
    this.workflowsTable.grantReadData(this.changelogLambda);
    this.membershipsTable.grantReadData(this.changelogLambda);
    this.workflowChangeLogsTable.grantReadData(this.changelogLambda);
    const changelogResource = workflowIdResource.addResource('changelog');
    this.addLambdaIntegration(changelogResource, 'GET', this.changelogLambda, true);
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
            // Lambda invoke permissions - scoped to this account's functions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'lambda:InvokeFunction',
                'lambda:GetFunction',
                'lambda:GetLayerVersion',
                'lambda:ListFunctions',
                'lambda:CreateFunction',
                'lambda:DeleteFunction',
                'lambda:UpdateFunctionCode',
                'lambda:UpdateFunctionConfiguration',
                'lambda:TagResource',
                'lambda:UntagResource',
              ],
              resources: [
                `arn:aws:lambda:${this.region}:${this.account}:function:*`,
                `arn:aws:lambda:${this.region}:${this.account}:layer:*:*`,
              ],
            }),
            // CloudFormation permissions - scoped to workflow stacks
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
              resources: [
                `arn:aws:cloudformation:${this.region}:${this.account}:stack/workflow-*/*`,
              ],
            }),
            // IAM permissions - scoped to workflow-generated role name patterns
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
              resources: [
                `arn:aws:iam::${this.account}:role/SF-Role-*`,
                `arn:aws:iam::${this.account}:role/Lambda-Role-*`,
                `arn:aws:iam::${this.account}:role/Lambda-*-Role-*`,
                `arn:aws:iam::${this.account}:role/StepFunction-*`,
                `arn:aws:iam::${this.account}:role/workflow-*`,
                `arn:aws:iam::${this.account}:role/*-workflow-*`,
              ],
            }),
            // Step Functions permissions - scoped to workflow state machines
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
              resources: [
                `arn:aws:states:${this.region}:${this.account}:stateMachine:SF-*`,
                `arn:aws:states:${this.region}:${this.account}:stateMachine:workflow-*`,
              ],
            }),
            // S3 permissions - scoped to workflow buckets and the code bucket
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
              resources: [
                `arn:aws:s3:::workflow-*`,
                `arn:aws:s3:::workflow-*/*`,
                `arn:aws:s3:::${PROJECT.s3.lambdaCodeBucket}-${this.account}-${this.region}`,
                `arn:aws:s3:::${PROJECT.s3.lambdaCodeBucket}-${this.account}-${this.region}/*`,
              ],
            }),
            // EventBridge permissions (does not support resource-level permissions)
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
              resources: ['*'], // EventBridge does not support resource-level permissions for PutEvents
            }),
            // EventBridge tagging permissions for per-workflow rules.
            // CloudFormation propagates stack-level tags (WorkflowId,
            // DeploymentId, DeployedBy, Environment) to taggable resources
            // in per-workflow stacks. AWS::Events::Rule requires
            // events:TagResource on the rule ARN; without it, CFN logs
            // "Unauthorized tagging operation", retries without tags, and
            // adds avoidable latency to every Create/Update of the rule.
            // Scoped to the rule name pattern produced by
            // cloudFormationTemplateGenerator.ts (S3Trigger-${WorkflowId}).
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'events:TagResource',
                'events:UntagResource',
                'events:ListTagsForResource',
              ],
              resources: [
                `arn:aws:events:${this.region}:${this.account}:rule/S3Trigger-*`,
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
                'logs:DeleteLogGroup',
                'logs:PutRetentionPolicy',
                'logs:TagLogGroup',
                'logs:UntagLogGroup',
                'logs:ListTagsForResource',
                'logs:TagResource',
                'logs:UntagResource',
              ],
              resources: [
                `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/*`,
                `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/stepfunctions/*`,
                `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/*:*`,
                `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/stepfunctions/*:*`,
              ],
            }),
            // EC2 Describe-only permissions. The deployment Lambda passes
            // this role as the CloudFormation service role (RoleArn) when
            // creating per-workflow stacks. CFN assumes the role and uses
            // it to call ec2:DescribeSecurityGroups / DescribeSubnets /
            // DescribeVpcs / DescribeNetworkInterfaces while validating
            // VpcConfig on Lambda function resources. Mutating EC2
            // permissions are intentionally not granted: the per-workflow
            // CFN templates do not create AWS::EC2::* resources.
            // Describe* actions do not support resource-level permissions.
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ec2:DescribeSecurityGroups',
                'ec2:DescribeSubnets',
                'ec2:DescribeVpcs',
                'ec2:DescribeNetworkInterfaces',
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
        resources: [
          `arn:aws:cloudformation:${this.region}:${this.account}:stack/workflow-*/*`,
        ],
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
        resources: [
          `arn:aws:states:${this.region}:${this.account}:stateMachine:SF-*`,
          `arn:aws:states:${this.region}:${this.account}:stateMachine:workflow-*`,
        ],
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
        resources: [
          `arn:aws:lambda:${this.region}:${this.account}:function:*`,
        ],
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
        resources: [
          `arn:aws:iam::${this.account}:role/SF-Role-*`,
          `arn:aws:iam::${this.account}:role/Lambda-Role-*`,
          `arn:aws:iam::${this.account}:role/Lambda-*-Role-*`,
          `arn:aws:iam::${this.account}:role/StepFunction-*`,
          `arn:aws:iam::${this.account}:role/workflow-*`,
          `arn:aws:iam::${this.account}:role/*-workflow-*`,
        ],
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
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/*`,
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/stepfunctions/*`,
        ],
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
        resources: ['*'], // EventBridge does not support resource-level permissions for these actions
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
              resources: [
                `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/vendedlogs/*`,
                `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/vendedlogs/*:*`,
                `arn:aws:logs:${this.region}:${this.account}:log-group:${PROJECT.stepFunctions.deletionLogGroup}`,
                `arn:aws:logs:${this.region}:${this.account}:log-group:${PROJECT.stepFunctions.deletionLogGroup}:*`,
              ],
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
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
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

    // Create WebSocket authorizer Lambda
    const webSocketAuthorizerHandler = this.createLambdaFunction(
      'WebSocketAuthorizer',
      'websocket-authorizer',
      '../lambda-functions/websocket-lambda/dist',
      'handlers/authorize.handler',
      {}
    );

    const webSocketAuthorizer = new apigatewayv2Authorizers.WebSocketLambdaAuthorizer(
      'WebSocketConnectAuthorizer',
      webSocketAuthorizerHandler,
      {
        identitySource: ['route.request.querystring.token'],
      }
    );

    // Create WebSocket API
    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'DeploymentWebSocketApi', {
      apiName: 'workflow-deployment-websocket',
      description: 'WebSocket API for real-time deployment updates',
      connectRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
          'ConnectIntegration',
          connectHandler
        ),
        authorizer: webSocketAuthorizer,
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
          image: lambda.Runtime.NODEJS_22_X.bundlingImage,
          local: {
            tryBundle(outputDir: string): boolean {
              const execSync = require('child_process').execSync;
              const path = require('path');
              const fs = require('fs');
              try {
                // Use node build.js (cross-platform) instead of ./build.sh
                execSync('node build.js', { 
                  cwd: lambdaPath,
                  stdio: 'inherit'
                });
                // Copy dist contents to output (cross-platform)
                const distDir = path.join(lambdaPath, 'dist');
                const copyRecursive = (src: string, dest: string) => {
                  const entries = fs.readdirSync(src, { withFileTypes: true });
                  fs.mkdirSync(dest, { recursive: true });
                  for (const entry of entries) {
                    const srcPath = path.join(src, entry.name);
                    const destPath = path.join(dest, entry.name);
                    if (entry.isDirectory()) {
                      copyRecursive(srcPath, destPath);
                    } else {
                      fs.copyFileSync(srcPath, destPath);
                    }
                  }
                };
                copyRecursive(distDir, outputDir);
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
      runtime: lambda.Runtime.NODEJS_22_X,
      handler,
      code,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      ...this.lambdaVpcProps,
      environment: {
        NODE_ENV: 'production',
        USER_POOL_ID: this.userPool.userPoolId,
        USER_POOL_CLIENT_ID: this.userPoolClient.userPoolClientId,
        ALLOWED_ORIGIN: `https://${this.frontendHosting.distribution.distributionDomainName}`,
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
    });

    let methodOptions: apigateway.MethodOptions = {};

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
        vpcId: this.vpc!.vpcId,
        subnetIds: this.resolvedSubnetIds,
        securityGroupIds: this.resolvedSecurityGroupIds,
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

    // Pre-create an explicit IAM role for the OpenSearch search Lambda.
    // The function itself is constructed later (alongside the API Gateway
    // resources) and consumes this role via `role: this.opensearchSearchLambdaRole`.
    // Creating the role here lets the data access policy below grant it
    // narrow read-only access by exact ARN. The role name is left to CDK
    // because `this.account` is a token at synth time.
    this.opensearchSearchLambdaRole = new iam.Role(this, 'OpenSearchSearchLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    // Data access policy - scoped to specific Lambda principals with
    // narrowly-defined permissions instead of `aoss:*` to the account root.
    //   - Search Lambda: read-only on the collection (exact role ARN; CDK
    //     resolves the token to the concrete ARN at deploy time).
    //   - Per-workflow OpenSearch indexer Lambdas: read+write+create-index.
    //     CFN templates create their roles with name pattern
    //     OpenSearch-Lambda-Role-${WorkflowId} (see
    //     cloudFormationTemplateGenerator.ts), but AOSS data access
    //     policies do NOT support wildcards in IAM role ARN principals,
    //     and the per-workflow role names are not known at CDK synth
    //     time. As a pragmatic compromise we keep the principal at
    //     account root for this rule but tighten the permissions from
    //     `aoss:*` to the specific data-plane actions the indexer needs.
    //     A future change can move to dynamic UpdateAccessPolicy calls
    //     from the deployment Lambda to enumerate exact role ARNs.
    const dataAccessPolicy = new cdk.aws_opensearchserverless.CfnAccessPolicy(this, 'OpenSearchDataAccessPolicy', {
      name: `health-msgs-access-${this.account.slice(-6)}`,
      type: 'data',
      policy: JSON.stringify([
        {
          Description: 'Read-only access for the OpenSearch search Lambda',
          Rules: [
            {
              ResourceType: 'index',
              Resource: [`index/${collectionName}/*`],
              Permission: ['aoss:DescribeIndex', 'aoss:ReadDocument'],
            },
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
              Permission: ['aoss:DescribeCollectionItems'],
            },
          ],
          Principal: [this.opensearchSearchLambdaRole.roleArn],
        },
        {
          Description: 'Read+write access for per-workflow OpenSearch indexer Lambdas',
          Rules: [
            {
              ResourceType: 'index',
              Resource: [`index/${collectionName}/*`],
              Permission: [
                'aoss:CreateIndex',
                'aoss:UpdateIndex',
                'aoss:DescribeIndex',
                'aoss:ReadDocument',
                'aoss:WriteDocument',
              ],
            },
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
              Permission: [
                'aoss:CreateCollectionItems',
                'aoss:UpdateCollectionItems',
                'aoss:DescribeCollectionItems',
              ],
            },
          ],
          Principal: [`arn:aws:iam::${this.account}:root`],
        },
      ]),
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
    'Access-Control-Allow-Origin': os.environ.get('ALLOWED_ORIGIN', 'http://localhost:3000'),
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
        allowed_workflow_ids = body.get('allowedWorkflowIds')

        if not endpoint or not index_name:
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'indexName required'})}

        # Add workflowId filter if provided
        if workflow_id:
            query_params['workflowId'] = workflow_id

        query = build_query(query_params, config, allowed_workflow_ids)
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

def build_query(params, config, allowed_workflow_ids=None):
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
    if allowed_workflow_ids is not None:
        if len(allowed_workflow_ids) > 0:
            filters.append({'terms': {'workflowId.keyword': allowed_workflow_ids}})
        else:
            filters.append({'term': {'workflowId.keyword': '__none__'}})

    date_field = config.get('dateRangeField', 'ingestedAt')
    date_days = config.get('dateRangeDays', 7)
    filters.append({'range': {date_field: {'gte': f'now-{date_days}d', 'lte': 'now'}}})

    return {'query': {'bool': {'must': must if must else [{'match_all': {}}], 'filter': filters}}, 'size': 100}
`.trim();
  }

}
