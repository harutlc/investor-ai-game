# Investor Negotiation Game

The player pitches a startup to an AI investor and negotiates the deal. For a plain-language description of the product, read the [`PRD.md`](./PRD.md); for the roles of the two LLMs (decision and thinking), read [`LLM.md`](./LLM.md). The game design and roadmap are in [`TASKS.md`](./TASKS.md); the homework brief is in [`homework-en.md`](./homework-en.md).

This README covers what exists so far: the monorepo, the Express API with its security baseline, the LLM provider layer, the game (brain, policy, voice, engine, HTTP API) and the web UI.

## Prerequisites

- **Node.js ≥ 22.12** (tested with 24)
- **pnpm 10** (`corepack enable` picks up the version pinned in `package.json`)
- A C/C++ toolchain for the native SQLite driver (`better-sqlite3`). On macOS this is the Xcode Command Line Tools (`xcode-select --install`). Prebuilt binaries are used when one is available.

## Setup

```bash
pnpm install
cp .env.example .env
# generate the cookie secret (at least 32 characters)
echo "COOKIE_SECRET=$(openssl rand -base64 48)" >> .env
# only if you turn CSRF protection on (CSRF_ENABLED=true): a second, different secret
# echo "CSRF_SECRET=$(openssl rand -base64 48)" >> .env
pnpm dev                     # API on http://localhost:3001
curl -i http://localhost:3001/api/health
pnpm dev:web                 # web UI on http://localhost:5173 (second terminal)
```

The SQLite database is created at `data/game.sqlite` on first start, and migrations run automatically.

## Docker

The root `Dockerfile` builds two images, and `docker-compose.yml` runs them together:

- `api` runs the compiled API with production dependencies only, as a non-root user.
- `web` is nginx serving the built UI. It proxies `/api` to the API, so the browser sees one origin, as with the Vite dev proxy.

Only the web port is published. You need Docker with Compose v2 (for example Docker Desktop); Node and pnpm are not needed on the host.

```bash
cp .env.example .env
echo "COOKIE_SECRET=$(openssl rand -base64 48)" >> .env
# Pick real providers in .env: the example selects jev, which needs TYPESAFE_API_KEY
# (or set DECISION_PROVIDER=laya and run laya-serve on the host). See "LLM providers" below.
docker compose up --build    # http://localhost:8080
```

Without any LLM provider, use the development-mode command under "Production mode over plain HTTP" below.

The `api` service must pass its `/api/health` check before `web` starts. Secrets and provider settings come from `.env`. Compose pins these values for the container, overriding `.env`:

| Container value   | Default                             | Override with            |
| ----------------- | ----------------------------------- | ------------------------ |
| `NODE_ENV`        | `production`                        | `DOCKER_NODE_ENV`        |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | `DOCKER_OLLAMA_BASE_URL` |
| `LAYA_BASE_URL`   | `http://host.docker.internal:8000`  | `DOCKER_LAYA_BASE_URL`   |
| web port          | `8080`                              | `WEB_PORT`               |

