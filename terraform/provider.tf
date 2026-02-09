terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
  }

  backend "s3" {
    bucket  = "onedevops-tfstate-381491959603"
    key     = "onedevops/terraform.tfstate"
    region  = "us-east-1"
    profile = "onedevops"
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project     = "onedevops"
      Environment = var.stage
      ManagedBy   = "terraform"
    }
  }
}
