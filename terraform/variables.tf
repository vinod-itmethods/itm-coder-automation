variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS CLI profile to use"
  type        = string
  default     = "onedevops"
}

variable "account_id" {
  description = "Target AWS account ID"
  type        = string
  default     = "381491959603"
}

variable "stage" {
  description = "Deployment stage"
  type        = string
  default     = "stage"
}

variable "coder_base_url" {
  description = "Coder instance URL (leave empty to stub)"
  type        = string
  default     = ""
}

variable "coder_org_id" {
  description = "Coder organization ID"
  type        = string
  default     = "default"
}

variable "bedrock_model_id" {
  description = "Bedrock inference profile ID"
  type        = string
  default     = "us.anthropic.claude-3-5-sonnet-20241022-v2:0"
}

variable "log_level" {
  description = "Application log level"
  type        = string
  default     = "info"
}
