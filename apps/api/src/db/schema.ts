import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// PostgreSQL range types are not first-class in Drizzle; this maps the driver
// representation (a range literal string) without hiding it behind a wrapper.
const tstzrange = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tstzrange';
  },
});

export const userAccountStatus = pgEnum('user_account_status', [
  'PENDING_APPROVAL',
  'ACTIVE',
  'REJECTED',
  'SUSPENDED',
]);

export const roleNameEnum = pgEnum('role_name_enum', [
  'STUDENT',
  'FACULTY',
  'HOD',
  'PRINCIPAL',
  'BURSAR',
  'ADMINISTRATOR',
]);

export const scopeTypeEnum = pgEnum('scope_type_enum', [
  'CREATOR_DEPARTMENT',
  'VENUE_DEPARTMENT',
  'COLLEGE_WIDE',
]);

export const eventStatusEnum = pgEnum('event_status_enum', [
  'DRAFT',
  'SUBMITTED',
  'CANCELLED',
  'COMPLETED',
]);

export const requestStatusEnum = pgEnum('request_status_enum', [
  'SUBMITTED',
  'IN_REVIEW',
  'APPROVED_PENDING_ALLOTMENT',
  'CONFIRMED',
  'REJECTED',
  'SUPERSEDED_CONFLICT',
  'CANCELLED',
]);

export const decisionEnum = pgEnum('decision_enum', ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']);

export const allotmentStatusEnum = pgEnum('allotment_status_enum', [
  'ACTIVE',
  'CANCELLED',
  'RELEASED',
]);

export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const approvalWorkflows = pgTable(
  'approval_workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('approval_workflows_one_default_idx')
      .on(table.isDefault)
      .where(sql`${table.isDefault}`),
  ],
);

export const workflowSteps = pgTable(
  'workflow_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => approvalWorkflows.id, { onDelete: 'cascade' }),
    stepOrder: integer('step_order').notNull(),
    stepName: varchar('step_name', { length: 100 }).notNull(),
    requiredRole: roleNameEnum('required_role').notNull(),
    scopeType: scopeTypeEnum('scope_type').notNull().default('COLLEGE_WIDE'),
    isFinalAllotmentStep: boolean('is_final_allotment_step').notNull().default(false),
  },
  (table) => [
    uniqueIndex('workflow_steps_order_unique').on(table.workflowId, table.stepOrder),
    check('workflow_steps_order_positive', sql`${table.stepOrder} > 0`),
  ],
);

export const venues = pgTable(
  'venues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 30 }).notNull().unique(),
    name: varchar('name', { length: 120 }).notNull(),
    building: varchar('building', { length: 100 }).notNull(),
    floor: integer('floor').notNull().default(1),
    capacity: integer('capacity').notNull(),
    facilities: jsonb('facilities').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    setupBufferMins: integer('setup_buffer_mins').notNull().default(30),
    teardownBufferMins: integer('teardown_buffer_mins').notNull().default(30),
    isActive: boolean('is_active').notNull().default(true),
    departmentId: uuid('department_id').references(() => departments.id),
    workflowId: uuid('workflow_id').references(() => approvalWorkflows.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('venues_capacity_positive', sql`${table.capacity} > 0`),
    check('venues_setup_buffer_non_negative', sql`${table.setupBufferMins} >= 0`),
    check('venues_teardown_buffer_non_negative', sql`${table.teardownBufferMins} >= 0`),
    index('venues_active_idx').on(table.isActive),
    index('venues_department_idx').on(table.departmentId),
    index('venues_workflow_idx').on(table.workflowId),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    phone: varchar('phone', { length: 20 }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id),
    status: userAccountStatus('status').notNull().default('PENDING_APPROVAL'),
    statusReason: text('status_reason'),
    approvedBy: uuid('approved_by').references((): AnyPgColumn => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('users_email_lowercase', sql`${table.email} = lower(${table.email})`),
    uniqueIndex('users_email_unique').on(table.email),
  ],
);

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: roleNameEnum('name').notNull().unique(),
  description: text('description'),
});

export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'cascade' }),
    venueId: uuid('venue_id').references(() => venues.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('user_roles_scope_unique').on(
      table.userId,
      table.roleId,
      table.departmentId,
      table.venueId,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sessions_expiry_idx').on(table.expiresAt, table.revokedAt)],
);

export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientUserId: uuid('recipient_user_id').references(() => users.id, { onDelete: 'set null' }),
    type: varchar('type', { length: 80 }).notNull(),
    subject: varchar('subject', { length: 200 }).notNull(),
    body: text('body').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'notification_outbox_status_valid',
      sql`${table.status} in ('PENDING', 'PROCESSING', 'SENT', 'FAILED')`,
    ),
    index('notification_outbox_pending_idx').on(table.status, table.nextAttemptAt),
  ],
);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => users.id),
    facultyCoordinatorId: uuid('faculty_coordinator_id').references((): AnyPgColumn => users.id),
    expectedAttendance: integer('expected_attendance').notNull(),
    status: eventStatusEnum('status').notNull().default('DRAFT'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('events_attendance_positive', sql`${table.expectedAttendance} > 0`),
    index('events_creator_idx').on(table.creatorId, table.createdAt),
    index('events_status_idx').on(table.status),
    index('events_faculty_coordinator_idx').on(table.facultyCoordinatorId),
  ],
);

