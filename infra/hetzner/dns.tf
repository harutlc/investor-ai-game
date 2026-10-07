# A and AAAA records for both Hetzner domains in the existing Route 53 zone. Both names resolve to the one
# server; Caddy routes by host name. allow_overwrite stays false: a name the AWS stack already manages makes the
# apply fail instead of taking over its record.

data "aws_route53_zone" "main" {
  zone_id = var.route53_zone_id
}

locals {
  dns_records = {
    for pair in setproduct(["domain", "api_domain"], ["A", "AAAA"]) :
    "${pair[0]}-${pair[1]}" => {
      name    = pair[0] == "domain" ? var.domain : var.api_domain
      type    = pair[1]
      address = pair[1] == "A" ? hcloud_primary_ip.ipv4.ip_address : hcloud_server.app.ipv6_address
    }
  }
}

resource "aws_route53_record" "app" {
  for_each = local.dns_records

  zone_id = var.route53_zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 300
  records = [each.value.address]

  lifecycle {
    precondition {
      condition     = endswith(var.domain, ".${trimsuffix(data.aws_route53_zone.main.name, ".")}") && endswith(var.api_domain, ".${trimsuffix(data.aws_route53_zone.main.name, ".")}")
      error_message = "domain and api_domain must both be subdomains of the Route 53 zone ${data.aws_route53_zone.main.name}."
    }
    precondition {
      condition     = lower(var.domain) != lower(var.api_domain)
      error_message = "domain and api_domain must differ."
    }
  }
}
