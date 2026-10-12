# hetzner-deployment Specification

## Purpose

Runs the game on Hetzner Cloud at its own public HTTPS subdomains, independently of the AWS deployment. The servers run on Hetzner, while DNS, secrets, image storage, backups and Terraform state stay in the existing AWS account.

## Requirements

### Requirement: Infrastructure as code
The repository SHALL contain a Terraform root, separate from the AWS one. On Hetzner Cloud it provisions the server, firewall, public IPs and data volume. In AWS it provisions the DNS records, image registries, backup bucket and backup uploader identity. Its inputs MUST include the Hetzner location, server type, UI domain, API domain, Route 53 hosted zone, operator SSH keys and SSH source CIDRs.

#### Scenario: Fresh provision
- **WHEN** an operator with a Hetzner API token and AWS credentials runs `terraform apply` with the required inputs
- **THEN** the apply succeeds and outputs the public IPs, server name, registry URLs and SSM parameter prefix

#### Scenario: Re-apply is a no-op
- **WHEN** `terraform apply` is run again with unchanged inputs
- **THEN** Terraform reports no changes

#### Scenario: Hetzner token stays out of the repository
- **WHEN** the repository and the example variables file are searched for the Hetzner API token
- **THEN** it is not found, because the token is read only from the operator's environment

### Requirement: Stack outputs
The Terraform root SHALL output what operators and the deploy command need: the public IPv4 and IPv6 addresses, the server name, the registry URLs, the SSM parameter prefix, the backup bucket name and an SSH `known_hosts` line for the server.

#### Scenario: Deploy reads outputs
- **WHEN** an operator runs `terraform output` after an apply
- **THEN** every listed value is present and non-empty

### Requirement: Independent of the AWS deployment
The Hetzner stack SHALL keep its own Terraform state and SSM parameter prefix, and it SHALL own its image repositories. Applying, changing or destroying either stack MUST NOT change the other stack's resources, DNS records or secrets.

#### Scenario: AWS stack untouched
- **WHEN** the Hetzner stack is applied and later destroyed
- **THEN** a `terraform plan` of the AWS stack reports no changes, and the AWS UI and API domains keep serving

#### Scenario: Separate secrets
- **WHEN** `COOKIE_SECRET` is rotated under the Hetzner prefix
- **THEN** the AWS deployment's `COOKIE_SECRET` is unchanged

### Requirement: DNS in the existing Route 53 zone
The stack SHALL create `A` and `AAAA` records for both Hetzner domains in the given Route 53 hosted zone, pointing at the server's public IPv4 and IPv6 addresses. Both domains MUST be different from the AWS deployment's domains. The public IP addresses MUST survive replacement of the server, so the DNS records do not change.

#### Scenario: Records created
- **WHEN** the stack is applied with a hosted zone ID
- **THEN** both Hetzner domains resolve to the server's IPv4 and IPv6 addresses

#### Scenario: Server replacement keeps the address
- **WHEN** the server is replaced
- **THEN** the replacement has the same public IPv4 and IPv6 addresses, and the DNS records are unchanged

### Requirement: Public HTTPS with a trusted certificate
The deployment SHALL serve the game only over HTTPS, with certificates that browsers trust and that are obtained and renewed automatically. The UI domain serves the web UI and its same-origin `/api`. The API domain serves only `/api/*` and redirects every other path to the UI domain. Plain HTTP MUST redirect to HTTPS. Responses MUST keep the `container-deployment` security and cache headers.

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

#### Scenario: Player cookie works in production
- **WHEN** a new player starts a game at `https://<domain>/`
- **THEN** the browser stores the `Secure`, `__Host-`-prefixed player cookie and later requests are recognized as the same player

### Requirement: Network exposure
Only ports 80/tcp, 443/tcp and 443/udp SHALL be reachable from any address. Port 22 MUST be reachable only from the operator CIDRs that are configured. The `web` (8080) and `api` (3001) ports MUST NOT be reachable from the internet.

#### Scenario: Internal ports closed
- **WHEN** a client on the internet connects to the server's public IP on port 3001 or 8080
- **THEN** the connection is refused or times out

#### Scenario: SSH limited to operators
- **WHEN** a client whose address is outside the configured SSH CIDRs connects to port 22
- **THEN** the connection times out

### Requirement: Operator access over SSH keys only
Operators SHALL reach the server only over SSH with the configured public keys, as a non-root user with `sudo`. Password authentication and direct root login MUST be disabled. The server's SSH host key MUST be known to the operator before the first connection, so the operator never has to accept an unverified host key.

#### Scenario: Key login works
- **WHEN** an operator whose key is configured connects from an allowed CIDR
- **THEN** they get a shell as the operator user and can run `sudo`, and SSH verifies the host key without prompting

#### Scenario: Passwords and root refused
- **WHEN** a client tries a password login, or tries to log in as `root`
- **THEN** the server refuses the login

