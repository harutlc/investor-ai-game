#!/usr/bin/env bash
# Build, push and deploy the game to the Hetzner stack provisioned by infra/hetzner (see README "Deploy to Hetzner").
#
#   scripts/hetzner-deploy.sh                 build images for HEAD, push them to ECR, deploy, wait for health
#   scripts/hetzner-deploy.sh --tag <tag>     deploy (or roll back to) an image tag already in ECR; no build
#   scripts/hetzner-deploy.sh --allow-dirty   build from a working tree with uncommitted changes
#
# Needs: terraform (state for infra/hetzner), AWS CLI v2, Docker with buildx, git, python3, curl, ssh, and an SSH
# key that infra/hetzner's ssh_public_keys lists, from an address in ssh_allowed_cidrs.
# Same structure as scripts/aws-deploy.sh, but the server has no AWS identity: secrets are read from SSM here and
# streamed over SSH (never written to this machine's disk), and the server gets a short-lived ECR pull token.
# CSRF and Sentry follow the optional SSM parameters CSRF_ENABLED, SENTRY_DSN and SENTRY_WEB_DSN, as on AWS.

set -euo pipefail

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

die() {
  echo "error: $*" >&2
  exit 1
}

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tf_dir="$repo_root/infra/hetzner"

tag=""
allow_dirty=false
while [ $# -gt 0 ]; do
  case "$1" in
    --tag)
      [ $# -ge 2 ] || die "--tag needs a value"
      tag=$2
      shift 2
      ;;
    --allow-dirty)
      allow_dirty=true
      shift
      ;;
    -h | --help) usage ;;
    *)
      echo "unknown argument: $1" >&2
      usage 1
      ;;
  esac
done

for cmd in terraform aws docker git python3 curl ssh; do
  command -v "$cmd" >/dev/null || die "$cmd is not installed"
done

dirty=false
[ -n "$(git -C "$repo_root" status --porcelain)" ] && dirty=true
if [ -z "$tag" ] && $dirty && ! $allow_dirty; then
  die "working tree has uncommitted changes; commit them or pass --allow-dirty"
fi

# --- Terraform outputs ------------------------------------------------------------------------------
tf_out() { terraform -chdir="$tf_dir" output -raw "$1"; }
region=$(tf_out aws_region) || die "no Terraform outputs in $tf_dir; run terraform apply first"
host=$(tf_out public_ipv4)
ssh_user=$(tf_out ssh_user)
known_hosts=$(tf_out known_hosts)
registry=$(tf_out ecr_registry)
namespace=$(tf_out image_namespace)
domain=$(tf_out domain)
api_domain=$(tf_out api_domain)
ssm_prefix=$(tf_out ssm_prefix)
platform=$(tf_out image_platform)
backup_bucket=$(tf_out backup_bucket)

awsr() { aws --region "$region" "$@"; }

# --- SSM parameters: fail before building if a required secret is missing -------------------------
# Names only here; values are read once, below, and piped straight to the server.
param_names=$(awsr ssm get-parameters-by-path --path "$ssm_prefix" --query 'Parameters[].Name' --output text)
has_param() { tr '\t' '\n' <<<"$param_names" | grep -qx "${ssm_prefix}$1"; }

csrf_enabled=""
if has_param CSRF_ENABLED; then
  csrf_enabled=$(awsr ssm get-parameter --name "${ssm_prefix}CSRF_ENABLED" --with-decryption \
    --query Parameter.Value --output text)
fi
sentry_web_dsn=""
if has_param SENTRY_WEB_DSN; then
  sentry_web_dsn=$(awsr ssm get-parameter --name "${ssm_prefix}SENTRY_WEB_DSN" --with-decryption \
    --query Parameter.Value --output text)
fi
required=(COOKIE_SECRET ANTHROPIC_API_KEY TYPESAFE_API_KEY BACKUP_AWS_ACCESS_KEY_ID BACKUP_AWS_SECRET_ACCESS_KEY)
[ "$csrf_enabled" = "true" ] && required+=(CSRF_SECRET)
for name in "${required[@]}"; do
  has_param "$name" || die "SSM parameter ${ssm_prefix}${name} is missing (see README \"Deploy to Hetzner\")"
done

# --- Images ------------------------------------------------------------------------------------------
image_exists() {
  awsr ecr describe-images --repository-name "$namespace/$1" --image-ids "imageTag=$2" >/dev/null 2>&1
}

if [ -n "$tag" ]; then
  for image in api web; do
    image_exists "$image" "$tag" || die "image $namespace/$image:$tag is not in ECR"
  done
  echo "Deploying existing tag $tag (no build)"
