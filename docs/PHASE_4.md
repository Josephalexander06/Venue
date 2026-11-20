# Phase 4 — Atomic Venue Allotment & Conflict Resolution Engine

## Delivered

- **Final Venue Allotment & State Transition**:
  - Restricts final allotment commits strictly to requests in `APPROVED_PENDING_ALLOTMENT` status. Preliminary approvals never automatically reserve a venue or insert confirmed allotment records.
  - Authorized final approver execution: Enforces that the winning request must be explicitly selected and committed by the authorized decision-maker designated by the workflow's terminal allotment step:
    - **HOD-only workflows**: Department HOD has sole authority to allot.
    - **Principal-only workflows**: Principal has sole authority to allot.
    - **Bursar-only workflows**: Bursar has sole authority to allot.
    - **Multi-step workflows (e.g., HOD → Bursar → Principal)**: Only the terminal step approver (Principal) possesses allotment authority.
  - Strict separation of duties: Event organizers cannot allot their own requests (`SELF_APPROVAL_FORBIDDEN`), even if they hold an institutional approver or administrative role.
  - Administrative override: Administrators can allot requests on behalf of other roles, strictly requiring explicit justification remarks ($\ge 5$ characters) stored permanently in the audit trail.
  - Request state transitions atomically from `APPROVED_PENDING_ALLOTMENT` to `CONFIRMED`.
  - Winning event state transitions to `SUBMITTED` (confirmed active booking).
  - Active `venue_allotments` record is created with `status = 'ACTIVE'`, linking `venueRequestId`, `venueId`, `eventId`, `allottedBy`, and PostgreSQL `tstzrange` covering setup and teardown buffers.

- **Atomic Conflict Resolution & Concurrency Controls**:
  - Pessimistic locking: Allotment transactions lock both the target venue row (`SELECT id FROM venues WHERE id = $1 FOR UPDATE`) and the target request row (`SELECT ... FROM venue_requests FOR UPDATE`) to serialize competing allotment requests.
  - Deadlock & serialization retry wrapper (`withRetry`): Safely traps transient database deadlocks (`40P01`) and serialization failures (`40001`) with randomized exponential backoff (up to 3 retries) before raising structured conflict errors.
  - Double-booking prevention via PostgreSQL GiST exclusion constraint: Backed by `no_overlapping_active_allotments` on `(venue_id WITH =, reserved_range WITH &&) WHERE (status = 'ACTIVE')`. Exclusion constraint violations (`23P01`) are trapped and mapped to HTTP 409 `SLOT_ALREADY_ALLOTTED`.
  - Atomic competitor superseding: Atomically identifies all overlapping unresolved requests in `SUBMITTED`, `IN_REVIEW`, or `APPROVED_PENDING_ALLOTMENT` for that venue:
    - Updates their status to `SUPERSEDED_CONFLICT`.
    - Sets clear rejection reason referencing the winning event title and rescheduling guidance (`Slot allotted to another conflicting event ('<title>'). Please reschedule.`).
    - Deactivates any active approval instances (`isActive = false`) to halt pending workflow stages.
    - Emits individual `REQUEST_SUPERSEDED` audit log entries.
  - Idempotent allotment submission: Re-submitting an allotment for an already confirmed request returns HTTP 200 with the active allotment details and `supersededRequestsCount: 0`.

- **Cancellation & Slot Release Engine**:
  - Authorized cancellation via `POST /api/v1/allotments/:id/cancel` and `DELETE /api/v1/allotments/:id`.
  - Permitted actors: Event organizer, the allotting approver, or system administrators.
  - Releasing PostgreSQL exclusion reservation: Updates allotment status to `CANCELLED`, which immediately releases the GiST exclusion constraint (`WHERE status = 'ACTIVE'`), allowing new bookings in that time slot.
  - Request cancellation: Associated `venue_requests` row is marked `CANCELLED` with recorded reason.
  - Preserves full audit history: Emits `ALLOTMENT_CANCELLED` and `SLOT_RELEASED_NOTICE` audit records.
  - Non-automatic confirmation policy: Superseded competitor requests are **never** automatically promoted to confirmed when an allotment is cancelled; slots become cleanly available on the campus schedule for re-application.

- **Responsive User Interface & Dashboards**:
  - **Allotment Inbox Tabs (`ApprovalInboxPage`)**:
    - Filter tabs: `All items`, `Preliminary review`, `Ready for allotment` (items in `APPROVED_PENDING_ALLOTMENT`), `With overlaps`.
    - Dedicated "Review & allot" quick-action button on cards ready for final decision.
  - **Competitor Comparison Split Panel (`CompetitorComparison`)**:
    - Side-by-side view displaying competing applications for the same time window.
    - Renders applicant headcount, venue capacity utilization ratio, department badge, and requested schedule.
  - **Final Allotment Confirmation Dialog (`AllotmentConfirmDialog`)**:
    - Summarizes winning event details, venue buffers, and schedule.
    - Prominent warning indicating the exact count of competing requests that will be superseded upon confirmation.
    - Administrative override remarks input when acting under override authority.
  - **Cancellation & Release Dialog (`AllotmentCancelDialog`)**:
    - Slot release notice explaining that the calendar window will be reopened and superseded organizers notified.
    - Mandatory cancellation reason input ($\ge 3$ characters).
  - **Confirmed Status & Cancellation Action (`ApprovalDetailPage`)**:
    - Prominent Confirmed Reservation banner showing allotter metadata and timestamp.
    - In-place "Cancel Booking & Release Slot" action for authorized organizers/allotters/administrators.
  - **Superseded Guidance**:
    - Rejection guidance banner on `ApprovalDetailPage` and `MyEventsPage` with direct advice to pick an alternative date or venue.
  - **Calendar Integration**:
    - Confirmed reservations appear immediately on venue calendars via `GET /api/v1/venues/:id/calendar`.

