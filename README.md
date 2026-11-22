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

If startup reports a missing notification outbox, connect to your development
database, run `pnpm db:migrate` with the same `DATABASE_URL` used by the API,
and restart `pnpm dev`.

The seed creates departments, roles, a default workflow, sample venues and one
administrator using the `SEED_ADMIN_*` values in `.env`. The defaults in
`.env.example` are development credentials only; change them before using a
shared database.

Registration creates a pending account. An administrator signs in, opens
**Users** in Administration, assigns at least one role, and approves or rejects
the request.
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

## Frontend design system

Campus Venue pairs a quiet green-gray navigation rail with white work surfaces,
strong text contrast and a deep teal for primary actions and selection. Lexend
sets page and section headings, while Source Sans 3 handles controls, forms and
data. Styles use 4–40 px spacing increments, compact rows and visible keyboard
focus. Each page places its main task in the header. Use blue for review or
information, green for confirmation, amber for competing requests and red for
blocking conflicts or destructive actions. Status text stays visible alongside
its color.

Use `PageHeader`, `Button`, `TextField`, `SelectField`, `Alert`, `EmptyState` and
`Dialog` from `apps/web/src/components/ui.tsx`. Use the domain status components
from `booking.tsx` and the tokens at the top of `apps/web/src/styles.css`.
Desktop keeps the workspace navigation in the side rail. Tablet and phone use
bottom navigation and keep admin sections reachable from the console. On narrow
screens, queue and directory rows stack their fields and keep the review action
in view.

The audit found three recurring issues across public entry, event planning and
administration. Space was spent on decoration, cards repeated record metadata,
and approval filters only applied to the current page. The approval inbox and
shell established the visual baseline on desktop and phone before the other
routes were updated. The references informed navigation density, operational
tables and accessible controls. [Linear redesign](https://linear.app/now/how-we-redesigned-the-linear-ui),
[Stripe Dashboard guide](https://docs.stripe.com/dashboard/basics),
[shadcn dashboard blocks](https://ui.shadcn.com/blocks/dashboard).

To reproduce the screenshot set, point `E2E_DATABASE_URL` at a disposable local
database and run `VENUE_CAPTURE=1 pnpm test:e2e e2e/screenshot.spec.ts`. The
capture creates sample users, bookings and decisions through the real API and
writes PNGs under Playwright's output directory.

The approval inbox reads the accessible queue in batches for whole-queue
filtering, sorting and pagination. Its network cost rises with queue size. The
administration schedule displays one venue at a time using the existing
per-venue calendar API.

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

### Vercel, Render and Neon

Vercel serves the web app and forwards `/api` and `/health` requests to Render.
This keeps browser requests on the frontend origin and preserves secure session
cookies and CSRF checks. The Render Blueprint runs the existing API image and
uses a separate Neon PostgreSQL database for durable data.

1. Choose the production Vercel project name or custom domain. Use this origin
   for the backend's `FRONTEND_URL`.
2. Create a Neon Free project with PostgreSQL 16 in **AWS Asia Pacific
   (Singapore)** to match `render.yaml`. Copy its direct connection string and
   use `sslmode=verify-full`. Keep the connection string in your secret store.
3. From the repository root, initialize the new database with the commands below.
   The seed creates the first administrator, the default workflow, departments,
   and sample venues. Use a unique administrator password.
4. In Render, create a **Blueprint** from the repository. Supply `DATABASE_URL`
   with the same Neon connection string and `FRONTEND_URL` with the exact Vercel
   production origin, such as `https://your-project.vercel.app` with no trailing
   slash. Wait for `/health/ready` to return `{"status":"ready"}`.
5. Import the repository in Vercel, leave **Root Directory** at the repository
   root, and set the **Production** variable `VENUE_API_ORIGIN` to the Render
   HTTPS origin before deploying. `vercel.ts` supplies the build and routing
   settings. If Vercel assigns a different production URL, update Render's
   `FRONTEND_URL` to match. Check `/health/ready` on the Vercel domain, open
   `/login` directly, and verify sign-in and sign-out with the seeded administrator.
   Set `VENUE_API_ORIGIN` for each Vercel environment you deploy. For preview
   sign-in, use a dedicated API, database, and stable preview origin.

```bash
(
  set -e
  read -r -s -p 'Neon connection string: ' DATABASE_URL
  printf '\n'
  read -r -p 'Vercel production origin: ' FRONTEND_URL
  read -r -p 'First administrator email: ' SEED_ADMIN_EMAIL
  read -r -s -p 'First administrator password: ' SEED_ADMIN_PASSWORD
  printf '\n'
  : "${DATABASE_URL:?A Neon connection string is required}"
  : "${FRONTEND_URL:?A Vercel production origin is required}"
  : "${SEED_ADMIN_EMAIL:?An administrator email is required}"
  : "${SEED_ADMIN_PASSWORD:?An administrator password is required}"
  export DATABASE_URL FRONTEND_URL SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD
  export NODE_ENV=production COOKIE_SECURE=true
  pnpm --filter @venue/shared build
  pnpm db:migrate
  pnpm db:seed
)
```

For future schema changes, run `pnpm db:migrate` with the same `DATABASE_URL`,
`FRONTEND_URL`, `NODE_ENV`, and `COOKIE_SECURE` before manually deploying the
corresponding Render revision. Run the seed only when initializing a fresh database.

Vercel Hobby is limited to personal, non-commercial use. Render Free sleeps
after 15 minutes without traffic and can take about a minute to wake. The in-app
notification worker pauses while Render sleeps. Use the free setup for a demo or
pilot and verify plan eligibility before a campus rollout.
[Vercel Hobby](https://vercel.com/docs/plans/hobby) ·
[Render Free](https://render.com/docs/free) ·
[Neon regions](https://neon.com/docs/introduction/regions)

### Docker Compose

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
