#!/usr/bin/env node

/**
 * Build script to compile TypeScript deployment scripts to JavaScript
 * This ensures the npm scripts can run the deployment tools
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scriptsDir = path.join(__dirname, 'deployment');
const tsFiles = [
  'deploy-frontend.ts',
  'build-frontend.ts',
  'configure-environment.ts',
  'backend-integration.ts',
  'validate-backend.ts',
  'rollback-frontend.ts',
  'deployment-status.ts',
  'validate-deployment.ts'
];

console.log('Building deployment scripts...');

try {
  // Compile each TypeScript file individually
  for (const tsFile of tsFiles) {
    const tsPath = path.join(scriptsDir, tsFile);
    const jsFile = tsFile.replace('.ts', '.js');
    const jsPath = path.join(scriptsDir, jsFile);
    
    if (fs.existsSync(tsPath)) {
      console.log(`Compiling ${tsFile}...`);
      
      // Compile individual file
      execSync(`npx tsc "${tsPath}" --target ES2020 --module ESNext --moduleResolution node --esModuleInterop --allowSyntheticDefaultImports --skipLibCheck --outDir "${scriptsDir}"`, { 
        stdio: 'pipe',
        cwd: __dirname 
      });
      
      // Add shebang and make executable
      if (fs.existsSync(jsPath)) {
        const content = fs.readFileSync(jsPath, 'utf-8');
        if (!content.startsWith('#!/usr/bin/env node')) {
          fs.writeFileSync(jsPath, '#!/usr/bin/env node\n' + content);
        }
        
        // Make executable on Unix systems
        try {
          fs.chmodSync(jsPath, '755');
        } catch (error) {
          // Ignore chmod errors on Windows
        }
      }
    }
  }
  
  console.log('✓ Deployment scripts compiled successfully');
  console.log('✓ Scripts made executable');
  
} catch (error) {
  console.error('Failed to build deployment scripts:', error.message);
  process.exit(1);
}

console.log('Deployment scripts are ready to use!');