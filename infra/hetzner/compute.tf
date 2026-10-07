data "hcloud_server_type" "app" {
  name = var.server_type
}

locals {
  # The platform scripts/hetzner-deploy.sh builds images for.
  image_platform = data.hcloud_server_type.app.architecture == "arm" ? "linux/arm64" : "linux/amd64"
}

# Creating the server with keys means Hetzner never emails a root password. cloud-init gives the same keys to
# the `deploy` user and disables root login.
resource "hcloud_ssh_key" "operator" {
  count = length(var.ssh_public_keys)

  name       = "${local.name}-operator-${count.index}"
  public_key = var.ssh_public_keys[count.index]
  labels     = local.labels
}

# The server's only SSH host key. Operators verify the server from their first connection (the known_hosts
# output), and a replaced server keeps the same key. It sits in the encrypted state and the server's user data;
# cloud-init blocks containers from the metadata endpoint that serves the user data.
resource "tls_private_key" "host" {
  algorithm = "ED25519"
}

resource "hcloud_server" "app" {
  name         = local.name
  server_type  = var.server_type
  image        = "ubuntu-24.04"
  location     = var.location
  ssh_keys     = hcloud_ssh_key.operator[*].id
  firewall_ids = [hcloud_firewall.app.id]
  labels       = local.labels

  public_net {
    ipv4_enabled = true
    ipv4         = hcloud_primary_ip.ipv4.id
    ipv6_enabled = true
    ipv6         = hcloud_primary_ip.ipv6.id
  }

  user_data = templatefile("${path.module}/cloud-init.yaml", {
    ssh_user         = local.ssh_user
    ssh_public_keys  = var.ssh_public_keys
    host_key_private = tls_private_key.host.private_key_openssh
    host_key_public  = trimspace(tls_private_key.host.public_key_openssh)
    data_volume_id   = hcloud_volume.data.id
  })

  lifecycle {
    # A newer image, edited cloud-init or changed operator keys must not silently replace the running server
    # (Hetzner can only set them at creation). Use `terraform apply -replace=hcloud_server.app` to roll them
    # out; data stays on the separate volume and the IPs and host key are kept.
    ignore_changes = [image, user_data, ssh_keys]
  }
}