export const eventOrganizers = pgTable(
  'event_organizers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assignedById: uuid('assigned_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('event_organizers_event_user_unique').on(table.eventId, table.userId),
    index('event_organizers_user_idx').on(table.userId),
  ],
);

export const venueRequests = pgTable(
  'venue_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    submittedById: uuid('submitted_by_id')
      .notNull()
      .references(() => users.id),
    requiresFacultyEndorsement: boolean('requires_faculty_endorsement').notNull().default(false),
    facultyEndorserId: uuid('faculty_endorser_id').references(() => users.id),
    facultyEndorsedAt: timestamp('faculty_endorsed_at', { withTimezone: true }),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => approvalWorkflows.id),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    setupBufferMins: integer('setup_buffer_mins').notNull().default(30),
    teardownBufferMins: integer('teardown_buffer_mins').notNull().default(30),
    // PostgreSQL cannot generate a range from timestamptz +/- interval directly:
    // that operator is STABLE, not IMMUTABLE. Converting through UTC epoch keeps
    // the expression immutable and the resulting instants timezone-correct.
    effectiveRange: tstzrange('effective_range')
      .notNull()
      .generatedAlwaysAs(
        sql`tstzrange(
          to_timestamp(date_part('epoch', start_time at time zone 'UTC') - setup_buffer_mins * 60),
          to_timestamp(date_part('epoch', end_time at time zone 'UTC') + teardown_buffer_mins * 60),
          '[)'
        )`,
      ),
    status: requestStatusEnum('status').notNull().default('SUBMITTED'),
    currentStepOrder: integer('current_step_order').notNull().default(1),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('venue_requests_end_after_start', sql`${table.endTime} > ${table.startTime}`),
    check('venue_requests_setup_buffer_non_negative', sql`${table.setupBufferMins} >= 0`),
    check('venue_requests_teardown_buffer_non_negative', sql`${table.teardownBufferMins} >= 0`),
    index('venue_requests_event_idx').on(table.eventId),
    index('venue_requests_venue_status_idx').on(table.venueId, table.status),
    index('venue_requests_submitted_by_idx').on(table.submittedById),
  ],
);

export const approvalInstances = pgTable(
  'approval_instances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    venueRequestId: uuid('venue_request_id')
      .notNull()
      .references(() => venueRequests.id, { onDelete: 'cascade' }),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => approvalWorkflows.id),
    currentStepOrder: integer('current_step_order').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    isCompleted: boolean('is_completed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('approval_instances_request_idx').on(table.venueRequestId, table.createdAt),
    index('approval_instances_active_idx').on(table.venueRequestId, table.isActive),
  ],
);

export const approvalDecisions = pgTable(
  'approval_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    approvalInstanceId: uuid('approval_instance_id')
      .notNull()
      .references(() => approvalInstances.id, { onDelete: 'cascade' }),
    workflowStepId: uuid('workflow_step_id')
      .references(() => workflowSteps.id),
    stepOrder: integer('step_order').notNull().default(1),
    stepName: varchar('step_name', { length: 100 }).notNull().default('Approval'),
    approverId: uuid('approver_id')
      .notNull()
      .references(() => users.id),
    decision: decisionEnum('decision').notNull(),
    remarks: text('remarks'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('approval_decisions_instance_step_approved_unique')
      .on(table.approvalInstanceId, table.stepOrder)
      .where(sql`${table.decision} = 'APPROVED'`),
    index('approval_decisions_instance_idx').on(table.approvalInstanceId, table.decidedAt),
    index('approval_decisions_approver_idx').on(table.approverId),
  ],
);

export const venueAllotments = pgTable(
  'venue_allotments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    venueRequestId: uuid('venue_request_id')
      .notNull()
      .unique()
      .references(() => venueRequests.id),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    reservedRange: tstzrange('reserved_range').notNull(),
    status: allotmentStatusEnum('status').notNull().default('ACTIVE'),
    allottedBy: uuid('allotted_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
  },
  (table) => [check('venue_allotments_range_not_empty', sql`not isempty(${table.reservedRange})`)],
);

export const auditLogs = pgTable('audit_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorId: uuid('actor_id').references(() => users.id),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  action: varchar('action', { length: 100 }).notNull(),
  entityName: varchar('entity_name', { length: 50 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  oldState: jsonb('old_state').$type<Record<string, unknown> | null>(),
  newState: jsonb('new_state').$type<Record<string, unknown> | null>(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type DepartmentRow = typeof departments.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;
export type EventOrganizerRow = typeof eventOrganizers.$inferSelect;