else
  cd "$repo_root"
  if $dirty; then
    # ECR tags are immutable: a dirty build must never take the clean commit's tag.
    tag="$(git rev-parse --short=12 HEAD)-dirty-$(date +%Y%m%d%H%M%S)"
  else
    tag=$(git rev-parse --short=12 HEAD)
  fi

  if image_exists api "$tag" && image_exists web "$tag"; then
    echo "Images for $tag are already in ECR; skipping the build"
  else
    echo "Building $tag for $platform (CSRF_ENABLED=${csrf_enabled:-unset})"
    awsr ecr get-login-password | docker login --username AWS --password-stdin "$registry"
    docker buildx build --platform "$platform" --target api \
      -t "$registry/$namespace/api:$tag" --push .
    sentry_secret=()
    if [ -n "${SENTRY_AUTH_TOKEN:-}" ]; then
      sentry_secret=(--secret "id=sentry_auth_token,env=SENTRY_AUTH_TOKEN")
    else
      echo "SENTRY_AUTH_TOKEN is not set: web source maps will not be uploaded to Sentry" >&2
    fi
    docker buildx build --platform "$platform" --target web --build-arg "VITE_CSRF_ENABLED=$csrf_enabled" \
      --build-arg "VITE_SENTRY_DSN=$sentry_web_dsn" --build-arg "VITE_SENTRY_RELEASE=$tag" \
      ${sentry_secret[@]+"${sentry_secret[@]}"} -t "$registry/$namespace/web:$tag" --push .
  fi
fi

# --- SSH: one multiplexed connection, host key pinned from Terraform ---------------------------------
ssh_dir=$(mktemp -d)
printf '%s\n' "$known_hosts" >"$ssh_dir/known_hosts"
sshr() {
  ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$ssh_dir/known_hosts" \
    -o ConnectTimeout=15 -o ControlMaster=auto -o ControlPath="$ssh_dir/cm" -o ControlPersist=60 \
    "$ssh_user@$host" "$@"
}
cleanup() {
  ssh -o ControlPath="$ssh_dir/cm" -O exit "$ssh_user@$host" >/dev/null 2>&1 || true
  rm -rf "$ssh_dir"
}
trap cleanup EXIT

# --- Stage the next release; the running stack is untouched until the images are pulled ------------
stage_out=$(sshr 'sudo bash -s' <<'REMOTE'
set -euo pipefail
[ -f /var/lib/cloud/instance/boot-finished ] || { echo "server bootstrap is still running (see /var/log/cloud-init-output.log)" >&2; exit 1; }
mountpoint -q /srv/investor || { echo "data volume is not mounted at /srv/investor; bootstrap incomplete (see /var/log/cloud-init-output.log)" >&2; exit 1; }
docker compose version >/dev/null
cd /opt/investor
previous=$(sed -n "s/^IMAGE_TAG='\(.*\)'\$/\1/p" .env 2>/dev/null || true)
echo "previous tag: ${previous:-none}"
rm -rf next && mkdir -m 700 next
REMOTE
) || die "could not stage the deploy on $ssh_user@$host (is your IP in ssh_allowed_cidrs, and is the server still booting?)"
printf '%s\n' "$stage_out"
previous=$(sed -n 's/^previous tag: //p' <<<"$stage_out")
[ "$previous" = none ] && previous=""

sshr 'sudo tee /opt/investor/next/docker-compose.yml >/dev/null' <"$repo_root/docker-compose.aws.yml"
sshr 'sudo tee /opt/investor/next/Caddyfile >/dev/null' <"$repo_root/docker/Caddyfile"

# Renders one env file from the SSM JSON on stdin. Single-quoted values are literal in Compose and in the
# backup script's shell; reject what cannot be quoted that way. BACKUP_* never reach the app's .env.
render_env() {
  SSM_PREFIX=$ssm_prefix MODE=$1 REGISTRY=$registry NAMESPACE=$namespace TAG=$tag DOMAIN=$domain \
    API_DOMAIN=$api_domain BUCKET=$backup_bucket REGION=$region python3 -c '
import json, os, sys
env = os.environ
prefix = env["SSM_PREFIX"]
params = {p["Name"][len(prefix):]: p["Value"] for p in json.load(sys.stdin)["Parameters"]}
required = ["COOKIE_SECRET", "ANTHROPIC_API_KEY", "TYPESAFE_API_KEY",
            "BACKUP_AWS_ACCESS_KEY_ID", "BACKUP_AWS_SECRET_ACCESS_KEY"]
if params.get("CSRF_ENABLED") == "true":
    required.append("CSRF_SECRET")
missing = [n for n in required if not params.get(n)]
if missing:
    sys.exit("missing SSM parameter(s): " + ", ".join(prefix + n for n in missing))
if env["MODE"] == "app":
    lines = {n: v for n, v in params.items() if not n.startswith("BACKUP_")}
    lines.update(ECR_REGISTRY=env["REGISTRY"], IMAGE_NAMESPACE=env["NAMESPACE"], IMAGE_TAG=env["TAG"],
                 DOMAIN=env["DOMAIN"], API_DOMAIN=env["API_DOMAIN"])
else:
    lines = {n: params[n] for n in ("BACKUP_AWS_ACCESS_KEY_ID", "BACKUP_AWS_SECRET_ACCESS_KEY")}
    lines.update(BACKUP_BUCKET=env["BUCKET"], BACKUP_AWS_REGION=env["REGION"])
for name, value in sorted(lines.items()):
    if "/" in name or chr(39) in value or "\n" in value:
        sys.exit("SSM parameter " + prefix + name + " has an unsupported name or value (quote or newline)")
    print(f"{name}={chr(39)}{value}{chr(39)}")
'
}

