# Hetzner Cloud Firewall: it filters before traffic reaches the server, so Docker's published-port iptables
# rules cannot open a hole. Only Caddy's 80/443 are public; SSH only from the operator CIDRs.

resource "hcloud_firewall" "app" {
  name   = "${local.name}-app"
  labels = local.labels

  # HTTP (ACME challenge + redirect) and HTTPS; HTTP/3 rides on 443/udp.
  rule {
    description = "http"
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }

  rule {
    description = "https"
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }

  rule {
    description = "http3"
    direction   = "in"
    protocol    = "udp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }

  # Path MTU discovery and ping.
  rule {
    description = "icmp"
    direction   = "in"
    protocol    = "icmp"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }

  rule {
    description = "ssh-operators"
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = var.ssh_allowed_cidrs
  }
}

# Primary IPs outlive the server (like the AWS Elastic IP): replacing the server keeps both addresses, so the
# DNS records never change. No delete_protection, so a deliberate `terraform destroy` can still remove them.
resource "hcloud_primary_ip" "ipv4" {
  name        = "${local.name}-ipv4"
  type        = "ipv4"
  location    = var.location
  auto_delete = false
  labels      = local.labels
}

resource "hcloud_primary_ip" "ipv6" {
  name        = "${local.name}-ipv6"
  type        = "ipv6"
  location    = var.location
  auto_delete = false
  labels      = local.labels
}
