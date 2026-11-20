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
});
export type EventInput = z.infer<typeof eventInputSchema>;

export const eventUpdateSchema = eventInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one event field.');
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;

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
  APPROVED_PENDING_ALLOTMENT: 'Preliminary approval',
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
