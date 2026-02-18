# ONEdevops Unified Bot — Technical Design Document

**Version:** 1.0
**Date:** February 2026
**Author:** iTmethods DevOps Platform Team

---

## 1. Overview

ONEdevops is a Slack bot that serves as a single AI-powered interface for two capabilities:

| Intent | Example Trigger | Outcome |
|---|---|---|
| **Knowledge Base Query** | "What were the key issues with CIBC?" | Searches 224 Slack channels + company docs via Bedrock Agent |
| **Workspace Provisioning** | "Onboard a backend dev for repo payments-api" | Provisions a Coder workspace via pipeline |

A single intent classifier (Bedrock Nova Lite) routes every message to the correct handler automatically. Users interact with one bot, one way.

---

## 2. Architecture

```
Slack @mention
      │
      ▼
┌─────────────────────┐
│  Webhook Lambda      │  Verifies Slack signature, async-invokes Orchestrator, returns 200
│  onedevops-webhook   │
└────────┬────────────┘
         │ async invoke
         ▼
┌─────────────────────────────────────────────────────┐
│  Orchestrator Lambda  (onedevops-orchestrator-stage) │
│                                                     │
│  routeMessage()                                     │
│    │                                                │
│    ├─ classifyMessageIntent()  [Bedrock Nova Lite]  │
│    │       "kb_query" | "workspace_provision"       │
│    │       | "unknown"                              │
│    │                                                │
│    ├── kb_query ──► handleKbQuery()                 │
│    │                  InvokeAgent → stream chunks   │
│    │                  postKbAnswer() to Slack        │
│    │                                                │
│    ├── workspace_provision ──► runPipeline()         │
│    │                  parse intent → GitHub → Coder │
│    │                                                │
│    └── unknown ──► postClarification() to Slack     │
└─────────────────────────────────────────────────────┘
```

**Jira webhooks** bypass routing and always go directly to `runPipeline()`.

---

## 3. AWS Components

### 3.1 Account
All resources live in a single AWS account: **`381491959603`** (us-east-1)

### 3.2 Lambda Functions

| Function | Runtime | Memory | Timeout | VPC |
|---|---|---|---|---|
| `onedevops-webhook-stage` | Node.js 20.x | 256 MB | 10s | No |
| `onedevops-orchestrator-stage` | Node.js 20.x | 512 MB | 300s | Yes (private subnets) |
| `onedevops-jira-webhook-stage` | Node.js 20.x | 256 MB | 10s | No |

### 3.3 Bedrock Knowledge Base

| Property | Value |
|---|---|
| KB ID | `ALR6COAAPX` |
| Name | `slack-presales-kb` |
| Embedding Model | Amazon Titan Embed Text v2 (1024-dim) |
| Vector Store | OpenSearch Serverless (`06bk9d2i6762zmhnotnc`) |
| Data Source | S3 — `s3://onedevops-slack-kb-381491959603/` |
| Documents | 224 Slack channel exports (11,735 messages) + 8 company docs |
| Chunking | Fixed-size, 300 tokens, 20% overlap |

### 3.4 Bedrock Agent

| Property | Value |
|---|---|
| Agent ID | `MOWMJ9OC10` |
| Agent Alias ID | `K0DC1UMAIO` |
| Name | `slack-presales-agent` |
| Foundation Model | Claude 3.5 Sonnet (via agent) |
| Knowledge Base | `ALR6COAAPX` |

### 3.5 Supporting Infrastructure

| Resource | Value |
|---|---|
| DynamoDB Table | `onedevops-traces-stage` — request tracing |
| Secrets Manager | `onedevops/*` — Slack token, Coder token, GitHub PAT |
| S3 Bucket | `onedevops-slack-kb-381491959603` — KB source documents |
| VPC | `vpc-09571c6702a8b8547`, private subnets with NAT Gateway |
| API Gateway | Slack and Jira webhook endpoints |

---

## 4. Intent Classification

**Model:** `amazon.nova-lite-v1:0`
**Parameters:** `temperature: 0.0`, `max_new_tokens: 10`
**Location:** `src/orchestrator/bedrock.ts` → `classifyMessageIntent()`

The classifier uses a few-shot system prompt with 4 examples:

```
kb_query examples:
  - "What did we discuss about CIBC last quarter?"
  - "Find conversations about the Jenkins outage"

workspace_provision examples:
  - "Onboard a backend dev for repo payments-api"
  - "Create a Python workspace for Alice"
```

Returns one of: `kb_query` | `workspace_provision` | `unknown`

---

## 5. Knowledge Base Data Pipeline

