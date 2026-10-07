## Context

See proposal.md for the motivation. The facts that shape the design:

- **Stack shape.** The `Dockerfile` builds two images: an `api` image (Express, port 3001, runs as non-root `node`, uid 1000) and a `web` image (nginx-unprivileged on port 8080). nginx proxies `/api/` to `http://api:3001`, using Docker's embedded DNS at `127.0.0.11`. It appends `$proxy_add_x_forwarded_for` and allows 180 s reads.
- **Single process by design.** The API stores data in SQLite through `better-sqlite3` (`DATABASE_FILE`), applies migrations on startup, and keeps rate limits in memory. So exactly one API process may run.
- **Production rules the API already enforces.** With `NODE_ENV=production`, the API refuses fake providers and requires `COOKIE_SECRET`. It also issues a `Secure` cookie with the `__Host-` prefix, so plain HTTP cannot work in AWS.
- **Compose overrides.** `docker-compose.yml` hard-codes `CORS_ORIGINS=http://localhost:${WEB_PORT}` and `TRUST_PROXY=1`, and points the Ollama and Laya URLs at `host.docker.internal`. It also builds the images on the host. None of these fit a server, so the AWS stack needs its own Compose file, not a set of overrides.
- **CSRF is baked into the UI.** `VITE_CSRF_ENABLED` is fixed in the web bundle at build time, and it must match the API's `CSRF_ENABLED`.
- **No existing pieces to reuse.** The repo has no CI, no `infra/` directory and no existing AWS resources.

## Goals / Non-Goals

**Goals:**
- One `terraform apply` plus one deploy command takes a fresh account to a working game at `https://<domain>`.
- Running cost stays at about $25/month or less, not counting LLM usage.
- No changes to the local Compose workflow, and none to application code or the `Dockerfile` for the AWS work itself. (The separate Sentry integration later changed both; see §7.)
- Data survives deploys and instance replacement, and point-in-time snapshots exist for disaster recovery.

**Non-Goals:**
- High availability, multi-AZ or horizontal scaling. SQLite and the in-memory rate limits rule these out.
- Zero-downtime deploys. A few seconds of downtime during a container restart is acceptable.
- CI/CD pipelines. The deploy runs from an operator's machine, and a GitHub Actions workflow can wrap the same script later.
- Self-hosted LLMs. Ollama and Laya are not deployed.
- Multiple environments (such as staging). The Terraform takes an `environment` variable so this is possible later, but only `prod` is planned.

## Decisions

### 1. A single EC2 instance running Docker Compose, not ECS, App Runner or Lightsail
- **Why EC2.** The existing images and Compose topology carry over unchanged. SQLite on a local EBS volume is the safest place for that database.
- **ECS Fargate + EFS.** Rejected. The ALB plus Fargate cost is 3–4× higher, and SQLite file locking over NFS is a known risk.
- **App Runner or any Postgres move.** Rejected. These need the persistence layer rewritten.
- **Lightsail.** Simpler, but it gives weaker IAM, SSM and backup integration, and Terraform coverage of Lightsail is thinner.

### 2. Graviton `t4g.small` running Amazon Linux 2023
- **Instance size.** 2 vCPU and 2 GB is enough, because the API mostly waits on remote LLMs.
- **Why AL2023.** It ships the SSM agent, Docker and `amazon-ecr-credential-helper` as packages. The Compose v2 CLI plugin is installed from a pinned GitHub release, and its SHA-256 is verified.
- **AMI.** The AMI is resolved through the public SSM parameter for the latest AL2023 arm64 image. `ignore_changes = [ami]` stops routine applies from replacing the instance.
- **Alternative.** Ubuntu 24.04 packages `docker-compose-v2`, but it needs the ECR helper and SSM agent set up by hand.

