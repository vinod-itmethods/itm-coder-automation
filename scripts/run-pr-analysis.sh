#!/usr/bin/env bash
#
# Local PR analysis runner for the SonarQube PR-decoration demo.
# Runs sonar-scanner from an ALLOWLISTED machine (corporate VPN) so the scan
# can reach the IP-restricted staging Server. GitHub-hosted runners are blocked
# (HTTP 403), which is why this runs locally.
#
# Decoration (the "SonarQube Code Analysis" check + inline PR annotations) is
# posted by the SonarQube Server via its GitHub App. For it to appear:
#   1. You must be on the VPN / allowlisted network.
#   2. SONAR_TOKEN must be a valid token for the STAGING server (not SonarCloud).
#   3. The project must be BOUND to the GitHub repo (Project > Administration >
#      DevOps Platform Integration) so the Server knows where to post.
#   4. The SonarQube GitHub App must have Checks: write + Pull requests: write.
#      (Flip these to read-only to demo decoration being DISABLED.)
#
# Usage:
#   SONAR_TOKEN=xxx PR_KEY=6 PR_BRANCH=exp/perm-readonly PR_BASE=main \
#     ./scripts/run-pr-analysis.sh
#
set -euo pipefail

HOST_URL="${SONAR_HOST_URL:-https://itmethods-stage.devopsx.io}"
PROJECT_KEY="${PROJECT_KEY:-itm-coder-automation}"
PR_KEY="${PR_KEY:?set PR_KEY to the GitHub PR number (e.g. 6)}"
PR_BRANCH="${PR_BRANCH:?set PR_BRANCH to the PR head branch (e.g. exp/perm-readonly)}"
PR_BASE="${PR_BASE:-main}"
: "${SONAR_TOKEN:?export SONAR_TOKEN (a staging-server token) first}"

echo ">> Ensuring full history for correct PR diff scoping..."
git fetch --unshallow 2>/dev/null || echo "   (already a full clone)"
git fetch origin "$PR_BASE" 2>/dev/null || true

echo ">> Analyzing PR #${PR_KEY} (${PR_BRANCH} -> ${PR_BASE}) against ${HOST_URL}"

# NOTE: -D flags override sonar-project.properties, so the SonarCloud host/org
# in that file is ignored for this staging run.
sonar-scanner \
  -Dsonar.host.url="$HOST_URL" \
  -Dsonar.token="$SONAR_TOKEN" \
  -Dsonar.projectKey="$PROJECT_KEY" \
  -Dsonar.organization= \
  -Dsonar.pullrequest.key="$PR_KEY" \
  -Dsonar.pullrequest.branch="$PR_BRANCH" \
  -Dsonar.pullrequest.base="$PR_BASE"

echo ">> Done. Open PR #${PR_KEY}: check the 'Files changed' tab for inline"
echo "   annotations and the 'SonarQube Code Analysis' check run."
