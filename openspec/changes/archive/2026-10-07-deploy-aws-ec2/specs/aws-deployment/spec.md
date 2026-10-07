## Purpose

Runs the game on AWS at a public HTTPS address. It provisions the infrastructure reproducibly from code, keeps secrets out of source control and state, preserves player data across deploys and instance loss, and makes shipping or rolling back a version a single command.

## ADDED Requirements

### Requirement: Infrastructure as code
The repository SHALL contain Terraform configuration that provisions everything the AWS deployment needs from an empty AWS account and region:
- compute;
- storage;
- networking;
- image registries;
- IAM;
- backups;
- optionally, DNS.

The configuration MUST be parameterized by at least:
- the AWS region;
- the UI domain name;
- the API domain name;
- the instance type;
- the data volume size;
- an optional Route 53 hosted zone.

The configuration MUST output these values:
- the public IP;
- the instance ID;
- the ECR repository URLs;
- the SSM parameter path prefix.

Destroying the stack MUST NOT delete the data volume's snapshots.

#### Scenario: Fresh provision
- **WHEN** an operator runs `terraform apply` with a region and domain in a fresh account
- **THEN** the apply succeeds and outputs the public IP, instance ID, ECR repository URLs and SSM parameter prefix

#### Scenario: Re-apply is a no-op
- **WHEN** `terraform apply` is run again with unchanged inputs
- **THEN** Terraform reports no changes

#### Scenario: Optional DNS
- **WHEN** a Route 53 hosted zone ID is provided
- **THEN** `A` records for the UI domain and the API domain, both pointing at the instance's public IP, are created
- **WHEN** no hosted zone ID is provided
- **THEN** no DNS record is created, and the outputs show the IP the operator must point both domains at

### Requirement: Public HTTPS with a trusted certificate
The deployment SHALL serve the game only over HTTPS on the configured domains, each with a certificate that browsers trust:
- the UI domain serves the web UI and its same-origin `/api`;
- the API domain serves only `/api/*`, for direct API clients, and redirects every other path to the UI domain.

It MUST meet these rules:
- Plain HTTP requests MUST be redirected to HTTPS.
- Certificates MUST be obtained and renewed automatically.
- Only ports 80 and 443 MUST be reachable from the internet. The `web` (8080) and `api` (3001) ports and SSH MUST NOT be.
- Responses MUST keep the security and cache headers that the `container-deployment` capability defines.

#### Scenario: Game loads over HTTPS
- **WHEN** a browser opens `https://<domain>/`
- **THEN** the web UI loads with a valid certificate and its API calls go to `https://<domain>/api/...`

#### Scenario: HTTP redirects
- **WHEN** a client requests `http://<domain>/games/abc`
- **THEN** the response is a permanent redirect to `https://<domain>/games/abc`

#### Scenario: API host serves only the API
- **WHEN** a client requests `https://<api_domain>/api/health`
- **THEN** it receives the API's health response over a valid certificate
- **WHEN** a client requests `https://<api_domain>/games/abc`
- **THEN** the response redirects to `https://<domain>/games/abc`

#### Scenario: Internal ports closed
- **WHEN** a client outside AWS connects to the instance's public IP on port 22, 3001 or 8080
- **THEN** the connection is refused or times out

#### Scenario: Player cookie works in production
- **WHEN** a new player starts a game at `https://<domain>/`
- **THEN** the browser stores the `Secure`, `__Host-`-prefixed player cookie and later requests are recognized as the same player

### Requirement: Production runtime configuration
The deployed API SHALL run with `NODE_ENV=production`. It SHALL use the hosted providers: `THINKING_PROVIDER=anthropic` and `DECISION_PROVIDER=jev`.

Two settings MUST describe the production topology:
- **CORS:** CORS origins MUST be exactly `https://<domain>`.
- **Client IP:** the API MUST trust exactly the proxy hops in front of it, so that rate limits are tracked per real client IP.

The web image MUST be built with a CSRF setting that matches the API's.

#### Scenario: Health is green after deploy
- **WHEN** a deployment finishes
- **THEN** `GET https://<domain>/api/health` returns 200 with `checks.database`, `checks.thinking` and `checks.decision` all `"ok"`

#### Scenario: Per-client rate limits behind the proxies
- **WHEN** two clients with different public IPs send requests to the deployed game
- **THEN** the API counts their requests against separate rate-limit buckets

#### Scenario: Same client IP on either host
- **WHEN** one client sends API requests through both the UI domain and the API domain
- **THEN** the API resolves the same client IP for both, because both paths cross the same proxy hops

#### Scenario: Slow turn is not cut off
- **WHEN** a turn request takes 90 seconds because the thinking provider is slow
- **THEN** the client receives the API's response, not a gateway timeout

