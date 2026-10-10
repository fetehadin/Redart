#!/usr/bin/env bash
# Restore a backup made by backup.sh. THIS REPLACES THE CURRENT DATABASE.
#   deploy/restore.sh /srv/backups/redart/redart-20261010-031500.dump
set -euo pipefail
APP_DIR=/srv/redart
dump="${1:?Usage: restore.sh <file.dump>}"
[ -f "$dump" ] || { echo "No such file: $dump"; exit 1; }
set -a; . "$APP_DIR/.env"; set +a
read -r -p "Replace the live database with $dump? Type 'restore' to continue: " answer
[ "$answer" = restore ] || { echo "Cancelled."; exit 1; }
compose=(docker compose --env-file "$APP_DIR/.env" -f "$APP_DIR/current/deploy/docker-compose.yml")
"${compose[@]}" stop api web
"${compose[@]}" exec -T db pg_restore -U "${POSTGRES_USER:-redart}" -d "${POSTGRES_DB:-redart}" --clean --if-exists --no-owner < "$dump"
"${compose[@]}" start api web
echo "Restored $dump."
