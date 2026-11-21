# Phase 6: Production Security, Reliability & Deployment Readiness

## 1. Executive Summary

Phase 6 hardens the existing College Venue system for a single-college production deployment without changing its domain model or approval rules. The work covers verified security defects, session lifecycle, audit protection, reliable notification delivery, health/monitoring, database backups, production containers, HTTPS reverse proxying, CI, and operating documentation.

All prior guarantees remain in place: PostgreSQL GiST exclusion constraints, atomic allotment transactions, row-level locking, separation of duties, and append-only audit records.

---

## 2. Security Hardening

### 2.1 HTTP security headers

- Helmet now sends a strict API Content Security Policy (`default-src 'none'`, no framing, no form submissions).
- Added `Referrer-Policy: no-referrer` and kept `X-Content-Type-Options`, `X-Frame-Options`, and cross-origin protections.
- HSTS is enabled only when `NODE_ENV=production`.
- All `/api/v1` responses send `Cache-Control: no-store` so authenticated data is not cached by shared proxies.
- The production Nginx reverse proxy sends its own CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and `Cross-Origin-Opener-Policy` for the SPA. The SPA CSP allows only same-origin scripts, same-origin fonts/images, and inline styles required by the existing design system.

### 2.2 CSRF and CORS

- `POST /auth/logout` is no longer CSRF-exempt. A session cookie alone cannot revoke a session; the double-submit token header is required.
- Login and registration remain exempt because they create the session/token pair.
- CORS is restricted to the configured frontend origin, with an explicit header allow-list and a short preflight cache.
- Cross-origin requests from an unexpected `Origin` are rejected before state changes.

### 2.3 Account status and privilege changes

- `PATCH /api/v1/admin/users/:id/suspend` suspends an active account, revokes every existing session in the same transaction, records an audit entry, and queues a notification.
- `PATCH /api/v1/admin/users/:id/reactivate` restores a suspended account and queues a notification.
- Self-suspension and suspension of the last active administrator are blocked.
- Roles continue to be loaded from the database on every request, so a role reduction immediately removes access even from an existing session. This is covered by a regression test.
- Pending, rejected, suspended, expired-session, and revoked-session accounts cannot reach protected routes.

### 2.4 Authorization / IDOR fixes

- `GET /api/v1/allotments/competing/:requestId` previously accepted any authenticated user. It now requires an approver role and reuses the request access rules, so unrelated accounts receive `404` instead of competitor details.
- Existing owner/participant checks remain on request, event, approval-detail, team, organizer-candidate, and allotment-cancel routes.

### 2.5 Production credentials and logging

- Production startup rejects insecure cookies (`COOKIE_SECURE=false`) and non-HTTPS `FRONTEND_URL`.
- Optional environment values passed as empty strings by Compose are normalized to `undefined`, avoiding accidental validation failures.
- API logs redact cookies, authorization headers, and `Set-Cookie` headers.
- The repository's development seed credentials remain development-only; production uses `.env.production.example` with placeholders and must never commit the real file.
- Audit logs remain append-only through the existing `audit_logs_append_only` trigger.

### 2.6 Error responses

PostgreSQL constraint failures now return controlled responses instead of generic 500s:

| SQLSTATE | Response |
| --- | --- |
| `23503` foreign-key violation | `409 RELATED_RECORD_IN_USE` |
| `23514` check violation | `400 CONSTRAINT_VIOLATION` |
| `22P02` invalid identifier | `400 INVALID_IDENTIFIER` |
| `23505` unique violation | Existing `409` mapping |
| `23P01` exclusion violation | Existing `409 SLOT_ALREADY_ALLOTTED` |

---

## 3. Reliability

### 3.1 Session cleanup

- `cleanupSessions` removes sessions that expired or were revoked more than `SESSION_RETENTION_DAYS` ago.
- The API runs cleanup at startup and every `SESSION_CLEANUP_INTERVAL_HOURS` thereafter.
- A new `sessions_expiry_idx` index keeps cleanup cheap.
- Cleanup failures are logged and do not stop the API.

### 3.2 Approval inbox pagination

- The approval inbox UI now requests 10 items per page and exposes Previous/Next controls with an accurate total and range.
- The API already returned `total`, `limit`, and `offset`; the UI now uses them.
- Filter tabs reset the page to the first page.
- Existing bounded queries for admin users, venue lists, and “my events” remain in place.

### 3.3 Transactional notification outbox

A new `notification_outbox` table and worker provide reliable delivery without putting external services inside approval/allotment transactions:

1. Approval, rejection, changes-requested, final allotment, cancellation, superseded-request, suspension, and reactivation actions insert notification rows inside the same database transaction as the business change and audit entry.
2. A background worker claims pending rows with `FOR UPDATE SKIP LOCKED`, so multiple API replicas cannot deliver the same row twice.
3. Delivery uses either:
   - `NOTIFICATION_MODE=log` (development/observability), or
   - `NOTIFICATION_MODE=webhook` with `NOTIFICATION_WEBHOOK_URL` and optional bearer token.
4. Failed deliveries retry with exponential backoff up to `NOTIFICATION_MAX_ATTEMPTS`; failures are recorded in `last_error` and never roll back the approval/allotment.
5. Rows stuck in `PROCESSING` after a crash are recovered after five minutes.

