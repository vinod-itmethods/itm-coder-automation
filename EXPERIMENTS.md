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

> **CI network caveat (observed):** the staging Server is behind an
> IP-allowlisted ingress. GitHub-**hosted** runners are blocked — the scanner
> gets `HTTP 403` on `/api/server/version` even with a valid token (while local
> runs from an allowlisted machine get `200`). Use a **self-hosted runner**
> inside the network, or run the scanner locally. This is not a token problem.

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

## BLOCKER (RESOLVED) — GitHub App installation + SonarCloud contamination

Two issues had to be cleared before staging-Server decoration worked:

1. **GitHub App not installed.** The App `sq-github-itm` (appId **4425448**,
   GitHub slug `sonarqube-git-itm`) was *configured* in SonarQube (validate =
   204, key matches appId) but GitHub returned **no installation** for the repo,
   so the CE task succeeded while decoration failed with *"GitHub Application
   has no installations."* Fixed by installing the App on `vinod-itmethods` with
   access to `itm-coder-automation` (GitHub account-owner action / permission
   grant — done by the repo owner, not automatable).
2. **SonarCloud was also decorating the repo.** A pre-existing SonarCloud
   binding + SonarCloud's GitHub Advanced Security code-scanning were posting
   their *own* checks/annotations (`sonarqubecloud` appId 12526,
   `github-advanced-security` 57789) that referenced `sonarcloud.io` — easy to
   mistake for the staging Server. Silenced by turning off SonarCloud Automatic
   Analysis for the project. (Stale SonarCloud checks persist on already-analyzed
   commits; they drop off on a fresh commit.)

### Decoration anatomy on the staging Server (observed, PR #1)

One GitHub check run — `SonarQube Code Analysis`, app `sonarqube-git-itm`
(4425448), check-run id `90711021555` — carries **all** of:
- gate status → `conclusion: failure`, title *"Quality Gate failed"*;
- analysis summary (*"Failed conditions … 3 New issues"*) in the check-run
  **output** (Checks tab), linking to `itmethods-stage.devopsx.io`;
- the **3 inline annotations** (S1135 ×2, S2486) on `health.ts`.

The Server did **not** post a separate Conversation-tab summary comment on this
version/config; the summary lives in the check-run output. Because annotations
and gate are the *same* check run, no permission split or setting can keep one
and drop the other — confirming Experiment D against live data.

## Experiments & results

The violations live in `src/orchestrator/health.ts`. Detected as **new-code
issues** on the changed file in PR analysis: `typescript:S1135` (TODO, ×2) and
`typescript:S2486` (empty catch). The hard-coded credential surfaces as a
**Security Hotspot** (separate list); `==` (S1440) and redundant-boolean (S1125)
are not in the active Quality Profile, so they did not raise issues.

| # | Experiment | Setup | Expectation | Observed |
|---|------------|-------|-------------|----------|
| A | Reproduce | PR params set, **shallow** clone (depth 1) | annotations appear; unchanged-files section likely appears | ✅ **Reproduced.** `SonarQube Code Analysis` check posted (gate = failure) with **3 inline annotations** on `health.ts` (S1135 ×2, S2486). Scanner logged *"Shallow clone detected, no blame"* + *"Could not find ref 'dev'"*, yet all annotations landed **on the changed file only** → **no unchanged-files section**, because the analyzed base branch `dev` served as the new-code reference. |
| B | Diff-scoping | `fetch-depth: 0` full clone + PR params | annotations collapse to changed lines; unchanged-files section disappears | ✅ **Confirmed.** Full-clone run (no shallow/blame warnings) posted the same 3 annotations, all on the changed file `health.ts` — **no unchanged-files section**. With a valid analyzed base reference the annotations stay scoped to the diff. (To *reproduce* the unchanged-files noise, the reference must be absent — analyze the PR before the base is analyzed / no reference branch; the fix is exactly this: full clone + analyzed base.) |
| C | Summary-only | toggle **Enable analysis summary** (`summaryCommentEnabled`) off/on | only the Conversation-tab summary changes; annotations unaffected | ✅ **Confirmed.** Set to `false`, re-analyzed: the `SonarQube Code Analysis` check, `failure` gate status, and all **3 annotations remained**. The toggle governs only the optional Conversation-tab summary comment (which this version/config didn't post anyway — the summary sits in the check-run output). **No effect on annotations or gate.** |
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
