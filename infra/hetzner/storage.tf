# The SQLite database, Caddy's certificates and local backup copies live on their own volume, so the server can
# be replaced without losing them. Hetzner cannot snapshot volumes: off-site backups go to S3 (backup.tf).

resource "hcloud_volume" "data" {
  name              = "${local.name}-data"
  size              = var.data_volume_size_gb
  location          = var.location
  delete_protection = true
  labels            = local.labels
  # No `format`: cloud-init formats a blank volume itself, with the label it mounts by.

  lifecycle {
    # Player data. For a deliberate teardown see README "Deploy to Hetzner" (state rm, then delete by hand).
    prevent_destroy = true
  }
}

resource "hcloud_volume_attachment" "data" {
  volume_id = hcloud_volume.data.id
  server_id = hcloud_server.app.id
  automount = false
}
