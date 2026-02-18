# ONEdevops Workspace Provisioning — Technical Design Document

**Version:** 2.0
**Date:** February 2026
**Author:** iTmethods DevOps Platform Team

---

## 1. Overview

ONEdevops automates developer workspace provisioning triggered from two sources:

| Trigger | Mechanism | Example |
|---|---|---|
| **Slack @mention** | User mentions `@ONEdevops` in any channel or DM | `@ONEdevops onboard backend dev for repo payments-api` |
| **Jira comment** | Comment on any Jira issue containing the keyword `ONEdevops` | `ONEdevops create python workspace for repo data-pipeline` |

Both triggers converge on the same provisioning pipeline: Bedrock parses natural language into a structured intent, a Coder workspace is created on Kubernetes, the GitHub repo is cloned, and a workspace URL is returned to the requester on the originating platform.

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         TRIGGER LAYER                                │
│                                                                      │
│  Slack @mention                        Jira comment_created         │
│       │                                        │                    │
│       ▼                                        ▼                    │
│  POST /slack/events              POST /jira/events?secret=<token>   │
│       │                                        │                    │
│       ▼                                        ▼                    │
│  onedevops-webhook-stage         onedevops-jira-webhook-stage       │
│  (HMAC verify, 5-min replay)     (shared-secret verify,             │
│  (async Lambda invoke)            keyword filter, async invoke)     │
└──────────────────────┬─────────────────────────┬────────────────────┘
                       │  OrchestratorPayload     │
                       └──────────┬───────────────┘
                                  ▼
                    ┌──────────────────────────────┐
                    │  onedevops-orchestrator-stage │
                    │  (VPC, private subnets)       │
                    │                               │
                    │  routeMessage()               │
                    │   ├─ source=jira → bypass     │
                    │   │   classifier              │
                    │   └─ source=slack             │
                    │       classifyMessageIntent() │
                    │         Nova Lite, temp=0.0   │
                    │         "workspace_provision" │
                    │                               │
                    │  runPipeline()                │
                    │   1. Fetch Coder templates    │
                    │   2. parseIntent() via Bedrock│
                    │   3. Validate confidence ≥0.7 │
                    │   4. Post status to notifier  │
                    │   5. Validate GitHub repo     │
                    │   6. Match Coder template     │
                    │   7. Create Coder workspace   │
                    │   8. Poll until running       │
                    │   9. Clone repo + git config  │
                    │  10. Post completion URL      │
                    └──────────────────────────────┘
                         │                │
                         ▼                ▼
                    Coder API        Slack / Jira
                    (K8s pods)       (status updates)
```

---

## 3. Trigger Layer

### 3.1 Slack Webhook (`src/webhook/index.ts`)

**Lambda:** `onedevops-webhook-stage`
**Route:** `POST /slack/events`

**Security:**
- HMAC-SHA256 signature verified against `X-Slack-Signature` header using the Slack signing secret from Secrets Manager
- Requests with a timestamp older than 5 minutes are rejected (replay protection)
- `timingSafeEqual` prevents timing attacks on signature comparison

**Event handling:**
- `url_verification` — returns `challenge` for Slack app setup
- `event_callback` with type `app_mention` — user mentioned `@ONEdevops` in a channel
- `event_callback` with type `message` — direct message to the bot
- Bot messages and subtypes (`bot_id`, `subtype` present) are silently dropped to prevent feedback loops

**Payload forwarded to orchestrator:**
```typescript
{
  source: 'slack',
  requesterId: user,         // Slack user ID (e.g. U012AB3CD)
  slackChannel: channel,    // Channel or DM ID
  messageText: text,        // Full message text including @mention
  messageTs: ts,            // Thread timestamp for reply threading
}
```

**Response:** Always returns `200 OK` immediately before async invoke (Slack requires < 3s response).

---

### 3.2 Jira Webhook (`src/jira-webhook/index.ts`)

**Lambda:** `onedevops-jira-webhook-stage`
**Route:** `POST /jira/events?secret=<token>`

**Security:**
- Shared secret passed as query string parameter `?secret=` (Jira webhook URL configuration)
- Secret fetched from Secrets Manager (`onedevops/jira-webhook-secret`)

**Event handling:**
- Only processes `webhookEvent: "comment_created"` — all other events silently acknowledged
- Comment body must contain the keyword `ONEdevops` (case-sensitive)
- Comments containing `[ONEdevops]` prefix are dropped (they are bot replies — prevents feedback loops)

**Payload forwarded to orchestrator:**
```typescript
{
  source: 'jira',
  requesterId: author.accountId,  // Jira account ID
  messageText: commentBody,        // Full comment text
  issueKey: 'PROJ-123',
  issueId: '10001',
  projectKey: 'PROJ',
  commentAuthor: 'Jane Smith',
}
```

**Key difference from Slack:** Jira events bypass the intent classifier entirely — any comment that reaches the orchestrator is treated directly as a `workspace_provision` request.

---

## 4. Orchestrator Pipeline (`src/orchestrator/pipeline.ts`)

### 4.1 Intent Routing (`routeMessage`)

```
source === 'jira'   →  runPipeline() directly
source === 'slack'  →  classifyMessageIntent() → workspace_provision → runPipeline()
                                               → kb_query           → handleKbQuery()
                                               → unknown            → postClarification()
