# Technical Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | **IaC tool** | Terraform | S3 backend for state, multi-account support via profiles, team familiarity |
| 2 | **Language** | TypeScript / Node.js 20.x | Matches iTmONE platform. Full AWS SDK support. ESM modules. |
| 3 | **Bedrock model** | Claude 3.5 Sonnet (inference profile) | Reliable JSON extraction. <$2/mo at demo volume. Must use inference profile ID `us.anthropic.claude-3-5-sonnet-20241022-v2:0` — direct model IDs fail for on-demand invocation. |
| 4 | **Bedrock integration** | Direct `InvokeModel` | Single-turn extraction, no agent overhead. Prompts version-controlled in code. |
| 5 | **Secrets** | AWS Secrets Manager | Rotation support, CloudTrail audit, ~$1.60/mo for 4 secrets. In-memory cache with 5-min TTL in Lambda. |
| 6 | **Coder integration** | HTTP REST API v2 | Lambda calls Coder directly. Stub mode when `CODER_BASE_URL` is empty (returns fake data for testing). |
| 7 | **Lambda architecture** | 2 Lambdas, async invoke (no SQS) | Webhook acks Slack in <500ms. Orchestrator runs async via `InvocationType: 'Event'`. Simplest reliable pattern for demo. |
| 8 | **Approval gate** | None (demo mode) | Direct provisioning on Slack message. Can add back later. |
| 9 | **API Gateway** | HTTP API v2 | Lower latency and cost vs REST API v1. Auto-deploy stages. |
| 10 | **DynamoDB** | PAY_PER_REQUEST | Zero cost at low volume. GSI by slackUserId for trace lookup. TTL for auto-cleanup. |
| 11 | **Bundler** | esbuild | Fast, tree-shaking, ESM output. AWS SDK externalized (provided by Lambda runtime). |
| 12 | **Logging** | Custom structured JSON logger | Auto-scrubs secrets (detects xoxb-, ghp_, sk- prefixes). No external dependency needed. |
