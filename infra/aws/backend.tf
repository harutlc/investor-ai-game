# Remote state in S3 (versioned, SSE-encrypted). The bucket lives in eu-central-1, independent of the
# region the stack is deployed into (var.region). use_lockfile gives S3-native locking, no DynamoDB table.

terraform {
  backend "s3" {
    bucket       = "terraform-state-harut"
    key          = "investor-game/prod/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}
