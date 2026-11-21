# Production Runbook — Campus Venue

This runbook covers a single-college deployment on one Linux VPS using Docker Compose, PostgreSQL, Nginx, and HTTPS. It is intentionally conservative: the database is never published, the API is only reachable through Nginx, and migrations run as a one-shot service before the API starts.

---

## 1. Deployment Checklist

- [ ] DNS `A`/`AAAA` record for `DOMAIN` points at the VPS.
- [ ] Firewall allows only SSH, HTTP (80), and HTTPS (443).
- [ ] Docker Engine and Compose plugin installed.
- [ ] A long random `POSTGRES_PASSWORD` generated and stored in a password manager.
- [ ] TLS certificate and private key placed in `infra/certs/fullchain.pem` and `infra/certs/privkey.pem`.
- [ ] `.env.production` created from `.env.production.example` with real values.
- [ ] `SEED_ADMIN_*` values changed from development defaults.
- [ ] Notification relay URL/token configured, or `NOTIFICATION_MODE=log` explicitly accepted.
- [ ] Backup destination mounted or reachable, with at least one tested restore.
- [ ] Monitoring checks `/health/ready` from outside the host.

Never commit `.env.production`, database dumps, certificates, or private keys.

---

## 2. Secrets

Generate the database password and webhook token with a password manager or:

```bash
openssl rand -base64 48
```

Create `.env.production`:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

The API validates production configuration and refuses to start when:

- `COOKIE_SECURE` is not `true`,
- `FRONTEND_URL` is not HTTPS, or
- `NOTIFICATION_MODE=webhook` without `NOTIFICATION_WEBHOOK_URL`.

If the database password contains URL-reserved characters, URL-encode it in the resulting `DATABASE_URL` (the Compose file builds the URL from the password). Prefer a long alphanumeric password to avoid encoding mistakes.

---

## 3. TLS

Place certificates where Compose mounts them:

```text
infra/certs/fullchain.pem
infra/certs/privkey.pem
```

The Nginx template also serves `/.well-known/acme-challenge/` from `infra/certbot/` for HTTP-01 issuance. Certificate renewal is operator-managed; after renewal, reload Nginx:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec web nginx -s reload
```

Verify:

```bash
curl -I https://venue.your-college.edu
curl -fsS https://venue.your-college.edu/health/ready
```

Expected: `200`, HSTS present, and `{"status":"ready"}`.

---

## 4. First Deployment

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate
```

Seed the first administrator and reference data once:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm \
  -e SEED_ADMIN_EMAIL \
  -e SEED_ADMIN_PASSWORD \
  -e SEED_ADMIN_FIRST_NAME \
  -e SEED_ADMIN_LAST_NAME \
  api node dist/db/seed.js
```

Then start the application:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

The API waits for the `migrate` service to complete successfully and for PostgreSQL to become healthy. PostgreSQL and the API have no published host ports.

### Updating an existing deployment

```bash
git pull --ff-only
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

Take a backup before running migrations that change or remove data. The Phase 6 migration is additive.

### Rollback

1. Stop the API and web containers.
2. Restore the pre-deploy database backup into a scratch database and verify it.
3. Check out the previous image tag/commit and rebuild.
4. Restore production only after a verified backup and explicit approval.

Application rollback without a database rollback is only safe when the new release did not write incompatible data.

---

## 5. Backups

### Schedule

Run daily at a quiet hour and retain at least 14 daily backups plus weekly/monthly copies off-host.

```cron
15 2 * * * cd /opt/venue && set -a && . ./.env.production && set +a && DATABASE_URL="postgres://venue:${POSTGRES_PASSWORD}@127.0.0.1:5432/venue" BACKUP_DIR=/var/backups/venue /opt/venue/scripts/backup-postgres.sh >> /var/log/venue-backup.log 2>&1
```

If PostgreSQL is only reachable inside Compose, run `pg_dump` through the container instead:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "/var/backups/venue/venue-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Store backups encrypted off-host (object storage, encrypted NAS, or tape). A backup that exists only on the same VPS is not a disaster-recovery backup.

### Verify a backup

```bash
pg_restore --list /var/backups/venue/venue-YYYYMMDDTHHMMSSZ.dump | head
sha256sum --check /var/backups/venue/venue-YYYYMMDDTHHMMSSZ.dump.sha256
```

### Restore drill

Always restore to a scratch database first:

```bash
createdb -h 127.0.0.1 -U venue venue_restore_test
RESTORE_DATABASE_URL="postgres://venue:password@127.0.0.1:5432/venue_restore_test" \
  ./scripts/restore-postgres.sh /var/backups/venue/venue-YYYYMMDDTHHMMSSZ.dump
```

Smoke checks on the scratch database:

```sql
select count(*) from users;
select count(*) from venue_requests;
select count(*) from venue_allotments where status = 'ACTIVE';
select max(created_at) from audit_logs;
```