### Requirement: Production runtime configuration
The deployed API SHALL run with the same production settings as the AWS deployment: `NODE_ENV=production`, `THINKING_PROVIDER=anthropic` and `DECISION_PROVIDER=jev`. CORS origins MUST be exactly `https://<domain>`. The API MUST trust exactly the proxy hops in front of it. The web image MUST be built with a CSRF setting that matches the API's.

#### Scenario: Health is green after deploy
- **WHEN** a deployment finishes
- **THEN** `GET https://<domain>/api/health` returns 200 with `checks.database`, `checks.thinking` and `checks.decision` all `"ok"`

#### Scenario: Per-client rate limits behind the proxies
- **WHEN** two clients with different public IPs send requests to the deployed game
- **THEN** the API counts their requests against separate rate-limit buckets

#### Scenario: Slow turn is not cut off
- **WHEN** a turn request takes 90 seconds because the thinking provider is slow
- **THEN** the client receives the API's response, not a gateway timeout

### Requirement: Secrets management
Secrets SHALL be stored only as SSM SecureString parameters under the Hetzner prefix. They are `COOKIE_SECRET`, `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY`, `CSRF_SECRET` when CSRF is enabled, and the backup uploader's access key. Secret values MUST NOT appear in the repository, Terraform configuration or state, server user data, images, deploy output or files on the operator's disk. On the server they MUST be readable only by root. Rotation MUST take effect on the next deploy.

#### Scenario: Missing secret fails the deploy
- **WHEN** a deploy runs while `COOKIE_SECRET` is absent under the Hetzner prefix
- **THEN** the deploy fails with a message naming the missing parameter, and the previously running version keeps serving

#### Scenario: Secrets absent from state and user data
- **WHEN** the Terraform state and the server's user data are searched for the value of `ANTHROPIC_API_KEY`
- **THEN** the value is not found

#### Scenario: Secret rotation
- **WHEN** an operator updates `TYPESAFE_API_KEY` under the Hetzner prefix and runs a deploy
- **THEN** the API uses the new key and no Terraform change is needed

### Requirement: Durable game data
The SQLite database and the TLS certificates SHALL live on a Hetzner Volume that is separate from the server's disk. Players, games and turns MUST survive container restarts, deploys, server reboots and replacement of the server. Terraform MUST refuse to destroy the volume unless an operator first removes that guard on purpose.

#### Scenario: Data survives a deploy
- **WHEN** a player starts a game and a new version is then deployed
- **THEN** the player's game is still listed for the same player cookie

#### Scenario: Data survives server replacement
- **WHEN** the server is replaced by Terraform while the volume is kept
- **THEN** after the next deploy, existing players' games are still available

#### Scenario: Destroy is refused
- **WHEN** an operator runs `terraform destroy` without removing the volume's guard
- **THEN** Terraform fails without deleting the volume

### Requirement: Daily off-site backups
A consistent copy of the database SHALL be uploaded to an AWS S3 bucket at least daily while the API is running, and at least 7 daily backups MUST be kept. The credentials on the server MUST allow only uploads: they MUST NOT be able to read, list or delete backups. The bucket and its backups MUST survive destroying the stack. The README MUST document how to restore.

#### Scenario: Backup exists after a day
- **WHEN** the deployment has been running for more than 24 hours
- **THEN** the bucket contains a backup from the last 24 hours that opens as a valid SQLite database with the game's tables

#### Scenario: Server cannot delete backups
- **WHEN** a process on the server uses the backup credentials to list, read or delete objects in the bucket
- **THEN** each request is denied

#### Scenario: Restore
- **WHEN** an operator follows the README restore steps with a chosen backup
- **THEN** after the next deploy the game serves the data from that backup

### Requirement: Repeatable deploy
The repository SHALL provide one deploy command for Hetzner, run from an operator's machine. It MUST build the `api` and `web` images for the server's CPU architecture, tag them with the current git commit, push them to the Hetzner stack's registry, and have the server pull and run that tag. It MUST wait until the API reports healthy, and exit non-zero if the new version is not healthy in time.

#### Scenario: Deploy a commit
- **WHEN** an operator runs the deploy command on a clean checkout of commit `abc1234`
- **THEN** images tagged `abc1234` are in the registry, the server runs them, and the command exits 0 after `/api/health` returns 200

#### Scenario: Unhealthy deploy is reported
- **WHEN** the new API container fails its healthcheck within the timeout
- **THEN** the deploy command exits non-zero and prints the API container's recent logs

#### Scenario: No lasting registry credentials on the server
- **WHEN** a deploy has finished
- **THEN** the server holds no registry credential, and none that stays valid for more than 12 hours

### Requirement: Rollback and dirty-tree guard
Deploying an earlier tag that is already in the registry SHALL roll back to it without a build. The deploy MUST refuse to run from a working tree with uncommitted changes unless explicitly overridden.

#### Scenario: Roll back
- **WHEN** an operator runs the deploy command with an earlier tag `def5678` that already exists in the registry
- **THEN** no images are built, the server runs `def5678`, and the command exits 0 once it is healthy

#### Scenario: Dirty tree refused
- **WHEN** the working tree has uncommitted changes and no override flag is given
- **THEN** the deploy command exits non-zero without building or pushing anything