### Requirement: Secrets management
Secrets SHALL be stored only as encrypted SSM Parameter Store parameters under the deployment's prefix. These are:
- `COOKIE_SECRET`;
- `ANTHROPIC_API_KEY`;
- `TYPESAFE_API_KEY`;
- `CSRF_SECRET`, when CSRF is enabled.

Optional settings that are not secret MAY be stored as plain `String` parameters under the same prefix: `CSRF_ENABLED`, and the Sentry DSNs `SENTRY_DSN` (API) and `SENTRY_WEB_DSN` (web build). The Sentry auth token used to upload source maps is a secret. It stays in the operator's environment, never in SSM or the repository.

Secret values, including the Sentry auth token, MUST NOT appear in any of these places:
- the repository;
- Terraform configuration or state;
- EC2 user data;
- container images;
- deploy script output.

On the instance, secrets MUST only be readable by root and by the containers that receive them. Rotating a secret MUST take effect on the next deploy, with no infrastructure change.

#### Scenario: Missing secret fails the deploy
- **WHEN** a deploy runs while `COOKIE_SECRET` is absent from SSM
- **THEN** the deploy fails with a message naming the missing parameter, and the previously running version keeps serving

#### Scenario: Secrets absent from state
- **WHEN** the Terraform state file is searched for the value of `ANTHROPIC_API_KEY`
- **THEN** the value is not found

#### Scenario: Secret rotation
- **WHEN** an operator updates `TYPESAFE_API_KEY` in SSM and runs a deploy
- **THEN** the API uses the new key and no Terraform change is needed

### Requirement: Durable game data with backups
The SQLite database SHALL live on a dedicated encrypted EBS volume that is separate from the instance's root volume. Players, games and turns MUST survive the following events:
- container restarts;
- deploys;
- instance reboots;
- replacement of the instance (for example, a new AMI).

The volume MUST be snapshotted at least daily, and at least 7 daily snapshots MUST be kept. The README MUST document how to restore from a snapshot.

#### Scenario: Data survives a deploy
- **WHEN** a player starts a game and a new version is then deployed
- **THEN** the player's game is still listed for the same player cookie

#### Scenario: Data survives instance replacement
- **WHEN** the EC2 instance is replaced by Terraform while the data volume is kept
- **THEN** after the next deploy, existing players' games are still available

#### Scenario: Daily snapshots exist
- **WHEN** the deployment has been running for more than 24 hours
- **THEN** at least one snapshot of the data volume exists, created by the backup policy

### Requirement: Repeatable deploy and rollback
The repository SHALL provide one deploy command, run from an operator's machine. It MUST do the following:
- build the `api` and `web` images for the instance's CPU architecture;
- tag them with the current git commit;
- push them to ECR;
- have the instance pull and run that tag.

It does not need SSH. The command MUST wait until the API reports healthy and MUST exit non-zero if the new version is not healthy in time.

Deploying an earlier tag MUST roll back to that version. The deploy MUST refuse to run from a working tree with uncommitted changes, unless explicitly overridden.

#### Scenario: Deploy a commit
- **WHEN** an operator runs the deploy command on a clean checkout of commit `abc1234`
- **THEN** images tagged `abc1234` are in ECR, the instance runs them, and the command exits 0 after `/api/health` returns 200

#### Scenario: Roll back
- **WHEN** an operator runs the deploy command with an earlier tag `def5678` that already exists in ECR
- **THEN** no images are built, the instance runs `def5678`, and the command exits 0 once it is healthy

#### Scenario: Unhealthy deploy is reported
- **WHEN** the new API container fails its healthcheck within the timeout
- **THEN** the deploy command exits non-zero and prints the API container's recent logs

#### Scenario: Dirty tree refused
- **WHEN** the working tree has uncommitted changes and no override flag is given
- **THEN** the deploy command exits non-zero without building or pushing anything

### Requirement: Operator access without SSH
Operators SHALL reach the instance only through AWS Systems Manager: Session Manager for shell access and Run Command for deploys. The instance MUST NOT have an SSH key pair or an inbound SSH rule. Its IAM role MUST be limited to these permissions:
- pulling from the deployment's ECR repositories;
- reading the deployment's SSM parameters;
- the SSM agent's own permissions.

#### Scenario: Shell access through Session Manager
- **WHEN** an operator with IAM permissions runs `aws ssm start-session --target <instance-id>`
- **THEN** they get a shell on the instance

#### Scenario: Role cannot read other parameters
- **WHEN** a process on the instance tries to read an SSM parameter outside the deployment's prefix
- **THEN** the request is denied
