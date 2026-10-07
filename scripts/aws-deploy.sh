#!/usr/bin/env bash
# Build, push and deploy the game to the AWS stack provisioned by infra/aws (see README "Deploy to AWS").
#
#   scripts/aws-deploy.sh                 build images for HEAD, push them to ECR, deploy, wait for health
#   scripts/aws-deploy.sh --tag <tag>     deploy (or roll back to) an image tag already in ECR; no build
#   scripts/aws-deploy.sh --allow-dirty   build from a working tree with uncommitted changes
#
# Needs: terraform (state for infra/aws), AWS CLI v2, Docker with buildx, git, python3, curl.
# CSRF follows the optional SSM parameter <ssm_prefix>CSRF_ENABLED, which sets both the web build
# (VITE_CSRF_ENABLED) and the API, so the two cannot drift apart.
# Sentry (optional): SSM <ssm_prefix>SENTRY_DSN reaches the API, <ssm_prefix>SENTRY_WEB_DSN is baked into the
# web build, both tagged with the image tag as release. SENTRY_AUTH_TOKEN in this shell uploads web source maps.

set -euo pipefail

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

die() {
  echo "error: $*" >&2
  exit 1
}

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tf_dir="$repo_root/infra/aws"

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

for cmd in terraform aws docker git python3 curl; do
  command -v "$cmd" >/dev/null || die "$cmd is not installed"
done

dirty=false
[ -n "$(git -C "$repo_root" status --porcelain)" ] && dirty=true
if [ -z "$tag" ] && $dirty && ! $allow_dirty; then
  die "working tree has uncommitted changes; commit them or pass --allow-dirty"
fi

# --- Terraform outputs ------------------------------------------------------------------------------
tf_out() { terraform -chdir="$tf_dir" output -raw "$1"; }
region=$(tf_out region) || die "no Terraform outputs in $tf_dir; run terraform apply first"
instance_id=$(tf_out instance_id)
registry=$(tf_out ecr_registry)
domain=$(tf_out domain)
api_domain=$(tf_out api_domain)
ssm_prefix=$(tf_out ssm_prefix)
platform=$(tf_out image_platform)

awsr() { aws --region "$region" "$@"; }

# --- SSM parameters: fail before building if a required secret is missing -------------------------
# Names only; values are never read on this machine.
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
required=(COOKIE_SECRET ANTHROPIC_API_KEY TYPESAFE_API_KEY)
[ "$csrf_enabled" = "true" ] && required+=(CSRF_SECRET)
for name in "${required[@]}"; do
  has_param "$name" || die "SSM parameter ${ssm_prefix}${name} is missing (see README \"Deploy to AWS\")"
done

# --- Images ------------------------------------------------------------------------------------------
image_exists() {
  awsr ecr describe-images --repository-name "investor-game/$1" --image-ids "imageTag=$2" >/dev/null 2>&1
}

if [ -n "$tag" ]; then
  for image in api web; do
    image_exists "$image" "$tag" || die "image investor-game/$image:$tag is not in ECR"
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
      -t "$registry/investor-game/api:$tag" --push .
    sentry_secret=()
    if [ -n "${SENTRY_AUTH_TOKEN:-}" ]; then
      sentry_secret=(--secret "id=sentry_auth_token,env=SENTRY_AUTH_TOKEN")
    else
      echo "SENTRY_AUTH_TOKEN is not set: web source maps will not be uploaded to Sentry" >&2
    fi
    docker buildx build --platform "$platform" --target web --build-arg "VITE_CSRF_ENABLED=$csrf_enabled" \
      --build-arg "VITE_SENTRY_DSN=$sentry_web_dsn" --build-arg "VITE_SENTRY_RELEASE=$tag" \
      ${sentry_secret[@]+"${sentry_secret[@]}"} -t "$registry/investor-game/web:$tag" --push .
  fi
fi

# --- Remote deploy through SSM Run Command -----------------------------------------------------------
ping=$(awsr ssm describe-instance-information --filters "Key=InstanceIds,Values=$instance_id" \
  --query 'InstanceInformationList[0].PingStatus' --output text)
[ "$ping" = "Online" ] || die "instance $instance_id is not reachable through SSM (status: $ping); is it still booting?"

compose_b64=$(base64 <"$repo_root/docker-compose.aws.yml" | tr -d '\n')
caddy_b64=$(base64 <"$repo_root/docker/Caddyfile" | tr -d '\n')

