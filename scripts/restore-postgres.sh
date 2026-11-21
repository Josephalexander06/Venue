#!/usr/bin/env bash
set -euo pipefail

: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to the target PostgreSQL connection string.}"
: "${1:?Usage: restore-postgres.sh <backup.dump>}"

backup="$1"
if [[ ! -f "$backup" ]]; then
  echo "Backup file not found: $backup" >&2
  exit 1
fi

if [[ -f "$backup.sha256" ]]; then
  sha256sum --check "$backup.sha256"
fi

if [[ "${ALLOW_PRODUCTION_RESTORE:-no}" != "yes" ]]; then
  echo "Restore target: $RESTORE_DATABASE_URL"
  echo "Restore into a scratch database first. Set ALLOW_PRODUCTION_RESTORE=yes only after verifying the backup."
  read -r -p "Type RESTORE to continue: " confirmation
  [[ "$confirmation" == "RESTORE" ]] || exit 1
fi

pg_restore \
  --dbname="$RESTORE_DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  "$backup"

echo "Restore completed. Run the smoke checks in docs/PRODUCTION_RUNBOOK.md."
