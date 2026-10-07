# Design

## Context

See proposal.md for the motivation and specs/hetzner-deployment/spec.md for the requirements. The facts that shape the design:

- **The AWS stack is the template.** `infra/aws` runs one EC2 instance with Docker Compose (`docker-compose.aws.yml`). Caddy in front (`docker/Caddyfile`) serves two host names, and the client → Caddy → nginx → api chain runs with `TRUST_PROXY=2`. SQLite and Caddy's certificates sit on a separate volume mounted at `/srv/investor`. Secrets come from SSM under `/investor-game/prod/`, and images are in ECR, tagged with the git SHA. `scripts/aws-deploy.sh` builds, pushes and deploys through SSM Run Command, then polls `/api/health`.
- **What stays in AWS.** The Route 53 hosted zone (for example `utrakme.com`) and the Terraform state bucket `terraform-state-harut` (eu-central-1, versioned, S3 locking).
- **What Hetzner Cloud lacks compared with AWS:**
  - no instance IAM role, so a server cannot get short-lived AWS credentials;
  - no Session Manager, so access is SSH;
  - no managed container registry;
  - no volume snapshots: snapshots and backups cover only the server's own disk, never Volumes;
  - no secret store.
- **What Hetzner Cloud offers instead:**
  - an external Cloud Firewall that sits outside the host, so Docker's iptables rules cannot bypass it;
  - Primary IPs that outlive a server;
  - Volumes;
  - a free IPv6 /64;
  - ARM `cax*` servers. `cax11` has 2 vCPU, 4 GB of RAM and a 40 GB disk for about €4/month. It is arm64, the same architecture as the AWS `t4g.small`.
- **The runtime config already fits a generic Linux host.** `docker-compose.aws.yml` and `docker/Caddyfile` only assume an image registry, a `.env` file and `/srv/investor`. The one AWS-specific part is the image path `${ECR_REGISTRY}/investor-game/<image>`.

## Goals / Non-Goals

**Goals:**
- `terraform apply`, a handful of `aws ssm put-parameter` commands, and `scripts/hetzner-deploy.sh` take you from nothing to a healthy game at the Hetzner subdomains.
- The Hetzner stack can be created and destroyed without touching the AWS stack, and the other way round.
- Operators get the same workflow as on AWS: the same flags, the same health gate and the same rollback.
- No long-lived credential on the server can read or delete anything.

**Non-Goals:**
- Failover or traffic splitting between AWS and Hetzner (for example Route 53 health-checked failover). The two are separate deployments with separate data.
- Data sync between the two stacks.
- Hetzner Load Balancer, multiple servers, or Postgres/MySQL. SQLite with one API process, as on AWS.
- A VPN or bastion (Tailscale, WireGuard). Instead, SSH is limited to a list of CIDRs.
- Refactoring `scripts/aws-deploy.sh`. See decision 9.
- CI/CD.

## Decisions

### 1. A separate Terraform root `infra/hetzner/`, with providers `hcloud`, `aws` and `tls`
- **Why a separate root.** Separate state means separate blast radius. A broken Hetzner apply cannot plan changes against EC2. A separate root is also how the spec's "independent" requirement holds by construction.
- **Rejected: a module shared with `infra/aws`.** The two have almost nothing in common at the resource level.
- **Rejected: workspaces.** They would share providers that don't apply to both stacks.
- **State.** It goes in the same S3 bucket under `investor-game/hetzner-<env>/terraform.tfstate`. A committed `backend.tf` mirrors `infra/aws/backend.tf`, together with a `backend.tf.example`.
- **Versions.** `required_version >= 1.6`. Providers are `hetznercloud/hcloud` (pinned to the current `~> 1.x` minor at implementation), `hashicorp/aws ~> 6.0` (the same as `infra/aws`) and `hashicorp/tls ~> 4.0`. The lock file is committed.
- **Credentials.**
  - **Hetzner:** `HCLOUD_TOKEN` comes from the environment, and no `hcloud_token` variable exists. That way the token can never end up in a tfvars file.
  - **AWS:** the normal AWS CLI credential chain.
