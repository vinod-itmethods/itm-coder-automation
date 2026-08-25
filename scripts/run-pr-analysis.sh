#!/usr/bin/env bash
#
# Local PR analysis runner for the SonarQube PR-decoration experiments.
# Mirrors the CI workflow but runs sonar-scanner from your machine so you can
# iterate quickly on experiments A-D (see EXPERIMENTS.md).
#
# Prereqs:
#   - sonar-scanner on PATH
#   - SONAR_TOKEN exported (a "Analyze Project"/user token for the staging Server)
#   - The SonarQube project must be BOUND to the GitHub repo (DevOps Platform
#     Integration) or no check run / annotations will be posted.
#
# Usage:
#   SONAR_TOKEN=xxx PR_KEY=1 PR_BRANCH=exp/pr-decoration-noise PR_BASE=dev \
#     ./scripts/run-pr-analysis.sh
#
# Experiment toggles:
#   SHALLOW=1   -> simulate a shallow clone (Exp. A: expect unchanged-file annotations)
#   SHALLOW=0   -> full clone / diff-scoped   (Exp. B: annotations collapse to the diff)
#
set -euo pipefail

HOST_URL="${SONAR_HOST_URL:-https://itmethods-stage.devopsx.io}"
PR_KEY="${PR_KEY:?set PR_KEY to the GitHub PR number}"
PR_BRANCH="${PR_BRANCH:?set PR_BRANCH to the PR head branch}"
PR_BASE="${PR_BASE:-dev}"
SHALLOW="${SHALLOW:-0}"
: "${SONAR_TOKEN:?export SONAR_TOKEN first}"

if [[ "$SHALLOW" == "1" ]]; then
  echo ">> SHALLOW mode: SonarQube cannot compute the PR diff (Exp. A)."
  DEPTH_ARGS="-Dsonar.scm.disabled=false"
else
  echo ">> FULL-CLONE mode: ensuring complete history for diff scoping (Exp. B)."
  git fetch --unshallow 2>/dev/null || echo "   (already a full clone)"
  git fetch origin "$PR_BASE" 2>/dev/null || true
  DEPTH_ARGS=""
fi

echo ">> Analyzing PR #${PR_KEY} (${PR_BRANCH} -> ${PR_BASE}) against ${HOST_URL}"

sonar-scanner \
  -Dsonar.host.url="$HOST_URL" \
  -Dsonar.token="$SONAR_TOKEN" \
  -Dsonar.pullrequest.key="$PR_KEY" \
  -Dsonar.pullrequest.branch="$PR_BRANCH" \
  -Dsonar.pullrequest.base="$PR_BASE" \
  ${DEPTH_ARGS}

echo ">> Done. Check the PR 'Files changed' tab and the 'SonarQube Code Analysis' check run."