```

Jira events always trigger provisioning — the comment is already scoped by the `ONEdevops` keyword check in the Jira webhook handler.

### 4.2 Intent Classification (Slack only)

**Function:** `classifyMessageIntent()` in `src/orchestrator/bedrock.ts`
**Model:** `amazon.nova-lite-v1:0`
**Parameters:** `temperature: 0.0`, `max_new_tokens: 10`

Uses few-shot prompting with 4 examples (2 per category). Returns exactly one of:
- `workspace_provision` — onboarding, workspace creation, template listing, workspace status
- `kb_query` — searching Slack history, company knowledge, past projects
- `unknown` — greetings, ambiguous, out-of-scope

### 4.3 Intent Parsing (`parseIntent`)

**Function:** `parseIntent()` in `src/orchestrator/bedrock.ts`
**Model:** `amazon.nova-lite-v1:0`
**Parameters:** `temperature: 0.1`, `max_new_tokens: 1024`

The model receives:
1. A system prompt listing all available Coder template names fetched live from the Coder API
2. Two few-shot examples showing Slack message → structured JSON
3. The user message with `requesterId` and today's date as context

Output is validated with a Zod schema:

```typescript
{
  action: 'create_workspace' | 'list_templates' | 'workspace_status' | 'help',
  confidence: number,           // 0.0–1.0
  workspace: {
    name: string,               // slug, max 32 chars, alphanumeric + hyphens
    templateId: string,         // matches Coder template name
    templateName: string,
  },
  repository: {
    url: string,                // full GitHub URL; empty if not mentioned
    branch: string,             // e.g. onboard/dev/2026-02-18
    cloneDepth: number,         // default 1
  },
  developer: {
    slackUserId: string,
    gitName: string,
    gitEmail: string,
  },
  environment: Record<string, string>,
  secretRefs: string[],
  steps: string[],              // human-readable provisioning plan
}
```

**Confidence threshold:** If `confidence < 0.7`, provisioning is halted and a clarification message is posted with the best-guess plan and available templates.

**Repo URL normalization:** Short names like `payments-api` are expanded to `https://github.com/itmethods/payments-api`.

### 4.4 Provisioning Steps (`runPipeline`)

| Step | Action | Status |
|---|---|---|
| 1 | Emit trace event `received_slack_message` or `received_jira_comment` | Implemented |
| 2 | `GET /api/v2/organizations/{orgId}/templates` — fetch live template list | Implemented |
| 3 | `parseIntent()` via Bedrock Nova Lite — structured JSON action plan | Implemented |
| 4 | Check `confidence ≥ 0.7`; post clarification and abort if below threshold | Implemented |
| 5 | Normalize repository URL (short name → full GitHub URL) | Implemented |
| 6 | Post initial status message to Slack thread or Jira comment | Implemented |
| 7 | `GET /api/v2/workspaces?name=…` — validate GitHub repo accessibility | Implemented |
| 8 | Fuzzy match Coder template by ID, name, or display_name | Implemented |
| 9 | `POST /api/v2/organizations/{orgId}/members/me/workspaces` — create workspace with 6-char UUID suffix to avoid name collisions | Implemented |
| 10 | Poll `GET /api/v2/workspaces/{id}` every 10s, max 30 attempts (5 min timeout) | Implemented |
| 11 | `git clone`, `git checkout -b`, `git config user.name/email` via `execInWorkspace()` | **Stub — not implemented for live Coder** (see below) |
| 12 | Emit `secrets_injected` trace event | Implemented (event only, no injection logic yet) |
| 13 | Post workspace URL and trace URL as completion message | Implemented |