```
Slack API (user token xoxp-)
    │  conversations.list + conversations.history + replies
    │  224 channels, 11,735 messages
    ▼
ingest.ts  →  Markdown files  →  S3 (onedevops-slack-kb-381491959603)
                                         │
                              Bedrock Sync Job (TLTOUNJCCF)
                                         │
                              Titan Embed v2 → AOSS KNN Index
                                         │
                              Agent (MOWMJ9OC10) answers queries
```

**Slack token scope required:** `channels:read`, `channels:history`, `groups:read`, `groups:history`, `users:read` (User OAuth Token for private channel access)

---

## 6. Source Code Layout

```
src/
├── orchestrator/
│   ├── index.ts          Entry point — calls routeMessage()
│   ├── pipeline.ts       routeMessage() router + runPipeline() workspace flow
│   ├── bedrock.ts        classifyMessageIntent() + parseIntent()
│   ├── kb-handler.ts     handleKbQuery() — Bedrock Agent invocation + streaming
│   ├── slack.ts          SlackNotifier — postKbAnswer(), postError(), postClarification()
│   ├── coder.ts          Coder workspace API client
│   ├── github.ts         GitHub repo/template resolution
│   └── jira.ts           Jira ticket updates
├── shared/
│   ├── config.ts         getConfig() — env var loading (incl. KB_AGENT_ID)
│   ├── secrets.ts        AWS Secrets Manager wrapper
│   ├── logger.ts         Structured JSON logger
│   └── types.ts          OrchestratorPayload and shared types
demos/slack-kb-agent/
├── src/ingest.ts         Slack → S3 export script
└── src/setup-kb.ts       AOSS + KB + Agent provisioning script
```

---

## 7. IAM Permissions (Orchestrator Role)

| Permission | Resource |
|---|---|
| `bedrock:InvokeModel` | `amazon.nova-lite-v1:0`, `amazon.nova-*` |
| `bedrock:InvokeAgent` | `agent/MOWMJ9OC10`, `agent-alias/MOWMJ9OC10/K0DC1UMAIO` |
| `secretsmanager:GetSecretValue` | `arn:aws:secretsmanager:us-east-1:381491959603:secret:onedevops/*` |
| `dynamodb:PutItem/GetItem/Query/UpdateItem` | `onedevops-traces-stage` + GSI |
| VPC execution | `AWSLambdaVPCAccessExecutionRole` |

---

## 8. Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Intent routing model | Nova Lite, temp=0, max 10 tokens | Cheap, deterministic, fast (~200ms) |
| Private channel access | User OAuth token (xoxp-) | Bot token lacks `groups:history` by default |
| KB embedding model | Titan Embed v2 (1024-dim) | Native Bedrock, no cross-account friction |
| Vector store | OpenSearch Serverless | Managed, serverless, required by Bedrock KB |
| All resources in one account | `381491959603` | Eliminates cross-account IAM complexity |
| Agent streaming | Collected into single string | Simpler Slack formatting; no partial message edits |
| Jira bypass routing | Always `runPipeline()` | Jira events are always provisioning actions |

---

## 9. Environment Variables (Orchestrator Lambda)

| Variable | Value | Source |
|---|---|---|
| `KB_AGENT_ID` | `MOWMJ9OC10` | Lambda env |
| `KB_AGENT_ALIAS_ID` | `K0DC1UMAIO` | Lambda env |
| `BEDROCK_MODEL_ID` | `amazon.nova-lite-v1:0` | Lambda env |
| `BEDROCK_REGION` | `us-east-1` | Lambda env |
| `CODER_BASE_URL` | `https://labcoder.stage.0658b-techopscore.com` | Lambda env |
| `TRACES_TABLE_NAME` | `onedevops-traces-stage` | Lambda env |
| `SECRETS_PREFIX` | `onedevops` | Lambda env |
| Slack/Coder/GitHub tokens | — | Secrets Manager (`onedevops/*`) |

---

## 10. Deployment

**Infrastructure as Code:** Terraform (`terraform/`) + AWS SAM (`template.yaml`)

```bash
# Build
npm run build

# Deploy via SAM
sam deploy --profile onedevops

# OR via Terraform
cd terraform && terraform apply
```

**Re-ingesting KB** (after new Slack exports):
```bash
# 1. Re-run ingest to push to S3
cd demos/slack-kb-agent && npx ts-node src/ingest.ts

# 2. Trigger Bedrock sync
aws bedrock-agent start-ingestion-job \
  --knowledge-base-id ALR6COAAPX \
  --data-source-id TLTOUNJCCF \
  --region us-east-1 --profile onedevops
```
