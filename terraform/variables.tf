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
  default     = "https://labcoder.stage.0658b-techopscore.com"
}

variable "coder_org_id" {
  description = "Coder organization ID"
  type        = string
  default     = "default"
}

variable "bedrock_model_id" {
  description = "Bedrock model ID"
  type        = string
  default     = "amazon.nova-lite-v1:0"
}

variable "log_level" {
  description = "Application log level"
  type        = string
  default     = "info"
}

variable "vpc_id" {
  description = "VPC ID for orchestrator Lambda"
  type        = string
  default     = "vpc-09571c6702a8b8547"
}

variable "orchestrator_subnet_ids" {
  description = "Private subnet IDs for orchestrator Lambda (must have NAT Gateway)"
  type        = list(string)
  default     = ["subnet-0b5d0835fbac176c1", "subnet-05cb8969b8ec58541"]
}
