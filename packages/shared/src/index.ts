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
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX_LENGTH),
});

export const registrationSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
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
