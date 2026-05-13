#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AmplifyStack } from '../lib/amplify-stack';

const app = new cdk.App();

// Get environment from context or environment variable
const environment = app.node.tryGetContext('environment') || process.env.NODE_ENV || 'development';

new AmplifyStack(app, `WorkflowBuilderAmplify-${environment}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: `Amplify infrastructure for AWS Step Functions Workflow Builder (${environment})`,
  tags: {
    Project: 'WorkflowBuilder',
    Component: 'Amplify',
    Environment: environment,
  },
});