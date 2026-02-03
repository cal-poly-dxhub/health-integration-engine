#!/usr/bin/env node

import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import chalk from 'chalk';

async function deployAmplify() {
  try {
    console.log(chalk.blue.bold('🚀 Amplify deployment information...'));

    const environment = process.env.NODE_ENV || 'production';
    const stackName = `WorkflowBuilderAmplify-${environment}`;
    
    console.log(chalk.blue(`🔍 Looking for stack: ${stackName}`));
    console.log(chalk.blue(`🌍 Environment: ${environment}`));
    
    // Get stack outputs
    const cfClient = new CloudFormationClient({ region: process.env.CDK_DEFAULT_REGION || 'us-east-1' });
    const stackResult = await cfClient.send(new DescribeStacksCommand({ StackName: stackName }));
    
    if (!stackResult.Stacks || stackResult.Stacks.length === 0) {
      throw new Error(`Stack ${stackName} not found. Please deploy the CDK stack first.`);
    }

    const outputs = stackResult.Stacks[0].Outputs || [];
    const appIdOutput = outputs.find(o => o.OutputKey === 'AmplifyAppId');
    
    if (!appIdOutput || !appIdOutput.OutputValue) {
      throw new Error('Amplify App ID not found in stack outputs');
    }

    const appId = appIdOutput.OutputValue;
    console.log(chalk.blue(`📱 Found Amplify App ID: ${appId}`));

    const appUrl = `https://main.${outputs.find(o => o.OutputKey === 'AmplifyDefaultDomain')?.OutputValue}`;
    const consoleUrl = `https://console.aws.amazon.com/amplify/home#/${appId}/YnJhbmNoZXM/main`;
    
    console.log(chalk.green.bold('✅ Amplify app is ready!'));
    console.log(chalk.yellow(`🌐 App URL: ${appUrl}`));
    console.log(chalk.yellow(`🔧 Console URL: ${consoleUrl}`));
    console.log(chalk.blue('📋 Manual deployment steps:'));
    console.log(chalk.blue('1. Go to the Amplify console URL above'));
    console.log(chalk.blue('2. Click "Deploy without Git provider"'));
    console.log(chalk.blue('3. Upload your frontend/dist folder as a ZIP file'));
    console.log(chalk.blue('4. Or use the AWS CLI: aws amplify create-deployment --app-id ' + appId + ' --branch-name main'));

  } catch (error) {
    console.error(chalk.red.bold('❌ Amplify deployment failed!'));
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
    process.exit(1);
  }
}

deployAmplify();