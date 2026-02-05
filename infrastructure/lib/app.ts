#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WorkflowBuilderStack } from './workflow-builder-stack';
import { PROJECT } from './config';

const app = new cdk.App();

// Create the main infrastructure stack
new WorkflowBuilderStack(app, PROJECT.stack.name, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-west-2',
  },
  synthesizer: new cdk.CliCredentialsStackSynthesizer(),
  description: PROJECT.stack.description,
  tags: {
    Project: PROJECT.stack.tags.Project,
    Environment: process.env.NODE_ENV || 'development',
  },
});