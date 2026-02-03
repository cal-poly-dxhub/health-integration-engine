#!/usr/bin/env node

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';

async function manualAmplifyDeploy() {
  try {
    console.log(chalk.blue.bold('🚀 Manual Amplify deployment...'));

    const frontendDir = path.resolve(__dirname, '../../frontend');
    const distDir = path.join(frontendDir, 'dist');

    // Step 1: Clean build
    console.log(chalk.blue('🧹 Cleaning and rebuilding...'));
    execSync('npm run build', { cwd: frontendDir, stdio: 'inherit' });

    // Step 2: Create deployment ZIP
    console.log(chalk.blue('📦 Creating deployment ZIP...'));
    const outputDir = path.resolve(__dirname, '../dist');
    const zipFile = path.join(outputDir, 'manual-deploy.zip');

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Create ZIP using PowerShell
    const powershellCommand = `Compress-Archive -Path "${distDir}\\*" -DestinationPath "${zipFile}" -Force`;
    execSync(`powershell -Command "${powershellCommand}"`, { stdio: 'inherit' });

    console.log(chalk.green.bold('✅ Manual deployment package ready!'));
    console.log(chalk.blue(`📁 ZIP file: ${zipFile}`));
    console.log(chalk.yellow('📋 Manual deployment steps:'));
    console.log(chalk.yellow('1. Go to AWS Amplify Console'));
    console.log(chalk.yellow('2. Select your app: workflow-builder-production'));
    console.log(chalk.yellow('3. Go to the main branch'));
    console.log(chalk.yellow('4. Click "Deploy without Git provider"'));
    console.log(chalk.yellow(`5. Upload: ${zipFile}`));
    console.log(chalk.yellow('6. Wait for deployment to complete'));

    // Also show what's in the ZIP
    console.log(chalk.blue('\n📋 Files in deployment:'));
    execSync(`powershell -Command "Get-ChildItem '${distDir}' -Recurse | Select-Object Name"`, { stdio: 'inherit' });

  } catch (error) {
    console.error(chalk.red.bold('❌ Manual deployment preparation failed!'));
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
    process.exit(1);
  }
}

manualAmplifyDeploy();