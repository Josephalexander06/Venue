import { z } from 'zod';
export declare const ROLE_NAMES: readonly ["STUDENT", "FACULTY", "HOD", "BURSAR", "PRINCIPAL", "ADMINISTRATOR"];
export type RoleName = (typeof ROLE_NAMES)[number];
export declare const ROLE_LABELS: Record<RoleName, string>;
export declare const DEPARTMENT_SCOPED_ROLES: readonly RoleName[];
export declare const USER_STATUSES: readonly ["PENDING_APPROVAL", "ACTIVE", "REJECTED", "SUSPENDED"];
export type UserStatus = (typeof USER_STATUSES)[number];
export declare const PASSWORD_MIN_LENGTH = 12;
export declare const PASSWORD_MAX_LENGTH = 128;
export declare const loginSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
export declare const registrationSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
    firstName: z.ZodString;
    lastName: z.ZodString;
    phone: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    departmentId: z.ZodString;
}, z.core.$strip>;
export type RegistrationInput = z.infer<typeof registrationSchema>;
export declare const roleAssignmentSchema: z.ZodObject<{
    role: z.ZodEnum<{
        STUDENT: "STUDENT";
        FACULTY: "FACULTY";
        HOD: "HOD";
        BURSAR: "BURSAR";
        PRINCIPAL: "PRINCIPAL";
        ADMINISTRATOR: "ADMINISTRATOR";
    }>;
    departmentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const approveUserSchema: z.ZodObject<{
    roles: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<{
            STUDENT: "STUDENT";
            FACULTY: "FACULTY";
            HOD: "HOD";
            BURSAR: "BURSAR";
            PRINCIPAL: "PRINCIPAL";
            ADMINISTRATOR: "ADMINISTRATOR";
        }>;
        departmentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ApproveUserInput = z.infer<typeof approveUserSchema>;
export declare const rejectUserSchema: z.ZodObject<{
    reason: z.ZodString;
}, z.core.$strip>;
export type RejectUserInput = z.infer<typeof rejectUserSchema>;
export declare const updateUserRolesSchema: z.ZodObject<{
    roles: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<{
            STUDENT: "STUDENT";
            FACULTY: "FACULTY";
            HOD: "HOD";
            BURSAR: "BURSAR";
            PRINCIPAL: "PRINCIPAL";
            ADMINISTRATOR: "ADMINISTRATOR";
        }>;
        departmentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type UpdateUserRolesInput = z.infer<typeof updateUserRolesSchema>;
export declare const suspendUserSchema: z.ZodObject<{
    reason: z.ZodString;
}, z.core.$strip>;
export type SuspendUserInput = z.infer<typeof suspendUserSchema>;
export declare const MAX_FACILITY_LENGTH = 40;
export declare const MAX_FACILITIES = 20;
export declare const venueInputSchema: z.ZodObject<{
    code: z.ZodString;
    name: z.ZodString;
    building: z.ZodString;
    floor: z.ZodCoercedNumber<unknown>;
    capacity: z.ZodCoercedNumber<unknown>;
    facilities: z.ZodPipe<z.ZodDefault<z.ZodArray<z.ZodString>>, z.ZodTransform<string[], string[]>>;
    setupBufferMins: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    teardownBufferMins: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    isActive: z.ZodDefault<z.ZodBoolean>;
    departmentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    workflowId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type VenueInput = z.infer<typeof venueInputSchema>;
export declare const venueUpdateSchema: z.ZodObject<{
    code: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    building: z.ZodOptional<z.ZodString>;
    floor: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    capacity: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    facilities: z.ZodOptional<z.ZodPipe<z.ZodDefault<z.ZodArray<z.ZodString>>, z.ZodTransform<string[], string[]>>>;
    setupBufferMins: z.ZodOptional<z.ZodDefault<z.ZodCoercedNumber<unknown>>>;
    teardownBufferMins: z.ZodOptional<z.ZodDefault<z.ZodCoercedNumber<unknown>>>;
    isActive: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    departmentId: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    workflowId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type VenueUpdateInput = z.infer<typeof venueUpdateSchema>;
export declare const venueListQuerySchema: z.ZodObject<{
    search: z.ZodOptional<z.ZodString>;
    building: z.ZodOptional<z.ZodString>;
    departmentId: z.ZodOptional<z.ZodString>;
    minCapacity: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    active: z.ZodOptional<z.ZodEnum<{
        true: "true";
        false: "false";
    }>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const APPROVER_ROLES: readonly ["FACULTY", "HOD", "BURSAR", "PRINCIPAL", "ADMINISTRATOR"];
export type ApproverRole = (typeof APPROVER_ROLES)[number];
export declare const WORKFLOW_SCOPE_TYPES: readonly ["CREATOR_DEPARTMENT", "VENUE_DEPARTMENT", "COLLEGE_WIDE"];
export type WorkflowScopeType = (typeof WORKFLOW_SCOPE_TYPES)[number];
export declare const WORKFLOW_SCOPE_LABELS: Record<WorkflowScopeType, string>;
export declare const APPROVAL_DECISIONS: readonly ["APPROVED", "REJECTED", "CHANGES_REQUESTED"];
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];
export declare const APPROVAL_DECISION_LABELS: Record<ApprovalDecision, string>;
export declare const workflowStepInputSchema: z.ZodObject<{
    stepName: z.ZodString;
    requiredRole: z.ZodEnum<{
        FACULTY: "FACULTY";
        HOD: "HOD";
        BURSAR: "BURSAR";
        PRINCIPAL: "PRINCIPAL";
        ADMINISTRATOR: "ADMINISTRATOR";
    }>;
    scopeType: z.ZodDefault<z.ZodEnum<{
        CREATOR_DEPARTMENT: "CREATOR_DEPARTMENT";
        VENUE_DEPARTMENT: "VENUE_DEPARTMENT";
        COLLEGE_WIDE: "COLLEGE_WIDE";
    }>>;
    isFinalAllotmentStep: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type WorkflowStepInput = z.infer<typeof workflowStepInputSchema>;
export declare const workflowInputSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    isDefault: z.ZodDefault<z.ZodBoolean>;
    steps: z.ZodArray<z.ZodObject<{
        stepName: z.ZodString;
        requiredRole: z.ZodEnum<{
            FACULTY: "FACULTY";
            HOD: "HOD";
            BURSAR: "BURSAR";
            PRINCIPAL: "PRINCIPAL";
            ADMINISTRATOR: "ADMINISTRATOR";
        }>;
        scopeType: z.ZodDefault<z.ZodEnum<{
            CREATOR_DEPARTMENT: "CREATOR_DEPARTMENT";
            VENUE_DEPARTMENT: "VENUE_DEPARTMENT";
            COLLEGE_WIDE: "COLLEGE_WIDE";
        }>>;
        isFinalAllotmentStep: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type WorkflowInput = z.infer<typeof workflowInputSchema>;
export declare const workflowUpdateSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    isDefault: z.ZodOptional<z.ZodBoolean>;
    steps: z.ZodOptional<z.ZodArray<z.ZodObject<{
        stepName: z.ZodString;
        requiredRole: z.ZodEnum<{
            FACULTY: "FACULTY";
            HOD: "HOD";
            BURSAR: "BURSAR";
            PRINCIPAL: "PRINCIPAL";
            ADMINISTRATOR: "ADMINISTRATOR";
        }>;
        scopeType: z.ZodDefault<z.ZodEnum<{
            CREATOR_DEPARTMENT: "CREATOR_DEPARTMENT";
            VENUE_DEPARTMENT: "VENUE_DEPARTMENT";
            COLLEGE_WIDE: "COLLEGE_WIDE";
        }>>;
        isFinalAllotmentStep: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type WorkflowUpdateInput = z.infer<typeof workflowUpdateSchema>;
export declare const approvalDecisionInputSchema: z.ZodObject<{
    decision: z.ZodEnum<{
        REJECTED: "REJECTED";
        APPROVED: "APPROVED";
        CHANGES_REQUESTED: "CHANGES_REQUESTED";
    }>;
    expectedUpdatedAt: z.ZodOptional<z.ZodISODateTime>;
    comments: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
}, z.core.$strip>;
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionInputSchema>;
export declare const approvalInboxQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const departmentInputSchema: z.ZodObject<{
    code: z.ZodString;
    name: z.ZodString;
}, z.core.$strip>;
export type DepartmentInput = z.infer<typeof departmentInputSchema>;
export declare const departmentUpdateSchema: z.ZodObject<{
    code: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type DepartmentUpdateInput = z.infer<typeof departmentUpdateSchema>;
export declare const eventInputSchema: z.ZodObject<{
    title: z.ZodString;
    description: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    expectedAttendance: z.ZodCoercedNumber<unknown>;
    departmentId: z.ZodOptional<z.ZodString>;
    facultyCoordinatorId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type EventInput = z.infer<typeof eventInputSchema>;
export declare const eventUpdateSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>>;
    expectedAttendance: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    departmentId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    facultyCoordinatorId: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
}, z.core.$strip>;
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;
export declare const eventCoordinatorSchema: z.ZodObject<{
    facultyCoordinatorId: z.ZodString;
}, z.core.$strip>;
export type EventCoordinatorInput = z.infer<typeof eventCoordinatorSchema>;
export declare const eventOrganizerSchema: z.ZodObject<{
    userId: z.ZodString;
}, z.core.$strip>;
export type EventOrganizerInput = z.infer<typeof eventOrganizerSchema>;
export interface EventTeamMember {
    id: string;
    userId: string;
    firstName: string;
    lastName: string;
    email: string;
    department: {
        id: string;
        code: string;
        name: string;
    };
    assignedAt?: string;
    assignedBy?: {
        id: string;
        firstName: string;
        lastName: string;
    };
}
export interface EventTeamView {
    creator: EventTeamMember;
    facultyCoordinator: EventTeamMember | null;
    organizers: EventTeamMember[];
}
export declare const ALLOTMENT_STATUSES: readonly ["ACTIVE", "CANCELLED", "RELEASED"];
export type AllotmentStatus = (typeof ALLOTMENT_STATUSES)[number];
export declare const ALLOTMENT_POLICIES: readonly ["AUTO_REJECT_CONFLICTS"];
export type AllotmentPolicy = (typeof ALLOTMENT_POLICIES)[number];
export declare const allotmentConfirmSchema: z.ZodObject<{
    venueRequestId: z.ZodString;
    remarks: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    conflictResolutionPolicy: z.ZodDefault<z.ZodEnum<{
        AUTO_REJECT_CONFLICTS: "AUTO_REJECT_CONFLICTS";
    }>>;
    expectedUpdatedAt: z.ZodOptional<z.ZodISODateTime>;
    reviewedCompetingRequestIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type AllotmentConfirmInput = z.infer<typeof allotmentConfirmSchema>;
export declare const allotmentCancelSchema: z.ZodObject<{
    reason: z.ZodString;
}, z.core.$strip>;
export type AllotmentCancelInput = z.infer<typeof allotmentCancelSchema>;
export declare const allotmentInboxQuerySchema: z.ZodObject<{
    venueId: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type AllotmentInboxQuery = z.infer<typeof allotmentInboxQuerySchema>;
export declare const venueRequestInputSchema: z.ZodObject<{
    eventId: z.ZodString;
    venueId: z.ZodString;
    startTime: z.ZodISODateTime;
    endTime: z.ZodISODateTime;
}, z.core.$strip>;
export type VenueRequestInput = z.infer<typeof venueRequestInputSchema>;
export declare const venueRequestUpdateSchema: z.ZodObject<{
    venueId: z.ZodOptional<z.ZodString>;
    startTime: z.ZodOptional<z.ZodISODateTime>;
    endTime: z.ZodOptional<z.ZodISODateTime>;
    event: z.ZodOptional<z.ZodObject<{
        title: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>>;
        expectedAttendance: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        departmentId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        facultyCoordinatorId: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type VenueRequestUpdateInput = z.infer<typeof venueRequestUpdateSchema>;
export declare const venueScheduleQuerySchema: z.ZodObject<{
    from: z.ZodISODateTime;
    to: z.ZodISODateTime;
}, z.core.$strip>;
export declare const availabilityQuerySchema: z.ZodObject<{
    from: z.ZodISODateTime;
    to: z.ZodISODateTime;
    excludeRequestId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const EVENT_STATUSES: readonly ["DRAFT", "SUBMITTED", "CANCELLED", "COMPLETED"];
export type EventStatus = (typeof EVENT_STATUSES)[number];
export declare const REQUEST_STATUSES: readonly ["SUBMITTED", "IN_REVIEW", "APPROVED_PENDING_ALLOTMENT", "CONFIRMED", "REJECTED", "SUPERSEDED_CONFLICT", "CANCELLED"];
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export declare const REQUEST_STATUS_LABELS: Record<RequestStatus, string>;
export declare const EVENT_STATUS_LABELS: Record<EventStatus, string>;
export declare const BOOKING_ROLES: readonly RoleName[];
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
    department: {
        id: string;
        code: string;
        name: string;
    };
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
