output "webhook_url" {
  description = "Slack Event Subscriptions URL"
  value       = "${aws_apigatewayv2_api.onedevops.api_endpoint}/${var.stage}/slack/events"
}

output "health_url" {
  description = "Health check endpoint"
  value       = "${aws_apigatewayv2_api.onedevops.api_endpoint}/${var.stage}/health"
}

output "traces_table_name" {
  description = "DynamoDB traces table"
  value       = aws_dynamodb_table.traces.name
}

output "webhook_function_arn" {
  description = "Webhook Lambda ARN"
  value       = aws_lambda_function.webhook.arn
}

output "orchestrator_function_arn" {
  description = "Orchestrator Lambda ARN"
  value       = aws_lambda_function.orchestrator.arn
}

output "api_gateway_id" {
  description = "API Gateway ID"
  value       = aws_apigatewayv2_api.onedevops.id
}