#### Step 11 — Repo Checkout: Current Status

The pipeline calls `execInWorkspace()` (`src/orchestrator/coder.ts`) with four commands in sequence:

```
git clone --depth 1 <url> /home/coder/project
cd /home/coder/project && git checkout -b <branch>
cd /home/coder/project && git config user.name "<name>"
cd /home/coder/project && git config user.email "<email>"
```

`execInWorkspace()` is **not yet implemented for live Coder**. It currently logs a warning and returns a `[NOT IMPLEMENTED]` stub string. The `repo_cloned` trace event is still emitted, but no commands actually execute in the workspace pod.

**What needs to be built:** The Coder agent exec API requires first resolving the workspace agent ID, then calling `POST /api/v2/workspaceagents/{agentId}/exec` with the command. The agent ID is returned as part of the workspace build response but is not currently captured in `createWorkspace()`.

**Coding agent install is unaffected** — GitHub Copilot is installed by the template `startup_script` at pod boot, independent of the pipeline (see Section 7.2).

---

## 5. Status Notifier Abstraction (`src/orchestrator/notifier.ts`)

Both triggers share the same provisioning pipeline via a `StatusNotifier` interface:

```typescript
interface StatusNotifier {
  postStatusMessage(intent: ParsedIntent, traceId: string): Promise<string>  // returns handle
  updateStatus(handle: string, status: string, emoji: string): Promise<void>
  postCompletion(handle: string, workspaceUrl: string, traceUrl: string, durationSec: number): Promise<void>
  postError(handle: string | null, error: string, traceId: string): Promise<void>
  postClarification(message: string): Promise<void>
}
```

| Implementation | Platform | Handle type | updateStatus behaviour |
|---|---|---|---|
| `SlackNotifier` | Slack | message `ts` | Updates original message + posts threaded reply |
| `JiraNotifier` | Jira Cloud | comment `id` | No-op (Jira comments are immutable; only initial + final posts) |

**SlackNotifier** uses Block Kit formatting: header, template/repo/workspace section, numbered plan, and a live-updating context block for status. Completion posts a message with workspace and trace links. All replies are in-thread using the original message `ts`.

**JiraNotifier** uses Atlassian Document Format (ADF) for Jira Cloud REST API v3. Posts two comments total: initial provisioning plan, and final workspace URL. Intermediate status updates are suppressed.

---

## 6. AWS Infrastructure

### 6.1 Account & Region

| Property | Value |
|---|---|
| AWS Account | `381491959603` |
| Region | `us-east-1` |

### 6.2 Lambda Functions

| Function | Memory | Timeout | VPC | Purpose |
|---|---|---|---|---|
| `onedevops-webhook-stage` | 256 MB | 10s | No | Slack signature verify + async invoke |
| `onedevops-jira-webhook-stage` | 256 MB | 10s | No | Jira secret verify + keyword filter + async invoke |
| `onedevops-orchestrator-stage` | 512 MB | 300s | Yes (private subnets) | Full provisioning pipeline |

The orchestrator runs in a VPC with private subnets to reach the internal Coder service URL. Egress is HTTPS-only (port 443) via NAT Gateway.

### 6.3 API Gateway (HTTP API v2)

| Route | Integration | Auth |
|---|---|---|
| `POST /slack/events` | `onedevops-webhook-stage` | Slack HMAC-SHA256 |
| `POST /jira/events` | `onedevops-jira-webhook-stage` | Query string secret |
| `GET /health` | `onedevops-webhook-stage` | None |
| `GET /jira/events` | `onedevops-jira-webhook-stage` | None (Jira URL validation) |

### 6.4 DynamoDB — Trace Table

| Property | Value |
|---|---|
| Table | `onedevops-traces-stage` |
| Billing | PAY_PER_REQUEST |
| Hash key | `traceId` (String) |
| Range key | `eventKey` (String) |
| GSI | `by-user`: hash=`slackUserId`, range=`timestamp` |
| TTL | Enabled (`ttl` attribute) |

### 6.5 Secrets Manager

