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

## Experiments & results

The violations live in `src/orchestrator/health.ts` (hard-coded credential,
TODO comment, `==` vs `===`, redundant boolean, empty catch). They should
surface as inline annotations on the changed lines.

| # | Experiment | Setup | Expectation | Observed | Gate check kept? | Inline annotations? | Unchanged-files section? |
|---|------------|-------|-------------|----------|------------------|---------------------|--------------------------|
| A | Reproduce | PR params set, **shallow** clone | annotations appear; unchanged-files section likely appears | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| B | Diff-scoping | `fetch-depth: 0` full clone + PR params | annotations collapse to changed lines; unchanged-files section disappears | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| C | Summary-only | toggle **Enable analysis summary** off/on | only the Conversation-tab summary changes; annotations unaffected | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| D | Annotation suppression | search Server settings/API for an annotation toggle or `sonar.pullrequest.github.*` prop; apply | if a Server "Enable Issue Annotations" equivalent exists: annotations gone, gate check + summary stay | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

### Experiment D — search checklist (on this instance)

- [ ] `GET /api/settings/list_definitions` (admin token) — grep keys for
      `annotation`, category `Pull Requests`, `pullrequest`, `github`.
- [ ] Admin UI: Administration → Configuration → General Settings → **Pull
      Requests** — is there an **"Enable Issue Annotations"** checkbox?
- [ ] Project UI: Project Settings → General Settings → **DevOps Platform
      Integration** — beyond "Enable analysis summary", any annotation toggle?
- [ ] Test any candidate `sonar.pullrequest.github.*` scanner property.

## Conclusion (fill after runs)

_Which setting, if any, kept PR decoration + gate check while removing the
inline annotation noise. If no Server annotation toggle exists, the fallback is
diff-scoping (Exp B) so the noise collapses to the actual changed lines and the
unchanged-files section disappears._
