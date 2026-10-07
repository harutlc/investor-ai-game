# Tasks

## 1. Shared runtime config

- [x] 1.1 In `docker-compose.aws.yml`, change both image lines to `${ECR_REGISTRY:?}/${IMAGE_NAMESPACE:-investor-game}/<image>:${IMAGE_TAG:?}`, and update the header comment to say both the AWS and Hetzner stacks use the file. Verify: with a sample AWS `.env` (no `IMAGE_NAMESPACE`), `docker compose -f docker-compose.aws.yml config` prints the same image references as before the change. With `IMAGE_NAMESPACE=investor-game-hetzner`, it prints the Hetzner paths.

## 2. Terraform root scaffold

- [x] 2.1 Create `infra/hetzner/versions.tf`, `backend.tf` and `backend.tf.example`:
  - providers `hcloud`, pinned to the current `~> 1.x` minor; `aws ~> 6.0`, with `default_tags` plus `stack = "hetzner"`; `tls ~> 4.0`;
  - locals `project`, `name` and `ssm_prefix = "/investor-game/hetzner-<env>/"`;
  - an S3 backend at key `investor-game/hetzner-prod/terraform.tfstate`;
  - no `hcloud_token` variable.

  Verify: `terraform -chdir=infra/hetzner init` succeeds, and `.terraform.lock.hcl` is generated with hashes for `darwin_arm64`, `linux_amd64` and `linux_arm64` (`terraform providers lock -platform=...`).
- [x] 2.2 Create `infra/hetzner/variables.tf` with these variables:
  - `environment`, validated like the AWS one;
  - `location` (default `nbg1`);
  - `server_type` (default `cax11`);
  - `aws_region` (default `eu-central-1`);
  - `domain`, `api_domain`, `route53_zone_id` (all required);
  - `ssh_public_keys` (a non-empty list);
  - `ssh_allowed_cidrs` (non-empty; rejects `0.0.0.0/0` and `::/0`);
  - `data_volume_size_gb` (default 10, at least 10);
  - `backup_retention_days` (default 14, at least 7).

  Also create `terraform.tfvars.example`, with `investor-game-hz.<zone>` example domains and a comment showing `curl -4 https://ifconfig.me`. Verify: `terraform validate` passes, and `terraform plan` with `ssh_allowed_cidrs = ["0.0.0.0/0"]` fails with the validation message.
- [x] 2.3 Add `infra/hetzner/.terraform/` and `infra/hetzner/terraform.tfvars` to `.gitignore`. Verify: `git status` doesn't show them after `init`.

## 3. Hetzner network, server and storage

- [x] 3.1 `network.tf`:
  - an `hcloud_firewall` allowing in 80/tcp, 443/tcp and 443/udp from any v4/v6 address, ICMP, and 22/tcp only from `ssh_allowed_cidrs`;
  - two `hcloud_primary_ip` (ipv4 and ipv6) in `var.location`, with `auto_delete = false` and labels.

  Verify: `terraform plan` shows the rules exactly, and port 22 has no world source.
- [x] 3.2 `compute.tf`:
  - an `hcloud_ssh_key` per public key;
  - a `tls_private_key` (ed25519) for the host key;
  - the `hcloud_server_type` data source, and a local `image_platform` taken from its architecture;
  - `hcloud_server.app` (`ubuntu-24.04`, firewall, `public_net` with both Primary IPs, SSH keys, labels, `user_data` from `templatefile("cloud-init.yaml")`, `ignore_changes = [image, user_data]`).

  Verify: `terraform validate` passes, and a plan with `server_type = "cpx11"` gives `image_platform = linux/amd64`.