### 3. Caddy terminates TLS in a third Compose service, not an ALB with ACM
- **What Caddy does.** It gets and renews Let's Encrypt certificates automatically, redirects HTTP to HTTPS, and proxies to `web:8080` with `read_timeout 180s`. That covers the 120 s turn budget.
- **Why not an ALB.** An ALB with ACM adds about $18/month and needs at least two subnets in different AZs. That buys nothing while there is a single instance.
- **Certificate storage.** Certificates and ACME state go on the data EBS volume (`/srv/investor/caddy`). This means a replaced instance does not re-request certificates and risk hitting Let's Encrypt rate limits.
- **Ports.** Only Caddy publishes host ports (80 and 443). In `docker-compose.aws.yml`, `web` has no `ports:` entry.

### 4. `TRUST_PROXY=2`
- **The proxy chain.** It runs client → Caddy → nginx → api. Caddy replaces any client-supplied `X-Forwarded-For` with the real peer IP, because no `trusted_proxies` are configured. nginx then appends Caddy's container IP.
- **Why 2.** Trusting exactly 2 hops makes Express resolve `req.ip` to the real client, and a client cannot spoof it. The rate-limit scenario in the spec verifies this.
- **Both hosts.** Requests to the API host take the same Caddy → nginx → api path (§11), so 2 stays correct whichever host a client uses.

### 5. Images are built on the operator's machine and pushed to ECR, not built on the instance
- **Why.** Building on a 2 GB instance compiles native modules slowly and risks running out of memory.
- **How.** `docker buildx build --platform linux/arm64` runs natively on Apple Silicon (and under QEMU elsewhere). It builds the existing `api` and `web` targets.
- **Tags.** Tags are the short git SHA.
- **Cleanup.** ECR lifecycle policies keep the last 20 tagged images and expire untagged ones after 1 day.

### 6. Deploys run through SSM Run Command, and the Compose and Caddy files travel with each deploy
- **What runs on the instance.** `scripts/aws-deploy.sh` sends an `AWS-RunShellScript` command. It carries `docker-compose.aws.yml` and `docker/Caddyfile` base64-encoded inline, both a few KB. The command then does the following:
  1. Writes both files to `/opt/investor/`.
  2. Renders `/opt/investor/.env` (mode 0600, root) from `aws ssm get-parameters-by-path --with-decryption` under `/investor-game/<env>/`.
  3. Fails before touching the running containers if a required parameter is missing.
  4. Writes `IMAGE_TAG`, `DOMAIN`, `API_DOMAIN` and `ECR_REGISTRY`.
  5. Runs `docker compose pull` and then `docker compose up -d --wait --remove-orphans`.
- **After the command.** The script polls the command's status, then checks `https://<domain>/api/health` from the operator's side. On failure it prints `docker compose logs --tail 100 api`, which the remote command captures. It then checks `https://<api_domain>/api/health` once, but only warns if that fails: the API host's certificate can lag behind the UI host's, and the game itself is already healthy.
- **Why files travel with the deploy.** The repo stays the source of truth for runtime config, without an S3 artifact bucket. The rejected alternatives were baking the files into cloud-init, which would make every config change a Terraform change and an instance replacement, or syncing them through S3.
- **Rollback.** `scripts/aws-deploy.sh --tag <sha>` skips the build and redeploys an existing tag. Rollback is manual, not automatic, which keeps the script simple. The previously deployed tag is printed at the start of each deploy so it is easy to find.

### 7. Secrets live in SSM Parameter Store, which Terraform does not manage
- **Who creates them.** Operators create SecureString parameters with `aws ssm put-parameter`. Terraform only grants read access to the prefix (`ssm:GetParametersByPath`, `ssm:GetParameter*`, plus `kms:Decrypt` on the AWS-managed `aws/ssm` key). Values therefore never enter Terraform state.
- **What the README lists.** The exact `put-parameter` commands.
- **Plain settings.** Non-secret settings are plain `environment:` values in `docker-compose.aws.yml`:
  - `NODE_ENV=production`;
  - `THINKING_PROVIDER=anthropic`, `DECISION_PROVIDER=jev`;
  - `TRUST_PROXY=2`;
  - `CORS_ORIGINS=https://${DOMAIN}`;
  - `DATABASE_FILE`.
