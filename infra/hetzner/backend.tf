# Remote state in the same S3 bucket as infra/aws, under its own key (versioned, SSE-encrypted, S3-native
# locking). The two stacks never share state.

terraform {
  backend "s3" {
    bucket       = "terraform-state-harut"
    key          = "investor-game/hetzner-prod/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}
