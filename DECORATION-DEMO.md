# SonarQube PR Decoration — Demo Runbook

Demonstrates PR decoration (inline annotations + the "SonarQube Code Analysis"
check run) and how it is controlled by the **SonarQube GitHub App permissions**.

Analysis runs **locally over VPN** because the staging Server
(`itmethods-stage.devopsx.io`) is IP-allowlisted — GitHub-hosted runners get
HTTP 403.

## Prerequisites

- Connected to the corporate **VPN** (allowlisted network).
- `sonar-scanner` on PATH (`which sonar-scanner`).
- A **staging-server** token (Server → My Account → Security). This is NOT the
  SonarCloud token.
- Project `itm-coder-automation` on the Server is **bound** to the GitHub repo:
  Project → Administration → **DevOps Platform Integration** → GitHub.

## Part 1 — Activate decoration (baseline: permissions OK)

Ensure the **SonarQube GitHub App** (org → Settings → GitHub Apps) has:
- **Checks: Read & write**
- **Pull requests: Read & write**

Then run analysis against an open PR (example: PR #6):

```bash
export SONAR_TOKEN=<your-staging-server-token>
PR_KEY=6 PR_BRANCH=exp/perm-readonly PR_BASE=main ./scripts/run-pr-analysis.sh
```

Open PR #6:
- **Files changed** tab → inline SonarQube annotations on the diff.
- **Checks / Conversation** → "SonarQube Code Analysis" check run + summary comment.

## Part 2 — Disable decoration (flip permissions to read-only)

1. GitHub → org **Settings → GitHub Apps → SonarQube → Permissions**.
2. Set **Checks → Read-only** and **Pull requests → Read-only**. Save & accept.
3. Re-run the exact same command from Part 1.

Result: the scan still **succeeds on the Server** (issues are computed), but the
Server can no longer **post** back to GitHub — so:
- No new inline annotations.
- No updated check run / PR comment.

This proves decoration is gated by the GitHub App's write permissions, not by
the analysis itself.

## Restore

Set Checks + Pull requests back to **Read & write** and re-run to confirm
decoration returns.
