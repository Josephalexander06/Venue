import { z } from 'zod';

export const ROLE_NAMES = [
  'STUDENT',
  'FACULTY',
  'HOD',
  'BURSAR',
  'PRINCIPAL',
  'ADMINISTRATOR',
] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export const ROLE_LABELS: Record<RoleName, string> = {
  STUDENT: 'Student',
  FACULTY: 'Faculty',
  HOD: 'Head of Department',
  BURSAR: 'Bursar',
  PRINCIPAL: 'Principal',
  ADMINISTRATOR: 'Administrator',
};

export const DEPARTMENT_SCOPED_ROLES: readonly RoleName[] = ['STUDENT', 'FACULTY', 'HOD'];

export const USER_STATUSES = ['PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'SUSPENDED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`)
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
    message: 'Include at least one letter and one number.',
  });

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(255, 'Email is too long.')
    .email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX_LENGTH),
});

export const registrationSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(255, 'Email is too long.')
      .email('Enter a valid email address.'),
    password: passwordSchema,
    firstName: z.string().trim().min(1, 'Enter your first name.').max(100),
    lastName: z.string().trim().min(1, 'Enter your last name.').max(100),
    phone: z
      .string()
      .trim()
      .max(20)
      .regex(/^[+0-9 ()-]*$/, 'Use digits, spaces and + ( ) - only.')
      .optional()
      .or(z.literal('')),
    departmentId: z.string().uuid('Choose your department.'),
  })
  .refine((data) => !data.password.toLowerCase().includes(data.email.split('@')[0] ?? ''), {
    message: 'Password must not contain your email name.',
    path: ['password'],
  });
export type RegistrationInput = z.infer<typeof registrationSchema>;

export const roleAssignmentSchema = z.object({
  role: z.enum(ROLE_NAMES),
  departmentId: z.string().uuid().nullable().optional(),
});

export const approveUserSchema = z.object({
  roles: z.array(roleAssignmentSchema).min(1, 'Assign at least one role.').max(10),
});
export type ApproveUserInput = z.infer<typeof approveUserSchema>;

export const rejectUserSchema = z.object({
  reason: z.string().trim().min(5, 'Give a brief reason (at least 5 characters).').max(500),
});
export type RejectUserInput = z.infer<typeof rejectUserSchema>;

export const updateUserRolesSchema = approveUserSchema;
export type UpdateUserRolesInput = z.infer<typeof updateUserRolesSchema>;

export const suspendUserSchema = z.object({
  reason: z.string().trim().min(5, 'Give a brief reason (at least 5 characters).').max(500),
});
export type SuspendUserInput = z.infer<typeof suspendUserSchema>;

/* --------------------------------------------------------------- venues */

export const MAX_FACILITY_LENGTH = 40;
export const MAX_FACILITIES = 20;

const facilitySchema = z.string().trim().min(1).max(MAX_FACILITY_LENGTH);

export const venueInputSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Use at least 2 characters.')
    .max(30)
    .regex(/^[A-Z0-9-]+$/, 'Use letters, numbers and hyphens only.'),
  name: z.string().trim().min(2, 'Enter a venue name.').max(120),
  building: z.string().trim().min(1, 'Enter a building.').max(100),
  floor: z.coerce.number().int().min(-5).max(100),
  capacity: z.coerce.number().int().min(1, 'Capacity must be at least 1.').max(100000),
  facilities: z
    .array(facilitySchema)
    .max(MAX_FACILITIES, `List at most ${MAX_FACILITIES} facilities.`)
    .default([])
    .transform((values) => [...new Set(values)]),
  setupBufferMins: z.coerce.number().int().min(0).max(240).default(30),
  teardownBufferMins: z.coerce.number().int().min(0).max(240).default(30),
  isActive: z.boolean().default(true),
  departmentId: z.string().uuid().nullable().optional(),
  workflowId: z.string().uuid().optional(),
});
export type VenueInput = z.infer<typeof venueInputSchema>;

export const venueUpdateSchema = venueInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one venue field.');
export type VenueUpdateInput = z.infer<typeof venueUpdateSchema>;

export const venueListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  building: z.string().trim().max(100).optional(),
  departmentId: z.string().uuid().optional(),
  minCapacity: z.coerce.number().int().min(1).optional(),
  active: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/* ---------------------------------------------------- approval workflows */

export const APPROVER_ROLES = [
  'FACULTY',
  'HOD',
  'BURSAR',
  'PRINCIPAL',
  'ADMINISTRATOR',
] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

export const WORKFLOW_SCOPE_TYPES = [
  'CREATOR_DEPARTMENT',
  'VENUE_DEPARTMENT',
  'COLLEGE_WIDE',
] as const;
export type WorkflowScopeType = (typeof WORKFLOW_SCOPE_TYPES)[number];

export const WORKFLOW_SCOPE_LABELS: Record<WorkflowScopeType, string> = {
  CREATOR_DEPARTMENT: "Requester's department",
  VENUE_DEPARTMENT: "Venue's department",
  COLLEGE_WIDE: 'College-wide',
};

export const APPROVAL_DECISIONS = ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const APPROVAL_DECISION_LABELS: Record<ApprovalDecision, string> = {
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CHANGES_REQUESTED: 'Changes requested',
};

export const workflowStepInputSchema = z.object({
  stepName: z.string().trim().min(2, 'Name this approval step.').max(100),
  requiredRole: z.enum(APPROVER_ROLES),
  scopeType: z.enum(WORKFLOW_SCOPE_TYPES).default('COLLEGE_WIDE'),
  isFinalAllotmentStep: z.boolean().default(false),
});
export type WorkflowStepInput = z.infer<typeof workflowStepInputSchema>;

const workflowFieldsSchema = z.object({
  name: z.string().trim().min(2, 'Name this workflow.').max(100),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  isDefault: z.boolean().default(false),
  steps: z
    .array(workflowStepInputSchema)
    .min(1, 'Add at least one approval step.')
    .max(12, 'Use at most 12 approval steps.'),
});

function validateWorkflowSteps(
  value: { steps: WorkflowStepInput[] },
  context: z.RefinementCtx,
) {
  const finalSteps = value.steps.filter((step) => step.isFinalAllotmentStep);
  if (finalSteps.length !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['steps'],
      message: 'Mark exactly one step as the final allotment step.',
    });
  }
  if (value.steps.length > 0 && !value.steps[value.steps.length - 1]!.isFinalAllotmentStep) {
    context.addIssue({
      code: 'custom',
      path: ['steps'],
      message: 'The final allotment step must be last.',
    });
  }
  value.steps.forEach((step, index) => {
    if (step.requiredRole !== 'HOD' && step.scopeType !== 'COLLEGE_WIDE') {
      context.addIssue({
        code: 'custom',
        path: ['steps', index, 'scopeType'],
        message: 'Only HOD steps can be department-scoped.',
      });
    }
  });
}

export const workflowInputSchema = workflowFieldsSchema.superRefine(validateWorkflowSteps);
export type WorkflowInput = z.infer<typeof workflowInputSchema>;

export const workflowUpdateSchema = z
  .object({
    name: z.string().trim().min(2, 'Name this workflow.').max(100).optional(),
    description: z.string().trim().max(500).optional().or(z.literal('')),
    isDefault: z.boolean().optional(),
    steps: z
      .array(workflowStepInputSchema)
      .min(1, 'Add at least one approval step.')
      .max(12, 'Use at most 12 approval steps.')
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one workflow field.')
  .superRefine((value, context) => {
    if (value.steps) validateWorkflowSteps({ steps: value.steps }, context);
  });
export type WorkflowUpdateInput = z.infer<typeof workflowUpdateSchema>;

export const approvalDecisionInputSchema = z
  .object({
    decision: z.enum(APPROVAL_DECISIONS),
    expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(),
    comments: z.string().trim().max(1000).optional().or(z.literal('')),
  })
  .superRefine((value, context) => {
    if (value.decision !== 'APPROVED' && (value.comments?.trim().length ?? 0) < 5) {
      context.addIssue({
        code: 'custom',
        path: ['comments'],
        message:
          value.decision === 'REJECTED'
            ? 'Give a rejection reason (at least 5 characters).'
            : 'Describe the changes needed (at least 5 characters).',
      });
    }
  });
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionInputSchema>;

export const approvalInboxQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

/* ---------------------------------------------------------- departments */

export const departmentInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Enter a department code.')
    .max(20, 'Department code is too long.')
    .toUpperCase(),
  name: z.string().trim().min(2, 'Enter a department name.').max(100),
});
export type DepartmentInput = z.infer<typeof departmentInputSchema>;

export const departmentUpdateSchema = departmentInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one department field.');
export type DepartmentUpdateInput = z.infer<typeof departmentUpdateSchema>;

/* --------------------------------------------------------------- events */

export const eventInputSchema = z.object({
  title: z.string().trim().min(3, 'Enter an event title.').max(200),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  expectedAttendance: z.coerce
    .number()
    .int()
    .min(1, 'Attendance must be at least 1.')
    .max(100000),
  departmentId: z.string().uuid().optional(),
  facultyCoordinatorId: z.string().uuid().optional().nullable(),
});
export type EventInput = z.infer<typeof eventInputSchema>;

export const eventUpdateSchema = eventInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one event field.');
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;

export const eventCoordinatorSchema = z.object({
  facultyCoordinatorId: z.string().uuid('Choose a valid faculty coordinator.'),
});
export type EventCoordinatorInput = z.infer<typeof eventCoordinatorSchema>;

export const eventOrganizerSchema = z.object({
  userId: z.string().uuid('Choose a valid user.'),
});
export type EventOrganizerInput = z.infer<typeof eventOrganizerSchema>;

export interface EventTeamMember {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  department: { id: string; code: string; name: string };
  assignedAt?: string;
  assignedBy?: { id: string; firstName: string; lastName: string };
}

export interface EventTeamView {
  creator: EventTeamMember;
  facultyCoordinator: EventTeamMember | null;
  organizers: EventTeamMember[];
}

export const ALLOTMENT_STATUSES = ['ACTIVE', 'CANCELLED', 'RELEASED'] as const;
export type AllotmentStatus = (typeof ALLOTMENT_STATUSES)[number];

export const ALLOTMENT_POLICIES = ['AUTO_REJECT_CONFLICTS'] as const;
export type AllotmentPolicy = (typeof ALLOTMENT_POLICIES)[number];

export const allotmentConfirmSchema = z.object({
  venueRequestId: z.string().uuid(),
  remarks: z.string().trim().max(1000).optional().or(z.literal('')),
  conflictResolutionPolicy: z.enum(ALLOTMENT_POLICIES).default('AUTO_REJECT_CONFLICTS'),
  expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  reviewedCompetingRequestIds: z.array(z.string().uuid()).optional(),
});
export type AllotmentConfirmInput = z.infer<typeof allotmentConfirmSchema>;

export const allotmentCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Provide a cancellation reason (at least 3 characters).').max(1000),
});
export type AllotmentCancelInput = z.infer<typeof allotmentCancelSchema>;

export const allotmentInboxQuerySchema = z.object({
  venueId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AllotmentInboxQuery = z.infer<typeof allotmentInboxQuerySchema>;

/* --------------------------------------------------------- venue requests */

const isoTimestamp = z.iso.datetime({ offset: true, message: 'Use an ISO timestamp with a timezone.' });

export const venueRequestInputSchema = z.object({
  eventId: z.string().uuid(),
  venueId: z.string().uuid(),
  startTime: isoTimestamp,
  endTime: isoTimestamp,
});
export type VenueRequestInput = z.infer<typeof venueRequestInputSchema>;

export const venueRequestUpdateSchema = z
  .object({
    venueId: z.string().uuid().optional(),
    startTime: isoTimestamp.optional(),
    endTime: isoTimestamp.optional(),
    event: eventUpdateSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one change.');
export type VenueRequestUpdateInput = z.infer<typeof venueRequestUpdateSchema>;

export const venueScheduleQuerySchema = z.object({
  from: isoTimestamp,
  to: isoTimestamp,
});

export const availabilityQuerySchema = venueScheduleQuerySchema.extend({
  excludeRequestId: z.string().uuid().optional(),
});

export const EVENT_STATUSES = ['DRAFT', 'SUBMITTED', 'CANCELLED', 'COMPLETED'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const REQUEST_STATUSES = [
  'SUBMITTED',
  'IN_REVIEW',
  'APPROVED_PENDING_ALLOTMENT',
  'CONFIRMED',
  'REJECTED',
  'SUPERSEDED_CONFLICT',
  'CANCELLED',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  SUBMITTED: 'Submitted',
  IN_REVIEW: 'In review',
  APPROVED_PENDING_ALLOTMENT: 'Approved — pending allotment',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Rejected',
  SUPERSEDED_CONFLICT: 'Superseded',
  CANCELLED: 'Cancelled',
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};

export const BOOKING_ROLES: readonly RoleName[] = [
  'STUDENT',
  'FACULTY',
  'HOD',
  'BURSAR',
  'PRINCIPAL',
  'ADMINISTRATOR',
];

export interface SessionRole {
  role: RoleName;
  departmentId: string | null;
  venueId: string | null;
}

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
  department: { id: string; code: string; name: string };
  roles: SessionRole[];
}

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

export interface AuthSessionResponse {
  user: SessionUser;
  csrfToken: string;
}
