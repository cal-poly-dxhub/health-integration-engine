#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building frontend for S3/CloudFront deployment (production mode)...');

try {
  // Step 1: Environment setup
  console.log('\n1⃣ Setting up environment...');
  execSync('node scripts/setup-env.cjs', { stdio: 'inherit', cwd: __dirname + '/..' });
  
  // Step 2: Build (skip TypeScript check for deployment)
  console.log('\n2⃣ Building application...');
  execSync('npm run build', { stdio: 'inherit', cwd: __dirname + '/..' });
  
  // Step 3: Verify build output
  console.log('\n3⃣ Verifying build output...');
  const distPath = path.join(__dirname, '..', 'dist');
  
  if (!fs.existsSync(distPath)) {
    throw new Error('Build failed - dist directory not found');
  }
  
  const indexPath = path.join(distPath, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error('index.html not found in build output');
  }
  
  const assetsPath = path.join(distPath, 'assets');
  if (!fs.existsSync(assetsPath)) {
    throw new Error('assets directory not found in build output');
  }
  
  // Check for JS files (Vite puts them directly in assets/)
  const jsFiles = fs.readdirSync(assetsPath).filter(f => f.endsWith('.js'));
  if (jsFiles.length === 0) {
    throw new Error('No JavaScript files found in assets directory');
  }
  
  console.log(`Found ${jsFiles.length} JavaScript files`);
  
  // Step 4: Check index.html content
  console.log('\n4⃣ Validating build structure...');
  const indexContent = fs.readFileSync(indexPath, 'utf8');
  
  if (!indexContent.includes('<div id="root">')) {
    throw new Error('Root div not found in index.html');
  }
  
  if (!indexContent.includes('type="module"')) {
    throw new Error('Module script not found in index.html');
  }
  
  console.log('Build structure is valid');
  
  // Step 5: File size check
  console.log('\n5⃣ Checking bundle sizes...');
  const mainJsFile = jsFiles.find(f => f.startsWith('index-'));
  if (mainJsFile) {
    const stats = fs.statSync(path.join(assetsPath, mainJsFile));
    const sizeKB = Math.round(stats.size / 1024);
    console.log(`   Main bundle size: ${sizeKB} KB`);
    
    if (sizeKB > 2000) {
      console.log('Warning: Main bundle is quite large (>2MB)');
      console.log('   Consider code splitting or removing unused dependencies');
    } else {
      console.log('Bundle size looks reasonable');
    }
  }
  
  console.log('\nBuild completed successfully! Ready for S3/CloudFront deployment.');
  console.log('\nNext steps:');
  console.log('   1. Run: npm run deploy:s3');
  console.log('   2. Wait for CloudFront distribution to deploy (10-15 minutes)');
  console.log('   3. Test your application at the provided URLs');
  
} catch (error) {
  console.error('\nBuild failed!');
  console.error('Error:', error.message);
  console.error('\nTroubleshooting:');
  console.error('   1. Check that all dependencies are installed: npm install');
  console.error('   2. Verify environment variables in .env file');
  console.error('   3. Try running npm run build directly to see detailed errors');
  process.exit(1);
}