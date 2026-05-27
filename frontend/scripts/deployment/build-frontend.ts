import { execSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import path from 'path';
import chalk from 'chalk';

interface BuildOptions {
  verbose?: boolean;
  skipTypeCheck?: boolean;
  skipLinting?: boolean;
}

interface BuildResult {
  success: boolean;
  buildPath: string;
  buildTime: number;
  artifacts: string[];
  buildLogs: string[];
}

export async function buildFrontend(
  environment: string, 
  options: BuildOptions = {}
): Promise<BuildResult> {
  const startTime = Date.now();
  const buildLogs: string[] = [];
  
  try {
    // Ensure we're in the frontend directory
    const frontendDir = process.cwd();
    const packageJsonPath = path.join(frontendDir, 'package.json');
    
    if (!existsSync(packageJsonPath)) {
      throw new Error('package.json not found. Please run this script from the frontend directory.');
    }

    buildLogs.push('Starting frontend build process...');
    
    // Step 1: Type checking (unless skipped)
    if (!options.skipTypeCheck) {
      buildLogs.push('Running TypeScript type check...');
      if (options.verbose) {
        console.log(chalk.yellow('Running type check...'));
      }
      
      try {
        execSync('npm run type-check', { 
          stdio: options.verbose ? 'inherit' : 'pipe',
          cwd: frontendDir 
        });
        buildLogs.push('Type check passed');
      } catch (error) {
        buildLogs.push('Type check failed');
        throw new Error('TypeScript type check failed. Please fix type errors before building.');
      }
    }

    // Step 2: Linting (unless skipped)
    if (!options.skipLinting) {
      buildLogs.push('Running ESLint...');
      if (options.verbose) {
        console.log(chalk.yellow('Running linter...'));
      }
      
      try {
        execSync('npm run lint', { 
          stdio: options.verbose ? 'inherit' : 'pipe',
          cwd: frontendDir 
        });
        buildLogs.push('Linting passed');
      } catch (error) {
        buildLogs.push('Linting failed');
        throw new Error('ESLint check failed. Please fix linting errors before building.');
      }
    }

    // Step 3: Build the application
    buildLogs.push(`Building application for ${environment} environment...`);
    if (options.verbose) {
      console.log(chalk.yellow(`Building for ${environment}...`));
    }

    // Set NODE_ENV for the build
    const buildEnv = {
      ...process.env,
      NODE_ENV: environment === 'development' ? 'development' : 'production',
      VITE_NODE_ENV: environment
    };

    try {
      execSync('npm run build', { 
        stdio: options.verbose ? 'inherit' : 'pipe',
        cwd: frontendDir,
        env: buildEnv
      });
      buildLogs.push('Build completed successfully');
    } catch (error) {
      buildLogs.push('Build failed');
      throw new Error('Frontend build failed. Please check the build errors.');
    }

    // Step 4: Verify build output
    const buildPath = path.join(frontendDir, 'dist');
    if (!existsSync(buildPath)) {
      throw new Error('Build output directory not found. Build may have failed.');
    }

    // Get list of build artifacts
    const artifacts = getBuildArtifacts(buildPath);
    buildLogs.push(`Generated ${artifacts.length} build artifacts`);

    const buildTime = Date.now() - startTime;
    buildLogs.push(`Build completed in ${buildTime}ms`);

    return {
      success: true,
      buildPath,
      buildTime,
      artifacts,
      buildLogs
    };

  } catch (error) {
    const buildTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown build error';
    buildLogs.push(`Build failed after ${buildTime}ms: ${errorMessage}`);
    
    throw error;
  }
}

function getBuildArtifacts(buildPath: string): string[] {
  const artifacts: string[] = [];
  
  function scanDirectory(dir: string, relativePath = ''): void {
    try {
      const items = require('fs').readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const itemRelativePath = path.join(relativePath, item);
        
        if (statSync(fullPath).isDirectory()) {
          scanDirectory(fullPath, itemRelativePath);
        } else {
          artifacts.push(itemRelativePath);
        }
      }
    } catch (error) {
      // Ignore errors when scanning directories
    }
  }
  
  scanDirectory(buildPath);
  return artifacts;
}

// Utility function for getting build statistics
export function getBuildStats(buildPath: string): {
  totalSize: number;
  fileCount: number;
  jsFiles: number;
  cssFiles: number;
  htmlFiles: number;
  assetFiles: number;
} {
  const artifacts = getBuildArtifacts(buildPath);
  let totalSize = 0;
  let jsFiles = 0;
  let cssFiles = 0;
  let htmlFiles = 0;
  let assetFiles = 0;

  for (const artifact of artifacts) {
    const fullPath = path.join(buildPath, artifact);
    try {
      const stats = statSync(fullPath);
      totalSize += stats.size;
      
      const ext = path.extname(artifact).toLowerCase();
      switch (ext) {
        case '.js':
        case '.mjs':
          jsFiles++;
          break;
        case '.css':
          cssFiles++;
          break;
        case '.html':
          htmlFiles++;
          break;
        default:
          assetFiles++;
          break;
      }
    } catch (error) {
      // Ignore errors when getting file stats
    }
  }

  return {
    totalSize,
    fileCount: artifacts.length,
    jsFiles,
    cssFiles,
    htmlFiles,
    assetFiles
  };
}