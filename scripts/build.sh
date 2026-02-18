#!/bin/bash
set -euo pipefail

# ONEdevops - Build Lambda bundles with esbuild
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"

echo "=== Building Lambda bundles ==="

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/webhook" "$DIST_DIR/orchestrator" "$DIST_DIR/jira-webhook"

# Banner to shim require() in ESM context (needed by @slack/web-api)
BANNER='import { createRequire } from "module"; const require = createRequire(import.meta.url);'

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
  --minify \
  --banner:js="$BANNER"

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
  --minify \
  --banner:js="$BANNER"

# Build Jira webhook Lambda
echo "Building jira-webhook..."
npx esbuild "$PROJECT_DIR/src/jira-webhook/index.ts" \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=esm \
  --outfile="$DIST_DIR/jira-webhook/index.mjs" \
  --external:@aws-sdk/* \
  --sourcemap \
  --minify \
  --banner:js="$BANNER"

echo "=== Build complete ==="
echo "  dist/webhook/index.mjs"
echo "  dist/orchestrator/index.mjs"
echo "  dist/jira-webhook/index.mjs"
