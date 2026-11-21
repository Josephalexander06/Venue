# Phase 5: Complete Frontend Integration, Event Collaboration & Mandatory Faculty Endorsement

## 1. Executive Summary

Phase 5 extends the College Venue Booking and Approval Management System with complete end-to-end frontend integration, robust multi-user event collaboration, and mandatory preliminary endorsement for student-submitted venue requests. All previous core guarantees from Phases 1–4—including GiST exclusion constraints, atomic conflict resolution, pessimistic locking transactions, and immutable audit trails—are strictly preserved.

---

## 2. Confirmed Business Logic & Collaboration Model

### 2.1 Role Separation in Event Lifecycles
- **Event Creator (`events.creator_id`)**: The individual (student or faculty) who authored the event. Retains primary management authority over the event and its team.
- **Faculty Coordinator (`events.faculty_coordinator_id`)**: An active faculty member or Head of Department (`HOD`) within the event's department assigned to oversee the event.
  - Mandatory requirement before any student organizer or creator can request a venue.
  - Faculty-submitted events do not require a separate faculty coordinator endorsement stage.
- **Event Organizers (`event_organizers`)**: Co-organizers assigned to collaborate on an event. Authorized to submit venue requests, view team information, and track progress.
- **Request Submitter (`venue_requests.submitted_by_id`)**: The specific user who initiated a given venue request. Subject to strict separation of duties (cannot approve, endorse, or allot their own request).

### 2.2 Mandatory Faculty Endorsement Flow
1. **Student Submission**: When a student submits a venue booking request, the system verifies that `event.faculty_coordinator_id` is assigned and active.
2. **Initial Stage (`current_step_order = 0`)**: The request is created in `SUBMITTED` status with `requires_faculty_endorsement = true`.
3. **Faculty Coordinator Review**:
   - The request appears exclusively in the assigned faculty coordinator's inbox.
   - Other faculty members or student submitters cannot record decisions (`403 APPROVAL_FORBIDDEN` / `403 SELF_APPROVAL_FORBIDDEN`).
   - The coordinator can request changes (`CHANGES_REQUESTED`), reject (`REJECTED`), or approve (`APPROVED`).
4. **Advancement to Venue Workflow**:
   - Upon coordinator approval, the request records `faculty_endorser_id`, `faculty_endorsed_at`, and advances to Stage 1 of the venue's configured workflow (e.g. HOD → Bursar → Principal).
5. **Direct Faculty Submissions**: Requests submitted directly by faculty bypass Stage 0 and proceed directly to the venue's configured approval workflow.
6. **Critical Edit Reset**: Any critical modification to a student-submitted request (e.g., date/time change) invalidates earlier decisions and resets the request back to Stage 0 for re-endorsement.

---

## 3. Database Schema Extensions

### Migration `0003_event_collaboration.sql`
- **`event_organizers` table**:
  - `id`: UUID primary key.
  - `event_id`: UUID foreign key to `events(id)` ON DELETE CASCADE.
  - `user_id`: UUID foreign key to `users(id)` ON DELETE CASCADE.
  - `assigned_by_id`: UUID foreign key to `users(id)`.
  - `created_at`: `TIMESTAMPTZ` audit timestamp.
  - Unique constraint on `(event_id, user_id)` preventing duplicate assignments.
- **`events` table updates**:
  - `faculty_coordinator_id`: Nullable UUID foreign key to `users(id)` with ON DELETE SET NULL.
- **`venue_requests` table updates**:
  - `submitted_by_id`: UUID foreign key referencing `users(id)`.
  - `requires_faculty_endorsement`: Boolean flag indicating whether Stage 0 is active.
  - `faculty_endorser_id`: Nullable UUID referencing `users(id)`.
  - `faculty_endorsed_at`: Nullable `TIMESTAMPTZ`.
- **`approval_decisions` table updates**:
  - `workflow_step_id`: Made nullable to accommodate Stage 0 decisions which are request-scoped rather than template-scoped.
  - `step_order`: Integer column explicitly capturing stage sequence (0 for endorsement, 1..N for workflow steps).
  - `step_name`: Varchar(100) storing step description (e.g. "Faculty Coordinator Endorsement").
  - Index updated to `approval_decisions_instance_step_decision_unique` on `(approval_instance_id, step_order, decision)`.

