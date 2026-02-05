#!/bin/bash
# build.sh - Builds the deployment-lambda with all dependencies properly bundled

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🧹 Cleaning dist directory..."
rm -rf dist

echo "📦 Compiling TypeScript..."
npx tsc --skipLibCheck

echo "📁 Creating node_modules in dist..."
mkdir -p dist/node_modules

# Copy local node_modules if they exist
if [ -d "node_modules" ]; then
    echo "📋 Copying local node_modules..."
    cp -R node_modules/* dist/node_modules/ 2>/dev/null || true
fi

# Copy hoisted dependencies from parent node_modules
# These are dependencies that npm hoists to the workspace root
HOISTED_DEPS=(
    "zod"
    "jszip"
    "jsonwebtoken"
    "jwks-rsa"
    "mime-types"
    "pako"
    "jws"
    "jwa"
    "buffer-equal-constant-time"
    "ecdsa-sig-formatter"
    "safe-buffer"
    "semver"
    "lru-memoizer"
)

PARENT_NODE_MODULES="../../node_modules"

if [ -d "$PARENT_NODE_MODULES" ]; then
    echo "📋 Copying hoisted dependencies from parent..."
    for dep in "${HOISTED_DEPS[@]}"; do
        if [ -d "$PARENT_NODE_MODULES/$dep" ] && [ ! -d "dist/node_modules/$dep" ]; then
            echo "  - $dep"
            cp -R "$PARENT_NODE_MODULES/$dep" dist/node_modules/
        fi
    done
fi

echo "✅ Build complete!"
echo "📊 dist/node_modules contents:"
ls dist/node_modules | head -20
