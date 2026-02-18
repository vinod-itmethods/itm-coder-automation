# ============================================================
# API Gateway (HTTP API v2)
# ============================================================
resource "aws_apigatewayv2_api" "onedevops" {
  name          = "onedevops-${var.stage}"
  protocol_type = "HTTP"
  description   = "ONEdevops Slack webhook endpoint"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["POST", "GET"]
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.onedevops.id
  name        = var.stage
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
    })
  }
}

# Routes
resource "aws_apigatewayv2_integration" "webhook" {
  api_id                 = aws_apigatewayv2_api.onedevops.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.webhook.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "slack_events" {
  api_id    = aws_apigatewayv2_api.onedevops.id
  route_key = "POST /slack/events"
  target    = "integrations/${aws_apigatewayv2_integration.webhook.id}"
}

resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.onedevops.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.webhook.id}"
}

# Jira webhook integration
resource "aws_apigatewayv2_integration" "jira_webhook" {
  api_id                 = aws_apigatewayv2_api.onedevops.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.jira_webhook.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "jira_events" {
  api_id    = aws_apigatewayv2_api.onedevops.id
  route_key = "POST /jira/events"
  target    = "integrations/${aws_apigatewayv2_integration.jira_webhook.id}"
}

resource "aws_apigatewayv2_route" "jira_events_get" {
  api_id    = aws_apigatewayv2_api.onedevops.id
  route_key = "GET /jira/events"
  target    = "integrations/${aws_apigatewayv2_integration.jira_webhook.id}"
}

# Permission for API GW to invoke webhook Lambda
resource "aws_lambda_permission" "apigw_webhook" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.webhook.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.onedevops.execution_arn}/*/*"
}

# Permission for API GW to invoke Jira webhook Lambda
resource "aws_lambda_permission" "apigw_jira_webhook" {
  statement_id  = "AllowAPIGatewayInvokeJira"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.jira_webhook.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.onedevops.execution_arn}/*/*"
}

# ============================================================
# DynamoDB: Traces Table
# ============================================================
resource "aws_dynamodb_table" "traces" {
  name         = "onedevops-traces-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "traceId"
  range_key    = "eventKey"

  attribute {
    name = "traceId"
    type = "S"
  }

  attribute {
    name = "eventKey"
    type = "S"
  }

  attribute {
    name = "slackUserId"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "S"
  }

  global_secondary_index {
    name            = "by-user"
    hash_key        = "slackUserId"
    range_key       = "timestamp"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

# ============================================================
# CloudWatch Log Groups
# ============================================================
resource "aws_cloudwatch_log_group" "webhook" {
  name              = "/aws/lambda/onedevops-webhook-${var.stage}"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "orchestrator" {
  name              = "/aws/lambda/onedevops-orchestrator-${var.stage}"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "traces" {
  name              = "/onedevops/traces-${var.stage}"
  retention_in_days = 90
}

resource "aws_cloudwatch_log_group" "jira_webhook" {
  name              = "/aws/lambda/onedevops-jira-webhook-${var.stage}"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/onedevops-${var.stage}"
  retention_in_days = 30
}