`THINKING_PROVIDER` and `DECISION_PROVIDER` are passed through, so a value set in the shell wins over `.env`. `DOCKER_*` names are used because the `NODE_ENV` and URLs in a local `.env` describe the dev setup, not the containers. Compose also sets `PORT=3001`, `DATABASE_DIALECT=sqlite`, `DATABASE_FILE=/app/data/game.sqlite` and `TRUST_PROXY=1` (see [Choosing a database](#choosing-a-database) for PostgreSQL and MySQL). Only nginx reaches the API, so the API trusts exactly one hop for the client IP, and rate limits stay per player.

**LLM providers.**

- Ollama and laya-serve keep running on the host, and the API reaches them through `host.docker.internal`. This also works on Linux Docker Engine.
- On Linux, Ollama must listen on all interfaces: `OLLAMA_HOST=0.0.0.0 ollama serve`.
- Anthropic and Jev only need their API keys in `.env`.
- An unreachable provider shows up as `"error"` in `/api/health` and does not stop the stack.

**Production mode over plain HTTP.**

- The containers run with `NODE_ENV=production`, so the player cookie is `Secure` with a `__Host-` prefix.
- Chrome and Firefox accept it on `http://localhost`. Other browsers, or opening the game by LAN IP or hostname, drop it, and every request then starts a new player. Use TLS in front, or development mode.
- Fake providers are refused in production. To play with no LLM services at all:

```bash
DOCKER_NODE_ENV=development THINKING_PROVIDER=fake DECISION_PROVIDER=fake docker compose up --build
```

**CSRF.** The web image is built with `VITE_CSRF_ENABLED` set from the same `CSRF_ENABLED` value in `.env`, so the UI matches the API. Rebuild the images after you change it.

**Data.** The database lives in the `game-data` volume. It survives `docker compose down`, restarts and rebuilds. `docker compose down -v` deletes it. The stack assumes a single API replica: SQLite and the in-memory rate limits are per process.

To run the same images on a public HTTPS domain, see "Deploy to AWS" or "Deploy to Hetzner" below.

## Deploy to AWS

The same two images run on one EC2 instance with Docker Compose, behind Caddy for HTTPS:

```
Internet ──80/443──▶ caddy (Let's Encrypt, HTTP→HTTPS) ──▶ web (nginx :8080) ──/api──▶ api (:3001)
                     EC2 t4g.small, Amazon Linux 2023                                   │
                                                                     EBS data volume: game.sqlite
                                                                     (+ Caddy certs), daily snapshots
```

Two host names point at the one instance, and Caddy routes by host name:

- `domain` (for example `investor-game.utrakme.com`) serves the UI. The UI calls `/api` on its own host, as it does locally.
- `api_domain` (for example `investor-game-api.utrakme.com`) serves only `/api/*`, for direct clients such as Postman or scripts. Any other path redirects to the UI. Requests on either host take the same Caddy → nginx → api path, so the API's proxy settings and rate limits behave the same way.

What's created and where:

- **Infrastructure.** Terraform in `infra/aws/` creates:
  - a small VPC;
  - the instance, with an Elastic IP;
  - an encrypted data volume, snapshotted daily (7 kept);
  - ECR repositories for the two images;
  - IAM roles;
  - an EC2 auto-recover alarm;
  - optionally, Route 53 A records for both host names.
- **Runtime config.** `docker-compose.aws.yml` and `docker/Caddyfile` are the runtime config. `scripts/aws-deploy.sh` copies them to the instance on every deploy.
- **Providers.** The API runs with `NODE_ENV=production`, `THINKING_PROVIDER=anthropic` and `DECISION_PROVIDER=jev`. Ollama and Laya are not deployed.
- **Access.** Only ports 80 and 443 are open. There is no SSH, and shell access is through AWS Systems Manager.
- **Secrets.** Secrets live in SSM Parameter Store, never in Terraform state, user data or images.
- **Limits.** There is one instance and one API replica, as SQLite requires. A deploy restarts the containers, which causes roughly 10–20 s of 502s.

**Cost.** Roughly $15–25/month, plus LLM usage:

- t4g.small: about $12;
- 20 GB root and 10 GB data gp3: about $2.50;
- public IPv4: about $3.60;
- snapshots and ECR: about $1.

A public URL can drive LLM spend, so set spend limits in the Anthropic and TypeSafe consoles.

### Prerequisites

- An AWS account and credentials for the AWS CLI v2.
- Terraform ≥ 1.6.
- Docker with Buildx.
- `git`, `python3` and `curl`.
- The Session Manager plugin for the AWS CLI, needed only for shell access.
- Two host names: one for the UI and one for the API. If their DNS is in Route 53, the records are created for you.
- An Anthropic API key and a TypeSafe (Jev) API key.

Images are built for the instance's CPU, `linux/arm64` on the default Graviton instance. On Apple Silicon this is a native build; on x86 it is emulated and slower. To use an x86 instance instead, set `instance_type = "t3.small"`. The deploy script picks the platform from Terraform's `image_platform` output.

### First deploy

```bash
# 1. Infrastructure
cp infra/aws/terraform.tfvars.example infra/aws/terraform.tfvars   # set region, domain, api_domain, optional route53_zone_id
terraform -chdir=infra/aws init
terraform -chdir=infra/aws apply

# 2. DNS (skip if route53_zone_id is set): point A records for domain and api_domain at this IP, then wait until they resolve
terraform -chdir=infra/aws output -raw public_ip

# 3. Secrets: SecureString parameters under the ssm_prefix output (/investor-game/prod/ by default)
REGION=$(terraform -chdir=infra/aws output -raw region)
PREFIX=$(terraform -chdir=infra/aws output -raw ssm_prefix)
aws ssm put-parameter --region "$REGION" --type SecureString --name "${PREFIX}COOKIE_SECRET" --value "$(openssl rand -base64 48)"
aws ssm put-parameter --region "$REGION" --type SecureString --name "${PREFIX}ANTHROPIC_API_KEY" --value 'sk-ant-...'
aws ssm put-parameter --region "$REGION" --type SecureString --name "${PREFIX}TYPESAFE_API_KEY" --value '...'

# 4. Build, push and deploy (from a clean checkout); waits until https://<domain>/api/health is green
scripts/aws-deploy.sh
```

The instance needs a minute or two after `apply` to install Docker and mount the data volume. If the deploy reports that the instance is not reachable through SSM, or that the data volume is not mounted, wait and run it again.

Caddy requests a certificate for each host name on the first deploy. Each name needs to already resolve to the instance, and Caddy retries automatically until it does.

Every parameter under the prefix is passed to the API's environment. You can add other overrides there as well, for example `LOG_LEVEL`. Parameter values cannot contain a single quote or a newline.

**CSRF (optional).** CSRF is off by default. To turn it on, add two parameters, then deploy a fresh build:

```bash
aws ssm put-parameter --region "$REGION" --type String --name "${PREFIX}CSRF_ENABLED" --value true
aws ssm put-parameter --region "$REGION" --type SecureString --name "${PREFIX}CSRF_SECRET" --value "$(openssl rand -base64 48)"
```

The deploy script bakes this setting into the web image and passes the same value to the API, so the two always match. Because the web image is built with the setting, an older tag built with the opposite value will not match. After changing it, push a new commit and deploy that; don't roll back across the change.

**Sentry (optional).** Errors and traces go to the `harut-46` org: project `investor-api` for the API and `investor-web` for the UI. Each project's DSN is in its Client Keys settings. Add the two DSNs as parameters, then deploy a fresh build:

```bash
aws ssm put-parameter --region "$REGION" --type String --name "${PREFIX}SENTRY_DSN" --value 'https://...investor-api DSN'
aws ssm put-parameter --region "$REGION" --type String --name "${PREFIX}SENTRY_WEB_DSN" --value 'https://...investor-web DSN'
```

The API reads `SENTRY_DSN` at runtime. The web DSN is baked into the web image, the same way the CSRF setting is. Both report the image tag as their release. To make production stack traces from the UI readable, export `SENTRY_AUTH_TOKEN` (an org token with the `project:releases` scope) before you run `scripts/aws-deploy.sh`. The web build then uploads hidden source maps for that release and deletes them from the image. The token is passed as a BuildKit secret, so it never ends up in an image layer. Locally, set `SENTRY_DSN` in `.env` and `VITE_SENTRY_DSN` in `apps/web/.env.local`. If they are unset, the SDKs stay off.

### Redeploy, roll back, rotate secrets

```bash
scripts/aws-deploy.sh                 # build and deploy HEAD (tag = short commit SHA)
scripts/aws-deploy.sh --tag <sha>     # deploy an image already in ECR, e.g. to roll back; no build
scripts/aws-deploy.sh --allow-dirty   # build uncommitted changes (tagged <sha>-dirty-<timestamp>)
```

At the end of each deploy, the script prints the previous tag, which is the rollback target. ECR keeps the last 20 tags.

If the new version is not healthy within 2 minutes, the script exits non-zero and prints the API's logs. The broken version stays live until you roll back with `--tag`.

To rotate a secret, run `aws ssm put-parameter --overwrite ...` and then redeploy, for example with `--tag <current tag>`. No Terraform change is needed. If a required parameter is missing, the deploy stops before it touches the running containers.

### Operating

```bash
INSTANCE=$(terraform -chdir=infra/aws output -raw instance_id)
aws ssm start-session --region "$REGION" --target "$INSTANCE"     # shell on the instance
# on the instance:
sudo -i
cd /opt/investor && docker compose ps
docker compose logs --tail 200 api          # also: web, caddy
```

On the instance, the paths are:

- `/opt/investor`: the stack's files, including a root-only `.env`;
- `/srv/investor/data`: the database;
- `/srv/investor/caddy`: the certificates;
- `/var/log/cloud-init-output.log`: the first-boot log.

**Restore from a snapshot.** Snapshots are named after the `<project>-<env>-data` volume, with tag `SnapshotCreator=dlm`. The new volume keeps the filesystem label, so it mounts without any changes.

1. In the EC2 console (Snapshots), create a volume from the snapshot you want. Put it in the instance's availability zone, as gp3 and encrypted.
2. Stop the instance, detach the current data volume, attach the new one as `/dev/sdf`, then start the instance.
3. Point Terraform at the new volume, then re-apply its tags so daily snapshots continue:

   ```bash
   terraform -chdir=infra/aws state rm aws_volume_attachment.data aws_ebs_volume.data
   terraform -chdir=infra/aws import aws_ebs_volume.data vol-NEW
   terraform -chdir=infra/aws import aws_volume_attachment.data /dev/sdf:vol-NEW:$INSTANCE
   terraform -chdir=infra/aws apply
   ```

4. Delete the old volume when you no longer need it.

**Replace the instance**, for example to pick up a newer AMI or an edited `cloud-init.yaml`, with `terraform -chdir=infra/aws apply -replace=aws_instance.app`, then `scripts/aws-deploy.sh --tag <current tag>`. The data volume and the Elastic IP are kept.

**Tear down.** The data volume has `prevent_destroy`, so `terraform destroy` refuses to delete it. To tear down deliberately:

1. Run `terraform -chdir=infra/aws state rm aws_ebs_volume.data`. This keeps the volume outside Terraform.
2. Run `terraform -chdir=infra/aws destroy`.
3. Delete the volume, the snapshots and the SSM parameters by hand if you no longer want them.

**Terraform state.** State lives in S3 at `s3://terraform-state-harut/investor-game/prod/terraform.tfstate` (see `infra/aws/backend.tf`). The bucket is versioned and encrypted, and S3-native locking (`use_lockfile`) stops two applies from running at once. To use your own bucket, edit `backend.tf` and run `terraform -chdir=infra/aws init -migrate-state`.

## Deploy to Hetzner

A second, independent deployment runs the same two images on one Hetzner Cloud server, with the same Docker Compose and Caddy setup as AWS. It uses its own subdomains. DNS, secrets, images, backups and Terraform state stay in the AWS account:

```
Internet ──80/443──▶ caddy (Let's Encrypt, HTTP→HTTPS) ──▶ web (nginx :8080) ──/api──▶ api (:3001)
                     Hetzner cax11 (ARM), Ubuntu 24.04                                  │
                                                                     Hetzner Volume: game.sqlite
                                                                     (+ Caddy certs) ──daily──▶ S3 (AWS)
```

- **Host names.** `domain` (for example `investor-game-hz.utrakme.com`) serves the UI, and `api_domain` (for example `investor-game-api-hz.utrakme.com`) serves only `/api/*`, exactly like the AWS host names. They must be different names from the AWS stack's. If you enter a name the AWS stack already manages, the apply fails instead of taking over its record.
- **On Hetzner.** Terraform in `infra/hetzner/` creates:
  - the server;
  - a separate 10 GB Volume for the database and certificates;
  - an IPv4 and an IPv6 address that are kept if the server is replaced;
  - a Cloud Firewall: 80 and 443 open to everyone, SSH (22) only from the addresses you list.
- **In AWS.** The same Terraform also creates:
  - `A` and `AAAA` records for both names in your Route 53 zone;
  - two ECR repositories (`investor-game-hetzner/api`, `investor-game-hetzner/web`);
  - an S3 bucket for daily database backups;
  - an IAM user that can only upload to that bucket.

  It never touches the AWS stack's resources. Its state lives in the same S3 bucket under its own key, `investor-game/hetzner-prod/terraform.tfstate`.

- **Runtime config.** The same `docker-compose.aws.yml` and `docker/Caddyfile` as AWS. `scripts/hetzner-deploy.sh` copies them to the server on every deploy, the same way `scripts/aws-deploy.sh` does. The two scripts have the same structure and flags.
- **Access.** SSH with your key only, as the user `deploy` (with `sudo`). Root login and passwords are disabled. The server's SSH host key is generated by Terraform, so you can verify the server before your first connection, and a replaced server keeps the same key. Containers cannot reach the server's metadata endpoint.
- **Secrets.** SSM Parameter Store under `/investor-game/hetzner-prod/`, separate from the AWS stack's secrets. The deploy reads them on your machine and streams them over SSH into root-only files on the server. They are never written to your disk, and never stored in Terraform state, user data or images.
- **Backups.** Hetzner can't snapshot Volumes. So at about 03:00 UTC every day, the server takes a consistent online copy of the database, checks it, and uploads it to S3. Backups are kept 14 days by default. The server's upload key cannot read, list or delete backups. The bucket survives `terraform destroy`. Each deploy warns if the newest backup is older than 26 hours.
- **Limits.** The same as AWS: one server, one API replica, about 10–20 s of 502s during a deploy. Hetzner restarts the server on healthy hardware by itself if the host fails.

**Cost.** Roughly €5–7/month, plus LLM usage:

- cax11 (2 ARM vCPU, 4 GB): about €4–5;
- 10 GB Volume: about €0.50;
- public IPv4: about €0.50 (IPv6 is free);
- in AWS, S3 backups, ECR and DNS queries: under $1.

### Prerequisites

- Everything listed under "Deploy to AWS" → Prerequisites (AWS credentials, Terraform, Docker with Buildx, `git`, `python3`, `curl`, API keys). The AWS stack itself doesn't need to exist.
- `ssh`, and an SSH key pair. If you have none, create one with `ssh-keygen -t ed25519`.
- A Hetzner Cloud account and API token:
  1. Sign up at https://console.hetzner.cloud and create a project, for example `investor-game`.
  2. In the project, open **Security → API tokens → Generate API token**. Choose **Read & Write** and copy the token. It is shown only once.
  3. Export it in the shell you run Terraform from: `export HCLOUD_TOKEN=...`. Don't put it in any file in the repo. There is deliberately no Terraform variable for it.
- Your public IP, for SSH access: `curl -4 https://ifconfig.me`. Add `/32` to make it a CIDR.
- The ID of the Route 53 hosted zone that holds your domain: `aws route53 list-hosted-zones --query 'HostedZones[].[Id,Name]' --output text`. Use the part after `/hostedzone/`.

Images are built for the server's CPU: `linux/arm64` on the default `cax11`, which is a native build on Apple Silicon. If ARM servers are sold out in your location, set `server_type = "cpx11"` (x86). The deploy script picks the platform from Terraform's `image_platform` output.

### First deploy

```bash
# 1. Infrastructure (~2 min). Needs HCLOUD_TOKEN and AWS credentials in this shell.
cp infra/hetzner/terraform.tfvars.example infra/hetzner/terraform.tfvars   # set domains, zone ID, SSH key, your IP
terraform -chdir=infra/hetzner init
terraform -chdir=infra/hetzner apply

# 2. Secrets: SecureString parameters under the ssm_prefix output (/investor-game/hetzner-prod/ by default)
REGION=$(terraform -chdir=infra/hetzner output -raw aws_region)
PREFIX=$(terraform -chdir=infra/hetzner output -raw ssm_prefix)
aws ssm put-parameter --region "$REGION" --type SecureString --name "${PREFIX}COOKIE_SECRET" --value "$(openssl rand -base64 48)"
aws ssm put-parameter --region "$REGION" --type SecureString --name "${PREFIX}ANTHROPIC_API_KEY" --value 'sk-ant-...'
aws ssm put-parameter --region "$REGION" --type SecureString --name "${PREFIX}TYPESAFE_API_KEY" --value '...'

# 3. Backup upload key: created once, stored straight into SSM (the key never lands in a file)
BACKUP_USER=$(terraform -chdir=infra/hetzner output -raw backup_iam_user)
read -r KEY_ID KEY_SECRET < <(aws iam create-access-key --user-name "$BACKUP_USER" \
  --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
aws ssm put-parameter --region "$REGION" --type SecureString --name "${PREFIX}BACKUP_AWS_ACCESS_KEY_ID" --value "$KEY_ID"
aws ssm put-parameter --region "$REGION" --type SecureString --name "${PREFIX}BACKUP_AWS_SECRET_ACCESS_KEY" --value "$KEY_SECRET"
unset KEY_ID KEY_SECRET

# 4. Build, push and deploy (from a clean checkout); waits until https://<domain>/api/health is green
scripts/hetzner-deploy.sh
```

The server needs a minute or two after `apply` to install Docker and mount the Volume. If the deploy reports that the bootstrap is still running, wait and run it again. CSRF and Sentry work exactly as on AWS: create `CSRF_ENABLED`/`CSRF_SECRET` and `SENTRY_DSN`/`SENTRY_WEB_DSN` under the Hetzner prefix (see "Deploy to AWS").

### Redeploy, roll back, rotate secrets

```bash
scripts/hetzner-deploy.sh                 # build and deploy HEAD (tag = short commit SHA)
scripts/hetzner-deploy.sh --tag <sha>     # deploy an image already in ECR, e.g. to roll back; no build
scripts/hetzner-deploy.sh --allow-dirty   # build uncommitted changes (tagged <sha>-dirty-<timestamp>)
```

At the end of each deploy, the script prints the previous tag, which is the rollback target. ECR keeps the last 20 tags. The CSRF caveat from "Deploy to AWS" applies here too: don't roll back across a change of `CSRF_ENABLED`.

To rotate a secret, run `aws ssm put-parameter --overwrite ...` under the Hetzner prefix and then redeploy, for example with `--tag <current tag>`. No Terraform change is needed. If a required parameter is missing, the deploy stops before it touches the running containers.

To rotate the backup key:

1. Create a new key with `aws iam create-access-key` as in step 3 above, adding `--overwrite` to both `put-parameter` commands.
2. Redeploy.
3. Delete the old key: `aws iam list-access-keys --user-name "$BACKUP_USER"`, then `aws iam delete-access-key --user-name "$BACKUP_USER" --access-key-id <old id>`.

An IAM user has at most two keys.

### Operating

```bash
# Once per machine: trust the server's host key (it stays the same if the server is replaced)
terraform -chdir=infra/hetzner output -raw known_hosts >> ~/.ssh/known_hosts
ssh deploy@"$(terraform -chdir=infra/hetzner output -raw public_ipv4)"
# on the server:
sudo -i
cd /opt/investor && docker compose ps
docker compose logs --tail 200 api               # also: web, caddy
systemctl status investor-backup                 # last backup run; journalctl -u investor-backup for details
systemctl start investor-backup                  # take a backup now
```

On the server, the paths are the same as on AWS, plus two:

- `/opt/investor`: the stack's files, including a root-only `.env`;
- `/srv/investor/data`: the database;
- `/srv/investor/caddy`: the certificates;
- `/srv/investor/backups`: the last 3 backups, gzipped;
- `/etc/investor/backup.env`: the root-only backup upload key;
- `/var/log/cloud-init-output.log`: the first-boot log.

**Your IP changed and SSH times out.** Update `ssh_allowed_cidrs` in `terraform.tfvars` and run `terraform -chdir=infra/hetzner apply`. The firewall changes in place, and the game keeps serving throughout. If you're locked out entirely, the Hetzner console has a web console for the server: open the server, then **Console** (`>_`). The `deploy` user has no password, so this is mainly useful to watch boot output. Fixing the firewall is the real way back in.

**Restore from a backup.**

```bash
BUCKET=$(terraform -chdir=infra/hetzner output -raw backup_bucket)
HOST=$(terraform -chdir=infra/hetzner output -raw public_ipv4)
aws s3 ls "s3://$BUCKET/daily/"                                   # pick a backup
aws s3 cp "s3://$BUCKET/daily/<stamp>.sqlite.gz" /tmp/restore.sqlite.gz
scp /tmp/restore.sqlite.gz deploy@"$HOST":/tmp/ && rm /tmp/restore.sqlite.gz   # player data: don't keep it locally
ssh deploy@"$HOST"
# on the server:
sudo -i
cd /opt/investor && docker compose stop api
cd /srv/investor/data
mkdir -p before-restore && mv game.sqlite* before-restore/       # keep the current database, just in case
gunzip -c /tmp/restore.sqlite.gz > game.sqlite && rm /tmp/restore.sqlite.gz
chown 1000:1000 game.sqlite && chmod 0644 game.sqlite
cd /opt/investor && docker compose up -d --wait
```

To restore one of the local copies in `/srv/investor/backups/` instead, skip the download and `gunzip` that file. Delete `before-restore/` once you're happy with the result.

**Replace the server**, for example to pick up a newer Ubuntu image, an edited `cloud-init.yaml` or changed `ssh_public_keys`: run `terraform -chdir=infra/hetzner apply -replace=hcloud_server.app`, then `scripts/hetzner-deploy.sh --tag <current tag>`. The Volume, both IPs and the SSH host key are kept, so DNS and `known_hosts` don't change.

**Tear down.** The Volume and the backup bucket have `prevent_destroy`, so `terraform destroy` refuses to delete them. To tear down deliberately:

1. Take the Volume and the bucket, with all its settings, out of Terraform. This way the bucket's lifecycle rules keep expiring old backups:

   ```bash
   terraform -chdir=infra/hetzner state list | grep -E '^(hcloud_volume\.data|aws_s3_bucket)' \
     | xargs terraform -chdir=infra/hetzner state rm
   ```

2. Run `terraform -chdir=infra/hetzner destroy`. It removes only this stack's resources and its own DNS records.
3. Delete the rest by hand if you no longer want it:
   - the Volume, in the Hetzner console: disable its protection first;
   - the bucket: `aws s3 rb s3://<bucket> --force` doesn't remove old versions, so empty it in the S3 console;
   - the SSM parameters under the Hetzner prefix.

**Terraform state.** State lives in S3 at `s3://terraform-state-harut/investor-game/hetzner-prod/terraform.tfstate` (see `infra/hetzner/backend.tf`). It contains the server's SSH host private key, but no application secrets. To use your own bucket, edit `backend.tf` and run `terraform -chdir=infra/hetzner init -migrate-state`.

## Scripts (run from the repo root)

| Script                      | What it does                                                                  |
| --------------------------- | ----------------------------------------------------------------------------- |
| `pnpm dev`                  | Starts the API with hot reload (`tsx watch`)                                  |
| `pnpm dev:web`              | Starts the web UI (Vite) on http://localhost:5173, proxying `/api`            |
| `pnpm build`                | Compiles the API and `shared` with `tsc -b` into `dist/`                      |
| `pnpm build:web`            | Builds the web UI into `apps/web/dist/`                                       |
| `pnpm start`                | Runs the built API (`node apps/api/dist/main.js`)                             |
| `pnpm test`                 | Runs the Vitest suites in every package                                       |
| `pnpm typecheck`            | Type-checks sources and tests                                                 |
| `pnpm lint` / `pnpm format` | ESLint (type-aware) / Prettier                                                |
| `pnpm db:generate`          | Generates migrations from `apps/api/src/db/schema/*.ts` (all three dialects)  |
| `pnpm db:migrate`           | Applies migrations for `DATABASE_DIALECT` (the API also does this on startup) |

## Layout

```
apps/api/            Express API
  src/config/        ConfigLoader, AppConfigSchema (zod), WorkspaceRoot
  src/container/     Container: manual dependency injection
  src/db/            Database (better-sqlite3 + Drizzle), schema.ts, migrations/
  src/repositories/  data access only
  src/services/      business logic
  src/http/          ApiServer, controllers/, middleware/
  src/errors/        AppError and one subclass per error
  src/llm/           LLM providers: thinking/ (Ollama, Anthropic, fake), decision/ (Jev, Laya, fake,
                     ConfidenceGate, DecisionLogger)
  src/game/          the game master: hidden investor state, NegotiationPolicy, meters, turn limit
  src/personas/      investor personas: definitions, validation, catalog
  src/brain/         the investor's brain: decision state, offer candidates, question sets, InvestorBrain
  src/voice/         the investor's voice: prompts, lines, player options, number checks (InvestorVoice)
  test/              Vitest + Supertest (in-memory SQLite)
apps/web/            React 19 + Vite web UI (Tailwind v4, shadcn/ui, TanStack Query, React Router)
  src/api/           GameApiClient (typed fetch + zod), CsrfTokenStore, query hooks
  src/lib/           UI helper classes: OfferFormatter, ValuationPreview, PersonaAppearance, ...
  src/components/    ui/ (shadcn, owned code), layout/, setup/, game/, common/
  src/pages/         SetupPage, NegotiationPage, DebriefPage, NotFoundPage
  test/              Vitest + Testing Library (jsdom)
packages/shared/     zod schemas and types shared by the API and the web UI (game contracts, ValuationCalculator, MoneyFormatter)
config/app.config.json   non-secret settings (committed)
.env                 secrets and overrides (git-ignored)
```

## Architecture

Requests flow **controller → service → repository**:

- **Controllers** handle HTTP only: validated input in, DTO out. Each one exposes `basePath` and `routes()`.
- **Services** hold the business rules and throw `AppError` subclasses.
- **Repositories** do data access through Drizzle and return plain records.

Everything is wired with constructor injection in `Container`, the one place where objects are created. Tests build the same container with an in-memory database (`test/support/createTestApp.ts`).

Every error response has the shape `{ "error": { "code", "message", "details"?, "requestId" } }`. The codes are listed in `ErrorCode` in `packages/shared`.

## Configuration

`config/app.config.json` holds non-secret settings. Environment variables (or `.env`) supply the secrets and can override some values:

| Variable            | Overrides / purpose                                                     |
| ------------------- | ----------------------------------------------------------------------- |
| `COOKIE_SECRET`     | **Required.** At least 32 characters                                    |
| `CSRF_ENABLED`      | `security.csrf.enabled` (`true` / `false`; `false` by default)          |
| `CSRF_SECRET`       | Required only when CSRF is enabled; 32+ chars, not the cookie one       |
| `NODE_ENV`          | `development` (default), `production` or `test`                         |
| `PORT`              | `server.port`                                                           |
| `TRUST_PROXY`       | `server.trustProxy` (`false`, a hop count or a comma list; not `true`)  |
| `CORS_ORIGINS`      | `cors.origins` (a comma-separated list of exact origins; no `*`)        |
| `DATABASE_DIALECT`  | `database.dialect` (`sqlite` by default, `postgres` or `mysql`)         |
| `DATABASE_FILE`     | `database.file` (SQLite only; relative to the repo root, or `:memory:`) |
| `DATABASE_URL`      | Required for `postgres`/`mysql`: `postgres://…` or `mysql://…` (secret) |
| `LOG_LEVEL`         | `logging.level` (unset: `debug` in development, `info` otherwise)       |
| `LOG_LLM_CONTENT`   | `logging.llmContent` (`true` logs LLM prompts/responses; debug only)    |
| `APP_CONFIG_PATH`   | Path to an alternative config file                                      |
| `THINKING_PROVIDER` | `llm.thinking.provider` (`ollama`, `anthropic` or `fake`)               |
| `DECISION_PROVIDER` | `llm.decision.provider` (`laya`, `jev` or `fake`)                       |
| `OLLAMA_BASE_URL`   | `llm.thinking.providers.ollama.baseUrl`                                 |
| `LAYA_BASE_URL`     | `llm.decision.providers.laya.baseUrl`                                   |
| `ANTHROPIC_API_KEY` | Required when the thinking provider is `anthropic`                      |
| `TYPESAFE_API_KEY`  | Required when the decision provider is `jev`                            |
| `LAYA_API_KEY`      | Optional; sent as a bearer token if your laya-serve requires one        |

Invalid configuration stops startup with a list of every problem, written as a `fatal` log line. Secret values are never printed.

## Choosing a database

The API stores its data in SQLite by default: one file, no server to run. It can use PostgreSQL (14 or later) or MySQL (8.0 or later) instead. MariaDB is not supported.

| `DATABASE_DIALECT` | Where the data lives                 | Also needs                                       |
| ------------------ | ------------------------------------ | ------------------------------------------------ |
| `sqlite` (default) | `database.file` / `DATABASE_FILE`    | nothing                                          |
| `postgres`         | the database named in `DATABASE_URL` | `DATABASE_URL=postgres://user:pass@host:5432/db` |
| `mysql`            | the database named in `DATABASE_URL` | `DATABASE_URL=mysql://user:pass@host:3306/db`    |

- **Startup.** The API connects and applies its migrations before it listens. If the server cannot be reached or migrated, it exits with a `fatal` log line naming the dialect and host, never the password. An empty database gets the whole schema on first start.
- **Same behavior everywhere.** Games, transcripts, offers and decision logs read back the same on all three, including the order of rows written in the same millisecond. The test suite checks this (see below).
- **Switching starts empty.** Nothing copies an existing SQLite file into PostgreSQL or MySQL. Switching back to SQLite finds the file as it was.
- **One API process per database.** The turn lock and the rate limiter live in memory, so running several API replicas against one server database is not supported.
- **Pool size.** `database.poolMax` (default 10) caps the connections to a PostgreSQL or MySQL server.

**With Docker.** Two override files add a database container on its own named volume, reachable only on the Compose network, and point the API at it:

```sh
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up --build
docker compose -f docker-compose.yml -f docker-compose.mysql.yml up --build
```

`DOCKER_DB_PASSWORD` in `.env` sets the database password (URL-safe characters only; the default is for local use). Without an override file the stack stays on SQLite, even if `.env` sets `DATABASE_DIALECT` for local development.

**Schema changes.** Each dialect has its own schema file (`apps/api/src/db/schema/{sqlite,postgres,mysql}.ts`) and migrations folder (`apps/api/src/db/migrations/<dialect>/`). Change all three schema files, then run `pnpm db:generate`. A test fails if the three schemas disagree on tables, columns or TypeScript types.

**Running the tests against PostgreSQL and MySQL.** The suite always runs on SQLite. With these variables set it also runs every persistence test on PostgreSQL 14 and MySQL 8.0, each test in a fresh database that is dropped afterwards:

```sh
docker compose -f docker-compose.test-db.yml up -d --wait
TEST_POSTGRES_URL=postgres://postgres:test@127.0.0.1:5432/postgres \
TEST_MYSQL_URL=mysql://root:test@127.0.0.1:3306/mysql \
pnpm --filter @investor/api test
docker compose -f docker-compose.test-db.yml down
```

## Logging

The API logs structured JSON to stdout (pretty-printed in development) through one pino logger, built by `LoggerFactory` and injected everywhere; `console` is not used (lint enforces it).

- **Level:** `LOG_LEVEL`, else `debug` in development and `info` otherwise.
- **Request id:** every line written while a request is handled carries `requestId` (the `X-Request-Id` value), including lines from providers, the brain and repositories, via `AsyncLocalStorage`.
- **Redaction:** `Cookie`, `Set-Cookie`, `Authorization`, `X-CSRF-Token` and `X-Api-Key` headers, and fields named `password`, `token`, `accessToken`, `refreshToken`, `secret`, `apiKey`, `api_key`, `authorization` or `databaseUrl` (top level or one level down) are logged as `[Redacted]`. Don't log config or secrets objects.
- **Sentry:** with `SENTRY_DSN` set, `info`/`warn`/`error` lines also go to Sentry Logs (health-probe request lines excepted), and `error`/`fatal` lines become Sentry error events, tagged `request_id`. Errors reach Sentry only through the logger, so a failure is reported once. SDK v11 has Sentry Logs on by default (there is no `enableLogs` option); see `apps/api/src/monitoring/SentryOptions.ts`.

**LLM calls.** Every call to Anthropic, Ollama, Jev and Laya is logged by `LlmCallLogger`, so call sites log nothing themselves (the fake providers log nothing). Each line has `provider`, `operation` (`generate` for thinking, `decide` for decisions, `ping` for health probes), `model` and, inside a request, `requestId`. The backend's request id is `anthropicRequestId` for Anthropic and `providerRequestId` for the others (Jev/Laya's `x-typesafe-request-id`; Ollama sends none).

| Event (`event` / message) | Level | Fields                                                                                                                                                                                                                                                                           |
| ------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `llm.call`                | info  | `maxTokens`, `temperature`, `effort`, `fallbacks` (thinking only), `usage` (input, output, cache read/write, total tokens), `costUsd`, `latencyMs`, `attempts`, `stopReason`, the request id, `requestedModel` after a fallback. Pings log at debug                              |
| `llm.rate_limited`        | warn  | A 429 on one attempt: `attempt`, `retryAfterSeconds`, `retryAfterMs`, the request id                                                                                                                                                                                             |
| `llm.overloaded`          | warn  | A 529 on one attempt, same fields                                                                                                                                                                                                                                                |
| `llm.retry`               | warn  | `attempt` about to start and `reason` (`status_429`, `timeout`, `connection`, `invalid_json`, …)                                                                                                                                                                                 |
| `llm.timeout`             | warn  | `attempt`, `timeoutMs`                                                                                                                                                                                                                                                           |
| `llm.call_failed`         | error | After all retries: `errorType` (SDK error class, or `Refusal` with `category`), `status`, `attempts`, `latencyMs`, `err`. Becomes a Sentry error event. A failed `ping` logs at warn instead: `/api/health` already reports it, and an outage must not open an event every probe |

`costUsd` is an estimate from the `llm.pricing` table in `config/app.config.json` (USD per million tokens, per model); an unpriced model logs `costUsd: null` and one warning. Ollama and Laya are self-hosted, so they always log `costUsd: null` without a warning. Jev is priced like Anthropic once its model has an entry. Jev reports the version it resolved (`jev-latest` is served as e.g. `jev-1.13.0`, logged as `model`, with `requestedModel: "jev-latest"`); a price for the configured name covers every version, and a version's own entry wins. For example: `"jev-latest": { "inputPerMTok": …, "outputPerMTok": …, "cacheReadPerMTok": 0, "cacheWritePerMTok": 0 }`.

`LOG_LLM_CONTENT=true` adds `prompt` and `response` to these lines: the system prompt, messages and reply text for thinking calls, and the `state`, `questions` and `answers` for decisions. They hold players' text, so use it for local debugging only; Sentry drops them in production anyway.

Game settings live in the `game` section and have no environment overrides:

| Key                                 | Meaning                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `game.currency`                     | `EUR` (the only supported value)                                               |
| `game.maxTurns`                     | Turn limit per game (1–50, default 15)                                         |
| `game.defaultValuation`             | Pre-money valuation suggested for a new pitch (default €2,000,000)             |
| `game.features.*`                   | v2 feature flags (`phases`, `dueDiligence`, …); all off until they exist       |
| `game.policy.acceptMinLevel`        | Minimum `accept` score (0–4) for the investor to accept (default 3)            |
| `game.policy.goodDealMin`           | Minimum `good_deal` probability to accept (default 0.5)                        |
| `game.policy.walkAwayMinConfidence` | Confidence a `walk_away` reaction needs to end the game (default 0.7)          |
| `game.policy.injectionThreshold`    | Injection probability at which a move is brushed off (default 0.6)             |
| `game.policy.insultThreshold`       | Insult probability at which rudeness costs patience (default 0.6)              |
| `game.policy.concessionSteps`       | Steps per `concession_size` (`none`/`small`/`medium`/`large`, default 0/1/2/3) |
| `game.policy.patienceCost`          | Patience lost per `reject` / `insult` / `injection` (default 1/2/1)            |
| `game.policy.interestWeight`        | How strongly `good_deal` moves interest each turn (default 0.2)                |
| `llm.decision.minConfidence`        | Decision answers below this confidence count as uncertain (default 0.55)       |

## LLM providers

The investor uses two kinds of model. [`LLM.md`](./LLM.md) explains their roles in detail; this section covers setup.

- **The decision LLM is the brain.** Jev or Laya returns typed judgments: `choice` (one option), `noul` (probability of yes) and `score` (a position on ordered levels). Code then decides what the investor does.
- **The thinking LLM is the voice.** Ollama or Anthropic writes the investor's replies and the player's options, as text or as JSON that matches a schema.

Exactly one provider of each kind is active, chosen by config or env. Switching providers needs no code changes:

```bash
THINKING_PROVIDER=anthropic DECISION_PROVIDER=jev pnpm dev
```

Startup fails only on bad configuration, for example an unknown provider or a missing key for the _active_ provider. An unreachable provider never stops the server.

### Ollama (thinking, local)

```bash
ollama pull qwen2.5:3b    # the model set in llm.thinking.providers.ollama.model
ollama serve              # http://localhost:11434 (override with OLLAMA_BASE_URL)
```

Sampling options (`temperature`, `maxTokens`) live in the Ollama config block. JSON requests send the schema in Ollama's `format` field.

### Anthropic (thinking, hosted)

Set `THINKING_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. The defaults are `claude-opus-5-5` with `effort: "low"`, since investor replies are short chat turns. Current Claude models reject `temperature`, so depth and cost are controlled with `effort`. `fallbacks: true` turns on Anthropic's server-side refusal fallback (`fallbacks: "default"`); if the whole chain still declines, the call fails with `PROVIDER_BAD_RESPONSE`.

### Laya (decision, self-hosted)

```bash
pip install "laya[serve]"
laya-serve                # http://localhost:8000 (override with LAYA_BASE_URL)
```

Laya speaks the same wire protocol as Jev, so both use the official `@typesafe-ai/sdk` client. `model` picks the checkpoint: `english` (the default), `multilingual` or `typed-decisions`. Without `LAYA_API_KEY` the server is unauthenticated. The client still sends a placeholder token, which laya-serve ignores.

### Jev (decision, hosted)

Set `DECISION_PROVIDER=jev` and `TYPESAFE_API_KEY`.

> **Confidence values are not comparable between Jev and Laya.** They compute confidence differently, so calibrate any threshold separately for each provider.

### Errors

Provider failures use the standard error format:

| Code                    | HTTP | Meaning                                                                                    |
| ----------------------- | ---- | ------------------------------------------------------------------------------------------ |
| `PROVIDER_UNAVAILABLE`  | 503  | Unreachable, timed out, rate-limited, overloaded, or credentials rejected (see server log) |
| `PROVIDER_BAD_RESPONSE` | 502  | Invalid JSON after one retry, a refusal, or an inconsistent answer                         |

### Health

`GET /api/health` reports `checks.thinking` and `checks.decision` as `ok` or `error`. These checks never change the HTTP status, which only the database decides, and the response never names a provider. Results are cached for `llm.healthCacheMs` (30 s by default).

### Dev playground

When `dev.playground` is `true` (the committed default) and `NODE_ENV` is not `production`, three endpoints let you try the active providers by hand. They need the session cookie, plus a CSRF token only when CSRF is enabled:

```bash
API=http://localhost:3001
# Only when CSRF is enabled; with it off, /api/csrf-token is 404 and TOKEN can stay empty.
TOKEN=$(curl -s -c jar -b jar $API/api/csrf-token | node -pe 'JSON.parse(require("fs").readFileSync(0)).csrfToken ?? ""')
post() { curl -s -c jar -b jar -H 'Content-Type: application/json' -H "X-CSRF-Token: $TOKEN" -d "$2" "$API$1"; echo; }

post /api/dev/thinking/text '{"system":"You are a greedy investor.","messages":[{"role":"user","content":"500k for 15%?"}]}'

post /api/dev/thinking/json '{"messages":[{"role":"user","content":"Give me 3 reply options"}],
  "schema":{"type":"object","properties":{"options":{"type":"array","items":{"type":"string"}}},"required":["options"]}}'

