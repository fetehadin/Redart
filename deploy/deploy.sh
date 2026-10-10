#!/usr/bin/env bash
# Deploy the committed HEAD to the server. Run from the repo root on your machine:
#   deploy/deploy.sh            (reads DEPLOY_HOST and DEPLOY_USER from .env.deploy)
# Each deploy is a fresh release folder; `current` points at the live one; the last 5 are kept for rollback.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
[ -f .env.deploy ] && set -a && . ./.env.deploy && set +a
: "${DEPLOY_HOST:?Set DEPLOY_HOST in .env.deploy}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR=/srv/redart
# docker-compose.yml (own Caddy) or docker-compose.behind-proxy.yml (another proxy owns 80/443)
COMPOSE_FILE_NAME="${COMPOSE_FILE_NAME:-docker-compose.yml}"
TARGET="$DEPLOY_USER@$DEPLOY_HOST"

if [ -n "$(git status --porcelain)" ]; then
  echo "You have uncommitted changes; only committed code is deployed. Commit or stash first." >&2
  exit 1
fi
SHA="$(git rev-parse --short HEAD)"
RELEASE="$APP_DIR/releases/$(date -u +%Y%m%d-%H%M%S)-$SHA"
echo "==> Shipping $SHA to $TARGET:$RELEASE"
git archive --format=tar HEAD | ssh "$TARGET" "mkdir -p '$RELEASE' && tar -x -C '$RELEASE'"

echo "==> Building and starting (first build takes a few minutes)"
ssh "$TARGET" bash -se <<REMOTE
set -euo pipefail
cd '$RELEASE'
grep -q '^DOMAIN=CHANGE_ME' $APP_DIR/.env && { echo "Set DOMAIN in $APP_DIR/.env first."; exit 1; }
docker compose --env-file $APP_DIR/.env -f deploy/$COMPOSE_FILE_NAME build
docker compose --env-file $APP_DIR/.env -f deploy/$COMPOSE_FILE_NAME up -d --remove-orphans --wait --wait-timeout 300
ln -sfn '$RELEASE' $APP_DIR/current
ls -1dt $APP_DIR/releases/* | tail -n +6 | xargs -r rm -rf
docker image prune -f >/dev/null
REMOTE

DOMAIN="$(ssh "$TARGET" "grep '^DOMAIN=' $APP_DIR/.env | cut -d= -f2")"
echo "==> Checking https://$DOMAIN/api/health"
for i in 1 2 3 4 5 6; do
  if curl -fsS "https://$DOMAIN/api/health" >/dev/null 2>&1; then echo "Live: https://$DOMAIN ($SHA)"; exit 0; fi
  sleep 10
done
echo "The containers are up, but https://$DOMAIN isn't answering yet. If this is the first deploy, DNS or the certificate may still be settling." >&2
echo "Logs: ssh $TARGET 'cd $APP_DIR/current && docker compose --env-file $APP_DIR/.env -f deploy/$COMPOSE_FILE_NAME logs --tail 100'" >&2
exit 1