# Secrets: SSM → this process's pipe → root-only files on the server. Never on this disk, never echoed.
for target in app:.env backup:backup.env; do
  mode=${target%%:*}
  file=${target#*:}
  awsr ssm get-parameters-by-path --path "$ssm_prefix" --with-decryption --output json \
    | render_env "$mode" \
    | sshr "sudo sh -c 'umask 077; cat > /opt/investor/next/$file'"
done

# Runs as root on the server, with the ECR token on stdin. The token is logged out again in every case.
sshr 'sudo tee /opt/investor/next/deploy.sh >/dev/null' <<REMOTE
set -euo pipefail
REGISTRY='$registry'; TAG='$tag'
cd /opt/investor

trap 'docker logout "\$REGISTRY" >/dev/null 2>&1 || true' EXIT
docker login --username AWS --password-stdin "\$REGISTRY" >/dev/null
docker compose -f next/docker-compose.yml --env-file next/.env pull --quiet
docker logout "\$REGISTRY" >/dev/null

# Promote. The Caddyfile is bind-mounted as a single file, so overwrite it in place (same inode).
caddy_changed=false
cmp -s next/Caddyfile Caddyfile 2>/dev/null || caddy_changed=true
cat next/Caddyfile > Caddyfile
mv next/docker-compose.yml docker-compose.yml
mv next/.env .env
install -m 0600 -o root -g root next/backup.env /etc/investor/backup.env
rm -rf next

if ! docker compose up -d --wait --wait-timeout 120 --remove-orphans; then
  echo "--- api logs ---" >&2
  docker compose logs --tail 100 api >&2 || true
  exit 1
fi
if \$caddy_changed; then
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
fi
docker image prune -af --filter "until=168h" >/dev/null || true
echo "deployed tag: \$TAG"
REMOTE

echo "Deploying $tag to $ssh_user@$host"
awsr ecr get-login-password | sshr 'sudo bash /opt/investor/next/deploy.sh' \
  || die "remote deploy failed; the previous version (${previous:-none}) keeps serving unless the new containers had already started"

# --- Public health check -----------------------------------------------------------------------------
echo "Waiting for https://$domain/api/health"
deadline=$((SECONDS + 120))
while :; do
  body=$(curl -fsS --max-time 10 "https://$domain/api/health" 2>/dev/null || true)
  if [ -n "$body" ] && python3 -c '
import json, sys
checks = json.loads(sys.argv[1]).get("checks", {})
sys.exit(0 if all(checks.get(k) == "ok" for k in ("database", "thinking", "decision")) else 1)
' "$body" 2>/dev/null; then
    break
  fi
  [ $SECONDS -lt $deadline ] || die "https://$domain/api/health is not healthy after 120 s (last response: ${body:-none})"
  sleep 5
done

# The API host gets its own certificate; a failure here means its DNS or certificate is not ready yet.
curl -fsS --max-time 10 -o /dev/null "https://$api_domain/api/health" \
  || echo "warning: https://$api_domain/api/health is not reachable yet (DNS or certificate still pending?)" >&2

# --- Backup freshness: silent backup failures surface here ------------------------------------------
# shellcheck disable=SC2016 # backticks are a JMESPath literal, not a command substitution
latest_backup=$(awsr s3api list-objects-v2 --bucket "$backup_bucket" --prefix daily/ \
  --query 'sort_by(Contents || `[]`, &LastModified)[-1].LastModified' --output text 2>/dev/null || echo error)
booted_at=$(sshr 'stat -c %Y /var/lib/cloud/instance/boot-finished' 2>/dev/null || echo 0)
python3 - "$latest_backup" "$booted_at" "$backup_bucket" <<'PY' >&2 || true
import sys
from datetime import datetime, timezone
latest, booted, bucket = sys.argv[1], int(sys.argv[2]), sys.argv[3]
now = datetime.now(timezone.utc)
if latest == "error":
    print(f"warning: could not list s3://{bucket}/daily/ to check backups")
elif latest in ("None", ""):
    if (now.timestamp() - booted) > 86400:
        print(f"warning: no backup in s3://{bucket}/daily/ yet; check `systemctl status investor-backup` on the server")
else:
    age_h = (now - datetime.fromisoformat(latest.replace("Z", "+00:00"))).total_seconds() / 3600
    if age_h > 26:
        print(f"warning: newest backup in s3://{bucket}/daily/ is {age_h:.0f} h old; check `systemctl status investor-backup`")
PY

echo "Deployed $tag to https://$domain (API also at https://$api_domain/api)"
if [ -n "$previous" ]; then
  echo "Previous tag: $previous   (roll back with: scripts/hetzner-deploy.sh --tag $previous)"
else
  echo "Previous tag: none (first deploy)"
fi