---

## 4. API & Backend Enhancements

### 4.1 Department Administration (`/api/v1/admin/departments`)
- `GET /api/v1/admin/departments`: Returns all departments with aggregated metrics (`usersCount`, `venuesCount`, `eventsCount`).
- `POST /api/v1/admin/departments`: Creates a new department validating unique uppercase code.
- `PATCH /api/v1/admin/departments/:id`: Renames or re-codes existing department with audit logging.
- `DELETE /api/v1/admin/departments/:id`: Safely deletes empty departments; rejects with `409 DEPARTMENT_IN_USE` if assigned members, venues, or events exist.
- `GET /api/v1/departments/:id/faculty`: Lists active faculty and HODs in a department for coordinator assignment.

### 4.2 Event Collaboration Endpoints (`/api/v1/events`)
- `GET /api/v1/events/:id/team`: Returns full event roster (creator, assigned faculty coordinator, organizers).
- `GET /api/v1/events/:id/organizer-candidates?search=`: Scoped active-user lookup for event managers (creator, faculty coordinator or administrator). Returns only id, name, email and department; outsiders receive `403`.
- `POST /api/v1/events/:id/coordinator`: Assigns or updates the event's designated faculty coordinator with departmental scope verification.
- `POST /api/v1/events/:id/organizers`: Adds a co-organizer to the event team.
- `DELETE /api/v1/events/:id/organizers/:userId`: Removes co-organizer privileges from an event.

### 4.3 Approval Engine Integration
- `listApprovalInbox`: Queries and unions Step 0 endorsement requests for assigned coordinators with standard workflow requests (Steps 1..N).
- `decideRequest`: Handles Stage 0 transitions atomically, setting `facultyEndorserId` and advancing to venue workflow upon approval.
- `allotVenueRequest`: Enforces separation of duties checking both `event.creatorId` and `request.submittedById`.

---

## 5. Frontend & UI/UX Integration

### 5.1 Admin Department Management
- Created `apps/web/src/pages/AdminDepartmentsPage.tsx` and `apps/web/src/components/DepartmentDialog.tsx`.
- Integrated under the **Administration** navigation menu in `AppShell` with the `Buildings` icon.
- Provides search, member/venue/event metrics, edit modal, and protected deletion dialog.

### 5.2 Event Collaboration & Team Management
- Created `apps/web/src/components/EventTeamDialog.tsx` accessible directly from `MyEventsPage`.
- Displays creator badge, coordinator card with status pill, department faculty dropdown selector, and student organizer management.
- Organizer lookup now uses the event-scoped `/organizer-candidates` endpoint instead of the administrator-only user directory, so student creators and faculty coordinators can add co-organizers without elevated privileges.
- Managers (creator, faculty coordinator, administrator) can assign the coordinator and add or remove organizers; duplicate and self-addition attempts remain blocked by both UI and API validation.

### 5.3 Booking Wizard Enhancements (`VenueDetailPage`)
- For student submissions:
  - Dynamically displays designated faculty coordinator selector populated with department faculty.
  - Visual approval route preview: `Stage 0: Faculty Endorsement` → `Venue Approvals` → `Final Allotment`.
  - Automatically links or sets the coordinator upon submission.
- Multi-day calendar entries now appear on every day they span rather than only their start date.

### 5.4 Approval Tracking & Decision Views
- `MyEventsPage`: Renders faculty coordinator badges on event cards and endorsement status pills on booking rows.
- `ApprovalTimeline`: Clearly renders Stage 0 with a dedicated "Preliminary endorsement" badge and decision remarks.
- `ApprovalDetailPage`: Displays submitter details, faculty coordinator oversight information, and endorsement status blocks.
- `APPROVED_PENDING_ALLOTMENT` is labelled **Approved — pending allotment** so it is visually distinct from `CONFIRMED`.
- Competitor comparison receives the real venue capacity, so attendance-to-capacity ratios are accurate.

### 5.5 Booking Cancellation & Status Lifecycle
- Organizers can now cancel **confirmed** bookings directly from `MyEventsPage`; the action releases the active allotment and GiST slot through the existing request-cancellation endpoint.
- Open requests retain the existing cancel action, and critical slot edits still restart the approval workflow.
- Cancelling the last remaining request for an event follows the existing event-cancellation rule.

