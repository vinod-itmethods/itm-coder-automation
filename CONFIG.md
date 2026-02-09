# Configuration Reference

## Terraform Variables (`terraform/variables.tf`)

| Variable | Default | Description |
|---|---|---|
| `aws_region` | `us-east-1` | AWS region |
| `aws_profile` | `onedevops` | AWS CLI profile |
| `account_id` | `381491959603` | Target AWS account ID |
| `stage` | `stage` | Deployment stage name |
| `coder_base_url` | `""` (empty = stub mode) | Coder instance URL |
| `coder_org_id` | `default` | Coder organization ID |
| `bedrock_model_id` | `us.anthropic.claude-3-5-sonnet-20241022-v2:0` | Bedrock inference profile ID |
| `log_level` | `info` | Application log level |

## Lambda Environment Variables

### Webhook Lambda

| Variable | Set By | Description |
|---|---|---|
| `ORCHESTRATOR_FUNCTION_NAME` | Terraform | Name of orchestrator Lambda to async-invoke |
| `SECRETS_PREFIX` | Terraform | Secrets Manager prefix (`onedevops`) |
| `LOG_LEVEL` | Terraform | Log level |
| `NODE_OPTIONS` | Terraform | `--enable-source-maps` |

### Orchestrator Lambda

| Variable | Set By | Description |
|---|---|---|
| `TRACES_TABLE_NAME` | Terraform | DynamoDB table for ONEagent traces |
| `CODER_BASE_URL` | Terraform | Coder URL (empty = stub mode) |
| `CODER_ORG_ID` | Terraform | Coder org ID |
| `BEDROCK_MODEL_ID` | Terraform | Bedrock inference profile ID |
| `BEDROCK_REGION` | Terraform | Bedrock region |
| `SECRETS_PREFIX` | Terraform | Secrets Manager prefix |
| `LOG_LEVEL` | Terraform | Log level |
| `NODE_OPTIONS` | Terraform | `--enable-source-maps` |

## AWS Secrets Manager

All secrets are stored under the `onedevops/` prefix:

| Secret | Key | Description |
|---|---|---|
| `onedevops/slack/bot-token` | `token` | Slack bot OAuth token (`xoxb-...`) |
| `onedevops/slack/signing-secret` | `secret` | Slack app signing secret |
| `onedevops/github/token` | `token` | GitHub PAT with `repo` scope |
| `onedevops/coder/api-token` | `token` | Coder API session token |

Create secrets interactively:
```bash
./scripts/setup-secrets.sh
```

## AWS Resources Created

| Resource | Name |
|---|---|
| API Gateway | `onedevops-stage` |
| Lambda (webhook) | `onedevops-webhook-stage` |
| Lambda (orchestrator) | `onedevops-orchestrator-stage` |
| DynamoDB Table | `onedevops-traces-stage` |
| IAM Role (webhook) | `onedevops-webhook-stage` |
| IAM Role (orchestrator) | `onedevops-orchestrator-stage` |
| CloudWatch Log Groups | `/aws/lambda/onedevops-webhook-stage`, `/aws/lambda/onedevops-orchestrator-stage`, `/onedevops/traces-stage`, `/aws/apigateway/onedevops-stage` |
| S3 (Terraform state) | `onedevops-tfstate-381491959603` |