| Secret path | Contents |
|---|---|
| `onedevops/slack-token` | Slack Bot OAuth token |
| `onedevops/slack-signing-secret` | Slack signing secret for HMAC |
| `onedevops/coder-token` | Coder session token |
| `onedevops/github-pat` | GitHub Personal Access Token |
| `onedevops/jira-credentials` | `{ baseUrl, email, apiToken }` |
| `onedevops/jira-webhook-secret` | Shared secret for Jira webhook URL |

### 6.6 IAM Roles (Least Privilege)

**`onedevops-webhook-stage` role:**
- `lambda:InvokeFunction` on `onedevops-orchestrator-stage` only
- `secretsmanager:GetSecretValue` on `onedevops/*`

**`onedevops-jira-webhook-stage` role:**
- `lambda:InvokeFunction` on `onedevops-orchestrator-stage` only
- `secretsmanager:GetSecretValue` on `onedevops/*`

**`onedevops-orchestrator-stage` role:**
- `secretsmanager:GetSecretValue` on `onedevops/*`
- `bedrock:InvokeModel` on `amazon.nova-lite-v1:0` and `amazon.nova-*`
- `bedrock:InvokeAgent` on KB agent (agent ID + agent alias ARN)
- `dynamodb:PutItem/GetItem/Query/UpdateItem` on traces table + GSI
- `AWSLambdaVPCAccessExecutionRole` (managed) for VPC/ENI

### 6.7 Networking

| Resource | Value |
|---|---|
| VPC | `vpc-09571c6702a8b8547` |
| Subnets | Private subnets (NAT Gateway for egress) |
| Security group | Egress port 443 only — Coder, Bedrock, Slack, GitHub, AWS APIs |
| Coder URL (external) | `https://labcoder.stage.0658b-techopscore.com` |
| Coder URL (internal K8s) | `http://lab-poc-coder:8080` |

---

## 7. Coder Workspace Templates

### 7.1 Available Templates

| Template ID | Language | display_name |
|---|---|---|
| `c5eb4b6d` | Python 3 | Python 3 |
| `1832a64d` | Java 21 | Java 21 |
| `a199b2a1` | Node.js 20 | Node.js 20 |

All templates run as Kubernetes pods on the same cluster as Coder.

### 7.2 K8s Pod Configuration

Key design decisions reflected in `coder-templates/*/main.tf`:

| Concern | Implementation |
|---|---|
| **Runtime** | `kubernetes_pod_v1` resource (non-deprecated) |
| **Provisioner routing** | `provisioner_tags = { scope = "organization" }` |
| **Agent connectivity** | Internal K8s service URL `http://lab-poc-coder:8080` — external Coder URL is blocked by WAF for in-cluster traffic |
| **Base images** | Full images (e.g. `python:3.12`, not `python:3.12-slim`) — slim images lack `curl`/`wget` required by agent init script |
| **Agent binary** | Downloaded via curl with fallback: internal short name → internal FQDN → external URL |
| **Volumes** | `emptyDir` (no PVC) — faster startup, no storage class dependency |
| **Node tolerations** | `coder.com/provisioner=true:NoSchedule` and `app=coder:NoSchedule` |

### 7.3 Coding Agent Setup (GitHub Copilot + AI Bridge)

This happens **automatically at pod startup** for every workspace, independently of the provisioning pipeline. There are two layers:

#### GitHub Copilot (code-server extension)

All three templates run the same `startup_script` inside the Coder agent as soon as the pod reaches `running` state:

```bash
# 1. Ensure jq is present (needed by the install script)
which jq >/dev/null 2>&1 || apt-get install -y jq

# 2. Idempotent check — skip if already installed
if ! code-server --list-extensions | grep -qi "github.copilot"; then
  # 3. VSIX sideload via community install script
  curl -fsSL https://raw.githubusercontent.com/sunpix/howto-install-copilot-in-code-server/main/install-copilot.sh | bash
fi
```

**Why VSIX sideload?** GitHub Copilot is not published to the Open VSX registry (the extension marketplace code-server uses by default). It must be downloaded as a `.vsix` package and installed directly into code-server. The community script handles fetching the latest VSIX and calling `code-server --install-extension`.

**Idempotence:** The extension check runs on every workspace start/restart. If Copilot is already installed it is skipped, so restarts don't reinstall unnecessarily.

**Per-template dev tooling** installed alongside Copilot:

