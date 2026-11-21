# Campus Venue

College venue booking and approval management. The system now covers the full
lifecycle: registration and administrator approval, venue catalogue and calendar,
event collaboration, faculty endorsement, multi-step approval workflows, atomic
final allotment, cancellation, audit history, and production deployment controls.

## Stack

- **Frontend:** React 19, TypeScript, Vite, React Router, TanStack Query
- **Backend:** Fastify 5, TypeScript, Drizzle ORM, Zod
- **Database:** PostgreSQL 16 with `btree_gist`, `tstzrange` and exclusion constraints
- **Auth:** Argon2id passwords, opaque database-backed sessions, HttpOnly cookies,
  double-submit CSRF protection
- **Background work:** PostgreSQL-backed notification outbox with `SKIP LOCKED`
- **Deployment:** Docker Compose, Nginx TLS reverse proxy, GitHub Actions CI
- **Workspace:** pnpm workspaces (`apps/api`, `apps/web`, `packages/shared`)

## Prerequisites

- Node.js 22 or newer
- pnpm 10 (`corepack enable` if needed)
- Docker with Compose

## Local setup

```bash
cp .env.example .env
pnpm install
docker compose up -d
# Existing Docker volumes do not re-run init-databases.sql:
docker compose exec postgres createdb -U venue venue_e2e || true
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The default local services are:

| Service | URL |
| --- | --- |
| Web app | <http://localhost:5173> |
| API | <http://localhost:4000> |
| Liveness | <http://localhost:4000/health> |
| Readiness | <http://localhost:4000/health/ready> |
| PostgreSQL | `localhost:5433` (`venue_dev`, `venue_test`, `venue_e2e`) |

The seed creates departments, roles, a default workflow, sample venues and one
administrator using the `SEED_ADMIN_*` values in `.env`. The defaults in
`.env.example` are development credentials only; change them before using a
shared database.

Registration creates a pending account. An administrator signs in, opens
**Approvals**, assigns at least one role, and approves or rejects the request.
Pending, rejected and suspended accounts cannot sign in.

## Commands

```bash
pnpm dev             # shared build + API and web dev servers
pnpm build           # production build for shared, API and web
pnpm typecheck       # type-check every workspace
pnpm test            # API integration and schema-integrity tests
pnpm test:e2e        # Playwright registration, approval and booking workflows
pnpm lint            # ESLint
pnpm db:generate     # generate a Drizzle migration
pnpm db:migrate      # apply migrations to DATABASE_URL
pnpm db:seed         # seed departments, roles, workflow, venues and admin
```

Tests use `TEST_DATABASE_URL` and apply migrations automatically. They reset
application data between cases; do not point `TEST_DATABASE_URL` at a database
you need to keep.

Browser tests refuse to run in production or against a non-local database host.
Set `E2E_DATABASE_URL` (the example points at `venue_e2e`) so test accounts and
bookings do not pollute development data. The Playwright web server applies
migrations and the idempotent seed before starting.

## Repository layout

```text
apps/api/             Fastify API, Drizzle schema/migrations, integration tests
apps/web/             React application and design system
packages/shared/      Shared Zod schemas, roles, statuses and API types
docs/                 Product blueprint, phase records and production runbook
infra/                PostgreSQL bootstrap, Nginx template and certificates
scripts/              PostgreSQL backup and restore scripts
docker-compose.yml    Local PostgreSQL 16 service
docker-compose.prod.yml  Production API, web, migrate and PostgreSQL services
```

## Security notes

- Passwords are hashed with Argon2id (64 MiB, 3 iterations, parallelism 4).
- Session tokens are random, stored only as SHA-256 hashes, sent in an HttpOnly
  cookie, and revoked on logout.
- Authenticated state-changing requests require a matching CSRF header and an
  allowed `Origin`; logout is protected too.
- Login, registration and global routes are rate limited.
- Admin routes require the `ADMINISTRATOR` role. Suspending an account revokes
  all of its sessions immediately, and role reductions apply to existing sessions.
- API and web responses send Content Security Policy and standard security
  headers. Production enforces secure cookies and HTTPS.
- Request/event/allotment detail and competitor comparison routes enforce owner,
  participant or approver scope; request IDs are not an authorization bypass.
- Confirmed allotments use a PostgreSQL exclusion constraint. Booking checks add
  setup/cleanup buffers before allowing a request, while overlapping pending
  requests remain allowed.
- Approval, rejection, venue changes, booking submissions and cancellations run
  in transactions with row locks and append-only audit records.
- Notifications are written to a transactional outbox and delivered by a worker,
  so an unavailable email/webhook relay cannot roll back a business decision.
- Logs redact cookies and authorization headers.

## Production

See `docs/PRODUCTION_RUNBOOK.md` for TLS, secrets, deployment, migrations,
backups, restore drills, monitoring, incident response, operating costs and
scaling limits.

```bash
cp .env.production.example .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

PostgreSQL and the API are not published to the host; only Nginx exposes ports
80/443.

## Status

Phases 1–6 are complete. Phase 6 covers production security, reliable
notification delivery, session cleanup, health checks, backups, containers,
HTTPS reverse proxying, CI and operating documentation. Known limitations are
listed in `docs/PHASE_6.md`.
