terraform {
  required_version = ">= 1.6"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.70"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

# Reads HCLOUD_TOKEN from the environment. There is deliberately no token variable, so the token can never
# end up in a tfvars file.
provider "hcloud" {}

# DNS (Route 53), image registries (ECR), backups (S3) and secrets (SSM) stay in AWS.
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      project     = local.project
      environment = var.environment
      stack       = "hetzner"
    }
  }
}

locals {
  project = "investor-game"
  name    = "${local.project}-hetzner-${var.environment}"
  labels = {
    project     = local.project
    environment = var.environment
  }
  # Secrets live here; Terraform never writes or reads values (see README "Deploy to Hetzner").
  ssm_prefix = "/${local.project}/hetzner-${var.environment}/"
  # ECR namespace of this stack's images; the deploy passes it to docker-compose.aws.yml as IMAGE_NAMESPACE.
  image_namespace = "${local.project}-hetzner"
  ssh_user        = "deploy"
}
