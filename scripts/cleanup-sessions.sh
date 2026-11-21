#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the PostgreSQL connection string.}"
RETENTION_DAYS="${SESSION_RETENTION_DAYS:-7}"

echo "Running session cleanup (retention: ${RETENTION_DAYS} days)..."
psql "$DATABASE_URL" -c "
DELETE FROM sessions
WHERE expires_at < now() - interval '${RETENTION_DAYS} days'
   OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '${RETENTION_DAYS} days');
"
echo "Session cleanup completed."