post /api/dev/decision '{"state":{"player_offer":{"investment":500000,"equity":15}},
  "questions":{"reaction":{"type":"choice","instructions":"How should the investor react?",
  "criteria":{"accept":null,"counter":null,"reject":null,"walk_away":null}}}}'
```

Without Ollama or laya-serve running, start the API with `THINKING_PROVIDER=fake DECISION_PROVIDER=fake pnpm dev`. Fake providers are refused in production.

## Investor personas

`GET /api/personas` lists the six investors a player can pick: `greedy-shark`, `generous-angel`, `angry-rude`, `content-well-fed`, `skeptical-analyst` and `impact-investor`. Each persona has a public profile (`id`, `name`, `avatar`, `tagline`, `traits`), and that is all the endpoint returns.

The rest stays on the server, in `apps/api/src/personas/personaDefinitions.ts`:

- a **brain description** (`personality`, `goals`) for the decision model
- **voice instructions** (`toneInstructions`) for the thinking model
- **hidden numbers** (`budget`, `minEquity`, `maxEquity`, `initialInterest`, `patience`, `concessionStep`) that code negotiates with

Every definition is validated at startup; an invalid one stops the server with a message naming the persona and field.

```bash
curl -s localhost:3001/api/personas
```

Decision calls made for a game go through `DecisionLogger`, which records the questions, answers (or error code) and latency in the `decision_logs` table for the brain-insights panel.

## Investor brain

The decision model is the investor's **brain**: it answers narrow, typed questions and code acts on the answers. `InvestorBrain` (in `apps/api/src/brain/`) runs two stages per turn:

1. **Stage A, `understand()`**, only for free text: what the player is trying to do, and which offer the message contains.
2. **Stage B, `evaluate()`**: the investor's verdict on the move.

Both stages get the same kind of state, built by `NegotiationStateBuilder` in the tutor's shape (`player_offer`, `investor`, `history`, …). The state holds the investor's hidden numbers, so it goes to the decision provider only: it is never logged or returned.

| Stage | Set       | Questions                                                                                                                                                                     |
| ----- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | `intent`  | `intent` (choice: `counter_offer`, `accept`, `decline`, `ask_question`, `answer_question`, `leverage_claim`, `small_talk`, `other`), `injection` (noul)                       |
| A     | `offer`   | `investment`, `equity` (choices among the numbers code found in the message, plus `none`)                                                                                     |
| B     | `deal`    | `accept` (5-level score), `reaction` (choice: `accept`, `counter`, `reject`, `walk_away`), `good_deal` (noul), `concession_size` (choice: `none`, `small`, `medium`, `large`) |
| B     | `conduct` | `politeness` (score), `insult` (noul), `confidence` (score); only when the move has text                                                                                      |

Numbers are **selected, never generated**: `OfferCandidateExtractor` finds amounts (`500k`, `€0.5M`, `500,000`) and percentages (`15%`, `12 percent`) with a regex, and the model only picks one of them (or `none`).

Each set is one decision request. The requests of a stage run concurrently, each one is logged in `decision_logs` with its stage (`A` or `B`), and every answer comes back with its confidence and an `uncertain` flag from `llm.decision.minConfidence`. The brain never acts on the answers; the negotiation policy does.

**Adding a question set:** write a class implementing `StageAQuestionSet` or `StageBQuestionSet` (an `id`, a `stage`, optionally a `feature` from `game.features`, and `prepare()`, which returns the questions and how to interpret their answers), then register it in `Container`, after `mvpQuestionSets()`. A set with a `feature` is only asked while that flag is on.

## Negotiation policy

Code is the game master. `NegotiationPolicy` (in `apps/api/src/game/`) turns the brain's judgments and the investor's hidden numbers into one action per move; every threshold comes from `game.policy`.

| Action      | When                                                                                                                            | Offer                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `clarify`   | the brain is unsure of `reaction`                                                                                               | unchanged                 |
| `reject`    | `reaction = reject`, a hesitant `walk_away`, or a move with no offer                                                            | unchanged; costs patience |
| `accept`    | `reaction = accept`, `accept` ≥ `acceptMinLevel`, `good_deal` ≥ `goodDealMin`, and the offer fits the budget and minimum equity | the player's              |
| `counter`   | `reaction = counter`, or an accept that fails those checks                                                                      | computed (below)          |
| `walk_away` | a confident `walk_away`, or patience reaches 0                                                                                  | none                      |
| `dismiss`   | Stage A injection ≥ `injectionThreshold` (Stage B is skipped)                                                                   | unchanged; costs patience |

**Counter-offers:** equity moves from the investor's offer toward the player's by `concessionSteps[concession_size] × concessionStep` (the persona's), never past the player's number, and stays within the persona's equity limits; the investment is the player's ask, capped at the budget. Example: 30% vs the player's 15%, `medium`, step 4 → 22%.

After each move `InvestorStateUpdater` moves interest by `(good_deal − 0.5) × interestWeight` and takes patience for rejections and insults. `MeterHintMapper` shows the player only hints (`low`/`medium`/`high` interest, "Tapping the table"). `TurnLimiter` ends the game: `deal` (either side accepts), `rejected_by_player`, `walked_away`, or `out_of_turns` at `game.maxTurns`.

## Investor voice

The thinking model is the investor's **voice**: it phrases what code decided and suggests the player's replies. `InvestorVoice` (in `apps/api/src/voice/`) produces, for each turn and in parallel:

- **The investor's line.** The prompt carries the persona's name, personality and tone, the startup, the last 8 chat messages, and the decision: the action plus the exact numbers to state (`€550k (€550,000) for 24%`). Prompts never include the investor's hidden numbers, and player-written text (messages and the pitch) is wrapped in `<player_message>` / `<player_pitch>` tags and marked as untrusted. The opening offer is computed in code (the founder's ask, capped at the budget, for the persona's maximum equity) and only phrased by the voice.
- **The player's options.** The model suggests 1–3 replies as JSON (counter, message, leverage). Code validates every counter's numbers, computes its implied valuation, rewrites a label that disagrees with its numbers, drops duplicates and options with invented numbers, and always adds **Accept €X for Y%** and **Walk away**, so there are 3–5 options.

**Number check:** `NumberConsistencyChecker` reads every amount and percentage in a generated line with the same extractor Stage A uses. Only numbers in play are allowed (the offers on the table, their valuations and the gaps between them, the pitch, and numbers the player wrote); amounts may be rounded by up to 2% (`€3.3M` for €3,333,333). Counters, accepts and the opening must state the decided offer. A failing line is regenerated once with the problems listed; if it fails again, a code-written line is used ("I can do €550k for 24%. That's my offer.").

**Fallbacks:** when the thinking provider is down or keeps misbehaving, the turn still completes with the template line and code-built options. Each fallback is flagged in the result and logged at `warn` with the action and error code only.

## Game engine

`GameEngine` (in `apps/api/src/game/`) runs a game end to end; `GameSessionService` serves its public view and the decision insights.

- **`startGame`**: checks the persona, seeds the hidden investor state from its numbers, computes the opening offer, and has the voice write the opening line and the first options.
- **`playTurn`** resolves the move, then:
  - A clicked **option** or a structured **offer** is used directly.
  - **Free text** goes through Stage A and the injection guard. A confident accept or decline ends the game, and a single extracted number is completed from the investor's offer.
  - Anything else goes through Stage B, then the policy, the turn limit and the voice (the investor's line and options for the next turn).

All model calls finish before anything is written; then the turn's messages, offers, investor state, status and options are saved in **one transaction**. A failed decision call leaves the game exactly as it was (the decision log keeps the failed call). Games are scoped to their player: someone else's game is `NOT_FOUND`, like an unknown id.

| Code               | Status | When                                                                                        |
| ------------------ | ------ | ------------------------------------------------------------------------------------------- |
| `GAME_FINISHED`    | 409    | A move for a game that has already ended                                                    |
| `INVALID_MOVE`     | 422    | E.g. an option id that is not on offer                                                      |
| `TURN_IN_PROGRESS` | 409    | A second move while the game's previous turn is still running (one turn at a time per game) |

## Game API

All routes sit under `/api/games`, behind the player cookie, CSRF (for POSTs when enabled) and the rate limits. Every response is `Cache-Control: no-store`, and none carries the investor's hidden numbers (an HTTP test plays a whole game to check this).

| Route                         | Body                                                                              | Response                                                 |
| ----------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `POST /api/games`             | `{ personaId, pitch }`                                                            | 201 and the game (`GameSessionDto`)                      |
| `GET /api/games`              | —                                                                                 | 200 `{ games: [...] }`, the player's games, newest first |
| `GET /api/games/:id`          | —                                                                                 | 200 and the game                                         |
| `POST /api/games/:id/turns`   | exactly one of `{ optionId }`, `{ offer: { investment, equity } }`, `{ message }` | 200 `{ session, newMessages }`                           |
| `GET /api/games/:id/insights` | —                                                                                 | 200 `{ entries: [...] }`, the decision log per turn      |

Errors use the standard envelope: 400 `VALIDATION_ERROR` (bad body or a malformed `:id`), 404 `NOT_FOUND` (unknown game or someone else's), 422 `INVALID_MOVE`, 409 `GAME_FINISHED` / `TURN_IN_PROGRESS`, 503 / 502 when the decision provider fails.

```bash
curl -s -c jar -b jar localhost:3001/api/games -H 'Content-Type: application/json' \
  -d '{"personaId":"greedy-shark","pitch":{"name":"GreenCharge","sector":"EV charging","description":"Fast EV chargers.","valuation":2000000,"askAmount":500000}}'