- [x] 3.3 `storage.tf`: an `hcloud_volume` (`delete_protection = true`, `prevent_destroy`, in the same location, unformatted) and an `hcloud_volume_attachment` with `automount = false`. Verify: `terraform plan -destroy` errors on the volume's `prevent_destroy`.
- [x] 3.4 `cloud-init.yaml`:
  - the `deploy` user with the keys and NOPASSWD sudo; `disable_root`; `ssh_pwauth: false`; an sshd drop-in (`PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `AllowUsers deploy`);
  - the host key through `ssh_keys`, with `ssh_deletekeys` and `ssh_genkeytypes: []`;
  - Docker CE and the compose plugin from Docker's apt repo, with the key fingerprint checked; `sqlite3`; the same `daemon.json` log rotation as AWS;
  - a systemd unit that adds the `DOCKER-USER` DROP rule for `169.254.169.254` after `docker.service`;
  - the bootstrap: wait for `/dev/disk/by-id/scsi-0HC_Volume_<id>`, format only a blank volume with the label `investor-data`, add an fstab entry by label at `/srv/investor`, and create `data/` (uid 1000), `caddy/`, `backups/`, `/opt/investor` (0700) and `/etc/investor` (0700);
  - `investor-backup.service` and `investor-backup.timer` (see 5.3).

  Verify: `cloud-init schema --config-file <rendered file>` passes on an Ubuntu 24.04 host or container.
- [x] 3.5 Document the Terraform layout and the Hetzner token setup in the README "Deploy to Hetzner" section. Cover:
  - the architecture diagram;
  - what is created where, Hetzner vs AWS;
  - prerequisites: a Hetzner project and a read/write API token exported as `HCLOUD_TOKEN`, an SSH key, your IP CIDR;
  - cost.

  Verify: the README commands match the variable and output names in `infra/hetzner`.

## 4. AWS-side resources

- [x] 4.1 `dns.tf`:
  - the `aws_route53_zone` data source;
  - `A` and `AAAA` records (TTL 300) for `domain` and `api_domain`, pointing at the Primary IPs, with no `allow_overwrite`;
  - preconditions: both domains are inside the zone, and they differ.

  Verify: a plan with a domain outside the zone fails the precondition. Applying with a domain the AWS stack already manages fails with "already exists" and leaves the AWS record unchanged.
- [x] 4.2 `ecr.tf`: the repositories `investor-game-hetzner/api` and `investor-game-hetzner/web`, with immutable tags, scan-on-push and the same lifecycle policy as `infra/aws/ecr.tf`. Verify: after apply, `aws ecr describe-repositories` lists both, and the AWS repositories are unchanged.
- [x] 4.3 `backup.tf`:
  - the bucket `investor-game-hetzner-<env>-backups-<account_id>`, with versioning, SSE-S3, Block Public Access, `BucketOwnerEnforced`, a policy that denies non-TLS requests, and lifecycle rules (expire current after `backup_retention_days`, noncurrent after 7 days, abort multipart after 1 day). The bucket has `prevent_destroy`;
  - an IAM user with an inline policy allowing only `s3:PutObject` on `<bucket>/daily/*`, and no access key resource.

  Verify: with a test key, `aws s3 cp` to `daily/` succeeds, while `aws s3 ls`, `aws s3 cp` from the bucket and `aws s3 rm` are all denied.
- [x] 4.4 `outputs.tf`: `public_ipv4`, `public_ipv6`, `server_name`, `ssh_user` (`deploy`), `known_hosts` (a line covering the IPv4, the IPv6 and both domains), `ecr_registry`, `ecr_api_url`, `ecr_web_url`, `image_namespace`, `ssm_prefix`, `aws_region`, `domain`, `api_domain`, `image_platform`, `backup_bucket` and `backup_iam_user`. Verify: `terraform output -json` after apply has every key non-empty.
- [x] 4.5 Add the README steps for first provisioning and secrets:
  - `init`/`apply`;
  - the `put-parameter` block for `COOKIE_SECRET`, `ANTHROPIC_API_KEY` and `TYPESAFE_API_KEY` under the Hetzner prefix;
  - `aws iam create-access-key` piped into `BACKUP_AWS_ACCESS_KEY_ID` and `BACKUP_AWS_SECRET_ACCESS_KEY` without the key touching disk;
  - the optional CSRF and Sentry parameters.

  Verify: following them from scratch creates every required parameter (`aws ssm get-parameters-by-path --path <prefix> --query 'Parameters[].Name'`).

## 5. Deploy script and backups

- [x] 5.1 Create `scripts/hetzner-deploy.sh` (executable). It mirrors `aws-deploy.sh`: usage, `--tag`, `--allow-dirty`, tool checks (including `ssh`), the dirty-tree rule, reading Terraform outputs from `infra/hetzner`, the required-parameter pre-check (including `BACKUP_*`), and an image build and push to the Hetzner ECR namespace with the CSRF and Sentry build args. Verify:
  - with a dirty tree and no flag, it exits non-zero before building;
  - `--tag nonexistent` exits non-zero naming the missing image;
  - with `COOKIE_SECRET` deleted, it exits naming the parameter, before any SSH command.
- [x] 5.2 Add the remote stage to `hetzner-deploy.sh`:
  - an SSH ControlMaster in a `mktemp -d`, with `BatchMode=yes`, `StrictHostKeyChecking=yes` and `UserKnownHostsFile` built from the `known_hosts` output, cleaned up in an `EXIT` trap;
  - upload the compose file and Caddyfile to `/opt/investor/next`;
  - stream the SSM JSON through the renderer into `next/.env` (app) and `next/backup.env` (`BACKUP_*`, bucket, region), with `umask 077` and nothing written on the operator's disk;
  - pipe the ECR token into `sudo docker login`, pull, and `docker logout` in a remote trap;
  - promote, `up -d --wait --wait-timeout 120 --remove-orphans`, print the api logs on failure, reload Caddy when its config changed, prune images, and install `backup.env` at `/etc/investor/backup.env` (0600);
  - poll public health and print the rollback tag, as in AWS.

  Verify:
  - a deploy on a clean checkout exits 0 with `/api/health` green;
  - `sudo cat /root/.docker/config.json` on the server shows no `auths` entry;
  - the api container's env (`docker compose exec api env`) has no `BACKUP_` variables.
- [x] 5.3 Backup units, in cloud-init (3.4):
  - `investor-backup.service`: `ConditionPathExists=/etc/investor/backup.env`; then `sqlite3 .backup` to `/srv/investor/backups/`, `PRAGMA integrity_check` = `ok`, gzip, upload with a pinned `amazon/aws-cli` image to `s3://<bucket>/daily/<UTC timestamp>.sqlite.gz`, and keep the last 3 local copies;
  - `investor-backup.timer`: daily at 03:00 UTC, `Persistent=true`, `RandomizedDelaySec=600`.

  Verify on the server: `sudo systemctl start investor-backup` succeeds, and the operator's `aws s3 ls s3://<bucket>/daily/` shows the new object. Downloading it and running `sqlite3 <file> '.tables'` lists the game's tables.
- [x] 5.4 In `hetzner-deploy.sh`, after the health check, warn when the newest `daily/` object is older than 26 hours, or when none exists and the server is more than a day old. Verify: with an empty bucket on an old server, the deploy still exits 0 and prints the warning.
- [x] 5.5 Add the README sections for redeploy, rollback, secret rotation (including rotating the backup key), operating (SSH as `deploy` with the known_hosts output, `docker compose ps`/`logs`, backup status), restoring from a backup (download, copy, stop api, replace the db and remove `-wal`/`-shm`, chown 1000, start), updating `ssh_allowed_cidrs`, replacing the server, the Hetzner console as break-glass access, and teardown (`state rm` the volume, `destroy`, then manual cleanup of the volume, bucket and parameters). Verify: each command runs as written against the deployed stack. The restore is checked in 6.3.

## 6. End-to-end verification

- [x] 6.1 Run a fresh provision and first deploy, following the README literally, then run `terraform plan` again. Verify: the first deploy succeeds, and the re-plan reports no changes.
- [x] 6.2 Check the spec's HTTPS and network scenarios against the live stack:
  - `https://<domain>/` loads and the `__Host-` cookie is set;
  - `http://` gives a 301 to `https://`;
  - `https://<api_domain>/games/abc` redirects to `<domain>`;
  - `curl -6 https://<domain>/api/health` works;
  - ports 3001 and 8080 time out;
  - port 22 times out from a non-allowed IP;
  - password login and `root` login are refused;
  - the first SSH connection prompts for nothing.
- [x] 6.3 Check the data scenarios:
  - start a game, redeploy with `--tag <current>`, and the game is still listed;
  - `terraform apply -replace=hcloud_server.app` followed by a deploy keeps the game, the IPs and the DNS records;
  - restoring an S3 backup per the README serves its data;
  - `terraform plan -destroy` is refused on the volume.
- [x] 6.4 Check rollback and isolation:
  - deploy a second commit, then `--tag <first>`, with no build and a healthy result;
  - after the Hetzner apply, `terraform -chdir=infra/aws plan` reports no changes;
  - `scripts/aws-deploy.sh --tag <current AWS tag>` still deploys and stays healthy.
- [x] 6.5 Check secrets: search the Terraform state (`terraform state pull`) and the server's user data (`curl http://169.254.169.254/hetzner/v1/userdata` on the host) for the values of `ANTHROPIC_API_KEY` and the backup secret key, and confirm neither is found. Run the same curl from inside the api container and confirm it fails.

## Workflow follow-up

- Run `openspec validate deploy-hetzner-cloud --strict` before archiving.
- Archive the change with `/opsx:archive` once the end-to-end checks pass, so `hetzner-deployment` lands in `openspec/specs/`.
