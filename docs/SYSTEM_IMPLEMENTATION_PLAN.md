# College Venue Booking and Approval Management System
## Production-Ready Architectural Blueprint & Implementation Plan

---

### Document Information
- **Role Context**: Senior Software Architect, Security Engineer, Product Designer
- **Target Audience**: Engineering Leads, Backend/Frontend Developers, Autonomous Coding Agents
- **Target Repository**: `/home/joseph06/Projects/Venue`
- **Revision**: 1.0.0 (Production Blueprint)

---

## Table of Contents
1. [Executive Summary & Architectural Vision](#1-executive-summary--architectural-vision)
2. [Requirements, Business Rules & Assumptions](#2-requirements-business-rules--assumptions)
3. [Technology Stack & Architectural Trade-offs](#3-technology-stack--architectural-trade-offs)
4. [Modular Monolith Architecture](#4-modular-monolith-architecture)
5. [Database Design & PostgreSQL Exclusion Constraints](#5-database-design--postgresql-exclusion-constraints)
6. [Permission Model & Access Control Matrix](#6-permission-model--access-control-matrix)
7. [Approval Workflow Engine & State Machine](#7-approval-workflow-engine--state-machine)
8. [Booking Conflict Algorithm & Atomic Allotment](#8-booking-conflict-algorithm--atomic-allotment)
9. [API Design & Data Contracts](#9-api-design--data-contracts)
10. [Frontend Architecture & UX Design](#10-frontend-architecture--ux-design)
11. [Security Engineering & Auditability](#11-security-engineering--auditability)
12. [Quality Assurance & Testing Strategy](#12-quality-assurance--testing-strategy)
13. [Phased Implementation Roadmap & Acceptance Criteria](#13-phased-implementation-roadmap--acceptance-criteria)
14. [DevOps, CI/CD & Production Operations](#14-devops-cicd--production-operations)
15. [Clarification Questions & Open Product Decisions](#15-clarification-questions--open-product-decisions)

---

## 1. Executive Summary & Architectural Vision

Colleges struggle with venue bookings due to disconnected manual paper/email approval processes, lack of calendar visibility, and accidental double-bookings. The **College Venue Booking and Approval Management System** is a responsive, multi-role web application designed to bring complete transparency to venue availability, structure multi-tier departmental and administrative approvals, and provide mathematical, database-level guarantees against double-bookings.

### Core Architectural Axiom: Decoupled Domain Modeling
Traditional booking apps mistakenly merge an *Event Request* with a *Confirmed Booking*. This causes severe concurrency bugs when multiple clubs or faculties apply for the same auditorium on the same festival date.
In this architecture, four domain concepts are strictly decoupled:
1. **Event**: The logical entity (title, description, organizing body, expected turnout).
2. **Venue Request**: An application submitted by an event organizer for a specific venue, time window, and equipment setup. Multiple conflicting requests can coexist concurrently.
3. **Approval Decisions**: The progressive review milestones (HOD, Bursar, Facility Manager, Principal) assessing academic merit, safety, and operational feasibility.
4. **Venue Allotment (Confirmed Reservation)**: The final, atomic reservation binding a venue to a single request, protected by PostgreSQL GiST temporal exclusion constraints (`EXCLUDE USING gist`).

```mermaid
flowchart LR
    A["Event Creation\n(Draft / Submitted)"] --> B["Venue Request\n(Venue + Time Range)"]
    B --> C["Approval Workflow\n(Multi-tier Approvals)"]
    C --> D["Preliminary Approval\n(Approved Pending Allotment)"]
    D --> E{"Final Allotment\n(Authorized Approver)"}
    E -->|"Atomic Winner"| F["CONFIRMED Venue Allotment\n(GiST Exclusion Constraint)"]
    E -->|"Competing Requests"| G["SUPERSEDED / CONFLICT\n(Notified to Reschedule)"]
```

---

## 2. Requirements, Business Rules & Assumptions

### 2.1 Functional Requirements Matrix
- **FR-01: User Identity & Account Approval**: Self-registration with email/password; accounts remain inactive (`PENDING_APPROVAL`) until an Administrator verifies identity, departmental affiliation, and assigns initial roles.
- **FR-02: Granular Role & Scope Management**: Support users holding multiple roles simultaneously (e.g., Prof. Smith as `FACULTY` in CS and `HOD` in CS; Dr. Taylor as `FACULTY` and `BURSAR`). Scopes restrict actions (e.g., an HOD can only endorse requests from their department).
- **FR-03: Venue Master Management**: Management of venues with capacity, audiovisual facilities, layout types, buffer times (setup/cleanup intervals), and default approval workflows.
- **FR-04: Transparent Master Calendar**: Public/authenticated view showing confirmed allotments, tentative holds, maintenance blocks, and non-sensitive pending requests (to discourage overlapping applications early).
- **FR-05: Multi-Request Competition**: The system must allow multiple distinct events to submit venue requests for the identical venue and time interval.
- **FR-06: Configurable Approval Workflows**: Workflows customizable per venue or department (e.g., Seminar Hall = HOD only; Main Auditorium = HOD -> Bursar -> Principal).
- **FR-07: Invalidation on Modification**: If an organizer alters the date, time, or venue of an in-flight request, all existing approvals are automatically invalidated, the request is reset to step 1, and an audit entry is generated.
- **FR-08: Atomic Allotment Decision**: A designated final approver or venue authority picks the winning request. The selected request transitions to `CONFIRMED`; all overlapping pending requests are flagged as `SUPERSEDED_CONFLICT` with instant notifications.
- **FR-09: Cancellation & Relinquishment**: Organizers can cancel requests or allotments before event start, automatically releasing the calendar slot and notifying waitlisted/conflicting requesters.
- **FR-10: Immutable Audit Trail**: Every status change, approval decision, comment, rejection reason, and admin override is written to an append-only audit log.

### 2.2 Business Rules
1. **BR-01 (Buffer Times)**: A venue request reservation window must enforce venue-configured setup and teardown buffers (e.g., 30 mins before and 30 mins after). The conflict engine evaluates `[start_time - setup_buffer, end_time + teardown_buffer)`.
2. **BR-02 (Lead Time & Horizon)**: Requests must be submitted at least $N$ days in advance (e.g., 3 business days) and cannot exceed the current academic semester horizon (e.g., 180 days).
3. **BR-03 (No Silent Allocations)**: A preliminary approval (e.g., HOD sign-off) *never* locks or guarantees a venue. Only the final allotment stage commits the reservation.
4. **BR-04 (Atomic Exclusion)**: Under no circumstances can two confirmed bookings for the same venue overlap in time, including setup/teardown buffers.
5. **BR-05 (Rejection Finality)**: A rejection at any sequential workflow step halts the request immediately, setting it to `REJECTED` with mandatory feedback, unless the approver selects `CHANGES_REQUESTED`.

### 2.3 Confirmed Requirements vs. Architectural Assumptions

| Area | Status | Detail / Architectural Stance |
| :--- | :--- | :--- |
| **Payments** | Confirmed | Strictly out of scope. No commercial or payment processing components. |
| **Multi-Tenancy** | Assumption | Single-college deployment for MVP, but all database tables include a logical partition key (`college_id`) or clean foreign key isolation to allow seamless multi-college SaaS migration later. |
| **Notification Engine** | Assumption | In-app notification center + asynchronous email delivery (SMTP / Resend / AWS SES) via transactional background queue. SMS/WhatsApp deferred to future phase. |
| **Working Hours & Blackouts** | Assumption | Venues have configurable operational hours (e.g., 07:00 to 22:00) and academic blackout calendars (e.g., Examination weeks where student events are blocked). |
| **Recurring Bookings** | Assumption | MVP focuses on single-instance and multi-day continuous events. Complex recurring rules (e.g., every Tuesday for 12 weeks) are expanded into individual atomic request instances. |

---

## 3. Technology Stack & Architectural Trade-offs

To achieve rapid delivery, low maintenance overhead, strict type-safety, and mathematical data integrity, we select a **Full-Stack TypeScript Modular Monolith**.

```
+---------------------------------------------------------------------------------+
|                       Vite React SPA (TypeScript 5.x)                           |
|       Tailwind CSS + shadcn/ui + TanStack Query + TanStack Table + FullCalendar  |
+---------------------------------------------------------------------------------+
                                      |  HTTPS / JSON API
                                      v
+---------------------------------------------------------------------------------+
|                        Fastify Backend (Node.js 22 LTS)                         |
|     Modular Plugins: Auth, Venue, Event, Workflow, Allotment, Audit, Notif      |
|               Validation: Zod / TypeBox + OpenAPI / Swagger Specs               |
+---------------------------------------------------------------------------------+
                                      |  Drizzle ORM / SQL
                                      v
+---------------------------------------------------------------------------------+
|                         PostgreSQL 16 Enterprise DB                             |
|      Extensions: btree_gist | Range Types: tsrange | Exclusion Constraints      |
|              Job Queue: pg-boss (Postgres-native ACID queue)                    |
+---------------------------------------------------------------------------------+
```

### 3.1 Stack Breakdown & Justifications

| Component | Selected Technology | Deployment Location | Why Selected & Trade-off Justification |
| :--- | :--- | :--- | :--- |
| **Frontend Framework**| **React 19 + Vite + TypeScript (shadcn/ui + Tailwind + FullCalendar)** | **Vercel** (Free Tier / Global Edge CDN) | Hosted on Vercel for zero-config global CDN distribution, instant preview deploys on git push, automatic SSL, and zero server maintenance for the UI layer. |
| **Domain & DNS** | **Vercel Domain Management** | **Vercel** | Domain purchased/managed on Vercel (`collegevenue.com`), with an `A` record for `api.collegevenue.com` directed to the VPS. |
| **Backend Framework** | **Fastify (Node.js 22 LTS, TypeScript)** | **Single Docker VPS** (~$5/mo) | High-performance, schema-validated JSON API running in Docker on a dedicated VPS. Ensures persistent connections and fast query execution. |
| **Database** | **PostgreSQL 16 Enterprise** | **Single Docker VPS** (Docker volume) | Hosted in Docker on the same VPS. `btree_gist` enabled for temporal exclusion constraints (`EXCLUDE USING gist`), guaranteeing zero double-bookings. |
| **Email Service** | **Gmail SMTP (Nodemailer)** | **Docker Backend via Gmail** | 100% free via Gmail App Password (up to 500 emails/day), perfectly sized for college approval notices with zero monthly SaaS cost. |
| **Object Storage** | **None (Pure Relational)** | - | Excluded. All booking, venue, and approval data is structured and stored directly in PostgreSQL. |
| **Background Jobs** | **pg-boss** (Postgres-native) | **Docker Backend** | Operates inside PostgreSQL with `SKIP LOCKED`. No Redis container required. |

---

## 4. Modular Monolith Architecture

The codebase is organized as a domain-driven modular monolith within a monorepo (`pnpm` workspaces). Modules communicate via well-defined internal service interfaces and domain events, ensuring clean boundaries without microservice operational complexity.

```mermaid
graph TD
    subgraph Presentation_Layer [Presentation Layer]
        UI[Vite React Single Page App]
    end

    subgraph API_Gateway [Fastify Core Gateway]
        MW[Auth & Scope Guard]
        VAL[Zod Schema Validator]
        AUD[Audit Interceptor]
    end

    subgraph Domain_Modules [Modular Monolith Domain Services]
        IAM[Identity & Access Module]
        VM[Venue Catalog Module]
        EM[Event Management Module]
        AM[Approval Workflow Engine]
        ALM[Allotment & Conflict Engine]
        NM[Notification Module]
    end

    subgraph Infrastructure [Data & Persistence]
        PG[(PostgreSQL 16 + btree_gist)]
        PGBOSS[pg-boss Queue]
    end

    UI -->|REST / OpenAPI| MW
    MW --> VAL --> AUD
    AUD --> IAM
    AUD --> VM
    AUD --> EM
    AUD --> AM
    AUD --> ALM
    
    EM -->|Emits EventCreated| AM
    AM -->|On Final Stage| ALM
    ALM -->|Atomic Allot| PG
    ALM -->|Emits AllotmentConfirmed| NM
    NM --> PGBOSS
```

### Module Responsibilities & Boundaries

1. **`identity-module`**: User registration, credential hashing (Argon2id), admin user verification, session management, multi-role assignment, and scope evaluation (departmental & venue affiliations).
2. **`venue-module`**: Venue CRUD, equipment inventory, operational schedules, maintenance blackout windows, buffer configurations, and public availability feeds.
3. **`event-module`**: Event draft creation, metadata (title, category, expected headcount, faculty sponsor), lifecycle transitions (`DRAFT`, `SUBMITTED`, `COMPLETED`, `CANCELLED`).
4. **`workflow-engine`**: Workflow template management, step resolution based on event department and venue tier, approval instance progression, delegation, and approver action recording.
5. **`allotment-engine`**: Concurrency protection, overlapping slot detection, pessimistic locking, atomic transaction execution, exclusion constraint enforcement, and conflict resolution policy dispatch.
6. **`audit-module`**: Append-only event store recording actor, timestamp, IP, action, previous state, and next state for every system mutation.
7. **`notification-module`**: Templated in-app alert generation and background transactional email dispatching.

---

## 5. Database Design & PostgreSQL Exclusion Constraints

### 5.1 Physical ER Diagram

```mermaid
erDiagram
    DEPARTMENTS ||--o{ USERS : "belongs to"
    USERS ||--o{ USER_ROLES : "assigned"
    ROLES ||--o{ USER_ROLES : "defines"
    DEPARTMENTS ||--o{ VENUES : "owns (optional)"
    VENUES ||--o{ VENUE_REQUESTS : "requested for"
    EVENTS ||--o{ VENUE_REQUESTS : "contains"
    USERS ||--o{ EVENTS : "organizes"
    APPROVAL_WORKFLOWS ||--o{ WORKFLOW_STEPS : "consists of"
    VENUE_REQUESTS ||--o{ APPROVAL_INSTANCES : "instantiates"
    WORKFLOW_STEPS ||--o{ APPROVAL_DECISIONS : "records"
    APPROVAL_INSTANCES ||--o{ APPROVAL_DECISIONS : "tracks"
    VENUE_REQUESTS ||--o| VENUE_ALLOTMENTS : "materializes"
    VENUES ||--o{ VENUE_ALLOTMENTS : "allocated in"
    USERS ||--o{ AUDIT_LOGS : "acts"

    DEPARTMENTS {
        uuid id PK
        varchar code UK
        varchar name
    }
    USERS {
        uuid id PK
        varchar email UK
        varchar password_hash
        varchar status
        uuid department_id FK
        boolean is_active
    }
    VENUES {
        uuid id PK
        varchar code UK
        varchar name
        int capacity
        int setup_buffer_mins
        int teardown_buffer_mins
        uuid default_workflow_id FK
    }
    EVENTS {
        uuid id PK
        varchar title
        uuid department_id FK
        uuid creator_id FK
        varchar status
    }
    VENUE_REQUESTS {
        uuid id PK
        uuid event_id FK
        uuid venue_id FK
        timestamptz start_time
        timestamptz end_time
        tsrange effective_range
        varchar status
    }
    VENUE_ALLOTMENTS {
        uuid id PK
        uuid venue_request_id UK, FK
        uuid venue_id FK
        tsrange reserved_range
        varchar status
    }
```

### 5.2 Production PostgreSQL DDL Schema

```sql
-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- 1. Departments
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Users & Registration Approval
CREATE TYPE user_account_status AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'SUSPENDED');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    status user_account_status NOT NULL DEFAULT 'PENDING_APPROVAL',
    status_reason TEXT,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Roles and Scoped Assignments
CREATE TYPE role_name_enum AS ENUM ('STUDENT', 'FACULTY', 'HOD', 'PRINCIPAL', 'BURSAR', 'ADMINISTRATOR');

CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name role_name_enum NOT NULL UNIQUE,
    description TEXT
);

CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id) ON DELETE CASCADE, -- Scoped to department if HOD/Faculty
    venue_id UUID,                                                    -- Scoped to venue if Venue Manager
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_role_scope UNIQUE NULLS NOT DISTINCT (user_id, role_id, department_id, venue_id)
);

-- 4. Venues Catalog
CREATE TABLE venues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    building VARCHAR(100) NOT NULL,
    floor INT NOT NULL DEFAULT 1,
    capacity INT NOT NULL CHECK (capacity > 0),
    facilities JSONB NOT NULL DEFAULT '[]'::jsonb, -- e.g. ["AV", "Stage", "AC", "Projector"]
    setup_buffer_mins INT NOT NULL DEFAULT 30 CHECK (setup_buffer_mins >= 0),
    teardown_buffer_mins INT NOT NULL DEFAULT 30 CHECK (teardown_buffer_mins >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    department_id UUID REFERENCES departments(id), -- NULL = College Common Venue
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Approval Workflow Definitions
CREATE TABLE approval_workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE scope_type_enum AS ENUM ('CREATOR_DEPARTMENT', 'VENUE_DEPARTMENT', 'COLLEGE_WIDE');

CREATE TABLE workflow_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES approval_workflows(id) ON DELETE CASCADE,
    step_order INT NOT NULL,
    step_name VARCHAR(100) NOT NULL,
    required_role role_name_enum NOT NULL,
    scope_type scope_type_enum NOT NULL DEFAULT 'COLLEGE_WIDE',
    is_final_allotment_step BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_workflow_step_order UNIQUE (workflow_id, step_order)
);

-- 6. Events
CREATE TYPE event_status_enum AS ENUM ('DRAFT', 'SUBMITTED', 'CANCELLED', 'COMPLETED');

CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    department_id UUID NOT NULL REFERENCES departments(id),
    creator_id UUID NOT NULL REFERENCES users(id),
    expected_attendance INT NOT NULL CHECK (expected_attendance > 0),
    status event_status_enum NOT NULL DEFAULT 'DRAFT',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Venue Requests (Multiple conflicting requests can exist here)
CREATE TYPE request_status_enum AS ENUM (
    'SUBMITTED',
    'IN_REVIEW',
    'APPROVED_PENDING_ALLOTMENT',
    'CONFIRMED',
    'REJECTED',
    'SUPERSEDED_CONFLICT',
    'CANCELLED'
);

CREATE TABLE venue_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
    workflow_id UUID NOT NULL REFERENCES approval_workflows(id),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    setup_buffer_mins INT NOT NULL DEFAULT 30,
    teardown_buffer_mins INT NOT NULL DEFAULT 30,
    -- Effective range includes buffer times
    effective_range TSRANGE GENERATED ALWAYS AS (
        tsrange(
            start_time - (setup_buffer_mins || ' minutes')::interval,
            end_time + (teardown_buffer_mins || ' minutes')::interval,
            '[)'
        )
    ) STORED,
    status request_status_enum NOT NULL DEFAULT 'SUBMITTED',
    current_step_order INT NOT NULL DEFAULT 1,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_request_dates CHECK (end_time > start_time)
);

CREATE INDEX idx_venue_requests_effective_range ON venue_requests USING gist (venue_id, effective_range);
CREATE INDEX idx_venue_requests_status ON venue_requests(status);

-- 8. Approval Execution & Decisions
CREATE TABLE approval_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    venue_request_id UUID NOT NULL REFERENCES venue_requests(id) ON DELETE CASCADE,
    workflow_id UUID NOT NULL REFERENCES approval_workflows(id),
    current_step_order INT NOT NULL DEFAULT 1,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE decision_enum AS ENUM ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

CREATE TABLE approval_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    approval_instance_id UUID NOT NULL REFERENCES approval_instances(id) ON DELETE CASCADE,
    workflow_step_id UUID NOT NULL REFERENCES workflow_steps(id),
    approver_id UUID NOT NULL REFERENCES users(id),
    decision decision_enum NOT NULL,
    remarks TEXT,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Venue Allotments (THE HARD BOOKING TABLE - Protected by GiST Exclusion)
CREATE TYPE allotment_status_enum AS ENUM ('ACTIVE', 'CANCELLED', 'RELEASED');

CREATE TABLE venue_allotments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    venue_request_id UUID NOT NULL UNIQUE REFERENCES venue_requests(id) ON DELETE RESTRICT,
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    reserved_range TSRANGE NOT NULL,
    status allotment_status_enum NOT NULL DEFAULT 'ACTIVE',
    allotted_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    -- THE CRITICAL ENGINE GUARANTEE: No two ACTIVE bookings can overlap for the same venue!
    CONSTRAINT no_overlapping_active_allotments EXCLUDE USING gist (
        venue_id WITH =,
        reserved_range WITH &&
    ) WHERE (status = 'ACTIVE')
);

CREATE INDEX idx_venue_allotments_range ON venue_allotments USING gist (venue_id, reserved_range);

-- 10. Immutable Audit Trail
CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_id UUID REFERENCES users(id),
    ip_address VARCHAR(45),
    user_agent TEXT,
    action VARCHAR(100) NOT NULL, -- e.g., 'REQUEST_ALLOTTED', 'REQUEST_REJECTED'
    entity_name VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    old_state JSONB,
    new_state JSONB,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_entity ON audit_logs(entity_name, entity_id);
CREATE INDEX idx_audit_timestamp ON audit_logs(timestamp);
```

---

## 6. Permission Model & Access Control Matrix

The application employs a hybrid **RBAC + Attribute/Scope-Based Access Control (ReBAC/ABAC)** engine. Because a user can possess multiple roles, permissions are resolved dynamically by combining all active roles and evaluating contextual scope constraints.

### 6.1 Scoping Rules
1. **Department Scope (`CREATOR_DEPARTMENT`)**: An approver with role `HOD` can only endorse requests where `event.department_id == user_role.department_id`.
2. **Venue Scope (`VENUE_DEPARTMENT`)**: If a venue belongs to the Electrical Engineering department, its departmental custodian can review requests, while college-common venues fall to the Bursar / Principal.
3. **College-Wide Scope (`COLLEGE_WIDE`)**: Roles such as `PRINCIPAL`, `BURSAR`, and `ADMINISTRATOR` operate with global visibility and authority across all venues and departments.

### 6.2 Permission Matrix

| Capability / Action | Student | Faculty | HOD (Dept Scoped) | Bursar | Principal | Administrator |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Self-Registration** | Yes | Yes | - | - | - | - |
| **Approve User Account** | No | No | No | No | No | **Yes** |
| **Assign Roles & Scopes** | No | No | No | No | No | **Yes** |
| **View Venue Calendar** | Public/Auth | Public/Auth | Public/Auth | Public/Auth | Public/Auth | Public/Auth |
| **Create Event & Request** | Yes | Yes | Yes | Yes | Yes | Yes |
| **Edit/Cancel Own Request** | Yes | Yes | Yes | Yes | Yes | Yes |
| **Endorse Step (Dept Level)**| No | If delegated | **Yes (Own Dept)**| No | No | Override |
| **Endorse Step (Financial/Logistics)**| No | No | No | **Yes** | No | Override |
| **Final Allotment Selection**| No | No | Only Dept Venues | If designated | **Yes** | **Yes** |
| **Configure Workflows** | No | No | No | No | No | **Yes** |
| **Manage Venues & Buffers** | No | No | No | No | No | **Yes** |
| **View Full Audit Trail** | No | No | Dept Only | Yes | Yes | **Yes** |

### 6.3 Programmatic Authorization Guard Implementation Pattern

```typescript
// Architectural Pattern for Fastify Authorization Middleware
export interface RequestUserContext {
  id: string;
  email: string;
  roles: Array<{
    role: 'STUDENT' | 'FACULTY' | 'HOD' | 'PRINCIPAL' | 'BURSAR' | 'ADMINISTRATOR';
    departmentId?: string | null;
    venueId?: string | null;
  }>;
}

export function authorize(
  requiredRole: RoleNameEnum,
  scopeChecker?: (user: RequestUserContext, resource: any) => boolean
) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user as RequestUserContext;
    if (!user) return reply.status(401).send({ error: 'Unauthenticated' });

    // Administrator always bypasses scope restrictions
    if (user.roles.some(r => r.role === 'ADMINISTRATOR')) return;

    const matchingRole = user.roles.find(r => r.role === requiredRole);
    if (!matchingRole) {
      return reply.status(403).send({ error: `Forbidden: Requires role ${requiredRole}` });
    }

    if (scopeChecker) {
      const allowed = scopeChecker(user, req.params);
      if (!allowed) {
        return reply.status(403).send({ error: 'Forbidden: Insufficient departmental or venue scope' });
      }
    }
  };
}
```

---

## 7. Approval Workflow Engine & State Machine

The approval workflow engine drives requests through linear or branched milestone stages while keeping venue allocation strictly separated.

### 7.1 Venue Request State Machine

```mermaid
stateDiagram-v2
    [*] --> SUBMITTED : Organizer Submits Request
    SUBMITTED --> IN_REVIEW : Approver Views / Starts Review
    
    IN_REVIEW --> IN_REVIEW : Step N Approved (Moves to Step N+1)
    IN_REVIEW --> REJECTED : Any Approver Rejects
    IN_REVIEW --> SUBMITTED : Changes Requested & Updated (Resets Workflow)
    
    IN_REVIEW --> APPROVED_PENDING_ALLOTMENT : All Preliminary Steps Passed
    
    APPROVED_PENDING_ALLOTMENT --> CONFIRMED : Final Approver Selects Winning Request
    APPROVED_PENDING_ALLOTMENT --> SUPERSEDED_CONFLICT : Another Request Allotted for Same Slot
    
    SUBMITTED --> CANCELLED : Organizer Cancels
    IN_REVIEW --> CANCELLED : Organizer Cancels
    APPROVED_PENDING_ALLOTMENT --> CANCELLED : Organizer Cancels
    CONFIRMED --> CANCELLED : Cancelled by Organizer or Admin

    REJECTED --> [*]
    SUPERSEDED_CONFLICT --> [*]
    CANCELLED --> [*]
    CONFIRMED --> [*]
```

### 7.2 Configurable Workflow Definitions
A workflow is defined as an ordered collection of steps. Examples:
- **Standard Seminar Hall**:
  1. *Step 1*: `HOD` (Scope: `CREATOR_DEPARTMENT`, Final Allotment: `TRUE`).
- **Grand Auditorium (High-Stakes)**:
  1. *Step 1*: `HOD` (Scope: `CREATOR_DEPARTMENT`, Final Allotment: `FALSE`).
  2. *Step 2*: `BURSAR` (Scope: `COLLEGE_WIDE`, Final Allotment: `FALSE` - Logistics/Facilities Check).
  3. *Step 3*: `PRINCIPAL` (Scope: `COLLEGE_WIDE`, Final Allotment: `TRUE` - Selects Winner & Allots).

### 7.3 Handling Mid-Flight Modifications (Approval Invalidation)
If an organizer edits critical fields (`start_time`, `end_time`, or `venue_id`) while the request is `SUBMITTED`, `IN_REVIEW`, or `APPROVED_PENDING_ALLOTMENT`:
1. The system **invalidates all prior approvals** for this request.
2. A new `approval_instances` record is generated.
3. The request's `current_step_order` resets to `1`.
4. The request status reverts to `SUBMITTED`.
5. An audit entry is registered: `REQUEST_MUTATED_WORKFLOW_RESET`.
6. Email notification is dispatched to prior approvers explaining the invalidation.

---

## 8. Booking Conflict Algorithm & Atomic Allotment

### 8.1 The Core Problem & Race Condition
When multiple departments organize symposiums on the same date, both may submit requests for the Main Auditorium.
- **Event A (Computer Science)**: 10:00 to 14:00.
- **Event B (Mechanical Engineering)**: 12:00 to 16:00.
Both pass preliminary HOD reviews. Both reach `APPROVED_PENDING_ALLOTMENT`.
If the Principal opens two browser tabs or two administrators simultaneously click "Confirm & Allot", an unsafely designed application would double-book the hall.

### 8.2 Three-Layer Concurrency Defense Strategy

Our architecture implements a defense-in-depth model:
1. **Layer 1: Pessimistic Row Lock (`SELECT FOR UPDATE`)**: Synchronizes concurrent transactions within the application layer.
2. **Layer 2: Database Exclusion Constraint (`EXCLUDE USING gist`)**: Hardware-level mathematical guarantee preventing overlapping active `tsrange` records even under network partitions or distributed replicas.
3. **Layer 3: Conflict Resolution Policy Dispatcher**: Atomically invalidates competing pending requests upon winner confirmation.

### 8.3 The Atomic Allotment Transaction (SQL & Logic)

```sql
-- Executed inside a SERIALIZABLE or READ COMMITTED transaction with explicit locks
BEGIN;

-- 1. Pessimistically lock the target venue to serialize conflicting allotment attempts
SELECT id FROM venues WHERE id = :target_venue_id FOR UPDATE;

-- 2. Verify that no ACTIVE allotment already overlaps the requested range
SELECT id, event_id, reserved_range 
FROM venue_allotments 
WHERE venue_id = :target_venue_id 
  AND status = 'ACTIVE' 
  AND reserved_range && :effective_range;

-- If a record is returned, ABORT transaction immediately and return HTTP 409 Conflict:
-- "Venue was confirmed for another event while your review was in progress."

-- 3. Insert the winning allotment record (PostgreSQL GiST constraint enforces atomicity)
INSERT INTO venue_allotments (
    venue_request_id,
    venue_id,
    event_id,
    reserved_range,
    status,
    allotted_by
) VALUES (
    :winning_request_id,
    :target_venue_id,
    :event_id,
    :effective_range,
    'ACTIVE',
    :approver_user_id
);

-- 4. Mark winning request as CONFIRMED
UPDATE venue_requests 
SET status = 'CONFIRMED', updated_at = NOW() 
WHERE id = :winning_request_id;

-- 5. Mark Event as SUBMITTED / APPROVED
UPDATE events 
SET status = 'SUBMITTED', updated_at = NOW() 
WHERE id = :event_id;

-- 6. Execute Conflict Resolution Policy on competing requests
-- Identify all overlapping requests that were competing for this slot
UPDATE venue_requests
SET status = 'SUPERSEDED_CONFLICT',
    rejection_reason = 'Slot allotted to another conflicting event (' || :event_title || '). Please reschedule.',
    updated_at = NOW()
WHERE venue_id = :target_venue_id
  AND id != :winning_request_id
  AND status IN ('SUBMITTED', 'IN_REVIEW', 'APPROVED_PENDING_ALLOTMENT')
  AND effective_range && :effective_range
RETURNING id, event_id;

-- 7. Write to Audit Log
INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, new_state)
VALUES (:approver_user_id, 'ALLOTMENT_CONFIRMED', 'venue_allotments', :winning_request_id, json_build_object('range', :effective_range::text));

COMMIT;
```

---

## 9. API Design & Data Contracts

All endpoints follow REST principles, returning standardized JSON responses with OpenAPI 3.1 specifications.

### 9.1 Core Endpoints Specification

| Method | Endpoint | Authorization | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register` | Public | Submit registration application |
| `POST` | `/api/v1/auth/login` | Public | Authenticate and obtain session cookie |
| `POST` | `/api/v1/auth/logout` | Authenticated | Revoke session |
| `GET` | `/api/v1/admin/users/pending` | `ADMINISTRATOR` | List pending user accounts |
| `PATCH`| `/api/v1/admin/users/:id/approve` | `ADMINISTRATOR` | Approve/Reject user and assign roles |
| `GET` | `/api/v1/venues` | Public / Auth | List venues with filter parameters |
| `GET` | `/api/v1/venues/:id/calendar` | Public / Auth | Feed of confirmed bookings & pending holds |
| `POST` | `/api/v1/events` | `STUDENT`, `FACULTY` | Create event header |
| `POST` | `/api/v1/venue-requests` | `STUDENT`, `FACULTY` | Submit venue request for an event |
| `GET` | `/api/v1/approvals/inbox` | Approver Roles | List requests awaiting caller's decision |
| `POST` | `/api/v1/approvals/:requestId/decide` | Scoped Approver | Submit approval, rejection, or changes |
| `POST` | `/api/v1/allotments/confirm` | Final Approver | Select winning request & commit allotment |
| `DELETE`| `/api/v1/allotments/:id` | Organizer/Admin | Cancel confirmed booking & release slot |
| `GET` | `/api/v1/audit-logs` | Admin / Principals | Search immutable audit trail |

### 9.2 Critical Request / Response Payloads

#### `POST /api/v1/allotments/confirm`
*Payload:*
```json
{
  "venueRequestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "remarks": "Priority allocated to College Annual Symposium based on Senate approval.",
  "conflictResolutionPolicy": "AUTO_REJECT_CONFLICTS"
}
```

*Response (200 OK):*
```json
{
  "allotmentId": "c4a8b23e-8f31-482a-a92c-f37648312019",
  "status": "ACTIVE",
  "venueId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
  "reservedRange": "[\"2026-11-25 09:30:00+00\",\"2026-11-25 17:30:00+00\")",
  "supersededRequestsCount": 2,
  "supersededRequestIds": [
    "e2b1c4d3-1a2b-3c4d-5e6f-7a8b9c0d1e2f",
    "f3c2d5e4-2b3c-4d5e-6f7a-8b9c0d1e2f3a"
  ]
}
```

*Error Response (409 Conflict):*
```json
{
  "statusCode": 409,
  "error": "Conflict",
  "code": "SLOT_ALREADY_ALLOTTED",
  "message": "The selected venue was allotted to another event during your review session.",
  "conflictingAllotment": {
    "eventTitle": "National Science Conclave",
    "reservedRange": "[\"2026-11-25 09:00:00+00\",\"2026-11-25 18:00:00+00\")"
  }
}
```

---

## 10. Frontend Architecture & UX Design

The user interface is built with **React 19 + Tailwind CSS + shadcn/ui**, engineered around clear state visibility, proactive conflict discovery, and zero-confusion approval workflows.

```
+---------------------------------------------------------------------------------------+
|  TOP NAVIGATION: Logo | Master Calendar | My Events | Approval Inbox (3) | Admin Console |
+---------------------------------------------------------------------------------------+
| [ Left Pane: Venue Filters ]  | [ Center/Right: Interactive FullCalendar View       ] |
| - Capacity: [ 200+ Seats   ]  | < Today > Nov 2026                   Month Week Day   |
| - Equipment: [x] Projector    | +---------------------------------------------------+ |
| - Building: [ Science Block]  | | 09:00 [ CONFIRMED: Annual Tech Meet (CS)        ] | |
|                               | | 12:00 [ PENDING: Robotics Showcase (Mech)     ] | |
|                               | | 13:00 [ PENDING: Debate Competition (Lit)     ] | |
|                               | |       ^ Visual hatched bar indicates overlap!    | |
|                               | +---------------------------------------------------+ |
+---------------------------------------------------------------------------------------+
```

### 10.1 Key Frontend Portals

1. **Public / Master Venue Calendar**:
   - Visual distinction: **Solid Green/Blue** for `CONFIRMED` allotments; **Amber Striped / Hatch Pattern** for `PENDING_APPROVAL` holds.
   - Click-to-Inspect: Inspecting a confirmed booking displays the event title, organizing department, and public agenda. Inspecting a pending hold highlights competing requests.
   - Pre-Submission Conflict Warning: When an organizer selects a time slot in the booking wizard, the UI queries `/api/v1/venues/:id/conflicts?start=...&end=...` and displays:
     > ⚠️ *Heads Up: 2 pending requests already exist for this time. You may still apply, but final allotment is decided by the Principal.*

2. **Event & Venue Request Wizard**:
   - Step 1: Event Details (Title, Description, Expected Headcount, Department).
   - Step 2: Venue Selection (Filter by headcount with automatic filtering of undersized venues).
   - Step 3: Date & Buffer Planning (Start/End time + automatic calculation of setup/teardown buffers).
   - Step 4: Review Workflow Preview (Dynamic diagram showing the exact approvers who will review the request).

3. **Approver Unified Inbox & Comparison View**:
   - Single list for pending approvals with batch review capability for departmental HODs.
   - **Competitor Split View**: For the final allotter (Principal/Admin), if 2 or more requests compete for the same slot, the UI displays them side-by-side:
     - Event Title & Department
     - Expected Attendance vs. Venue Capacity
     - Endorsement history and comments from HODs and Bursar
     - One-click action: **"Allot Venue to Request A"** (automatically triggers confirmation and prompts for feedback to Request B).

4. **Administrator Control Console**:
   - User account approval pipeline (Identity verification, departmental assignment).
   - Venue management (Buffer times, equipment tags, active/maintenance toggles).
   - Workflow Builder: Drag-and-drop workflow step sequencer.

---

## 11. Security Engineering & Auditability

### 11.1 Threat Model (STRIDE Assessment)

| Threat Category | Potential Attack Vector | Architectural Mitigation |
| :--- | :--- | :--- |
| **Spoofing** | Forged user identities or session hijacking | HTTP-only, `SameSite=Lax`, secure signed session cookies; Argon2id password hashing; rapid session invalidation on credential update. |
| **Tampering** | Parameter tampering to approve unauthorized requests or bypass steps | Backend authorization guard re-validates `current_step_order`, caller role, and departmental scope on every single request. Never trust client state. |
| **Repudiation** | Approver claims they did not reject or allot a venue | Immutable, append-only `audit_logs` table capturing `actor_id`, IP address, timestamp, previous state, and new state. |
| **Information Disclosure** | Students viewing internal remarks or confidential institutional events | Field-level redaction in API serializers: confidential events appear on the public calendar only as "Reserved"; internal approver notes visible only to faculty/admin. |
| **Denial of Service** | Flooding request submissions to lock up venue slots | Rate limiting via Fastify (`@fastify/rate-limit`); limits on maximum active pending requests per student (e.g., max 3 active requests). |
| **Elevation of Privilege** | Student manipulating API to execute HOD or Principal actions | Strict Role & Scope Guard middleware enforcing DB-level checks before routing to business logic. |

### 11.2 Account Approval Security Lifecycle
1. User registers -> Status set to `PENDING_APPROVAL`.
2. Password hashed using Argon2id ($m=65536, t=3, p=4$).
3. User cannot access any authenticated routes except `/api/v1/auth/me` (which returns `{ status: "PENDING_APPROVAL" }`).
4. Administrator reviews user credentials, verifies college email domain or physical ID, and approves account.
5. Only upon approval does status transition to `ACTIVE`, enabling event and request creation.

---

## 12. Quality Assurance & Testing Strategy

A production-grade college system requires automated testing across unit, integration, and high-concurrency boundaries.

```
       / \
      / E2E \         Playwright (End-to-End User Journeys)
     /-------\
    / Concurrency \   k6 & Vitest Concurrency Test Suites (Race Conditions)
   /---------------\
  /   Integration   \ Supertest / Fastify Inject + Testcontainers (PostgreSQL)
 /-------------------\
/     Unit Tests      \ Vitest (Domain Logic, Workflow Engines, Scopes)
-----------------------
```

### 12.1 Concurrency & Double-Booking Stress Test (Vitest Script)

```typescript
// tests/integration/allotment-concurrency.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/db';
import { allotVenueService } from '../../src/modules/allotment/allotment.service';

describe('Concurrency Protection: Zero Double-Booking Guarantee', () => {
  it('should allow exactly one allotment when 10 approvers click allot simultaneously', async () => {
    const venueId = 'a1b2c3d4-0000-0000-0000-000000000001';
    const startTime = new Date('2026-12-01T10:00:00Z');
    const endTime = new Date('2026-12-01T14:00:00Z');

    // Create 10 competing venue requests for the identical slot
    const requestIds = await createCompetingRequests(10, venueId, startTime, endTime);

    // Fire 10 concurrent allotment attempts simultaneously
    const results = await Promise.allSettled(
      requestIds.map((reqId, idx) =>
        allotVenueService({
          venueRequestId: reqId,
          approverId: `user-approver-${idx}`,
          conflictResolutionPolicy: 'AUTO_REJECT_CONFLICTS',
        })
      )
    );

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    // Exactly ONE request must succeed; 9 must fail with 409 Conflict
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(9);

    // Verify database state: Exactly 1 ACTIVE allotment exists in PostgreSQL
    const activeAllotments = await db.query(
      `SELECT * FROM venue_allotments WHERE venue_id = $1 AND status = 'ACTIVE'`,
      [venueId]
    );
    expect(activeAllotments.rows.length).toBe(1);
  });
});
```

### 12.2 Edge Cases Test Matrix
- **EC-01 (Buffer Overlap)**: Event A ends at 12:00 (with 30-min cleanup buffer until 12:30). Event B attempts to book at 12:15. Verification: Must be rejected as a conflict.
- **EC-02 (Mid-Review Venue Edit)**: Organizer alters the venue from Audi A to Audi B while at Step 2 of 3. Verification: Reset to Step 1; prior approvals invalidated.
- **EC-03 (Cross-Department HOD Endorsement)**: Physics HOD attempts to approve a Chemistry student request. Verification: HTTP 403 Forbidden.
- **EC-04 (Allotment Cancellation Slot Release)**: Confirmed event is cancelled. Competing superseded request organizers receive notification that the slot is reopened.

---

## 13. Phased Implementation Roadmap & Acceptance Criteria

```mermaid
gantt
    title College Venue Management System Implementation
    dateFormat  YYYY-MM-DD
    section Phase 1
    Core Foundation, DB & Auth       :p1, 2026-12-01, 10d
    section Phase 2
    Venues, Calendar & Events        :p2, after p1, 10d
    section Phase 3
    Approval Engine & Workflows      :p3, after p2, 12d
    section Phase 4
    Atomic Allotment & Conflict Eng  :p4, after p3, 8d
    section Phase 5
    Frontend UI & Approver Inboxes   :p5, after p4, 14d
    section Phase 6
    Security, Auditing & Deployment  :p6, after p5, 8d
```

### Phase 1: Core Foundation, DB Schema & Authentication
- **Deliverables**:
  - PostgreSQL 16 schema with `btree_gist`, range types, and exclusion constraints.
  - Drizzle ORM schema mapping and migration scripts.
  - Fastify server scaffolding with authentication and user registration.
  - Admin account approval workflow.
- **Acceptance Criteria**:
  - `POST /api/v1/auth/register` creates inactive user.
  - Administrator can list and approve/reject pending accounts.
  - Inactive users are rejected by auth guards.

### Phase 2: Venue Catalog, Availability Calendar & Event Creation
- **Deliverables**:
  - Venue management CRUD with capacity, equipment, and buffer time configuration.
  - Event draft creation and submission endpoints.
  - Venue request creation with automatic `effective_range` calculation.
  - Public/authenticated calendar query endpoint.
- **Acceptance Criteria**:
  - Calendar returns confirmed bookings and pending holds.
  - Buffer times are automatically appended to requested time ranges.

### Phase 3: Configurable Approval Workflow Engine
- **Deliverables**:
  - Workflow template tables and step execution engine.
  - Dynamic route matching based on department and venue.
  - Approver inbox query endpoint with departmental and venue scoping.
  - Invalidation triggers on event detail modification.
- **Acceptance Criteria**:
  - Requests progress step-by-step upon `APPROVED` decisions.
  - Rejection halts request progression immediately.
  - Editing an in-flight request resets approval instances.

### Phase 4: Atomic Allotment & Concurrency Conflict Engine
- **Deliverables**:
  - Pessimistic locking transaction sequence for venue allotment.
  - Exclusion constraint handling and friendly error mapping.
  - Conflict resolution policy dispatcher (superseding competing requests).
  - Concurrency stress tests with Vitest.
- **Acceptance Criteria**:
  - Zero double-bookings under concurrent load tests.
  - Winning request set to `CONFIRMED`; competing requests transitioned to `SUPERSEDED_CONFLICT`.

### Phase 5: Modern Responsive Frontend (React + Tailwind + shadcn/ui)
- **Deliverables**:
  - Master Interactive FullCalendar with status filtering and conflict warnings.
  - Multi-step Event Booking Wizard.
  - Approver Inbox with side-by-side competitor comparison view.
  - Admin configuration dashboards.
- **Acceptance Criteria**:
  - Fully responsive on mobile (students) and desktop (admins).
  - Approvers can view all competing requests before committing allotment.

### Phase 6: Audit Logging, Notifications, Hardening & Deployment
- **Deliverables**:
  - Append-only audit logger interceptor.
  - `pg-boss` background worker for email notifications.
  - Docker Compose production build and GitHub Actions CI/CD pipeline.
  - Runbook and disaster recovery documentation.
- **Acceptance Criteria**:
  - Every allotment, rejection, and role change creates an immutable audit record.
  - Automated tests pass with >85% code coverage.

---

## 14. DevOps, CI/CD & Production Operations

### 14.1 Architecture Topology: Hybrid Vercel + Docker VPS
- **Frontend**: Deployed to **Vercel** (`https://collegevenue.com`). Handled via automatic GitHub integration.
- **Backend & Database**: Deployed on a single **Linux VPS** (`https://api.collegevenue.com`) running Docker Compose.
- **DNS**: Managed in Vercel:
  - Root `@` and `www` -> Vercel Edge Network
  - Subdomain `api` (`A` record) -> VPS Public IPv4 Address
- **SSL**: Automatic Let's Encrypt managed by Caddy reverse proxy on the VPS.

### 14.2 VPS Production Containerization (`docker-compose.prod.yml`)

```yaml
version: '3.8'

services:
  caddy:
    image: caddy:2-alpine
    container_name: venue_caddy
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./infra/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - backend

  postgres:
    image: postgres:16-alpine
    container_name: venue_postgres
    restart: always
    environment:
      POSTGRES_DB: venue_system
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./infra/init-extensions.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d venue_system"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: .
      dockerfile: infra/Dockerfile.backend
    container_name: venue_backend
    restart: always
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      NODE_ENV: production
      PORT: 4000
      DATABASE_URL: postgres://${DB_USER}:${DB_PASSWORD}@postgres:5432/venue_system
      SESSION_SECRET: ${SESSION_SECRET}
      FRONTEND_URL: https://collegevenue.com
      # Gmail SMTP Configuration
      SMTP_HOST: smtp.gmail.com
      SMTP_PORT: 465
      SMTP_SECURE: "true"
      SMTP_USER: ${GMAIL_USER}
      SMTP_PASS: ${GMAIL_APP_PASSWORD}
      SMTP_FROM: "College Venue System <${GMAIL_USER}>"
    expose:
      - "4000"

volumes:
  pgdata:
    driver: local
  caddy_data:
    driver: local
  caddy_config:
    driver: local
```

#### `infra/Caddyfile`:
```caddy
api.collegevenue.com {
    reverse_proxy backend:4000
}
```

### 14.3 Monthly Infrastructure Cost Breakdown

| Component | Provider | Configuration | Cost |
| :--- | :--- | :--- | :--- |
| **Frontend CDN** | **Vercel** | Free Tier (Hobby) | **$0 / month** |
| **Backend & Postgres** | **Hetzner Cloud / DigitalOcean** | 2 vCPU, 4GB RAM, 40GB SSD | **~$4 - $6 / month** |
| **Transactional Email** | **Gmail SMTP** | App Password (up to 500 emails/day) | **$0 / month** |
| **Domain Name** | **Vercel / Cloudflare** | `.com` or `.edu` domain | **~$12 - $15 / year** |
| **Object Storage** | **None** | All data stored in PostgreSQL | **$0 / month** |
| **Total Monthly Cost** | | | **~$4 - $6 / month** |

---

## 15. Clarification Questions & Open Product Decisions

While the architecture is complete and ready for implementation, the following operational preferences should be finalized with college leadership:

1. **Conflict Resolution Policy**: When a winning request is confirmed, should competing requests be:
   - *Option A (Recommended)*: Automatically marked as `SUPERSEDED_CONFLICT` with an immediate email inviting the organizer to select a new date?
   - *Option B*: Kept in an "Unresolved Conflict" state requiring explicit manual review or rejection by an administrator?
2. **Setup/Teardown Buffers**: Should buffer times be strictly enforced by venue type (e.g., Auditorium = 45 mins, Classroom = 10 mins) or allow organizers to request custom buffer durations during submission?
3. **Institutional Single Sign-On (SSO)**: Does the college intend to integrate Google Workspace for Education or Microsoft 365 Entra ID OAuth for auto-populating student/faculty identity, or will initial launch rely on local email/password registration with admin approval?
