#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';

async function createAmplifyZip() {
  try {
    console.log(chalk.blue.bold('📦 Creating Amplify deployment ZIP...'));

    const frontendDir = path.resolve(__dirname, '../../frontend');
    const distDir = path.join(frontendDir, 'dist');
    const outputDir = path.resolve(__dirname, '../dist');
    const zipFile = path.join(outputDir, 'amplify-deployment.zip');

    // Ensure dist directory exists
    if (!fs.existsSync(distDir)) {
      console.log(chalk.yellow('📦 Building frontend first...'));
      execSync('npm run build', { cwd: frontendDir, stdio: 'inherit' });
    }

    // Create output directory
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Create ZIP file (using PowerShell on Windows)
    console.log(chalk.blue('🗜️ Creating ZIP file...'));
    const powershellCommand = `Compress-Archive -Path "${distDir}\\*" -DestinationPath "${zipFile}" -Force`;
    execSync(`powershell -Command "${powershellCommand}"`, { stdio: 'inherit' });

    console.log(chalk.green.bold('✅ ZIP file created successfully!'));
    console.log(chalk.blue(`📁 Location: ${zipFile}`));
    console.log(chalk.yellow('📋 Next steps:'));
    console.log(chalk.yellow('1. Go to the Amplify console'));
    console.log(chalk.yellow('2. Select your app'));
    console.log(chalk.yellow('3. Click "Deploy without Git provider"'));
    console.log(chalk.yellow(`4. Upload the ZIP file: ${zipFile}`));

  } catch (error) {
    console.error(chalk.red.bold('❌ ZIP creation failed!'));
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
    process.exit(1);
  }
}

createAmplifyZip();