#!/usr/bin/env bash
# Dump the database to /srv/backups/redart and keep 14 days. Runs nightly from cron (see server-setup.sh).
set -euo pipefail
APP_DIR=/srv/redart
OUT=/srv/backups/redart
set -a; . "$APP_DIR/.env"; set +a
COMPOSE_FILE_NAME="${COMPOSE_FILE_NAME:-docker-compose.yml}"
DB_SERVICE="${DB_SERVICE:-db}"
file="$OUT/redart-$(date -u +%Y%m%d-%H%M%S).dump"
docker compose --env-file "$APP_DIR/.env" -f "$APP_DIR/current/deploy/$COMPOSE_FILE_NAME" exec -T "$DB_SERVICE" \
  pg_dump -U "${POSTGRES_USER:-redart}" -d "${POSTGRES_DB:-redart}" --format=custom > "$file.partial"
mv "$file.partial" "$file"
find "$OUT" -name 'redart-*.dump' -mtime +14 -delete
echo "$(date -u +%FT%TZ) backup ok: $file ($(du -h "$file" | cut -f1))"
