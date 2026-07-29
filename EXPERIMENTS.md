# SonarQube Server GitHub PR decoration — inline annotation noise

Goal: keep PR decoration (summary) **and** the quality-gate status check, but
remove the inline annotation noise on changed files (and the "Unchanged files
with check annotations" section) in the GitHub "Files changed" tab.

- Instance: `https://itmethods-stage.devopsx.io` — **SonarQube Server 2026.3.1.123439**
- Repo: `vinod-itmethods/itm-coder-automation`
- Project key: `itm-coder-automation`

## Mechanics (confirmed going in)

1. The inline annotations and the "SonarQube Code Analysis" quality-gate check
   are **the same GitHub check run** — annotations ride the check run via the
   GitHub Checks API. So GitHub App permission changes cannot separate them:
   `checks: read-only` kills the gate check too; `pull_requests: read-only`
   only removes the summary comment.
2. "Unchanged files with check annotations" is a **GitHub** feature with no
   disable toggle. It appears when the check posts annotations on lines outside
   the PR diff — i.e. when analysis is **not diff-scoped** (shallow clone or
   missing PR params).
3. On the GitHub binding, the documented decoration toggle is **"Enable
   analysis summary"** (removes the Conversation-tab summary, not the inline
   annotations).

## Research findings (docs, before running)

- **SonarQube Cloud** has an explicit toggle to kill inline annotations while
  keeping the check: **Administration → General Settings → Pull Requests →
  Issue Annotations → "Enable Issue Annotations"** (default: on). Cloud docs:
  *"As a project admin, you can disable the pull request inline annotations for
  your project."*
- **SonarQube Server** docs describe inline annotations in the Files-changed
  tab but do **not** document an equivalent "Enable Issue Annotations" toggle.
  The "Enable Inline Pull Request Annotations" toggle is documented for the
  **Azure DevOps** binding only.
- The legacy `sonar.github.disableInlineComments` property belonged to the
  **deprecated GitHub plugin**, not the current GitHub App decoration — it does
  nothing on 2026.x.
- **Whether Server 2026.3 exposes the Cloud "Enable Issue Annotations" toggle
  (or an equivalent global setting / scanner property) can only be settled
  empirically against this instance** — that is Experiment D.

Sources:
- https://docs.sonarsource.com/sonarqube-server/user-guide/issues/in-devops-platform/github
- https://docs.sonarsource.com/sonarqube-cloud/managing-your-projects/issues/in-devops-platform/github
- https://docs.sonarsource.com/sonarqube-cloud/managing-your-projects/administering-your-projects/devops-platform-integration/github
- https://docs.sonarsource.com/sonarqube-server/analyzing-source-code/scanners/scanner-environment/verifying-code-checkout-step

## Prerequisites for the live runs

- [ ] `SONAR_TOKEN` for the staging Server (repo secret for CI, or exported env for local).
- [ ] SonarQube project `itm-coder-automation` exists on the Server and is
      **bound** to the GitHub repo (Project Settings → General Settings → DevOps
      Platform Integration), with the SonarQube GitHub App installed on the
      `vinod-itmethods` account. Without the binding there is no check run at all.

## How to run

CI: add `SONAR_TOKEN` as a repo secret; the workflow
`.github/workflows/sonar-pr-analysis.yml` runs on PRs to `dev`/`main` with a
full clone and explicit PR params.

Local (fast iteration):

```bash
export SONAR_TOKEN=xxxx
PR_KEY=<pr#> PR_BRANCH=exp/pr-decoration-noise PR_BASE=dev SHALLOW=1 ./scripts/run-pr-analysis.sh   # Exp A
PR_KEY=<pr#> PR_BRANCH=exp/pr-decoration-noise PR_BASE=dev SHALLOW=0 ./scripts/run-pr-analysis.sh   # Exp B
```

## Environment as provisioned (2026-07-29)

- Project `itm-coder-automation` created on the staging Server, main branch `dev`.
- Bound to GitHub via `POST api/alm_settings/set_github_binding`
  (`almSetting=sq-github-itm`, `repository=vinod-itmethods/itm-coder-automation`,
  `monorepo=false`, `summaryCommentEnabled=true`). Binding verified.
- Baseline analysis of `dev` uploaded successfully.
- PR #1 opened (`exp/pr-decoration-noise` → `dev`).
- CI secret `SONAR_TOKEN` set on the repo.

## BLOCKER — GitHub App not installed

