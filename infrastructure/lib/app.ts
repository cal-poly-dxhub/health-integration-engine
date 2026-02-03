#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WorkflowBuilderStack } from './workflow-builder-stack';

const app = new cdk.App();

// Create the main infrastructure stack
new WorkflowBuilderStack(app, 'WorkflowBuilderStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1', // Force us-east-1
  },
  description: 'AWS Step Functions Workflow Builder Infrastructure',
  tags: {
    Project: 'WorkflowBuilder',
    Environment: process.env.NODE_ENV || 'development',
  },
});