The webhook is intentionally generic so a college can connect email/SMS relays without adding SMTP or vendor SDKs to the API.

### 3.4 Health, readiness, and structured logs

- `GET /health` and `/health/live` are liveness checks.
- `GET /health/ready` executes `SELECT 1` and returns `503` when the database is unavailable.
- Fastify/Pino structured logs include request IDs, status codes, durations, and redacted sensitive headers.
- Health endpoints are exempt from rate limiting.
- Production Compose uses `/health/ready` for the API container health check.

### 3.5 Database migration

Migration `0004_gigantic_master_chief.sql` adds:

- `notification_outbox` with status check constraint, recipient foreign key, and pending-work index.
- `sessions_expiry_idx`.

The generated migration was corrected to avoid replaying the already-applied Phase 5 schema changes; it only contains Phase 6 additions.

---

## 4. Production Deployment

### 4.1 Containers

- `apps/api/Dockerfile`: multi-stage pnpm build, production Node 22 Alpine runtime, Tini init, non-root `node` user, compiled API and Drizzle migrations included.
- `apps/web/Dockerfile`: Vite production build served by Nginx 1.27 Alpine with the environment-substituted reverse-proxy template.
- `docker-compose.prod.yml`:
  - PostgreSQL 16 with a named volume and no published port.
  - One-shot `migrate` service; the API starts only after migrations succeed.
  - API exposed only on the internal network.
  - Web/Nginx publishes 80/443 and proxies `/api`, `/health`, and `/health/ready`.
  - Secrets are required from `.env.production`; no production password is committed.
- `infra/nginx/venue.conf.template` provides HTTP-to-HTTPS redirect, TLS 1.2/1.3, ACME challenge support, security headers, SPA fallback, and API proxying.

### 4.2 CI

`.github/workflows/ci.yml` runs:

- Install with frozen lockfile.
- ESLint.
- Typecheck.
- API tests against a PostgreSQL 16 service.
- Production build.
- `docker compose config` validation for the production Compose file.

The lockfile was refreshed to match the existing `@types/node` dependency so frozen installs work in CI and Docker.

### 4.3 Backups

- `scripts/backup-postgres.sh` creates compressed custom-format `pg_dump` files with SHA-256 checksums and retention.
- `scripts/restore-postgres.sh` verifies the checksum, requires explicit confirmation, and restores with `pg_restore`.
- `docs/PRODUCTION_RUNBOOK.md` documents scheduling, off-site copies, restore drills, RPO/RTO, and smoke checks.

### 4.4 Browser-test data isolation

- Playwright refuses to run with `NODE_ENV=production` or against a non-local database host.
- `E2E_DATABASE_URL` is supported and documented; `venue_e2e` is created by the local PostgreSQL bootstrap.
- The E2E web server applies migrations and the idempotent seed before starting.

---

## 5. Verification

Run from the repository root:

| Command | Result |
| --- | --- |
| `pnpm test` | 8 files, 62 tests passed |
| `pnpm typecheck` | Shared, API and Web packages clean |
| `pnpm lint` | 0 errors |
| `pnpm build` | Shared, API and Web production builds succeeded |
| `pnpm test:e2e` | 3 Playwright projects passed |
| Docker API image build | Succeeded |
| Docker web image build | Succeeded |
| API container migration + `/health` + `/health/ready` | Succeeded |
| Nginx configuration test | Succeeded |
| `docker compose -f docker-compose.prod.yml config` | Succeeded |

New test coverage:

- `tests/security.test.ts` (6 tests): security headers, readiness, CSRF logout, suspension/session revocation/reactivation, immediate role reduction, competing-request IDOR, session cleanup.
- `tests/notifications.test.ts` (2 tests): outbox delivery success and failure/retry isolation.

Existing suites remain green: auth, bookings, approvals, allotments, schema integrity, and collaboration.

---

## 6. Known Limitations / Risks

1. **Single API instance assumed for background work.** Multiple replicas are safe for outbox claiming (`SKIP LOCKED`), but operational monitoring is simpler with one API container. The worker is in-process; a dedicated worker process is the next step if traffic grows.
2. **Notification delivery is only as reliable as the configured relay.** `NOTIFICATION_MODE=log` is useful for development but does not send email/SMS. Production should use the webhook mode and monitor `notification_outbox` rows with `status='FAILED'`.
3. **No in-app notification center.** The schema and worker deliver externally; the existing UI does not show a notification bell. Approval status remains visible in request timelines.
4. **Approval inbox filter counts are page-local.** The total is accurate, and pagination is real, but the preliminary/allotment/conflict tab counts describe the current page rather than the entire queue.
5. **“My events” is still bounded to 100 rows.** It is not paginated because the existing UI filters a single list; a larger deployment should add the same paging pattern used by the approval inbox.
6. **TLS certificate issuance is operator-managed.** The Nginx template expects mounted certificate files. ACME HTTP-01 challenge routing is present, but automatic certbot renewal is not embedded in Compose.
7. **No centralized metrics/tracing backend.** Structured logs plus health/readiness are provided; Prometheus/Grafana or an APM agent should be added if the college needs dashboards and alerting.
8. **Production restore is manual and privileged.** The restore script deliberately requires confirmation; operators must test restores against a scratch database first.
