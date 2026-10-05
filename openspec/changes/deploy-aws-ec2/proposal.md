## Why

The game only runs on a developer's machine (`pnpm dev` or `docker compose up`). Tutors and playtesters need a public HTTPS URL. The existing Compose stack already runs the production build, so the cheapest and lowest-risk path to AWS is to run that same stack on one EC2 instance. This avoids rewriting the SQLite persistence layer or the single-process rate limiter for a managed container platform.

## What Changes

- Add Terraform under `infra/aws/` that provisions a single-instance deployment:
  - an EC2 instance (Graviton, `t4g.small` by default) with Docker and Compose installed by cloud-init;
  - a separate encrypted EBS data volume for the SQLite database, with daily snapshots;
  - an Elastic IP and a security group that opens only 80/443;
  - ECR repositories for the `api` and `web` images;
  - an IAM instance role for ECR pull, SSM Parameter Store reads and Session Manager (no SSH);
  - optionally, a Route 53 `A` record for the game's domain.
- Add a production Compose file (`docker-compose.aws.yml`) that runs prebuilt ECR images instead of building on the host. It adds a Caddy reverse proxy that terminates HTTPS with automatic Let's Encrypt certificates and is the only service that publishes host ports. It bind-mounts the EBS data volume for SQLite. It also sets `TRUST_PROXY=2` and `CORS_ORIGINS=https://<domain>` for the production domain.
- Store secrets (`COOKIE_SECRET`, optional `CSRF_SECRET`, `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY`) as SSM SecureString parameters. The instance renders them into a root-only `.env` at deploy time, and no secret is ever placed in Terraform state, user data or images.
- Pin the providers in AWS to hosted ones: `THINKING_PROVIDER=anthropic` and `DECISION_PROVIDER=jev`. Ollama and Laya are not deployed.
- Add a deploy script that builds `linux/arm64` images, pushes them to ECR tagged with the git SHA, and tells the instance through SSM Run Command to pull them and restart. Rollback redeploys an earlier tag.
- Add an AWS section to the README covering prerequisites, first deploy, redeploy, rollback, backups/restore and cost.
- The local `docker-compose.yml`, `Dockerfile` and application code stay unchanged.

## Capabilities

### New Capabilities
- `aws-deployment`: Provisions the game on AWS and keeps it running. Covers the infrastructure as code, public HTTPS with a trusted certificate, secret handling, durable SQLite storage with backups, image delivery through ECR, and repeatable deploy and rollback.

### Modified Capabilities
<!-- None. container-deployment's local Compose behavior is unchanged; the AWS stack reuses its images. -->

## Impact

- **New files:** `infra/aws/*.tf` (plus `terraform.tfvars.example`), `infra/aws/cloud-init.yaml`, `docker-compose.aws.yml`, `docker/Caddyfile`, `scripts/aws-deploy.sh`, and a README section.
- **Unchanged:** the API, the web UI, the `Dockerfile` and the local Compose file. The existing images are reused as-is; the web image is still built with `VITE_CSRF_ENABLED` matching the API.
- **External dependencies:** an AWS account, Terraform ≥ 1.6, the AWS CLI v2, Docker Buildx, a domain name (DNS in Route 53 or elsewhere), and Anthropic and TypeSafe (Jev) API keys.
- **Cost:** roughly $15–25/month, made up of t4g.small, about 20 GB of gp3, a public IPv4 address, snapshots and ECR storage, plus LLM usage.
- **Operational limits:** one instance and one API replica, as the SQLite design already requires. There is downtime while a deploy restarts containers and if the instance fails. Recovery is from the latest EBS snapshot.
