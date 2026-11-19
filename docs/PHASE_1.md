# Phase 1 — Core Foundation, Database & Authentication

**Status:** Complete · 19 November 2026
**Blueprint:** [`SYSTEM_IMPLEMENTATION_PLAN.md`](SYSTEM_IMPLEMENTATION_PLAN.md)

Phase 1 establishes the production foundation: workspace, PostgreSQL schema,
migrations, Fastify API, authentication, administrator approval, scoped roles and
the responsive institutional UI. Phase 2 application features are intentionally
not implemented yet.

## Acceptance criteria

| Blueprint criterion | Result | Evidence |
| --- | --- | --- |
| `POST /api/v1/auth/register` creates an inactive user | Pass | `users.status` defaults to `PENDING_APPROVAL`; the integration test registers an applicant and receives a pending account. Login before approval returns `403 ACCOUNT_PENDING_APPROVAL`. |
| Administrator can list, approve and reject pending accounts | Pass | Admin directory, pending queue, stats, approve, reject and role endpoints are implemented and covered by integration tests. The same flows were exercised in the browser. |
| Inactive users are rejected by auth guards | Pass | Pending login, rejected login, and an existing session whose account is no longer active all return `403`. Non-administrators receive `403 FORBIDDEN` on admin routes. |
| Database-level conflict guarantee | Pass | Conflicting requests can all be marked `APPROVED_PENDING_ALLOTMENT`; concurrent creation of active allotments produces exactly one winner. The exclusion constraint rejects overlap; tests also accept a concurrent deadlock (`40P01`) because only the committing transaction can win. |
| Timezone-aware reservation ranges | Pass | Both range columns are `tstzrange`; buffer-adjusted `effective_range` is generated from UTC instants, and `reserved_range` is derived by trigger. Database tests verify exact range values across UTC. |

## Delivered scope

### Workspace and tooling

- pnpm workspace with `apps/api`, `apps/web` and `packages/shared`.
- Shared Zod schemas, role definitions, statuses and API types.
- TypeScript strict checking, ESLint configuration, Drizzle Kit and Vitest.
- Docker Compose PostgreSQL 16 on port `5433`, with separate `venue_dev` and
  `venue_test` databases.
- `.env.example`, schema migration, seed script and API/web development scripts.

### Database

Migration `apps/api/drizzle/0000_past_the_anarchist.sql` creates:

- `btree_gist` and all Phase 1–4 tables: `departments`, `venues`, `users`,
  `roles`, `user_roles`, `sessions`, `approval_workflows`, `workflow_steps`,
  `events`, `venue_requests`, `approval_instances`, `approval_decisions`,
  `venue_allotments`, `audit_logs`.
- Enum types for account, role, workflow, request, decision and allotment states.
- Timezone-aware `venue_requests.effective_range` generated from
  `start_time - setup_buffer` to `end_time + teardown_buffer`, half-open `[)`.
- GiST indexes for request and allotment ranges.
- `no_overlapping_active_allotments`: a partial GiST exclusion constraint on
  `(venue_id WITH =, reserved_range WITH &&)` where `status = 'ACTIVE'`.
- A trigger that copies `reserved_range` from the venue request and rejects a
  mismatched venue or event, so clients cannot forge reservation windows.
- Case-insensitive-email guard (`email = lower(email)`) plus a unique email index.
- `NULLS NOT DISTINCT` unique role scopes. This prevents duplicate unscoped roles,
  or duplicate department-scoped rows that differ only by a null venue.
- `updated_at` triggers for mutable Phase 1 tables.
- Append-only `audit_logs`: updates and deletes raise an exception from a trigger.

### API

| Method | Route | Access |
| --- | --- | --- |
| `GET` | `/health` | Public |
| `GET` | `/api/v1/departments` | Public |
| `POST` | `/api/v1/auth/register` | Public, rate limited |
| `POST` | `/api/v1/auth/login` | Public, rate limited |
| `POST` | `/api/v1/auth/logout` | Authenticated |
| `GET` | `/api/v1/auth/me` | Authenticated |
| `GET` | `/api/v1/admin/stats` | Administrator |
| `GET` | `/api/v1/admin/users` | Administrator |
| `GET` | `/api/v1/admin/users/pending` | Administrator |
| `PATCH` | `/api/v1/admin/users/:id/approve` | Administrator |
| `PATCH` | `/api/v1/admin/users/:id/reject` | Administrator |
| `PATCH` | `/api/v1/admin/users/:id/roles` | Administrator |

