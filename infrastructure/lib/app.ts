#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WorkflowBuilderStack } from './workflow-builder-stack';

const app = new cdk.App();

// Create the main infrastructure stack
new WorkflowBuilderStack(app, 'WorkflowBuilderStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-west-2',
  },
  synthesizer: new cdk.CliCredentialsStackSynthesizer(),
  description: 'AWS Step Functions Workflow Builder Infrastructure',
  tags: {
    Project: 'WorkflowBuilder',
    Environment: process.env.NODE_ENV || 'development',
  },
});