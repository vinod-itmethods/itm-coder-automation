testing changes

# ONEdevops Automation

Slack bot (`@ONEdevops`) that provisions Coder developer workspaces via natural language commands, powered by AWS Bedrock (Claude 3.5 Sonnet).

## Architecture

```
Slack (@ONEdevops mention)
  → API Gateway (HTTP API v2)
  → Lambda: webhook (verify signature, ack 200, async-invoke orchestrator)
  → Lambda: orchestrator
      → Bedrock InvokeModel → structured JSON intent
      → Slack: post "provisioning..." status
      → Coder HTTP API: create workspace
      → Coder: git clone, configure, create branch
      → DynamoDB + CloudWatch: ONEagent trace events
      → Slack: update with workspace URL + trace link
```

## Quick Start

### Prerequisites

- Node.js >= 20
- Terraform >= 1.5
- AWS CLI configured with profile `onedevops` (account 381491959603)
- Slack App with bot token and signing secret

### 1. Install dependencies

```bash
npm install
```

### 2. Build Lambda bundles

```bash
npm run build
```

### 3. Deploy infrastructure

```bash
cd terraform
terraform init
terraform apply
```

Or use the deploy script:

```bash
./scripts/deploy.sh stage
```

### 4. Store secrets

```bash
./scripts/setup-secrets.sh
```

You'll be prompted for:
- Slack bot token (`xoxb-...`)
- Slack signing secret
- GitHub personal access token (repo scope)
- Coder API token

### 5. Configure Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. **Event Subscriptions** → Enable → Set Request URL to the `webhook_url` from Terraform output
3. **Subscribe to bot events** → Add `app_mention`
4. **OAuth & Permissions** → Bot Token Scopes: `app_mentions:read`, `chat:write`
5. Install to workspace

### 6. Test

```
@ONEdevops onboard backend dev for repo payments-api
```

## Project Structure

```
onedevops-automation/
├── terraform/              # Infrastructure as Code
│   ├── provider.tf         # AWS provider + S3 backend
│   ├── variables.tf        # Input variables
│   ├── main.tf             # API GW, DynamoDB, CloudWatch
│   ├── lambda.tf           # Lambda functions
│   ├── iam.tf              # IAM roles + policies
│   └── outputs.tf          # Endpoint URLs, ARNs
├── src/
│   ├── shared/             # Shared utilities
│   │   ├── types.ts        # All TypeScript types
│   │   ├── config.ts       # Env var loader
│   │   ├── secrets.ts      # Secrets Manager client (5-min cache)
│   │   ├── logger.ts       # Structured JSON logger (auto-scrubs secrets)
│   │   ├── tracer.ts       # ONEagent trace emitter
│   │   └── retry.ts        # Exponential backoff
│   ├── webhook/
│   │   └── index.ts        # Lambda 1: Slack webhook handler
│   └── orchestrator/
│       ├── index.ts         # Lambda 2: entry point
│       ├── pipeline.ts      # Main orchestration flow
│       ├── bedrock.ts       # Bedrock intent parser
│       ├── slack.ts         # Slack message client (Block Kit)
│       ├── coder.ts         # Coder REST API client
│       └── github.ts        # GitHub repo validation
├── scripts/
│   ├── build.sh            # esbuild Lambda bundler
│   ├── deploy.sh           # Full build + Terraform deploy
│   └── setup-secrets.sh    # Interactive secrets creation
└── PROMPTS/
    ├── main_prompt.md      # Bedrock system prompt (readable copy)
    └── followups.md        # Clarification templates
```

## Deployed Endpoints

| Endpoint | URL |
|---|---|
| Webhook | `https://3a3wnbb4w9.execute-api.us-east-1.amazonaws.com/stage/slack/events` |
| Health | `https://3a3wnbb4w9.execute-api.us-east-1.amazonaws.com/stage/health` |

## Configuration

See [CONFIG.md](./CONFIG.md) for all environment variables and Terraform variables.

## Decisions

See [DECISIONS.md](./DECISIONS.md) for technical decision rationale.

## Roadmap

See [TODO_NEXT.md](./TODO_NEXT.md) for production hardening steps.