| Template | Additional tools |
|---|---|
| Python 3 | `black`, `flake8`, `mypy`, `pytest` |
| Node.js 20 | `typescript`, `ts-node`, `eslint`, `prettier` |
| Java 21 | *(none beyond JDK — Maven/Gradle expected in repo)* |

#### AI Bridge (Coder-governed AI proxy)

Every template sets four environment variables on the `coder_agent` resource:

```hcl
env = {
  ANTHROPIC_BASE_URL = "${workspace.access_url}/api/v2/aibridge/anthropic"
  ANTHROPIC_API_KEY  = workspace_owner.session_token
  OPENAI_BASE_URL    = "${workspace.access_url}/api/v2/aibridge/openai/v1"
  OPENAI_API_KEY     = workspace_owner.session_token
}
```

Any AI SDK that respects `ANTHROPIC_BASE_URL` or `OPENAI_BASE_URL` (Claude SDK, OpenAI SDK, LangChain, Continue.dev, etc.) will automatically route through Coder's AI Bridge instead of calling the model providers directly. This gives:

- **Governance** — all AI calls are logged and attributed to the workspace owner
- **Cost tracking** — token usage is visible in Coder's admin dashboard
- **No API key management** — the workspace owner's Coder session token is reused; no separate Anthropic or OpenAI key needed per developer

The AI Bridge is transparent to the developer: tools like GitHub Copilot Chat, Continue.dev, or custom scripts work without any code changes.

### 7.4 Coder API Interaction

| Operation | Endpoint |
|---|---|
| List templates | `GET /api/v2/organizations/{orgId}/templates` |
| Create workspace | `POST /api/v2/organizations/{orgId}/members/me/workspaces` |
| Poll status | `GET /api/v2/workspaces/{workspaceId}` |
| Exec in workspace | `POST /api/v2/workspaceagents/{agentId}/exec` *(planned)* |

**Template matching** uses fuzzy logic: exact ID → exact name → exact display_name → partial substring match.

**Workspace naming:** `{intent.workspace.name}-{6-char-uuid}` truncated to 32 characters to avoid collisions on repeated requests.

**Polling:** 10-second interval, 30 attempts maximum (5-minute timeout). Terminal states: `running` (success), `failed`/`canceled` (error).

---

## 8. Source Code Layout

```
src/
├── webhook/
│   └── index.ts              Slack webhook Lambda handler
├── jira-webhook/
│   └── index.ts              Jira webhook Lambda handler
├── orchestrator/
│   ├── index.ts              Lambda entry — calls routeMessage()
│   ├── pipeline.ts           routeMessage() router + runPipeline() (13 steps)
│   ├── bedrock.ts            classifyMessageIntent() + parseIntent() via Nova Lite
│   ├── slack.ts              SlackNotifier — Block Kit status messages, threading
│   ├── jira.ts               JiraNotifier — ADF comments to Jira Cloud REST API v3
│   ├── notifier.ts           StatusNotifier interface
│   ├── coder.ts              Coder API client — list, match, create, poll, exec
│   ├── github.ts             Repo URL normalization + validation
│   ├── kb-handler.ts         Bedrock Agent KB query handler (kb_query path)
│   └── notifier.ts           StatusNotifier interface definition
├── shared/
│   ├── config.ts             getConfig() — reads Lambda env vars
│   ├── secrets.ts            AWS Secrets Manager wrappers (cached)
│   ├── tracer.ts             OneAgentTracer — DynamoDB trace event emitter
│   ├── logger.ts             Structured JSON logger (pino)
│   └── types.ts              OrchestratorPayload, ParsedIntent, CoderWorkspace, etc.
coder-templates/
├── python/main.tf            Python 3 K8s workspace template
├── java/main.tf              Java 21 K8s workspace template
└── nodejs/main.tf            Node.js 20 K8s workspace template
terraform/
├── main.tf                   API Gateway, DynamoDB, CloudWatch log groups
├── lambda.tf                 Lambda functions, security group
├── iam.tf                    IAM roles and least-privilege policies
├── variables.tf              Input variables
└── outputs.tf                API URLs, function ARNs
template.yaml                 AWS SAM alternative deployment definition
```

---

## 9. Trace Events (ONEagent Studio)

Every provisioning run emits structured events to DynamoDB with a UUID trace ID:

