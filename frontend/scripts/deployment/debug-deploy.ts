#!/usr/bin/env node

console.log('Starting debug deployment script...');

try {
  console.log('1. Testing basic imports...');
  
  // Test basic imports
  const chalk = await import('chalk');
  console.log('chalk imported');
  
  const ora = await import('ora');
  console.log('ora imported');
  
  const { Command } = await import('commander');
  console.log('commander imported');
  
  console.log('2. Testing deployment modules...');
  
  // Test deployment confirmation
  try {
    const { DeploymentConfirmation } = await import('./deployment-confirmation.js');
    console.log('DeploymentConfirmation imported');
  } catch (error) {
    console.log('DeploymentConfirmation failed:', error.message);
  }
  
  // Test validation
  try {
    const { DeploymentValidator } = await import('./validate-deployment.js');
    console.log('DeploymentValidator imported');
  } catch (error) {
    console.log('DeploymentValidator failed:', error.message);
  }
  
  // Test backend integration
  try {
    const { getLatestDeploymentOutputs } = await import('./backend-integration.js');
    console.log('backend-integration imported');
  } catch (error) {
    console.log('backend-integration failed:', error.message);
  }
  
  // Test build frontend
  try {
    const { buildFrontend } = await import('./build-frontend.js');
    console.log('buildFrontend imported');
  } catch (error) {
    console.log('buildFrontend failed:', error.message);
  }
  
  // Test configure environment
  try {
    const { configureEnvironment } = await import('./configure-environment.js');
    console.log('configureEnvironment imported');
  } catch (error) {
    console.log('configureEnvironment failed:', error.message);
  }
  
  console.log('3. Testing AWS SDK...');
  try {
    const AWS = await import('aws-sdk');
    console.log('AWS SDK imported');
  } catch (error) {
    console.log('AWS SDK failed:', error.message);
  }
  
  console.log('Debug completed successfully!');
  
} catch (error) {
  console.error('Debug failed:', error);
  process.exit(1);
}