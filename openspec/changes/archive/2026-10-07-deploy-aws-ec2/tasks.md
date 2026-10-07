## 1. Terraform scaffold

- [x] 1.1 Create `infra/aws/versions.tf` (Terraform >= 1.6, AWS provider ~> 6.0, default tags `project=investor-game`, `environment`). Then create `variables.tf` with `region`, `environment` (default `prod`), `domain`, `api_domain`, `instance_type` (default `t4g.small`), `data_volume_size_gb` (default 10), `route53_zone_id` (optional) and `snapshot_retention_days` (default 7), and `terraform.tfvars.example`. Verify that `terraform init && terraform validate` passes.
- [x] 1.2 Add Terraform ignores to `.gitignore` (`infra/aws/.terraform/`, `*.tfstate*`, `infra/aws/terraform.tfvars`). Add `backend.tf.example` with an S3 backend that uses `use_lockfile = true`. Verify that `git status` does not show state or tfvars after an init. Later, `backend.tf` was committed (no longer git-ignored), pointing at `s3://terraform-state-harut/investor-game/prod/terraform.tfstate` in eu-central-1, and `terraform init` was run against it.

## 2. Network, registry and IAM

- [x] 2.1 `network.tf`: create the VPC, one public subnet, the internet gateway and the route table. Add a security group that allows inbound 80/443 over IPv4 and IPv6 and all outbound traffic, with no port 22. Verify with `terraform plan` that the security group has only the 80 and 443 ingress rules.
- [x] 2.2 `ecr.tf`: create the `investor-game/api` and `investor-game/web` repositories, with scan on push and lifecycle policies (keep the last 20 tagged images, expire untagged images after 1 day). Verify that the plan shows both repositories and both policies.
- [x] 2.3 `iam.tf`: create the instance role and profile. Attach `AmazonSSMManagedInstanceCore`, ECR pull rights scoped to the two repositories plus `ecr:GetAuthorizationToken`, and `ssm:GetParameter*`/`GetParametersByPath` on `arn:...:parameter/investor-game/<env>/*` only. Verify that the plan's policy JSON contains no `*` resource except `GetAuthorizationToken`.

## 3. Compute and storage

- [x] 3.1 `infra/aws/cloud-init.yaml` performs these steps:
  - installs `docker` and `amazon-ecr-credential-helper` and enables Docker;
  - installs the pinned Compose v2 plugin with a SHA-256 check;
  - configures `/root/.docker/config.json` with `credsStore: ecr-login`;
  - sets json-file log rotation in `/etc/docker/daemon.json`;
  - waits for the data volume, formats it as ext4 with label `investor-data` only if it is blank, mounts it at `/srv/investor` through fstab `LABEL=`, and creates `data/` (owned by 1000:1000), `caddy/` and `/opt/investor`.

  Verify by rendering it with `cloud-init schema --config-file` (or `terraform console` templatefile) without errors.
- [x] 3.2 `compute.tf`: create the AL2023 arm64 AMI lookup through the SSM public parameter, then the `aws_instance`:
  - IMDSv2 required, an encrypted gp3 root volume and no key pair;
  - `user_data = cloud-init`, with `ignore_changes = [ami, user_data]`.

  Add the Elastic IP and association, and a CloudWatch `StatusCheckFailed_System` alarm with the EC2 `recover` action. Verify that `terraform plan` succeeds.
