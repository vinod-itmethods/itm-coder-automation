# ============================================================
# Lambda packages (pre-built via scripts/build.sh)
# ============================================================
data "archive_file" "webhook" {
  type        = "zip"
  source_dir  = "${path.module}/../dist/webhook"
  output_path = "${path.module}/../dist/webhook.zip"
}

data "archive_file" "orchestrator" {
  type        = "zip"
  source_dir  = "${path.module}/../dist/orchestrator"
  output_path = "${path.module}/../dist/orchestrator.zip"
}

# ============================================================
# Lambda: Webhook
# ============================================================
resource "aws_lambda_function" "webhook" {
  function_name    = "onedevops-webhook-${var.stage}"
  role             = aws_iam_role.webhook.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  memory_size      = 256
  timeout          = 10
  filename         = data.archive_file.webhook.output_path
  source_code_hash = data.archive_file.webhook.output_base64sha256

  environment {
    variables = {
      ORCHESTRATOR_FUNCTION_NAME = "onedevops-orchestrator-${var.stage}"
      SECRETS_PREFIX             = "onedevops"
      LOG_LEVEL                  = var.log_level
      NODE_OPTIONS               = "--enable-source-maps"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.webhook,
    aws_iam_role_policy_attachment.webhook_basic,
  ]
}

# ============================================================
# Lambda: Orchestrator
# ============================================================
resource "aws_lambda_function" "orchestrator" {
  function_name    = "onedevops-orchestrator-${var.stage}"
  role             = aws_iam_role.orchestrator.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  memory_size      = 512
  timeout          = 300
  filename         = data.archive_file.orchestrator.output_path
  source_code_hash = data.archive_file.orchestrator.output_base64sha256

  vpc_config {
    subnet_ids         = var.orchestrator_subnet_ids
    security_group_ids = [aws_security_group.orchestrator.id]
  }

  environment {
    variables = {
      TRACES_TABLE_NAME = aws_dynamodb_table.traces.name
      CODER_BASE_URL    = var.coder_base_url
      CODER_ORG_ID      = var.coder_org_id
      BEDROCK_MODEL_ID  = var.bedrock_model_id
      BEDROCK_REGION    = var.aws_region
      SECRETS_PREFIX    = "onedevops"
      LOG_LEVEL         = var.log_level
      NODE_OPTIONS      = "--enable-source-maps"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.orchestrator,
    aws_iam_role_policy_attachment.orchestrator_basic,
    aws_iam_role_policy_attachment.orchestrator_vpc,
  ]
}

# ============================================================
# Security Group: Orchestrator Lambda
# ============================================================
resource "aws_security_group" "orchestrator" {
  name        = "onedevops-orchestrator-${var.stage}"
  description = "Orchestrator Lambda - egress HTTPS only"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS to Coder, Bedrock, Slack, AWS APIs"
  }

  tags = {
    Name = "onedevops-orchestrator-${var.stage}"
  }
}
