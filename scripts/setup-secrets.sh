#!/bin/bash
set -euo pipefail

# ONEdevops - One-time secrets setup
# This script creates secrets in AWS Secrets Manager
# It prompts for each value interactively and NEVER logs them

PREFIX="onedevops"
REGION="${AWS_REGION:-us-east-1}"
PROFILE="${AWS_PROFILE:-onedevops}"

echo "=== ONEdevops Secrets Setup ==="
echo "Region: $REGION"
echo "Profile: $PROFILE"
echo "Prefix: $PREFIX"
echo ""

create_secret() {
  local name="$1"
  local description="$2"
  local key="$3"

  echo "---"
  echo "Secret: $PREFIX/$name"
  echo "Description: $description"
  read -s -p "Enter value: " value
  echo ""

  if [ -z "$value" ]; then
    echo "  SKIPPED (empty value)"
    return
  fi

  local json_value="{\"$key\": \"$value\"}"

  # Check if secret already exists
  if aws secretsmanager describe-secret --secret-id "$PREFIX/$name" --region "$REGION" --profile "$PROFILE" >/dev/null 2>&1; then
    echo "  Secret exists, updating..."
    aws secretsmanager put-secret-value \
      --secret-id "$PREFIX/$name" \
      --secret-string "$json_value" \
      --region "$REGION" \
      --profile "$PROFILE" \
      --no-cli-pager >/dev/null
  else
    echo "  Creating secret..."
    aws secretsmanager create-secret \
      --name "$PREFIX/$name" \
      --description "$description" \
      --secret-string "$json_value" \
      --region "$REGION" \
      --profile "$PROFILE" \
      --no-cli-pager >/dev/null
  fi

  echo "  Done."
}

create_secret "slack/bot-token" "Slack bot OAuth token (xoxb-...)" "token"
create_secret "slack/signing-secret" "Slack app signing secret" "secret"
create_secret "github/token" "GitHub personal access token (repo scope)" "token"
create_secret "coder/api-token" "Coder API session token" "token"

echo ""
echo "=== Jira Integration Secrets ==="
echo ""

create_jira_credentials() {
  local name="jira/credentials"
  echo "---"
  echo "Secret: $PREFIX/$name"
  echo "Description: Jira Cloud credentials (baseUrl, email, apiToken)"

  read -p "Jira base URL (e.g. https://yoursite.atlassian.net): " base_url
  read -p "Jira email: " email
  read -s -p "Jira API token: " api_token
  echo ""

  if [ -z "$base_url" ] || [ -z "$email" ] || [ -z "$api_token" ]; then
    echo "  SKIPPED (empty values)"
    return
  fi

  local json_value="{\"baseUrl\": \"$base_url\", \"email\": \"$email\", \"apiToken\": \"$api_token\"}"

  if aws secretsmanager describe-secret --secret-id "$PREFIX/$name" --region "$REGION" --profile "$PROFILE" >/dev/null 2>&1; then
    echo "  Secret exists, updating..."
    aws secretsmanager put-secret-value \
      --secret-id "$PREFIX/$name" \
      --secret-string "$json_value" \
      --region "$REGION" \
      --profile "$PROFILE" \
      --no-cli-pager >/dev/null
  else
    echo "  Creating secret..."
    aws secretsmanager create-secret \
      --name "$PREFIX/$name" \
      --description "Jira Cloud credentials" \
      --secret-string "$json_value" \
      --region "$REGION" \
      --profile "$PROFILE" \
      --no-cli-pager >/dev/null
  fi

  echo "  Done."
}

create_jira_credentials
create_secret "jira/webhook-secret" "Shared secret for Jira webhook verification" "secret"

echo ""
echo "=== All secrets configured ==="
echo "Verify: aws secretsmanager list-secrets --filter Key=name,Values=$PREFIX --region $REGION --profile $PROFILE --query 'SecretList[*].Name' --output table"