- **CSRF.** `CSRF_ENABLED` is an optional plain SSM parameter under the same prefix. The deploy script reads it for the web build arg, and the instance gets it in `.env` along with the secrets. One stored value drives both, so they cannot drift apart. A rollback to an image built under a different setting is the one exception, and the README warns about it.
- **Sentry (optional).** `SENTRY_DSN` and `SENTRY_WEB_DSN` are plain `String` parameters under the prefix, because a DSN only allows sending events and the web one is public in the bundle anyway.
  - `SENTRY_DSN` reaches the API through `.env` like every other parameter. `SENTRY_WEB_DSN` is read by the deploy script and baked into the web build, the same way as `CSRF_ENABLED`.
  - Compose sets `SENTRY_RELEASE=${IMAGE_TAG}`, and the web build gets the same tag, so events from both tie to one deploy.
  - `SENTRY_AUTH_TOKEN` is a secret that stays in the operator's shell. It is passed to the web build as a BuildKit secret (`--secret id=sentry_auth_token`), never as a build argument, so it is not stored in any image layer. With it, the build uploads hidden source maps and deletes them from the image; without it, the upload is skipped.
  - The API image runs `node --enable-source-maps --import ./apps/api/dist/instrument.js`, so Sentry initialises first and stack frames point at the TypeScript sources.

### 8. A dedicated data volume mounted by filesystem label, with DLM snapshots
- **The volume.** An `aws_ebs_volume` (gp3, 10 GB, encrypted) is attached at `/dev/sdf` and has `lifecycle { prevent_destroy = true }`.
- **Mounting.** Cloud-init formats it as ext4 with label `investor-data` only if it has no filesystem. It mounts the volume at `/srv/investor` by `LABEL=` in fstab, which avoids NVMe device renaming. It then creates `data/`, owned by uid 1000, and `caddy/`.
- **Bind mount, not named volume.** The api container bind-mounts `/srv/investor/data:/app/data`, so the data lives outside `/var/lib/docker` on the root disk.
- **Snapshots.** A DLM lifecycle policy targets the volume's tag, takes a snapshot daily at 03:00 UTC and keeps 7. DLM snapshots outlive the policy and the stack.
- **Consistency.** SQLite runs in WAL mode, and an EBS snapshot is crash-consistent, which SQLite recovers from on open. That is acceptable at this scale. A `sqlite3 .backup` to S3 is a possible later addition (see Open Questions).

### 9. A minimal VPC created by Terraform
- **Why not the default VPC.** Many accounts have deleted theirs.
- **What gets created.** One VPC with one public subnet, an internet gateway and a route table. There are no NAT gateways, which saves about $32/month.
- **Security group.** It allows inbound 80/443 from `0.0.0.0/0` and `::/0`, and all outbound traffic.
- **Metadata.** IMDSv2 is required.
- **Public address.** An Elastic IP gives the instance a stable address across stop/start and replacement.

### 10. Terraform layout and state
- **Location.** `infra/aws/` holds:
  - `versions.tf` (Terraform ≥ 1.6, AWS provider ~> 6.0);
  - `variables.tf`, `network.tf`, `compute.tf`, `storage.tf`, `ecr.tf`, `iam.tf`, `dns.tf`, `outputs.tf`;
  - `cloud-init.yaml`;
  - `terraform.tfvars.example`.
- **State.** State lives in S3 at `s3://terraform-state-harut/investor-game/prod/terraform.tfstate` (bucket in eu-central-1, versioned, SSE-encrypted), with S3-native locking (`use_lockfile = true`) and no DynamoDB table. `backend.tf` is committed, so every checkout shares the same state. The bucket's region is independent of the stack's `var.region`. `backend.tf.example` remains as a template for other buckets.
- **Why no modules.** About 15 resources do not justify the indirection.

### 11. A second host name for the API, served from the same instance
- **What it does.** `api_domain` (for example `investor-game-api.utrakme.com`) gets its own Route 53 `A` record on the same Elastic IP, and Caddy serves it as a second site with its own certificate. Only `/api/*` is forwarded; every other path redirects to `https://<domain>`, where the UI lives.
- **Same proxy chain.** The API host is routed through nginx (`web:8080`), not straight to `api:3001`. Both hosts therefore have the same hop count and `TRUST_PROXY=2` stays correct (§4).
- **The UI stays same-origin.** The UI keeps calling `/api` on its own host. That avoids a CORS preflight on every POST, keeps the player cookie first-party, and leaves `CORS_ORIGINS` and the web build unchanged. The API host is for direct clients such as Postman and scripts.
- **Rejected: the UI calling the API host.** It would need `VITE_API_URL` baked into the web build, the API host in the CORS allowlist and in Sentry's trace propagation targets, and a preflight round trip per mutation, with nothing gained while both hosts share one instance.

