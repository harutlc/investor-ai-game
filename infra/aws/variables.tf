variable "region" {
  description = "AWS region to deploy into."
  type        = string
}

variable "environment" {
  description = "Environment name; prefixes resource names and the SSM parameter path."
  type        = string
  default     = "prod"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.environment))
    error_message = "environment must be lowercase letters, digits and dashes."
  }
}

variable "domain" {
  description = "Public domain the game is served on (e.g. game.example.com). Caddy requests its certificate."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type. Graviton (t4g/m7g/...) builds linux/arm64 images, others linux/amd64."
  type        = string
  default     = "t4g.small"
}

variable "data_volume_size_gb" {
  description = "Size of the EBS volume holding the SQLite database and Caddy's certificates."
  type        = number
  default     = 10
}

variable "route53_zone_id" {
  description = "Optional Route 53 hosted zone ID. When set, an A record for var.domain is created."
  type        = string
  default     = null
}

variable "snapshot_retention_days" {
  description = "How many daily snapshots of the data volume to keep."
  type        = number
  default     = 7

  validation {
    condition     = var.snapshot_retention_days >= 7
    error_message = "Keep at least 7 daily snapshots."
  }
}