| Event | When emitted |
|---|---|
| `received_slack_message` | On Slack trigger |
| `received_jira_comment` | On Jira trigger |
| `parsed_intent` | After Bedrock returns validated JSON — includes action, confidence, workspace name, repo |
| `bedrock_plan_created` | After confidence check passes — includes steps array |
| `coder_template_selected` | After fuzzy template match |
| `coder_workspace_created` | After workspace create API call returns |
| `repo_cloned` | Emitted after `execInWorkspace()` calls for git clone/checkout — **note: exec is currently a stub; event fires but commands do not run** |
| `secrets_injected` | Emitted after secret reference count is recorded — **note: no actual secret injection logic implemented yet** |
| `workspace_ready` | On completion — includes workspace URL and duration |
| `error` | On any unhandled exception — sanitized message only |

Trace URL format: `{tracesBaseUrl}/traces/{traceId}`

---

## 10. Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Jira bypasses classifier | Always `runPipeline()` | Jira comments are already scoped by the `ONEdevops` keyword; no ambiguity |
| Async Lambda invoke | `InvocationType: 'Event'` | Slack requires < 3s response; Jira has similar constraints |
| Intent model | Nova Lite, temp=0.1, max 1024 tokens | Fast and cheap for structured JSON extraction |
| Classifier model | Nova Lite, temp=0.0, max 10 tokens | Deterministic binary classification |
| Confidence threshold | 0.7 | Balances user experience vs false positives on ambiguous requests |
| Workspace name suffix | 6-char UUID | Prevents `409 Conflict` on repeated provisioning requests |
| Coder internal URL | `http://lab-poc-coder:8080` | WAF/ALB blocks external URL for in-cluster traffic; must use K8s service DNS |
| Full base images | `python:3.12` not `python:3.12-slim` | Slim images lack `curl` needed by Coder agent init |
| JiraNotifier updateStatus | No-op | Jira Cloud does not support editing comments in-place; only post initial plan + final result |
| Orchestrator in VPC | Private subnets + NAT | Required for Coder API connectivity (internal K8s cluster) |
| Secrets in Secrets Manager | `onedevops/*` prefix | Centralised, audited, never in env vars or logs |
| Copilot via VSIX sideload | `startup_script` on pod boot | Not on Open VSX registry; must be installed as a `.vsix` package directly into code-server |
| Copilot install is idempotent | Extension check before install | Avoids reinstalling on every workspace restart |
| AI Bridge env vars | Set on `coder_agent`, not in container env | Any AI SDK respecting base URL env vars routes through Coder automatically, no per-dev API keys needed |
| `execInWorkspace` not implemented | Stub returns `[NOT IMPLEMENTED]` | Coder agent exec API requires resolving agent ID from build response — planned, not yet built |

---

## 11. Environment Variables (Lambda)

### Webhook / Jira Webhook Lambdas

| Variable | Value |
|---|---|
| `ORCHESTRATOR_FUNCTION_NAME` | `onedevops-orchestrator-stage` |
| `SECRETS_PREFIX` | `onedevops` |
| `LOG_LEVEL` | `info` |
| `NODE_OPTIONS` | `--enable-source-maps` |

### Orchestrator Lambda

| Variable | Value |
|---|---|
| `TRACES_TABLE_NAME` | `onedevops-traces-stage` |
| `CODER_BASE_URL` | `https://labcoder.stage.0658b-techopscore.com` |
| `CODER_ORG_ID` | `default` |
| `BEDROCK_MODEL_ID` | `amazon.nova-lite-v1:0` |
| `BEDROCK_REGION` | `us-east-1` |
| `KB_AGENT_ID` | *(KB agent — for kb_query path only)* |
| `KB_AGENT_ALIAS_ID` | *(KB agent alias — for kb_query path only)* |
| `SECRETS_PREFIX` | `onedevops` |
| `LOG_LEVEL` | `info` |

---

## 12. Deployment

**Build:**
```bash
npm run build        # tsc compile → dist/
```

**Deploy via Terraform:**
```bash
cd terraform
terraform init
terraform apply -var-file=terraform.tfvars
```

**Deploy via SAM:**
```bash
sam build
sam deploy --profile onedevops
```

**Add a new Coder template:**
```bash
# 1. Edit coder-templates/<lang>/main.tf
# 2. Push via Coder CLI or API
cd coder-templates/python
coder templates push python3 --activate --yes
```