## Risks / Trade-offs

- **[Single point of failure]** The instance going down means the game is down. → EC2 auto-recovery is enabled through a CloudWatch `StatusCheckFailed_System` alarm with the `recover` action, and the README covers the restore-from-snapshot steps.
- **[Deploy downtime]** `up -d` recreates `api`, and `web` waits for its healthcheck, giving about 10–20 s of 502s. → Accepted. Deploy outside playtest sessions.
- **[A bad deploy stays live]** With no automatic rollback, a broken version keeps serving until the operator acts. → The deploy exits non-zero with logs, and `--tag <previous>` is a single command.
- **[DNS not pointed yet]** Caddy cannot get a certificate until the domain resolves to the EIP. It retries with backoff, so the site comes up once DNS propagates. → The README orders the steps: apply, point DNS, wait for resolution, then deploy. Using Route 53 makes this automatic.
- **[Let's Encrypt rate limits]** These are a risk if certificate state is lost repeatedly. → Certificate state is persisted on the data volume.
- **[arm64 builds on x86 operators]** QEMU emulation is slow, especially when compiling `better-sqlite3`. → Prebuilt linux-arm64 binaries normally apply. If not, operators can set `instance_type` to `t3.small` and the script's `--platform linux/amd64`. Both stay in sync through one variable printed by `terraform output`.
- **[`prevent_destroy` blocks `terraform destroy`]** → This is intentional. The README documents removing the guard, or `terraform state rm` of the volume, for a deliberate teardown.
- **[Crash-consistent snapshots]** A snapshot taken mid-write relies on SQLite's WAL recovery. → This is acceptable for game data. See Open Questions.
- **[Instance size]** The design assumes `t4g.small` (2 GB, the variable's default), but the live `terraform.tfvars` sets `t4g.nano` (512 MB) for Node, nginx and Caddy together. → If the API restarts under memory pressure, set `instance_type = "t4g.small"`; it is the first thing to change.
- **[Two certificates]** Caddy needs both host names to resolve before it can get their certificates. → With Route 53 both records are created together. The deploy only warns about the API host, so a lagging certificate does not fail a deploy.
- **[LLM spend]** A public URL can drive up Anthropic and Jev costs. → The API's existing per-IP rate limits apply. Setting provider-side spend limits is recommended in the README.

## Migration Plan

1. Write `infra/aws/terraform.tfvars` (region, `domain`, `api_domain`, optional `route53_zone_id`), then run `terraform init && terraform apply`. State goes to the S3 backend.
2. If DNS is not in Route 53, create `A` records for both domains pointing at the `public_ip` output.
3. Create the SSM parameters: `COOKIE_SECRET`, `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY` and, if CSRF is enabled, `CSRF_SECRET`. Optionally add `SENTRY_DSN` and `SENTRY_WEB_DSN`.
4. Optionally export `SENTRY_AUTH_TOKEN`, then run `scripts/aws-deploy.sh` to build, push and deploy. Check `https://<domain>/api/health` and `https://<api_domain>/api/health`.
5. **Rollback.** Run `scripts/aws-deploy.sh --tag <previous-sha>`.
6. **Disaster recovery.** Create a volume from the latest DLM snapshot, `terraform import` it in place of the old volume (or swap the attachment), then redeploy.

There is no existing production data to migrate. The AWS database starts empty.

## Open Questions

- Whether to add a nightly `sqlite3 .backup` copy to S3, on top of EBS snapshots, for file-level restores. This can be added later without changing the specs.
- Whether to ship container logs to CloudWatch Logs (`awslogs` driver) or keep them as local json-file logs with rotation. Local logs are the default.