# Runs as root on the instance. Secrets are written to .env and never echoed.
remote_script=$(
  cat <<REMOTE
set -euo pipefail
export AWS_REGION='$region' SSM_PREFIX='$ssm_prefix'
TAG='$tag'; DOMAIN='$domain'; API_DOMAIN='$api_domain'; REGISTRY='$registry'
cd /opt/investor

mountpoint -q /srv/investor || { echo "data volume is not mounted at /srv/investor; bootstrap incomplete (see /var/log/cloud-init-output.log)" >&2; exit 1; }
docker compose version >/dev/null

previous=\$(sed -n "s/^IMAGE_TAG='\(.*\)'\$/\1/p" .env 2>/dev/null || true)
echo "previous tag: \${previous:-none}"

# Stage the next release; the running stack is untouched until the images are pulled.
rm -rf next && mkdir -m 700 next
echo '$compose_b64' | base64 -d > next/docker-compose.yml
echo '$caddy_b64' | base64 -d > next/Caddyfile

umask 077
aws ssm get-parameters-by-path --path "\$SSM_PREFIX" --with-decryption --output json \
  | python3 -c '
import json, os, sys
prefix = os.environ["SSM_PREFIX"]
params = {p["Name"][len(prefix):]: p["Value"] for p in json.load(sys.stdin)["Parameters"]}
required = ["COOKIE_SECRET", "ANTHROPIC_API_KEY", "TYPESAFE_API_KEY"]
if params.get("CSRF_ENABLED") == "true":
    required.append("CSRF_SECRET")
missing = [n for n in required if not params.get(n)]
if missing:
    sys.exit("missing SSM parameter(s): " + ", ".join(prefix + n for n in missing))
for name, value in sorted(params.items()):
    # Single-quoted .env values are literal in Compose; reject what cannot be quoted that way.
    if "/" in name or chr(39) in value or "\n" in value:
        sys.exit("SSM parameter " + prefix + name + " has an unsupported name or value (quote or newline)")
    print(f"{name}={chr(39)}{value}{chr(39)}")
' > next/.env
{
  echo "ECR_REGISTRY='\$REGISTRY'"
  echo "IMAGE_TAG='\$TAG'"
  echo "DOMAIN='\$DOMAIN'"
  echo "API_DOMAIN='\$API_DOMAIN'"
} >> next/.env

docker compose -f next/docker-compose.yml pull --quiet

# Promote. The Caddyfile is bind-mounted as a single file, so overwrite it in place (same inode).
caddy_changed=false
cmp -s next/Caddyfile Caddyfile 2>/dev/null || caddy_changed=true
cat next/Caddyfile > Caddyfile
mv next/docker-compose.yml docker-compose.yml
mv next/.env .env
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
)

params_json=$(python3 -c 'import json, sys; print(json.dumps({"commands": [sys.stdin.read()], "executionTimeout": ["600"]}))' <<<"$remote_script")

echo "Deploying $tag to $instance_id"
command_id=$(awsr ssm send-command --instance-ids "$instance_id" --document-name AWS-RunShellScript \
  --comment "investor-game deploy $tag" --parameters "$params_json" --query Command.CommandId --output text)

while :; do
  status=$(awsr ssm get-command-invocation --command-id "$command_id" --instance-id "$instance_id" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$status" in
    Pending | InProgress | Delayed) sleep 5 ;;
    *) break ;;
  esac
done

remote_out=$(awsr ssm get-command-invocation --command-id "$command_id" --instance-id "$instance_id" \
  --query StandardOutputContent --output text)
remote_err=$(awsr ssm get-command-invocation --command-id "$command_id" --instance-id "$instance_id" \
  --query StandardErrorContent --output text)
[ -n "$remote_out" ] && printf '%s\n' "$remote_out"
[ -n "$remote_err" ] && printf '%s\n' "$remote_err" >&2
[ "$status" = "Success" ] || die "remote deploy $status (command $command_id)"

previous=$(sed -n 's/^previous tag: //p' <<<"$remote_out")

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

echo "Deployed $tag to https://$domain (API also at https://$api_domain/api)"
echo "Previous tag: ${previous:-none}   (roll back with: scripts/aws-deploy.sh --tag ${previous:-<tag>})"
