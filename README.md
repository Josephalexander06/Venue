# Campus Venue

College venue booking and approval management. This repository currently contains
**Phase 1: core foundation, database, authentication and administrator account
approval** and **Phase 2: venue catalogue, availability calendar and event/booking
requests**. The approval workflow engine and notifications arrive in Phase 3.

## Stack

- **Frontend:** React 19, TypeScript, Vite, React Router, TanStack Query
- **Backend:** Fastify 5, TypeScript, Drizzle ORM, Zod
- **Database:** PostgreSQL 16 with `btree_gist`, `tstzrange` and exclusion constraints
- **Auth:** Argon2id passwords, opaque database-backed sessions, HttpOnly cookies,
  double-submit CSRF protection
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
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The default local services are:

| Service | URL |
| --- | --- |
| Web app | <http://localhost:5173> |
| API | <http://localhost:4000> |
| Health check | <http://localhost:4000/health> |
| PostgreSQL | `localhost:5433` (`venue_dev`, `venue_test`) |

The seed creates departments, roles and one administrator using the
`SEED_ADMIN_*` values in `.env`. The defaults in `.env.example` are development
credentials only; change them before using a shared database.

Registration creates a pending account. An administrator signs in, opens
**Approvals**, assigns at least one role, and approves or rejects the request.
Pending and rejected accounts cannot sign in.

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
you need to keep. Browser tests start the dev servers against the local database,
register a unique account, approve it through the admin UI and submit a booking.
They expect the seeded administrator (`E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`
override the defaults).

## Repository layout

```text
apps/api/             Fastify API, Drizzle schema/migrations, integration tests
apps/web/             React application and design system
packages/shared/      Shared Zod schemas, roles, statuses and API types
docs/                 Product blueprint and phase records
infra/                PostgreSQL database bootstrap
docker-compose.yml    Local PostgreSQL 16 service
```

## Security notes

- Passwords are hashed with Argon2id (64 MiB, 3 iterations, parallelism 4).
- Session tokens are random, stored only as SHA-256 hashes, sent in an HttpOnly
  cookie, and revoked on logout.
- Authenticated state-changing requests require a matching CSRF header and an
  allowed `Origin`.
- Login, registration and global routes are rate limited.
- Admin routes require the `ADMINISTRATOR` role.
- Venue details and request history are owner-or-administrator only; students
  and faculty create events only for their own department.
- Confirmed allotments use a PostgreSQL exclusion constraint. Booking checks add
  setup/cleanup buffers before allowing a request, while overlapping pending
  requests remain allowed.
- Approval, rejection, venue changes, booking submissions and cancellations run
  in transactions with row locks and append-only audit records.
- For HTTPS deployments set `COOKIE_SECURE=true` and configure
  `FRONTEND_URL`/`COOKIE_SAME_SITE` for the real origin.

## Status

Phase 1 and Phase 2 are complete. Phase 3 (approval queue, workflow decisions,
allotments and notifications) has not started.
