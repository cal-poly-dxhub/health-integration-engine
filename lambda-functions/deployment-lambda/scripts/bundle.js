/**
 * bundle.js - Cross-platform script to bundle dependencies for Lambda deployment
 * Use this on Windows: npm run build:windows
 */

const fs = require('fs');
const path = require('path');

const HOISTED_DEPS = [
    'zod',
    'jszip',
    'jsonwebtoken',
    'jwks-rsa',
    'mime-types',
    'pako',
    'jws',
    'jwa',
    'buffer-equal-constant-time',
    'ecdsa-sig-formatter',
    'safe-buffer',
    'semver',
    'lru-memoizer'
];

const distNodeModules = path.join(__dirname, '..', 'dist', 'node_modules');
const localNodeModules = path.join(__dirname, '..', 'node_modules');
const parentNodeModules = path.join(__dirname, '..', '..', '..', 'node_modules');

// Create dist/node_modules if it doesn't exist
if (!fs.existsSync(distNodeModules)) {
    fs.mkdirSync(distNodeModules, { recursive: true });
}

// Copy local node_modules
if (fs.existsSync(localNodeModules)) {
    console.log('Copying local node_modules...');
    copyDir(localNodeModules, distNodeModules);
}

// Copy hoisted dependencies
if (fs.existsSync(parentNodeModules)) {
    console.log('Copying hoisted dependencies...');
    for (const dep of HOISTED_DEPS) {
        const src = path.join(parentNodeModules, dep);
        const dest = path.join(distNodeModules, dep);
        if (fs.existsSync(src) && !fs.existsSync(dest)) {
            console.log(`  - ${dep}`);
            copyDir(src, dest);
        }
    }
}

console.log('Bundle complete!');

function copyDir(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
