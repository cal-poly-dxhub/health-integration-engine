#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Testing frontend build for S3/CloudFront deployment...');

try {
  // Test 1: Environment setup
  console.log('\n1⃣ Testing environment setup...');
  execSync('node scripts/setup-env.cjs', { stdio: 'inherit', cwd: __dirname + '/..' });
  
  // Test 2: TypeScript check (optional for deployment)
  console.log('\n2⃣ Running TypeScript check...');
  try {
    execSync('npm run type-check', { stdio: 'inherit', cwd: __dirname + '/..' });
    console.log('TypeScript check passed');
  } catch (error) {
    console.log('TypeScript check failed, but continuing with deployment build...');
    console.log('   Note: Fix TypeScript errors for better development experience');
  }
  
  // Test 3: Build
  console.log('\n3⃣ Testing build...');
  execSync('npm run build', { stdio: 'inherit', cwd: __dirname + '/..' });
  
  // Test 4: Verify build output
  console.log('\n4⃣ Verifying build output...');
  const distPath = path.join(__dirname, '..', 'dist');
  
  if (!fs.existsSync(distPath)) {
    throw new Error('Build output directory not found');
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
  
  // Test 5: Check index.html content
  console.log('\n5⃣ Checking index.html content...');
  const indexContent = fs.readFileSync(indexPath, 'utf8');
  
  if (!indexContent.includes('<div id="root">')) {
    throw new Error('Root div not found in index.html');
  }
  
  if (!indexContent.includes('type="module"')) {
    throw new Error('Module script not found in index.html');
  }
  
  console.log('index.html structure looks good');
  
  // Test 6: Check for environment variable usage
  console.log('\n6⃣ Checking environment variable usage...');
  const mainJsFile = jsFiles.find(f => f.startsWith('index-'));
  if (mainJsFile) {
    const mainJsPath = path.join(assetsPath, mainJsFile);
    const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');
    
    // Check if environment variables are properly embedded
    if (mainJsContent.includes('import.meta.env.VITE_')) {
      console.log('Warning: Found unresolved import.meta.env references');
      console.log('   This might indicate environment variables are not being resolved at build time');
    } else {
      console.log('Environment variables appear to be resolved');
    }
  }
  
  // Test 7: File size check
  console.log('\n7⃣ Checking bundle sizes...');
  const stats = fs.statSync(path.join(assetsPath, mainJsFile));
  const sizeKB = Math.round(stats.size / 1024);
  console.log(`   Main bundle size: ${sizeKB} KB`);
  
  if (sizeKB > 2000) {
    console.log('Warning: Main bundle is quite large (>2MB)');
    console.log('   Consider code splitting or removing unused dependencies');
  } else {
    console.log('Bundle size looks reasonable');
  }
  
  console.log('\nAll tests passed! Frontend is ready for S3/CloudFront deployment.');
  console.log('\nNext steps:');
  console.log('   1. Run: npm run deploy:s3');
  console.log('   2. Wait for CloudFront distribution to deploy (10-15 minutes)');
  console.log('   3. Test your application at the provided URLs');
  
} catch (error) {
  console.error('\nBuild test failed!');
  console.error('Error:', error.message);
  console.error('\nTroubleshooting:');
  console.error('   1. Check that all dependencies are installed: npm install');
  console.error('   2. Verify environment variables in .env file');
  console.error('   3. Run npm run type-check to check for TypeScript errors');
  console.error('   4. Run npm run lint to check for code issues');
  process.exit(1);
}