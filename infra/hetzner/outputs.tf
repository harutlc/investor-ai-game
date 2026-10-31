# scripts/hetzner-deploy.sh reads these with `terraform output`.

output "public_ipv4" {
  description = "Primary IPv4 of the server (kept across server replacement); the deploy connects here."
  value       = hcloud_primary_ip.ipv4.ip_address
}

output "public_ipv6" {
  value = hcloud_server.app.ipv6_address
}

output "server_name" {
  value = hcloud_server.app.name
}

output "ssh_user" {
  description = "Operator login on the server (sudo, keys only)."
  value       = local.ssh_user
}

output "known_hosts" {
  description = "known_hosts line for the server's Terraform-generated host key."
  value = "${join(",", [
    hcloud_primary_ip.ipv4.ip_address,
    hcloud_server.app.ipv6_address,
    var.domain,
    var.api_domain,
  ])} ${trimspace(tls_private_key.host.public_key_openssh)}"
}

output "ecr_registry" {
  description = "Registry host the images are pushed to and pulled from."
  value       = split("/", aws_ecr_repository.image["api"].repository_url)[0]
}

output "ecr_api_url" {
  value = aws_ecr_repository.image["api"].repository_url
}

output "ecr_web_url" {
  value = aws_ecr_repository.image["web"].repository_url
}

output "image_namespace" {
  description = "ECR namespace of this stack's images (IMAGE_NAMESPACE in docker-compose.aws.yml)."
  value       = local.image_namespace
}

output "ssm_prefix" {
  description = "Create the secret SecureString parameters under this path."
  value       = local.ssm_prefix
}

output "aws_region" {
  value = var.aws_region
}

output "domain" {
  value = var.domain
}

output "api_domain" {
  value = var.api_domain
}

output "image_platform" {
  description = "Platform the images must be built for (matches the server architecture)."
  value       = local.image_platform
}

output "backup_bucket" {
  value = aws_s3_bucket.backup.bucket
}

output "backup_iam_user" {
  description = "Create its access key with `aws iam create-access-key` and store it in SSM (see README)."
  value       = aws_iam_user.backup.name
}