```

## Web UI

`apps/web` is the player-facing app, built from the approved UI mock. Run it next to the API:

```bash
pnpm dev        # API on :3001
pnpm dev:web    # UI on http://localhost:5173
```

To play without any model running, start the API with the fake providers:
`THINKING_PROVIDER=fake DECISION_PROVIDER=fake pnpm dev`.

| Screen                         | What it shows                                                                                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup (`/`)                    | Persona picker, pitch form with live valuation hints, "Your games" to resume                                                                                                                               |
| Negotiation (`/games/:id`)     | Chat (with a typing indicator while a turn runs), three ways to reply (options, an offer form with an equity slider and a valuation preview, free text), the deal panel, mood hints and **Brain insights** |
| Debrief (`/games/:id/debrief`) | Outcome, final terms, "Play again"                                                                                                                                                                         |

**Brain insights** is a side sheet with every decision call of the game: stage, provider, model and latency, and each answer's value and confidence. Answers below 55% confidence are marked "uncertain". It shows the split between the brain (decision model) and the voice (LLM).

**API address.** By default the UI calls `/api` on its own origin and the Vite dev server proxies it to `http://localhost:3001`, so the player cookie stays first-party. To call the API directly instead, set `VITE_API_URL` in `apps/web/.env.local` (see `apps/web/.env.example`), for example `VITE_API_URL=http://localhost:3001`. Vite reads env files from `apps/web`, not the repo root. The UI's origin must then be in `CORS_ORIGINS` (`http://localhost:5173` is allowed by default).

