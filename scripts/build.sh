#!/bin/bash
set -euo pipefail

# ONEdevops - Build Lambda bundles with esbuild
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"

echo "=== Building Lambda bundles ==="

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/webhook" "$DIST_DIR/orchestrator"

# Build webhook Lambda
echo "Building webhook..."
npx esbuild "$PROJECT_DIR/src/webhook/index.ts" \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=esm \
  --outfile="$DIST_DIR/webhook/index.mjs" \
  --external:@aws-sdk/* \
  --sourcemap \
  --minify

# Build orchestrator Lambda
echo "Building orchestrator..."
npx esbuild "$PROJECT_DIR/src/orchestrator/index.ts" \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=esm \
  --outfile="$DIST_DIR/orchestrator/index.mjs" \
  --external:@aws-sdk/* \
  --sourcemap \
  --minify

echo "=== Build complete ==="
echo "  dist/webhook/index.mjs"
echo "  dist/orchestrator/index.mjs"