Then start a temporary API against the scratch database and check `/health/ready`, sign in as a known account, and open one request. Drop the scratch database after verification.

### RPO / RTO

- **RPO:** 24 hours with daily backups; reduce to 1 hour with WAL archiving or more frequent dumps if required.
- **RTO:** 1–2 hours for a single VPS restore, assuming the backup and `.env.production` are available and DNS/TLS are intact.

Test the restore procedure at least once per semester.

---

## 6. Monitoring and Logs

### Health checks

- Liveness: `GET /health` or `/health/live`
- Readiness: `GET /health/ready` (includes a database query)

Alert when readiness fails for more than two minutes, or when the API container restarts repeatedly.

### Logs

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f web
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f postgres
```

Logs are structured JSON from Pino. Cookies and authorization headers are redacted. Configure the Docker log driver to rotate logs (for example `max-size=50m`, `max-file=5`) to avoid filling the disk.

### Notification queue

Check failed deliveries:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "select status, count(*) from notification_outbox group by status;"
```

Inspect recent failures:

```sql
select id, type, attempts, last_error, created_at
from notification_outbox
where status = 'FAILED'
order by created_at desc
limit 20;
```

After fixing the relay, reset selected rows to `PENDING` and set `next_attempt_at = now()`. Do not delete failed rows until they are investigated.

### Suggested alerts

- `/health/ready` non-200 for 2+ minutes.
- API 5xx rate above 1% for 5 minutes.
- PostgreSQL disk usage above 80%.
- Backup job failed or no new backup in 36 hours.
- `notification_outbox` failed count increasing.
- TLS certificate expiring within 21 days.

---

## 7. Operating Costs and Scaling

### Small single-college deployment

| Item | Typical monthly cost |
| --- | --- |
| 2 vCPU / 4 GB VPS | $12–30 |
| 40–80 GB SSD | Included or $5–10 |
| Domain | $10–20/year |
| TLS (Let’s Encrypt) | $0 |
| Off-site backup storage | $1–5 |
| Email/SMS relay | $0–20 |
| **Total** | **~$20–60/month** |

A 1 vCPU / 2 GB VPS can run a small pilot, but 2 GB is the practical minimum because PostgreSQL, Node, Nginx, and the OS share memory.

### Scaling limits

- Single PostgreSQL primary; scale vertically first.
- API is stateless and can be replicated behind the same Nginx upstream. The notification worker uses `SKIP LOCKED`, so multiple replicas are safe, but monitor duplicate worker logs.
- The current schema and authorization model assume one college. Multi-college tenancy would require an explicit tenant key and policy review.
- The approval inbox computes eligible rows in application code; very large queues (tens of thousands of pending requests) would need SQL-side eligibility filtering.
- “My events” returns at most 100 rows. Add pagination before using the system for a much larger event history.
- The in-process worker is adequate for one college. Move it to a dedicated process/queue if notification volume or retry volume grows.

### Capacity guidance

- 5,000–20,000 venue requests/year is comfortably within a 2 vCPU / 4 GB deployment.
- Keep PostgreSQL data and backups on separate storage where possible.
- Add read replicas or a managed PostgreSQL service only after measuring contention; the exclusion constraint remains the source of truth for double-booking prevention.

---

## 8. Security Operations

- Rotate `POSTGRES_PASSWORD` and webhook tokens on a schedule and after staff departures.
- Keep the host patched; rebuild images monthly to pick up Node/PostgreSQL/Nginx security updates.
- Do not publish PostgreSQL port 5432 or the API port 4000.
- Restrict SSH to key authentication and a management IP range where possible.
- Review `audit_logs` for admin overrides, suspensions, role changes, and allotment cancellations.
- Suspend accounts immediately when access should end; suspension revokes sessions in the same transaction.
- Keep `COOKIE_SECURE=true` and HTTPS-only `FRONTEND_URL` in production.
- Back up before schema changes and verify the backup checksum.

---

## 9. Incident Response

### Suspected account compromise

1. Suspend the account as an administrator (revokes sessions immediately).
2. Review `audit_logs` and session history for the account.
3. Reset the password and reactivate only after review.
4. Rotate any exposed notification/webhook credentials.

### Database unavailable

1. Check PostgreSQL container health and disk space.
2. Check `/health/ready` and API logs.
3. If data is corrupted, restore the latest verified backup into a scratch database first.
4. Restore production only after explicit approval and a second verification.

### Double-booking report

1. Confirm the active `venue_allotments` rows and their `reserved_range` values.
2. Check for manual database changes; the GiST exclusion constraint should prevent overlapping active allotments.
3. If an override is required, cancel the incorrect allotment through the application so the slot is released and audited.

### Notification outage

1. Approval and allotment transactions continue; notifications remain in `notification_outbox`.
2. Fix the relay or token.
3. Reset failed rows to `PENDING` with `next_attempt_at = now()`.
4. Confirm the queue drains and no rows remain in `FAILED`.
