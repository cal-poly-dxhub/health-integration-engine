#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FrontendStack } from '../lib/frontend-stack';

const app = new cdk.App();

// Get environment from context or environment variable
const environment = app.node.tryGetContext('environment') || process.env.NODE_ENV || 'development';

new FrontendStack(app, `WorkflowBuilderFrontend-${environment}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: `Frontend infrastructure for AWS Step Functions Workflow Builder (${environment})`,
  tags: {
    Project: 'WorkflowBuilder',
    Component: 'Frontend',
    Environment: environment,
  },
});