- **Naming and labels.** `local.name = "investor-game-hetzner-${var.environment}"`, and every Hetzner resource gets the labels `project` and `environment`. The AWS `default_tags` are the same as in `infra/aws`, plus `stack = "hetzner"`.
- **Files:** `versions.tf`, `backend.tf`, `variables.tf`, `network.tf` (firewall and primary IPs), `compute.tf` (server, SSH keys, host key), `storage.tf` (volume), `dns.tf`, `ecr.tf`, `backup.tf` (S3 and IAM), `outputs.tf`, `cloud-init.yaml` and `terraform.tfvars.example`. This mirrors `infra/aws`.

### 2. Server: `cax11` (ARM) in `nbg1`, Ubuntu 24.04, Docker from Docker's apt repository
- **Size.** 4 GB of RAM is twice the AWS instance's, for a third of the price.
- **Architecture.** It is arm64, so the images build natively on Apple Silicon, as for AWS. `image_platform` comes from the server type's `architecture` (via the `hcloud_server_type` data source). Switching to an x86 type such as `cpx11`, if ARM capacity runs out in a location, works without other changes.
- **Location.** The default is `nbg1`. `fsn1` and `hel1` also offer CAX. All three are in the EU, close to the AWS region `eu-central-1` that holds the backups.
- **Image.** `ubuntu-24.04`. cloud-init installs `docker-ce` and `docker-compose-plugin` from `download.docker.com`, and checks the repository key against Docker's published fingerprint. It also installs `sqlite3`, and leaves Ubuntu's `unattended-upgrades` (security updates) on.
- **Rejected: the Hetzner "Docker CE" app image.** Its contents and update schedule are less transparent.
- **Rejected: Debian.** It would work equally well, but Ubuntu 24.04 is the best-documented hcloud image.
- **Lifecycle.**
  - `ignore_changes = [image, user_data]`, as on AWS. A newer image or an edited cloud-init is rolled out with `terraform apply -replace=hcloud_server.app`.
  - Server `delete_protection` stays off, because it would block `-replace`. The volume carries the protection instead.
- **Host failures.** Hetzner restarts servers on healthy hardware itself, so nothing replaces the AWS auto-recover alarm.

### 3. Network: the Cloud Firewall, and Primary IPs that outlive the server
- **Firewall.** An `hcloud_firewall` allows inbound 80/tcp, 443/tcp and 443/udp from `0.0.0.0/0` and `::/0`, ICMP for path MTU, and 22/tcp only from `var.ssh_allowed_cidrs`. Everything else is dropped.
  - Validation rejects an empty list, `0.0.0.0/0` and `::/0`.
  - **Why the Cloud Firewall and not ufw.** It filters before the host, so Docker's published-port iptables rules cannot open a hole. ufw on the host cannot promise that.
- **Primary IPs.** One `hcloud_primary_ip` for IPv4 and one for IPv6, both with `auto_delete = false`, so replacing the server never releases them. `delete_protection` stays off, so a deliberate `terraform destroy` can still remove them. They are assigned to the server through `public_net`, and play the role of the AWS Elastic IP: replacing the server keeps both addresses, so the DNS records never change.
- **No private network.** There is one server, and the API is never exposed.

