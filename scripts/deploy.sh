#!/bin/bash
set -euo pipefail

# ONEdevops - Build and deploy (Terraform)
STAGE="${1:-stage}"
REGION="${AWS_REGION:-us-east-1}"
PROFILE="${AWS_PROFILE:-onedevops}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="$PROJECT_DIR/terraform"

echo "=== ONEdevops Deploy ==="
echo "Stage: $STAGE"
echo "Region: $REGION"
echo "Profile: $PROFILE"
echo ""

# Check prerequisites
command -v terraform >/dev/null 2>&1 || { echo "ERROR: Terraform not installed. Run: brew install terraform"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js not installed."; exit 1; }
aws sts get-caller-identity --profile "$PROFILE" >/dev/null 2>&1 || { echo "ERROR: AWS credentials not configured for profile $PROFILE."; exit 1; }

echo "1/5 Installing dependencies..."
cd "$PROJECT_DIR"
npm ci --silent

echo "2/5 Type checking..."
npx tsc --noEmit

echo "3/5 Building Lambda bundles..."
bash "$PROJECT_DIR/scripts/build.sh"

echo "4/5 Terraform init..."
cd "$TF_DIR"
terraform init -input=false

echo "5/5 Terraform apply..."
terraform apply \
  -var "stage=$STAGE" \
  -var "aws_region=$REGION" \
  -var "aws_profile=$PROFILE" \
  -auto-approve

echo ""
echo "=== Deploy Complete ==="
echo ""
terraform output
echo ""
echo "Next: Configure these URLs in your Slack App settings:"
echo "  Event Subscriptions -> Request URL: $(terraform output -raw webhook_url)"
echo "  Bot Token Scopes: app_mentions:read, chat:write"
echo "  Subscribe to bot events: app_mention"
