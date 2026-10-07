# One VPC with a single public subnet: no NAT gateway, no private subnets. Only Caddy's 80/443 are open.

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block                       = "10.42.0.0/16"
  assign_generated_ipv6_cidr_block = true
  enable_dns_support               = true
  enable_dns_hostnames             = true

  tags = { Name = local.name }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = local.name }
}

resource "aws_subnet" "public" {
  vpc_id                          = aws_vpc.main.id
  availability_zone               = data.aws_availability_zones.available.names[0]
  cidr_block                      = cidrsubnet(aws_vpc.main.cidr_block, 8, 0)
  ipv6_cidr_block                 = cidrsubnet(aws_vpc.main.ipv6_cidr_block, 8, 0)
  assign_ipv6_address_on_creation = true

  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  route {
    ipv6_cidr_block = "::/0"
    gateway_id      = aws_internet_gateway.main.id
  }

  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "app" {
  name        = "${local.name}-app"
  description = "HTTP/HTTPS to Caddy only; no SSH (Session Manager is used instead)"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name}-app" }
}

locals {
  # HTTP (ACME challenge + redirect) and HTTPS; HTTP/3 rides on 443/udp.
  public_ingress = {
    http-v4  = { port = 80, protocol = "tcp", cidr_ipv4 = "0.0.0.0/0", cidr_ipv6 = null }
    http-v6  = { port = 80, protocol = "tcp", cidr_ipv4 = null, cidr_ipv6 = "::/0" }
    https-v4 = { port = 443, protocol = "tcp", cidr_ipv4 = "0.0.0.0/0", cidr_ipv6 = null }
    https-v6 = { port = 443, protocol = "tcp", cidr_ipv4 = null, cidr_ipv6 = "::/0" }
    h3-v4    = { port = 443, protocol = "udp", cidr_ipv4 = "0.0.0.0/0", cidr_ipv6 = null }
    h3-v6    = { port = 443, protocol = "udp", cidr_ipv4 = null, cidr_ipv6 = "::/0" }
  }
}

resource "aws_vpc_security_group_ingress_rule" "public" {
  for_each = local.public_ingress

  security_group_id = aws_security_group.app.id
  description       = each.key
  ip_protocol       = each.value.protocol
  from_port         = each.value.port
  to_port           = each.value.port
  cidr_ipv4         = each.value.cidr_ipv4
  cidr_ipv6         = each.value.cidr_ipv6
}

resource "aws_vpc_security_group_egress_rule" "all_v4" {
  security_group_id = aws_security_group.app.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "all_v6" {
  security_group_id = aws_security_group.app.id
  ip_protocol       = "-1"
  cidr_ipv6         = "::/0"
}