- [x] 3.3 `storage.tf`: create an encrypted gp3 data volume in the instance's AZ with the tag `Backup=investor-data` and `prevent_destroy`, attached at `/dev/sdf`. Add the DLM role and a lifecycle policy that takes daily 03:00 UTC snapshots and keeps `snapshot_retention_days`. Verify that `terraform plan` shows the volume, the attachment and the DLM policy.
- [x] 3.4 `dns.tf` and `outputs.tf`: create conditional Route 53 `A` records for `domain` and `api_domain` (`for_each`, empty when `route53_zone_id` is unset). Add the outputs `public_ip`, `instance_id`, `ecr_api_url`, `ecr_web_url`, `ecr_registry`, `ssm_prefix`, `region`, `domain`, `api_domain` and `image_platform` (derived from the instance type's architecture). Verify that `terraform validate` passes and that the plan with and without a zone ID shows 2 and 0 records.

## 4. Production Compose and Caddy

- [x] 4.1 `docker/Caddyfile`: set up `{$DOMAIN}` with `reverse_proxy web:8080` and transport `read_timeout 180s`/`write_timeout 180s`, `encode` off (nginx already gzips), and the default HTTP→HTTPS redirect, with no `trusted_proxies`. Add a `{$API_DOMAIN}` site that forwards only `/api/*` to `web:8080`, through a shared snippet with the same timeouts, and redirects other paths to `https://{$DOMAIN}{uri}`. Verify that `docker run --rm -v $PWD/docker/Caddyfile:/etc/caddy/Caddyfile caddy:2 caddy validate --config /etc/caddy/Caddyfile` passes with `DOMAIN=example.com` and `API_DOMAIN=api.example.com`.
- [x] 4.2 `docker-compose.aws.yml` defines three services:
  - **api** (`image: ${ECR_REGISTRY}/investor-game/api:${IMAGE_TAG}`): `env_file: .env`, and `environment` with `NODE_ENV=production`, `PORT=3001`, `DATABASE_FILE=/app/data/game.sqlite`, `TRUST_PROXY=2`, `CORS_ORIGINS=https://${DOMAIN}`, `THINKING_PROVIDER=anthropic`, `DECISION_PROVIDER=jev`, `CSRF_ENABLED=${CSRF_ENABLED:-}` and `SENTRY_RELEASE=${IMAGE_TAG}`. It bind-mounts `/srv/investor/data:/app/data` and reuses the healthcheck, `init` and `stop_grace_period` from `docker-compose.yml`.
  - **web** (`image: …/web:${IMAGE_TAG}`): no ports, and `depends_on` api healthy.
  - **caddy** (pinned `caddy:2.x-alpine`): ports 80, 443 and 443/udp, the Caddyfile mounted read-only, `/srv/investor/caddy:/data`, `DOMAIN` and `API_DOMAIN` in its environment, and `depends_on` web.

  All services use `restart: unless-stopped`. Verify that `DOMAIN=example.com API_DOMAIN=api.example.com ECR_REGISTRY=x IMAGE_TAG=y docker compose -f docker-compose.aws.yml config` renders without errors and only `caddy` has `ports`.
- [x] 4.3 Local smoke test of the AWS Compose topology. Use locally built images tagged as ECR names, `DOMAIN=localhost` (Caddy's internal CA), bind directories under a temp dir and `TRUST_PROXY=2`. Verify three things: `curl -k https://localhost/api/health` returns 200, `curl -I http://localhost/` redirects to HTTPS, and two requests sent through Caddy with spoofed `X-Forwarded-For` headers still log the real peer IP.

## 5. Deploy script

- [x] 5.1 `scripts/aws-deploy.sh` (bash, `set -euo pipefail`):
  - reads the Terraform outputs (`terraform -chdir=infra/aws output -json`);
  - parses `--tag <sha>`, `--allow-dirty` and `CSRF_ENABLED`;
  - refuses a dirty tree unless `--allow-dirty` is given;
  - with no `--tag`, logs in to ECR and runs `docker buildx build --platform <image_platform> --target api|web --build-arg VITE_CSRF_ENABLED=$CSRF_ENABLED --push` tagged `$(git rev-parse --short HEAD)`;
  - for the web build, also passes `VITE_SENTRY_DSN` (from the optional SSM parameter `SENTRY_WEB_DSN`) and `VITE_SENTRY_RELEASE=<tag>`. When `SENTRY_AUTH_TOKEN` is set, it adds `--secret id=sentry_auth_token,env=SENTRY_AUTH_TOKEN`; otherwise it warns that source maps will not be uploaded;
  - with `--tag`, checks that both tags exist in ECR (`aws ecr describe-images`) and skips the build.

  Verify that a dirty tree exits non-zero before building, and that `--tag nonexistent` exits non-zero with a clear message.
- [x] 5.2 Remote step. Base64-encode `docker-compose.aws.yml` and `docker/Caddyfile`, then send an `AWS-RunShellScript` command that does the following:
  1. prints the currently deployed tag;
  2. writes the files to `/opt/investor/`;
  3. fetches `/investor-game/<env>/` parameters with decryption;
  4. fails with the parameter's name if `COOKIE_SECRET`, `ANTHROPIC_API_KEY` or `TYPESAFE_API_KEY` is missing (or `CSRF_SECRET` when CSRF is enabled), without touching the running containers;
  5. writes `.env` (umask 077) and the `IMAGE_TAG`, `DOMAIN`, `API_DOMAIN`, `ECR_REGISTRY` and `CSRF_ENABLED` values;
  6. runs `docker compose pull`, then `docker compose up -d --wait --wait-timeout 120 --remove-orphans`;
  7. on failure, prints `docker compose logs --tail 100 api` and exits 1.

  Poll `aws ssm get-command-invocation` until the command finishes and print its stdout and stderr. Make sure secret values are never echoed. Verify by deleting a test parameter and checking that the deploy fails with that parameter's name while the old containers keep running.
- [x] 5.3 Final check. Poll `https://$DOMAIN/api/health` for up to 2 minutes and exit 0 only on HTTP 200 with database, thinking and decision all `ok`. Then check `https://$API_DOMAIN/api/health` once and only warn if it fails, since its certificate can lag. Print the deployed tag and the previous tag (for rollback). Verify with `shellcheck scripts/aws-deploy.sh`, which must report no warnings.

## 6. Documentation

- [x] 6.1 Add a README "Deploy to AWS" section covering:
  - prerequisites (an AWS account, Terraform, AWS CLI v2, Docker Buildx, a domain, and the Anthropic and TypeSafe keys);
  - the architecture diagram;
  - the cost estimate;
  - first deploy in Migration Plan order, including the exact `aws ssm put-parameter --type SecureString` commands;
  - redeploy and rollback (`--tag`);
  - shell access (`aws ssm start-session`);
  - logs (`docker compose logs` through Session Manager);
  - restoring from a DLM snapshot;
  - teardown, including the `prevent_destroy` note;
  - a recommendation to set LLM spend limits.

  Verify that every command in the section is copy-pasteable and matches the script's flags.
- [x] 6.2 Mention the AWS option briefly in `PRD.md` or `README.md` "Docker" section, pointing to the new section. Confirm that the local `docker-compose.yml` text and behavior are unchanged with `git diff docker-compose.yml` (empty). The `Dockerfile` changed after this task, but only in the Sentry commit `a8a97e0`: build arguments and a build secret for the web build, and the API's start flags.
- [x] 6.3 Re-run the gates for files edited after their tasks were checked off, during the API-host and Sentry work. `shellcheck scripts/aws-deploy.sh` must report no warnings (5.3's gate; shellcheck was not installed when the script was last edited). `caddy validate` on the two-host Caddyfile with `DOMAIN` and `API_DOMAIN` set must pass (4.1's gate; Docker was not running when it was edited).

## 7. End-to-end verification in AWS

- [x] 7.1 Provision and first deploy. Run `terraform apply` in a real account, point DNS, create the parameters, then run `scripts/aws-deploy.sh`. Verify that the deploy exits 0, `https://<domain>/` loads with a valid certificate, `http://` redirects, and `/api/health` shows all checks `ok`. On the API host, also verify that `https://<api_domain>/api/health` is green with a valid certificate, `http://` redirects, and `/` redirects to the UI host.
- [x] 7.2 Security checks. Verify all of the following:
  - `nc -zv <ip> 22`, `3001` and `8080` all fail from outside;
  - `aws ssm start-session` works;
  - on the instance, `aws ssm get-parameter --name /other/param` is denied;
  - `grep` of `terraform.tfstate` for the Anthropic key finds nothing;
  - `ls -l /opt/investor/.env` shows `-rw------- root`.
- [x] 7.3 Data durability. Play a turn, redeploy the same commit with `--tag`, and confirm the game is still listed. Then run `terraform apply -replace=aws_instance.app`, redeploy, and confirm the game is still listed. After 24 h, confirm that a DLM snapshot exists.
  - Accepted by the operator on partial evidence (2026-10-07). The DLM snapshot `snap-04aac27abf7c331a9` of `vol-01a5f6c7b0b99e122` was taken at 2026-10-07 03:15 UTC by policy `policy-0cad8645906b56ebe` and is `completed`. Data survived the `--tag` rollback redeploy in 7.4. **Not run:** the `terraform apply -replace=aws_instance.app` instance-replacement check, so the "Data survives instance replacement" scenario is still untested in AWS.
- [x] 7.4 Behavior checks. Play a full game in a browser and confirm the `__Host-` cookie is set. Confirm that a slow turn (over 60 s, where one happens or is simulated by a thinking timeout) returns without a 504. Roll back to an earlier tag and confirm health is green on that tag.
