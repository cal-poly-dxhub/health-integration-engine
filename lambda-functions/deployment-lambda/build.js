const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building deployment Lambda...');

try {
  // Install dependencies
  console.log('Installing dependencies...');
  execSync('npm install', { stdio: 'inherit', cwd: __dirname });

  // Compile TypeScript
  console.log('Compiling TypeScript...');
  execSync('npx tsc', { stdio: 'inherit', cwd: __dirname });

  // Copy package.json to dist
  const packageJson = require('./package.json');
  const distPackageJson = {
    name: packageJson.name,
    version: packageJson.version,
    dependencies: packageJson.dependencies
  };
  
  fs.writeFileSync(
    path.join(__dirname, 'dist', 'package.json'),
    JSON.stringify(distPackageJson, null, 2)
  );

  // Install production dependencies in dist
  console.log('Installing production dependencies...');
  execSync('npm install --production', { 
    stdio: 'inherit', 
    cwd: path.join(__dirname, 'dist') 
  });

  console.log('✅ Deployment Lambda build complete!');
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}