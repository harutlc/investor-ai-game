terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      project     = local.project
      environment = var.environment
    }
  }
}

locals {
  project = "investor-game"
  name    = "${local.project}-${var.environment}"
  # Secrets live here; Terraform only grants read access, it never writes values (see README).
  ssm_prefix = "/${local.project}/${var.environment}/"
}