### 5.6 Responsive & Accessible Layout
- Added mobile/tablet layout rules for approval inbox cards, competitor comparison grids, approval summary cards, team-member rows and organizer forms.
- Approval and team actions wrap instead of overflowing on narrow screens.
- Fixed the organizer form field flex selector so the email input and button share the row correctly on desktop.
- Playwright now verifies desktop, tablet (834px) and mobile (Pixel 7) viewports for horizontal overflow and key navigation.

---

## 6. Automated Test Coverage & Verification

All automated API tests across all 6 test suites pass with 100% success rate:

```
Test Files  6 passed (6)
     Tests  54 passed (54)
  Duration  18.81s
```

Playwright browser journeys also pass on desktop, tablet and mobile:

```
Running 3 tests using 1 worker
  ✓ desktop-chromium  registration, approval, booking, endorsement and final allotment journey
  ✓ tablet-chromium   mobile venue calendar and booking form stay usable
  ✓ mobile-chromium   mobile venue calendar and booking form stay usable
  3 passed (46.6s)
```

### Test Suites:
1. `tests/allotments.test.ts` (11 tests): Atomic allotment, GiST exclusion constraints, concurrent race handling, idempotent retries, separation of duties.
2. `tests/approvals.test.ts` (10 tests): Multi-step sequential workflows, rejection termination, invalidation triggers, and inbox queries.
3. `tests/bookings.test.ts` (13 tests): Event and venue booking creation, buffer computations, availability queries, and status transitions.
4. `tests/auth.test.ts` (8 tests): User registration, approval lifecycles, session cookies, and role scoping.
5. `tests/schema-integrity.test.ts` (5 tests): Timezone-aware TSTZRANGE enforcement, GiST exclusion locks, and append-only audit trail integrity.
6. `tests/collaboration.test.ts` (7 tests):
   - Mandatory faculty coordinator validation before student submission (`400 FACULTY_COORDINATOR_REQUIRED`).
   - Rejection of cross-department or non-faculty coordinator assignments (`400 COORDINATOR_DEPARTMENT_MISMATCH` / `INVALID_FACULTY_COORDINATOR`).
   - Co-organizer addition, team inspection, and organizer submission privileges.
   - Event-scoped organizer candidate search for managers, with outsider enumeration blocked (`403`).
   - Non-collaborator access rejection (`403 EVENT_ACCESS_FORBIDDEN`).
   - Assigned faculty coordinator inbox discovery and Stage 0 endorsement approval advancing to Stage 1.
   - Unauthorized faculty decision blocking (`403 APPROVAL_FORBIDDEN`) and self-approval blocking (`403 SELF_APPROVAL_FORBIDDEN`).
   - Direct faculty submission bypass of Stage 0.
   - Critical edit invalidation resetting student requests back to Stage 0.
   - Full admin department CRUD and department faculty listing.

---

## 7. Build, Lint & Typecheck Verification
Run from the repository root:

| Command | Result |
| --- | --- |
| `pnpm test` | 6 files, 54 tests passed |
| `pnpm typecheck` | Shared, API and Web packages clean |
| `pnpm lint` | 0 errors, 0 warnings |
| `pnpm build` | Shared, API and Web production builds succeeded |
| `pnpm test:e2e` | 3 browser projects passed |

The previous typecheck failure in `apps/api/tests/collaboration.test.ts` (inserting a non-existent `isActive` column into `approval_workflows`) was fixed. The booking journey was updated to create and approve a faculty coordinator before selecting them, reflecting the mandatory Phase 5 endorsement rule.

## 8. Known Limitations
- The booking flow remains a single, calendar-driven form rather than a multi-step wizard; it already validates conflicts and routes approval correctly, so it was not rewritten.
- Approval inbox pagination is not exposed in the UI; the page requests the first 50 eligible requests.
- Administrator suspension/reactivation actions are not exposed because no matching API endpoint exists yet.
- Request-change feedback is visible in the status dialog and timeline but not inline on the My Events card.
- Calendar month cells intentionally show requests by their start/end dates only; buffer-only overlaps are surfaced in the conflict panels, not as separate calendar days.