---

## API Surface

| Method | Route | Description | Access |
| --- | --- | --- | --- |
| `POST` | `/api/v1/allotments/confirm` | Confirms final venue allotment, supersedes competitors, and locks slot | Authorized Approver / Administrator |
| `GET` | `/api/v1/allotments/competing/:requestId` | Retrieves competing requests overlapping target request's time window | Authenticated |
| `POST` | `/api/v1/allotments/:id/cancel` | Cancels confirmed allotment, releases GiST reservation, and logs audit trail | Organizer / Allotter / Administrator |
| `DELETE` | `/api/v1/allotments/:id` | RESTful alias to cancel confirmed allotment | Organizer / Allotter / Administrator |

---

## Database and Concurrency Architecture

- **GiST Exclusion Constraint**:
  - `venue_allotments` table constraint `no_overlapping_active_allotments`:
    ```sql
    CONSTRAINT no_overlapping_active_allotments
    EXCLUDE USING gist (
      venue_id WITH =,
      reserved_range WITH &&
    ) WHERE (status = 'ACTIVE')
    ```
  - Ensuring zero chance of conflicting confirmed reservations at the database kernel level.
- **Buffer-Aware Ranges**:
  - Reserved range computed via `bufferedRange(startTime, endTime, setupBufferMins, teardownBufferMins)`.
  - Overlap queries check `effectiveRange && reservedRange`.
- **Row-Level Serialization**:
  - `tx.execute(sql`SELECT id FROM venues WHERE id = ${venueId} FOR UPDATE`)`
  - `tx.select().from(venueRequests).where(eq(venueRequests.id, requestId)).for('update')`
- **Audit Log Actions**:
  - `ALLOTMENT_CONFIRMED`: Records `requestId`, `venueId`, `eventId`, `reservedRange`, `remarks`, `isAdministrativeOverride`, and `supersededCount`.
  - `REQUEST_SUPERSEDED`: Records `status: SUPERSEDED_CONFLICT`, reason, winning `requestId`, and `allotmentId`.
  - `ALLOTMENT_CANCELLED`: Records `status: CANCELLED`, cancellation reason, and `affectedSupersededCount`.
  - `SLOT_RELEASED_NOTICE`: Records `releasedRange` and affected superseded request IDs.

---

## Test Verification

A dedicated automated test suite was added in `apps/api/tests/allotments.test.ts` covering 11 critical scenarios:

1. **Single approved request allotment**: Successfully transitions request to `CONFIRMED`, inserts active allotment row, and records `ALLOTMENT_CONFIRMED` audit log.
2. **Competing approved requests**: Exactly one request wins; competing overlapping request is atomically superseded to `SUPERSEDED_CONFLICT` with clear rescheduling guidance and deactivated approval instances.
3. **Concurrent final allotment attempts**: Simultaneous allotment submissions are serialized; exactly one succeeds (HTTP 200) and competitor receives clean conflict error (HTTP 409).
4. **Duplicate / idempotent submissions**: Repeated confirmation calls for an already allotted request return HTTP 200 with existing allotment details and zero superseded count.
5. **Separation of duties**: Request creator attempting to self-allot receives HTTP 403 `SELF_APPROVAL_FORBIDDEN`.
6. **Unauthorized approver and cross-department access**: Non-eligible approvers (cross-department HOD, Bursar on HOD workflow, Student) receive HTTP 403 `ALLOTMENT_FORBIDDEN`.
7. **Administrative override remarks requirement**: Admin allotment on non-admin step without remarks ($\ge 5$ chars) fails with HTTP 400 `OVERRIDE_REMARKS_REQUIRED`; succeeds with valid remarks and records override in audit log.
8. **Buffer overlap enforcement**: Requests overlapping setup/teardown buffers trigger GiST conflict resolution and competitor superseding.
9. **Cancellation and slot release**: Cancelling an active allotment marks it `CANCELLED`, releases the GiST reservation, records audit trail, and allows a replacement request for the exact same time slot to be confirmed immediately.
10. **Multi-step workflow final allotment authority**: In multi-step workflows (HOD → Bursar → Principal), allotment attempts prior to the final step or by non-final approvers are rejected; only the Principal can allot.
11. **Calendar and permission queries**: Confirmed allotments appear in venue calendar queries and request detail views accurately expose `canAllot` and `canCancelAllotment` permissions.

### Verification Summary
- **Vitest**: 47 passing tests across 5 test suites (`allotments.test.ts`, `approvals.test.ts`, `bookings.test.ts`, `auth.test.ts`, `schema-integrity.test.ts`).
- **TypeScript**: 0 typecheck errors across `@venue/shared`, `apps/api`, and `apps/web`.
- **ESLint**: 0 errors and 0 warnings across all workspaces.
- **Vite Build**: Production web bundle successfully built.