**How it talks to the API.** `GameApiClient` sends cookies with every request and parses every response with the shared zod schemas, so an unexpected field fails instead of being shown. CSRF is off by default, like the API's: mutations carry no token and the UI never calls `/api/csrf-token`. If you run the API with `CSRF_ENABLED=true`, also set `VITE_CSRF_ENABLED=true` in `apps/web/.env.local`; the client then fetches a token for the first mutation and retries once after `CSRF_INVALID`.

The UI only shows what the API sends: interest, patience and trust are hints, never numbers, and the debrief does not reveal the investor's hidden limits. The theme follows the system and can be toggled in the header; the choice is remembered.

## Testing the API with Postman

`postman/` holds a collection and a local environment:

1. In Postman, **Import** `postman/investor-api.postman_collection.json` and `postman/local.postman_environment.json`.
2. Select the **Investor local** environment. It sets `baseUrl` to `http://localhost:3001` and `allowedOrigin` to `http://localhost:5173`.
3. Start the API. Without Ollama or laya-serve, use `THINKING_PROVIDER=fake DECISION_PROVIDER=fake pnpm dev`.
4. Run **Session & CSRF** first, or run the whole collection in order with the Collection Runner. Postman keeps the player cookie. If the server has CSRF enabled, the token is saved to `{{csrfToken}}` and sent as `X-CSRF-Token`. If it's disabled (the default), _Get CSRF token_ answers 404, no token is sent, and the two CSRF checks are reported as skipped.