### 4. SSH-only operator access, with a host key generated by Terraform
- **Operator keys.** Each entry in `var.ssh_public_keys` becomes an `hcloud_ssh_key`, and the server is created with them. Hetzner then emails no root password.
- **The `deploy` user.** cloud-init creates `deploy` with these keys and `NOPASSWD` sudo, sets `disable_root: true` and `ssh_pwauth: false`, and drops in an sshd config: `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `AllowUsers deploy`.
- **Host key.** A `tls_private_key` (ed25519) becomes the server's only SSH host key, through cloud-init `ssh_keys` with `ssh_deletekeys: true` and `ssh_genkeytypes: []`. Terraform outputs a `known_hosts` line covering the IPv4, the IPv6 and both domains, and the deploy script connects with `StrictHostKeyChecking=yes` against a temp file built from that output.
- **Why a generated host key.**
  - Without it, the first connection must be trust-on-first-use, an unverified prompt.
  - Every server replacement would also trigger a "host key changed" warning, which teaches operators to ignore it.
- **Trade-off.** The host private key sits in the encrypted S3 state and in the server's user data. That is the cost of the decision above, and it is acceptable. This key is not an application secret: anyone holding it could only impersonate the server to an operator. The spec's "secrets absent from state" rule covers application secrets.
- **Metadata hardening.** User data can be read from the server's metadata endpoint `169.254.169.254`. cloud-init adds a `DOCKER-USER` iptables rule, re-applied by a small systemd unit after `docker.service`, that drops container traffic to that address. A compromised container then cannot read the host key or the server's metadata.
- **Rejected: fail2ban.** The firewall CIDR allow-list already keeps scanners off port 22.
- **Break-glass access.** The Hetzner web console stays available (documented in the README).

### 5. Data on a separate Volume, with the same layout as AWS
- **Volume.** An `hcloud_volume` (10 GB by default, the Hetzner minimum) in the server's location, with `delete_protection = true` and `lifecycle { prevent_destroy = true }`. It is attached with `hcloud_volume_attachment` and `automount = false`.
- **Formatting and mounting.** The cloud-init bootstrap waits for `/dev/disk/by-id/scsi-0HC_Volume_<id>`. It formats the volume as ext4 with the label `investor-data` only if the volume is blank, and mounts it by label at `/srv/investor` with `nofail,noatime`. It creates `data/`, owned by uid 1000, and `caddy/`. This is the AWS bootstrap with a different device path, so the Compose file's bind mounts work unchanged.
- **Rejected: keeping data on the server disk and relying on Hetzner server backups.** Replacing the server would lose the data, and the backups are taken while SQLite is running, without its online backup API.

### 6. Off-site backups to S3: SQLite's online backup API, uploaded by a put-only IAM user
Hetzner cannot snapshot Volumes, so backups are taken at the application level and sent to AWS, where the operator already has an account.

- **Bucket.** An `aws_s3_bucket` named `investor-game-hetzner-<env>-backups-<account_id>` (globally unique). It has:
  - versioning;
  - SSE-S3;
  - Block Public Access;
  - `BucketOwnerEnforced`;
  - a bucket policy that denies non-TLS requests;
  - lifecycle rules that expire current objects after `var.backup_retention_days` (default 14, at least 7), expire noncurrent versions after 7 days, and abort incomplete multipart uploads after 1 day;
  - `prevent_destroy`, so backups survive a stack teardown, matching the AWS requirement that snapshots survive.
- **Uploader.** An `aws_iam_user` (`investor-game-hetzner-<env>-backup`) whose only permission is `s3:PutObject` on `arn:…:<bucket>/daily/*`.
  - Terraform does not create its access key, so the key never enters state. The operator runs `aws iam create-access-key` once and pipes the result into SSM as `BACKUP_AWS_ACCESS_KEY_ID` and `BACKUP_AWS_SECRET_ACCESS_KEY` under the Hetzner prefix. The README gives one copy-paste block.
  - Object keys include a timestamp, so nothing is overwritten. Even if versioning were off, a stolen key could only add objects, never read, list or delete them.
- **On the server.** The `investor-backup.timer` systemd timer runs daily at 03:00 UTC with `Persistent=true` and a randomized delay of up to 10 minutes. It starts `investor-backup.service`, which:
  1. runs `sqlite3 /srv/investor/data/game.sqlite ".backup /srv/investor/backups/game.sqlite"`, the online backup API, which is consistent with WAL and doesn't stop the API;
  2. runs `PRAGMA integrity_check` on the copy and fails unless it returns `ok`;
  3. gzips the copy;
  4. uploads it with a pinned `amazon/aws-cli` container to `s3://<bucket>/daily/<UTC timestamp>.sqlite.gz`, with `--env-file /etc/investor/backup.env` (mode 0600, root);
  5. keeps the last 3 copies locally for a quick restore.

  The unit is installed by cloud-init. The deploy writes `backup.env`, holding the keys, the bucket and the region. Until a deploy has written it, the unit is skipped with `ConditionPathExists`.
- **Visibility.**
  - The operator's credentials can list the bucket. The deploy script warns when the newest object under `daily/` is older than 26 hours, or when there is none after the first day. Silent backup failures therefore show up at the next deploy.
  - `systemctl status investor-backup` and `journalctl` show details on the server.
- **Rejected: AWS IAM Roles Anywhere.** It would give short-lived credentials, but it needs a private CA and certificate rotation on the server. That is too much for one server, given the key can't read anything.
- **Rejected: Hetzner Object Storage.** Its credentials can't be scoped to put-only, the hcloud Terraform provider can't manage it, and it would add a second place to look for backups.
- **Rejected: a Hetzner Storage Box.** It needs SSH or SMB credentials with full access, and has the same scoping problem.

### 7. Images: the Hetzner stack's own ECR repositories, pulled with a short-lived token over SSH
- **Repositories.** `investor-game-hetzner/api` and `investor-game-hetzner/web`, in `var.aws_region`. They have the same immutable tags, scan-on-push and lifecycle policy (last 20 tags, untagged after 1 day) as `infra/aws/ecr.tf`.
- **Why not share the AWS repositories.** Sharing would make the Hetzner stack depend on the AWS stack's resources, against the spec. It would also break if the two stacks ever used different CPU architectures, because tags are immutable. Pushing twice costs a minute and a few cents.
- **Pulling.** The server has no AWS identity. On each deploy the operator's machine runs `aws ecr get-login-password`, pipes it over SSH into `sudo docker login --password-stdin <registry>`, pulls, then `docker logout`. The logout runs in a remote `trap`, so it happens even when the pull fails. The token is valid for 12 hours at most and is removed right away.
- **Rejected: a long-lived ECR pull key on the server.**
- **Rejected: GHCR with a PAT.** It is a new dependency and a long-lived token.
- **Rejected: `docker save | ssh docker load`.** It leaves no registry for rollback and no scanning.
- **Egress.** ECR to internet egress is about $0.09/GB, and a deploy pulls about 150 MB, so the cost is negligible.

### 8. Secrets: SSM under `/investor-game/hetzner-<env>/`, read on the operator's machine and streamed over SSH
- **Same model as AWS.** The parameter names and the required set are the same as AWS: `COOKIE_SECRET`, `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY`, and `CSRF_SECRET` when `CSRF_ENABLED=true`. The optional `SENTRY_DSN` and `SENTRY_WEB_DSN` work the same way. On top of those, `BACKUP_AWS_ACCESS_KEY_ID` and `BACKUP_AWS_SECRET_ACCESS_KEY` are required. Terraform never writes or reads values, and it doesn't need any SSM resources, because the server has no AWS identity.
- **Where the difference is.** On AWS, the instance fetches its own secrets. Here the deploy script runs `aws ssm get-parameters-by-path --with-decryption` and pipes the JSON straight into the existing Python renderer, with the same quoting rules and the same missing-parameter check. The output goes over SSH into `sudo sh -c 'umask 077; cat > /opt/investor/next/.env'`.
  - Values exist only in process memory and pipes on the operator's machine. They are never written to its disk, and never echoed.
  - The renderer splits the parameters into two files. `BACKUP_*` go to `next/backup.env`, which is promoted to `/etc/investor/backup.env`. Everything else goes to the app's `.env`. The API container therefore never receives the backup key.
- **Trade-off.** The operator's IAM identity needs `ssm:GetParametersByPath` with decryption on the Hetzner prefix. On AWS, only the instance role needed that. Operators who run deploys already have it in practice.

### 9. Deploy script: a new `scripts/hetzner-deploy.sh`, with SSH multiplexing
- **Flags.** The same as `aws-deploy.sh`: `--tag`, `--allow-dirty` and `-h`. The same dirty-tree rule and dirty-tag format apply, as do the CSRF and Sentry build arguments and the health gate. The final message prints the rollback tag.
- **Transport.** One SSH ControlMaster connection (`ControlPath` in a `mktemp -d`, `ControlPersist=60`, closed in an `EXIT` trap) carries a few short commands:
  1. stage `docker-compose.aws.yml` and the Caddyfile;
  2. stream the rendered env files;
  3. pipe the ECR token in and pull;
  4. run the promote, `up --wait` and Caddy reload logic. This is copied from the AWS remote script, so a failed pull or a missing parameter still leaves the running stack untouched.
- **SSH options.** `BatchMode=yes`, `StrictHostKeyChecking=yes`, `UserKnownHostsFile=<from terraform output>`. It connects to the IPv4 output as `deploy`.
- **Why not refactor shared logic out of `aws-deploy.sh`.** The AWS script is in production and has no tests. A refactor would change its behavior surface for no gain to AWS. About 120 lines of bash are duplicated on purpose. Extracting a `scripts/lib/deploy-common.sh` is a sensible follow-up once both scripts have been exercised. The README points out that the two scripts share their structure.

### 10. Reuse `docker-compose.aws.yml` and `docker/Caddyfile` with one new variable
- **The change.** The image lines become `${ECR_REGISTRY:?}/${IMAGE_NAMESPACE:-investor-game}/<image>:${IMAGE_TAG:?}`. The AWS deploy doesn't set `IMAGE_NAMESPACE`, so its rendered config is byte-for-byte the same. The Hetzner deploy writes `IMAGE_NAMESPACE='investor-game-hetzner'`.
- **The header comment.** It changes to say the file serves both server stacks.
- **No rename.** The file keeps its name, so `aws-deploy.sh` needs no change. Renaming it to something neutral, such as `docker-compose.server.yml`, can come with the follow-up refactor.
- **Why one file.** Every production setting (`TRUST_PROXY=2`, CORS, the providers, healthchecks, timeouts) then stays defined in one place. A fix for one stack reaches the other on its next deploy.

### 11. DNS: Route 53 records in the existing zone, required
- **Records.** `var.route53_zone_id` is required, because the user's zone is in Route 53. For each of `var.domain` and `var.api_domain`, the stack creates an `A` and an `AAAA` record (TTL 300) pointing at the Primary IPs.
- **Preconditions.**
  - Each domain must end with the zone's name (read with the `aws_route53_zone` data source).
  - The two domains must differ.
- **Clash protection.** `allow_overwrite` stays false, so if someone enters a domain the AWS stack already manages, the apply fails ("record already exists") and never takes over the AWS records.
- **Example names.** `investor-game-hz.<zone>` and `investor-game-api-hz.<zone>`, used in `terraform.tfvars.example`.

## Risks / Trade-offs

- **The operator's IP changes and SSH is cut off** → Run `terraform apply` with the new CIDR; it updates the firewall in place, without replacing the server. The README shows `curl -4 https://ifconfig.me`. The Hetzner console is the break-glass path. The game keeps serving either way.
- **No ARM capacity in the chosen location** → `server_type` and `location` are variables. The platform follows the server type, so `cpx11` (x86) works with an emulated build.
- **The backup key is long-lived** → It is put-only on a single prefix and bucket versioning is on. It is delivered only on deploy, root-only, and never reaches containers. The README documents rotation: create a new key, update SSM, deploy, delete the old key.
- **Backups fail silently** → The deploy script warns about stale backups, and the systemd journal has the details. A full alerting setup is out of scope.
- **Up to 24 h of data loss** (backup RPO) → The same order as the AWS daily snapshots. It is acceptable for a game.
- **The host key is in state and user data** → The state is in encrypted S3 behind IAM. Containers can't reach the metadata endpoint. Rotating the key means `-replace` on the `tls_private_key` and the server.
- **Shared Compose file: an AWS-only change could break Hetzner** → Both stacks run the same production topology on purpose. Breakage shows on the next Hetzner deploy, which fails its health gate and keeps the previous version.
- **Let's Encrypt rate limits** → Certificates live on the Volume, so a server replacement reuses them. The domains are separate from the AWS ones, so they have their own limits.
- **Two deployments drift in version** → Expected, since they are independent. Each deploy prints its tag.

## Migration Plan

1. Merge. The AWS stack is unaffected: `IMAGE_NAMESPACE` defaults to the current path. Optionally, confirm with an AWS deploy of the current tag.
2. Create a Hetzner Cloud project and an API token with read/write access. Export `HCLOUD_TOKEN`.
3. Copy `infra/hetzner/terraform.tfvars.example` to `terraform.tfvars` and set the zone ID, the domains, the SSH public key and your IP's CIDR. Then run `terraform -chdir=infra/hetzner init && terraform -chdir=infra/hetzner apply`.
4. Create the SSM parameters under the `ssm_prefix` output, including the backup access key from `aws iam create-access-key`.
5. Run `scripts/hetzner-deploy.sh`, then check the spec scenarios: HTTPS, the redirects, closed ports, SSH refusals, and the first backup after 03:00 UTC, or start the backup service by hand.

**Rollback.** Run `scripts/hetzner-deploy.sh --tag <previous>` for a version. To remove the stack, follow the README teardown: `state rm` the volume, `destroy`, then delete the volume, bucket and parameters by hand if they are no longer wanted. Destroying the stack never touches AWS DNS records other than its own.