Admin list supports status filtering, case-insensitive name/email search,
`limit` and `offset`, and returns the total count. Approval requires one or more
roles. Department-scoped roles (`STUDENT`, `FACULTY`, `HOD`) are normalised to a
department; `HOD` must match the applicant's own department. College-wide roles
(`PRINCIPAL`, `BURSAR`, `ADMINISTRATOR`) are unscoped. An administrator cannot
remove their own administrator role.

### Security controls

- Argon2id hashing with 64 MiB memory, 3 iterations, parallelism 4.
- A dummy hash is verified for unknown emails to reduce login timing differences.
- Opaque 256-bit session tokens, stored only as SHA-256 hashes; HttpOnly,
  SameSite-configured cookie. Logout revokes the session row.
- Every request resolves the current account status; inactive accounts are
  rejected and their session revoked.
- Double-submit CSRF: same-site-readable token cookie plus `x-csrf-token` header,
  compared with a timing-safe equality check. Login and registration are exempt
  because they establish the session.
- `Origin` validation on mutations; Helmet, explicit CORS origin, 1 MiB body
  limit, and global/per-route rate limits.
- Zod validation at every trust boundary; consistent API error bodies and field
  errors; unexpected failures are logged without leaking internals.
- Approval, rejection and role replacement run in transactions. Pending reviews
  lock the target row with `FOR UPDATE`, preventing double review.
- Registration, approval, rejection and role changes append audit records with
  actor, IP address, user agent and before/after state.

### Frontend

- React 19 application with public auth routes, authenticated shell, admin routes,
  `403` and `404` screens, route guards and live page titles.
- Design system: custom semantic CSS tokens, Lexend headings, Source Sans 3 body,
  navy `#1E3A5F` and ochre `#A16207`, Phosphor icons, accessible form fields,
  buttons, badges, stat cards, tables, native `<dialog>`, toasts and an error
  boundary.
- Screens: sign in, registration, registration pending, home, account, approval
  console, user directory, review/reject dialog and manage-access dialog.
- Admin directory includes status tabs, search, pagination and empty/loading
  states. Review dialog approves with role assignment or rejects with a reason.
- Responsive layout: collapsible desktop sidebar, mobile bottom navigation,
  single-column forms and full-width dialog actions. Reduced-motion preferences
  are respected.

## Verification

Run from the repository root:

```text
pnpm --filter @venue/api test
  2 test files, 13 tests passed
  - 8 auth/authorization integration tests
  - 5 schema-integrity tests

pnpm typecheck
  shared, API and web passed

pnpm lint
  ESLint passed with zero errors

pnpm build
  shared, API and web passed
  Vite: 531.58 kB JS, 51.50 kB CSS (gzip 153.47 kB / 10.74 kB)
```

Schema tests cover:

- `tstzrange` column types and buffer-adjusted range values.
- Overlap rejection including setup/teardown buffers, with adjacent ranges allowed.
- Five conflicting requests marked as preliminarily approved, followed by
  concurrent allotment inserts: exactly one active allotment survives.
- Server-derived reservation ranges, independent of client input.
- Append-only audit rows.

Browser verification was performed with headless Chromium against the running dev
servers at `1440×1000` and `390×844`: registration and validation, pending login
error, admin sign-in, approval with multiple roles, rejection with reason, manage
access, account/home views, forbidden and not-found pages, sign-out redirect, and
mobile navigation/dialog layout. No page errors were observed; expected `401`
responses came from the anonymous session probe.

After verification the development database was reset to a clean seed: one
administrator, 12 departments and 6 roles.

## Deliberate deferrals and known limits

- Phase 2–4 tables exist for forward compatibility, but venue, event, workflow and
  allotment endpoints are not exposed yet.
- No email delivery, email verification or notification worker. Approval is a
  manual administrator action, as required by Phase 1.
- Rate-limit state is in-process. A multi-instance deployment needs a shared store
  (Phase 6).
- Expired/revoked session rows are not garbage-collected yet.
- The CSRF token is session-lifetime rather than rotated per request; the
  double-submit check and origin validation remain in force.
- Concurrent allotment inserts can surface a PostgreSQL deadlock (`40P01`). The
  database still guarantees one winner. Friendly conflict mapping, retries and
  superseding policy belong to Phase 4.
- The production bundle currently ships as one chunk and triggers Vite's 500 kB
  warning. Route-level splitting is deferred until later phases add more screens.
- Browser verification is manual and not yet committed as a CI test. CI/CD,
  production containers and coverage gates belong to Phase 6.

## Next phase

Phase 2: venue catalog CRUD, availability calendar, event drafts and submission,
request creation with automatic buffer-adjusted ranges. Do not begin until Phase 1
is accepted.