The collection's folders:

| Folder          | What it does                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| System          | Health check                                                                                                                                               |
| Session & CSRF  | Session and CSRF token                                                                                                                                     |
| Game            | List personas, then a full game: start, list, get, play turns (offer, message, option) and insights; every response is checked for hidden investor numbers |
| Playground      | Thinking text, thinking JSON, and the decision endpoint with the tutor's question set                                                                      |
| Security checks | Missing or forged CSRF token, form body, malformed JSON, validation errors, 404, allowed and blocked CORS                                                  |

Every response is also checked for the security headers and, on errors, for the error envelope.

With fake providers, _Thinking: JSON_ fails with 502 by design, because the fake has no scripted JSON. Playground requests and game moves count against the mutation rate limit of 60 per 15 minutes. With CSRF enabled, run _Get CSRF token_ again after clearing cookies, because the token is bound to the player cookie.

To run the collection from the terminal with [Newman](https://www.npmjs.com/package/newman):

```bash
npx newman run postman/investor-api.postman_collection.json -e postman/local.postman_environment.json
```

## Security

| Concern         | What the API does                                                                                                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headers         | `helmet`, set up for an API: `default-src 'none'`, `frame-ancestors 'none'`, `nosniff`, `no-referrer`, `X-Frame-Options: DENY`. HSTS is sent in production only, and `X-Powered-By` is removed                                                                                                       |
| CORS            | Exact-match allowlist from config, with credentials. Other origins get no CORS headers, and their preflights end before any session work                                                                                                                                                             |
| Identity        | Anonymous player ID in a signed, `HttpOnly`, `SameSite=Lax` cookie (`__Host-` prefix and `Secure` in production). A tampered or unknown cookie gets a new player                                                                                                                                     |
| CSRF            | **Off by default** (`security.csrf.enabled` / `CSRF_ENABLED`). When on: a signed double-submit token (`csrf-csrf`), HMAC-bound to the player ID, required on POST/PUT/PATCH/DELETE. When off, cross-site writes are still blocked by `SameSite=Lax` cookies, JSON-only bodies and the CORS allowlist |
| Input           | Only `application/json` bodies on POST/PUT/PATCH, a 100 KB body limit, and strict zod validation that rejects unknown fields                                                                                                                                                                         |
| Abuse           | Per-IP rate limits: a global limit, plus a stricter one for mutating requests. `X-Forwarded-For` is trusted only when `server.trustProxy` is configured                                                                                                                                              |
| Errors and logs | No stack traces or internal messages in production responses. Cookies, authorization, CSRF and API-key headers, and secret-named fields, are redacted from logs (see Logging)                                                                                                                        |

### Contract for the web client

```ts
// 1. Always send cookies.
const api = (path: string, init: RequestInit = {}) =>
  fetch(`${API_URL}${path}`, { credentials: 'include', ...init });

// 2. Only when CSRF is enabled on the server: fetch a token once (and again after a 403 CSRF_INVALID).
//    With CSRF disabled, /api/csrf-token is 404 and the header can be omitted.
const { csrfToken } = await (await api('/api/csrf-token')).json();

// 3. Send it with every mutating request.
await api('/api/games', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
  body: JSON.stringify({ personaId: 'greedy-shark' }),
});
```

Clearing cookies starts a new anonymous player. This is by design, since the game has no accounts.

## The `development` export condition

`@investor/shared` declares a custom `development` export that points to its TypeScript sources:

- `tsx` (`pnpm dev`) and Vitest run with that condition, so changes to `shared` take effect without a build.
- `pnpm build` and `pnpm start` resolve the compiled `dist/` instead.

If you add a new tool that imports `@investor/shared`, enable that condition in it too. The web app's Vite config aliases `@investor/shared` to its `src/index.ts` instead, so `vite build` bundles the sources and never needs `shared/dist`.