The GitHub App `sq-github-itm` (appId **4425448**) is *configured* in SonarQube
but has **no installation** on the `vinod-itmethods` account. The Compute Engine
task for the PR analysis succeeds but decoration fails with:

> Failed to report status to Devops platform: **GitHub Application has no
> installations.** Contact your SonarQube administrator to fix the problem.

Consequence: no "SonarQube Code Analysis" check run and no annotations can be
posted from the staging Server until the App is installed on the repo. (The
`sonarqubecloud` / "SonarCloud Code Analysis" checks already on the PR are from
a **pre-existing SonarCloud binding**, not this staging Server.)

**Fix (GitHub account-owner action — a permission grant, must be done by you):**
install the `sq-github-itm` App on `vinod-itmethods` with access to
`itm-coder-automation`. Find its install link via SonarQube → Administration →
Configuration → DevOps Platform Integrations → GitHub → `sq-github-itm`, or via
the App owner's GitHub *Developer settings → GitHub Apps → Install App*.

## Experiments & results

The violations live in `src/orchestrator/health.ts`. Detected as **new-code
issues** on the changed file in PR analysis: `typescript:S1135` (TODO, ×2) and
`typescript:S2486` (empty catch). The hard-coded credential surfaces as a
**Security Hotspot** (separate list); `==` (S1440) and redundant-boolean (S1125)
are not in the active Quality Profile, so they did not raise issues.

| # | Experiment | Setup | Expectation | Observed |
|---|------------|-------|-------------|----------|
| A | Reproduce | PR params set, **shallow** clone (depth 1) | annotations appear; unchanged-files section likely appears | Analysis ran & was **PR-scoped** (3 new-code issues, all in `health.ts`). Scanner logged *"Shallow clone detected, no blame"* + *"Could not find ref 'dev'"*. **GitHub annotations NOT observable — decoration blocked by missing App install.** |
| B | Diff-scoping | `fetch-depth: 0` full clone + PR params | annotations collapse to changed lines; unchanged-files section disappears | **Pending App install.** SonarQube-side new-code scoping already correct in the full clone; the GitHub-side "unchanged files" section can only be observed once decoration posts. |
| C | Summary-only | toggle **Enable analysis summary** (`summaryCommentEnabled`) off/on | only the Conversation-tab summary changes; annotations unaffected | **Pending App install.** Confirmed the toggle *exists* and is the single decoration knob (binding param `summaryCommentEnabled`, default `true`). |
| D | Annotation suppression | search Server settings/API for an annotation toggle or `sonar.pullrequest.github.*` prop | if a Server "Enable Issue Annotations" equivalent exists: annotations gone, gate check + summary stay | **DONE — none exists.** `GET api/settings/list_definitions` on 2026.3.1 has **zero** annotation/inline keys and no "Pull Requests → Issue Annotations" category (that is a **SonarQube Cloud-only** setting). The only decoration parameter on the GitHub binding is `summaryCommentEnabled` (summary comment). Legacy `sonar.github.disableInlineComments` belongs to the removed GitHub plugin and has no effect. |

## Conclusion

On **SonarQube Server 2026.3.1** there is **no setting or scanner property** that
disables GitHub inline PR annotations while keeping the quality-gate check run —
the annotations and the check run are the same Checks-API check run, and the
"Enable Issue Annotations" toggle exists only on SonarQube **Cloud**. The only
GitHub-binding decoration toggle is **"Enable analysis summary"**
(`summaryCommentEnabled`), which controls the Conversation-tab summary, not the
annotations.

Therefore the achievable outcome for the stated success criterion is:

1. **Remove the "Unchanged files with check annotations" noise** by ensuring
   PR analysis is **diff-scoped** — full clone (`fetch-depth: 0` / `GIT_DEPTH: 0`)
   plus correct `sonar.pullrequest.*` params (Experiment B). Annotations then
   collapse to the actual changed lines; the check run and summary are kept.
2. Inline annotations **on the changed lines themselves cannot be turned off by
   config** on Server 2026.3.1. Fully eliminating them (short of dropping the
   check) requires a non-config lever — e.g. a New Code definition / Quality
   Gate so no *new* issues are raised on the PR (annotations are only posted for
   new-code issues), or a feature request to Sonar to port the Cloud "Enable
   Issue Annotations" toggle to Server.

**Verification of B/C against real GitHub annotations is pending the one-time
GitHub App installation (see BLOCKER).**
