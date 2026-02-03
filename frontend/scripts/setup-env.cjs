#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔧 Setting up environment configuration...');

// Read the current .env file
const envPath = path.join(__dirname, '..', '.env');
const envProdPath = path.join(__dirname, '..', '.env.production');

if (!fs.existsSync(envPath)) {
  console.error('❌ .env file not found. Please create one based on .env.example');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
console.log('✅ Current .env file loaded');

// Parse environment variables
const envVars = {};
envContent.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const [key, ...valueParts] = trimmed.split('=');
    if (key && valueParts.length > 0) {
      envVars[key.trim()] = valueParts.join('=').trim();
    }
  }
});

// Ensure all required variables are present
const requiredVars = [
  'VITE_AWS_REGION',
  'VITE_API_BASE_URL',
  'VITE_API_GATEWAY_URL',
  'VITE_COGNITO_USER_POOL_ID',
  'VITE_COGNITO_USER_POOL_CLIENT_ID',
  'VITE_COGNITO_IDENTITY_POOL_ID',
  'VITE_COGNITO_DOMAIN',
  'VITE_WEBSOCKET_URL'
];

let missingVars = [];
requiredVars.forEach(varName => {
  if (!envVars[varName]) {
    missingVars.push(varName);
  }
});

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(varName => {
    console.error(`   - ${varName}`);
  });
  console.error('\nPlease update your .env file with these variables.');
  process.exit(1);
}

// Create production environment file
const prodEnvContent = `# Environment configuration for production
# Generated on ${new Date().toISOString()}

# AWS Configuration
VITE_AWS_REGION=${envVars.VITE_AWS_REGION}
VITE_API_BASE_URL=${envVars.VITE_API_BASE_URL}
VITE_API_GATEWAY_URL=${envVars.VITE_API_GATEWAY_URL}

# Cognito Configuration
VITE_COGNITO_USER_POOL_ID=${envVars.VITE_COGNITO_USER_POOL_ID}
VITE_COGNITO_USER_POOL_CLIENT_ID=${envVars.VITE_COGNITO_USER_POOL_CLIENT_ID}
VITE_COGNITO_IDENTITY_POOL_ID=${envVars.VITE_COGNITO_IDENTITY_POOL_ID}
VITE_COGNITO_DOMAIN=${envVars.VITE_COGNITO_DOMAIN}

# Environment Configuration
VITE_NODE_ENV=production

# WebSocket Configuration
VITE_WEBSOCKET_URL=${envVars.VITE_WEBSOCKET_URL}

# Feature Flags and Custom Configuration
VITE_ENABLE_DEBUG=false
VITE_ENABLE_MOCK_DATA=false
VITE_LOG_LEVEL=error
`;

fs.writeFileSync(envProdPath, prodEnvContent);
console.log('✅ Production environment file created');

// Validate configuration
console.log('\n📋 Environment Configuration Summary:');
console.log(`   AWS Region: ${envVars.VITE_AWS_REGION}`);
console.log(`   API Gateway: ${envVars.VITE_API_GATEWAY_URL}`);
console.log(`   WebSocket: ${envVars.VITE_WEBSOCKET_URL}`);
console.log(`   User Pool: ${envVars.VITE_COGNITO_USER_POOL_ID}`);
console.log(`   Cognito Domain: ${envVars.VITE_COGNITO_DOMAIN}`);

console.log('\n✅ Environment setup complete!');
console.log('💡 You can now run: npm run deploy:s3');