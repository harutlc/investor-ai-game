# scripts/aws-deploy.sh reads these with `terraform output -json`.

output "public_ip" {
  description = "Elastic IP of the instance; point the domain's A record here if DNS is not in Route 53."
  value       = aws_eip.app.public_ip
}

output "instance_id" {
  description = "Target for `aws ssm start-session` and deploys."
  value       = aws_instance.app.id
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

output "ssm_prefix" {
  description = "Create the secret SecureString parameters under this path."
  value       = local.ssm_prefix
}

output "region" {
  value = var.region
}

output "domain" {
  value = var.domain
}

output "image_platform" {
  description = "Platform the images must be built for (matches the instance architecture)."
  value       = local.image_platform
}

output "dns_record_created" {
  value = var.route53_zone_id != null
}
