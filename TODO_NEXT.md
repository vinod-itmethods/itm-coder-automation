# Production Hardening Roadmap

Items to add when moving from demo to production.

## High Priority

- [ ] **SQS Queue + DLQ**: Replace async Lambda invoke with SQS for durability and retry. Add Dead Letter Queue for failed messages.
- [ ] **Approval Gate**: Add Slack interactive buttons (Approve/Reject) before provisioning. Manager approval flow.
- [ ] **Coder Integration**: Set `coder_base_url` variable once Coder is accessible. Test full workspace provisioning flow.
- [ ] **VPC for Orchestrator**: Attach orchestrator Lambda to VPC for Coder connectivity (if Coder is behind VPN).
- [ ] **Rate Limiting**: Add per-user rate limiting to prevent workspace spam.

## Medium Priority

- [ ] **CloudWatch Alarms**: Error rate alarm on orchestrator Lambda. Latency alarm on API Gateway.
- [ ] **Reserved Concurrency**: Limit orchestrator Lambda to prevent runaway provisioning.
- [ ] **Slack App Home Tab**: Build an app home with recent traces and workspace status.
- [ ] **Unit Tests**: Add vitest tests for Bedrock parser, Slack message builder, Coder client.
- [ ] **Integration Tests**: End-to-end test with SAM local or localstack.

## Lower Priority

- [ ] **Multi-Region**: Deploy to secondary region for resilience.
- [ ] **Cost Monitoring**: Add AWS Budget alerts for Bedrock usage.
- [ ] **Audit Trail**: Export DynamoDB traces to S3 for long-term storage.
- [ ] **Slack Slash Commands**: Add `/onedevops status <workspace>` and `/onedevops list` commands.
- [ ] **Template Auto-Discovery**: Sync Coder templates to a config file periodically.
- [ ] **GitHub Copilot**: Verify license activation in workspaces, add setup instructions.

## Done (Demo)

- [x] API Gateway HTTP API v2
- [x] Webhook Lambda (signature verification, async invoke)
- [x] Orchestrator Lambda (Bedrock + Coder + Slack + DynamoDB)
- [x] DynamoDB traces table with GSI and TTL
- [x] Secrets Manager integration (4 secrets)
- [x] Terraform deployment to account 381491959603
- [x] Health endpoint
- [x] Structured logging with secret scrubbing
- [x] ONEagent trace emitter
