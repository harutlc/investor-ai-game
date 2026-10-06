# Only when the domain's zone is in Route 53. Otherwise point A records for both domains at the `public_ip` output.
# Both names resolve to the one instance; Caddy routes by host name.

resource "aws_route53_record" "app" {
  for_each = var.route53_zone_id == null ? toset([]) : toset([var.domain, var.api_domain])

  zone_id = var.route53_zone_id
  name    = each.value
  type    = "A"
  ttl     = 300
  records = [aws_eip.app.public_ip]
}
