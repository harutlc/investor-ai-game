variable "environment" {
  description = "Environment name; prefixes resource names and the SSM parameter path (/investor-game/hetzner-<environment>/)."
  type        = string
  default     = "prod"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.environment))
    error_message = "environment must be lowercase letters, digits and dashes."
  }
}

variable "location" {
  description = "Hetzner Cloud location. nbg1, fsn1 and hel1 offer the ARM (cax) server types."
  type        = string
  default     = "nbg1"
}

variable "server_type" {
  description = "Hetzner Cloud server type. ARM types (cax*) build linux/arm64 images, others (cpx*, cx*) linux/amd64."
  type        = string
  default     = "cax11"
}

variable "aws_region" {
  description = "AWS region for the ECR repositories, the backup bucket and the SSM parameters."
  type        = string
  default     = "eu-central-1"
}

variable "domain" {
  description = "Public domain the Hetzner deployment serves the UI on (e.g. investor-game-hz.example.com). Must differ from the AWS stack's."
  type        = string
}

variable "api_domain" {
  description = "Public domain that serves only the API (e.g. investor-game-api-hz.example.com). Must differ from the AWS stack's."
  type        = string
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone that contains both domains. A and AAAA records are created in it."
  type        = string
}

variable "ssh_public_keys" {
  description = "Operator SSH public keys (OpenSSH format) for the `deploy` user."
  type        = list(string)

  validation {
    condition     = length(var.ssh_public_keys) > 0
    error_message = "Provide at least one SSH public key."
  }
}

variable "ssh_allowed_cidrs" {
  description = "Source CIDRs allowed to reach SSH (port 22), e.g. [\"203.0.113.7/32\"]. Open to the world is refused."
  type        = list(string)

  validation {
    condition     = length(var.ssh_allowed_cidrs) > 0
    error_message = "Provide at least one CIDR for SSH access (your IP: curl -4 https://ifconfig.me, then append /32)."
  }

  validation {
    condition     = !anytrue([for c in var.ssh_allowed_cidrs : contains(["0.0.0.0/0", "::/0"], c)])
    error_message = "ssh_allowed_cidrs must not contain 0.0.0.0/0 or ::/0; list operator addresses only."
  }

  validation {
    condition     = alltrue([for c in var.ssh_allowed_cidrs : can(cidrhost(c, 0))])
    error_message = "Every entry of ssh_allowed_cidrs must be a CIDR, e.g. 203.0.113.7/32."
  }
}

variable "data_volume_size_gb" {
  description = "Size of the Hetzner Volume holding the SQLite database, Caddy's certificates and local backup copies."
  type        = number
  default     = 10

  validation {
    condition     = var.data_volume_size_gb >= 10
    error_message = "Hetzner Volumes are at least 10 GB."
  }
}

variable "backup_retention_days" {
  description = "How many days daily database backups are kept in S3."
  type        = number
  default     = 14

  validation {
    condition     = var.backup_retention_days >= 7
    error_message = "Keep at least 7 days of backups."
  }
}
