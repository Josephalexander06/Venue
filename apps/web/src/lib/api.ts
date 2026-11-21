import type {
  ApiErrorBody,
  ApprovalDecision,
  ApprovalDecisionInput,
  ApproverRole,
  AuthSessionResponse,
  DepartmentInput,
  DepartmentUpdateInput,
  EventInput,
  EventStatus,
  EventUpdateInput,
  RegistrationInput,
  RequestStatus,
  RoleName,
  SessionUser,
  UserStatus,
  VenueInput,
  VenueRequestInput,
  VenueRequestUpdateInput,
  VenueUpdateInput,
  WorkflowInput,
  WorkflowScopeType,
  WorkflowUpdateInput,
} from '@venue/shared';

export interface Department {
  id: string;
  code: string;
  name: string;
}

export interface UserView extends SessionUser {
  phone: string | null;
  statusReason: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface AdminStats {
  counts: Record<UserStatus, number>;
  recentPending: UserView[];
}

export interface UserList {
  users: UserView[];
  total: number;
}


export interface Venue {
  id: string;
  code: string;
  name: string;
  building: string;
  floor: number;
  capacity: number;
  facilities: string[];
  setupBufferMins: number;
  teardownBufferMins: number;
  isActive: boolean;
  department: { id: string; code: string; name: string } | null;
  workflow?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface VenueList {
  venues: Venue[];
  total: number;
}

export interface VenueListParams {
  search?: string;
  building?: string;
  departmentId?: string;
  minCapacity?: number;
  active?: boolean;
  limit?: number;
  offset?: number;
}

export interface CalendarEntry {
  id: string;
  kind: 'CONFIRMED' | 'PENDING';
  requestId: string;
  eventId: string;
  title: string;
  startTime: string;
  endTime: string;
  rangeStart: string;
  rangeEnd: string;
  status: RequestStatus;
  setupBufferMins: number;
  teardownBufferMins: number;
}

export interface VenueCalendar {
  venue: Venue;
  entries: CalendarEntry[];
}

export interface Conflict {
  requestId: string;
  eventId: string;
  title: string;
  status: RequestStatus;
  startTime: string;
  endTime: string;
  rangeStart: string;
  rangeEnd: string;
  departmentCode?: string;
  departmentName?: string;
  expectedAttendance?: number;
}

export interface Availability {
  venue: Venue;
  effectiveRange: { start: string; end: string };
  hasConfirmedConflict: boolean;
  confirmedConflicts: Conflict[];
  pendingConflicts: Conflict[];
}

export interface RequestView {
  id: string;
  eventId: string;
  submittedById?: string;
  requiresFacultyEndorsement?: boolean;
  facultyEndorserId?: string | null;
  facultyEndorsedAt?: string | null;
  venue: {
    id: string;
    code: string;
    name: string;
    building: string;
    floor: number;
    capacity: number;
  };
  startTime: string;
  endTime: string;
  effectiveStart: string;
  effectiveEnd: string;
  setupBufferMins: number;
  teardownBufferMins: number;
  status: RequestStatus;
  currentStepOrder: number;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventSummary {
  id: string;
  title: string;
  description: string | null;
  expectedAttendance: number;
  status: EventStatus;
  department: { id: string; code: string; name: string };
  creatorId?: string;
  facultyCoordinatorId?: string | null;
  facultyCoordinator?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventTeamMember {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  department: { id: string; code: string; name: string };
  assignedAt?: string;
}

export interface EventTeamView {
  creator: EventTeamMember;
  facultyCoordinator: EventTeamMember | null;
  organizers: EventTeamMember[];
}

export interface FacultyMember {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  department: { id: string; code: string; name: string };
}

export interface OrganizerCandidate {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  department: { id: string; code: string; name: string };
}

export interface DepartmentWithStats extends Department {
  createdAt: string;
  updatedAt: string;
  usersCount: number;
  venuesCount: number;
  eventsCount: number;
}

export interface EventView extends EventSummary {
  requests: RequestView[];
}

export interface RequestDetail {
  request: RequestView;
  event: EventSummary;
}

export interface WorkflowStepView {
  id: string;
  stepOrder: number;
  stepName: string;
  requiredRole: ApproverRole;
  scopeType: WorkflowScopeType;
  isFinalAllotmentStep: boolean;
}

export interface WorkflowView {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  steps: WorkflowStepView[];
  venueCount: number;
  usageCount: number;
  stepsLocked: boolean;
  createdAt: string;
}

export interface ApprovalDecisionView {
  id: string;
  instanceId: string;
  round: number;
  stepOrder: number;
  stepName: string;
  decision: ApprovalDecision;
  remarks: string | null;
  approver: { id: string; firstName: string; lastName: string; email: string };
  decidedAt: string;
  isCurrentRound: boolean;
}

export interface ApprovalTimelineStep {
  id: string;
  stepOrder: number;
  stepName: string;
  requiredRole: RoleName;
  scopeType: WorkflowScopeType;
  isFinalAllotmentStep: boolean;
  state: ApprovalDecision | 'CURRENT' | 'PENDING';
  decision: ApprovalDecisionView | null;
}

export interface AllotmentView {
  id: string;
  status: 'ACTIVE' | 'CANCELLED' | 'RELEASED';
  reservedRange: string;
  allottedBy: { id: string; firstName: string; lastName: string; email: string };
  createdAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

export interface AllotmentConfirmInput {
  venueRequestId: string;
  remarks?: string;
  conflictResolutionPolicy?: 'AUTO_REJECT_CONFLICTS';
}

export interface AllotmentConfirmResult {
  allotmentId: string;
  status: 'ACTIVE';
  venueId: string;
  reservedRange: string;
  supersededRequestsCount: number;
  supersededRequestIds: string[];
}

export interface AllotmentCancelInput {
  reason: string;
}

export interface AllotmentCancelResult {
  success: boolean;
  allotmentId: string;
  status: 'CANCELLED';
  cancelledAt: string;
  releasedRange: string;
  affectedSupersededCount: number;
  affectedRequestIds: string[];
}

export interface CompetingRequestItem {
  request: RequestView;
  event: EventSummary;
  organizer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

export interface CompetingRequestsView {
  targetRequestId: string;
  competingRequests: CompetingRequestItem[];
}

export interface RequestDetailView {
  request: RequestView;
  event: EventSummary;
  workflow: {
    id: string;
    name: string;
    description: string | null;
    steps: Omit<ApprovalTimelineStep, 'state' | 'decision'>[];
  };
  timeline: ApprovalTimelineStep[];
  decisions: ApprovalDecisionView[];
  conflicts: { confirmed: Conflict[]; pending: Conflict[] };
  currentRound: number | null;
  allotment?: AllotmentView | null;
  permissions: {
    canDecide: boolean;
    canEdit: boolean;
    canCancel: boolean;
    canAllot: boolean;
    canCancelAllotment: boolean;
  };
}

export interface ApprovalInboxItem {
  request: RequestView;
  event: EventSummary;
  step: WorkflowStepView;
  conflicts: { confirmedCount: number; pendingCount: number };
}

export interface ApprovalInboxList {
  items: ApprovalInboxItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface RoleAssignment {
  role: RoleName;
  departmentId?: string | null;
}

export interface UserListParams {
  status?: UserStatus | 'ALL';
  search?: string;
  limit?: number;
  offset?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(status: number, body: Partial<ApiErrorBody> | null) {
    super(body?.message || 'Something went wrong. Please try again.');
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.code ?? 'REQUEST_ERROR';
    this.fieldErrors = body?.fieldErrors;
  }
}

const BASE = '/api/v1';
const CSRF_COOKIE = 'venue_csrf';

function readCookie(name: string) {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const value = part.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return null;
}

async function request<T>(
  path: string,
  init: RequestInit & { method?: string } = {},
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);

  if (init.body) headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = readCookie(CSRF_COOKIE);
    if (token) headers.set('x-csrf-token', token);
  }

  const response = await fetch(`${BASE}${path}`, {
    ...init,
    method,
    headers,
    credentials: 'same-origin',
  });

  if (response.status === 204) return undefined as T;

  const body = (await response.json().catch(() => null)) as
    | (T & Partial<ApiErrorBody>)
    | null;

  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

export const api = {
  async getMe(): Promise<AuthSessionResponse | null> {
    try {
      return await request<AuthSessionResponse>('/auth/me');
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
      throw error;
    }
  },

  login(input: { email: string; password: string }) {
    return request<AuthSessionResponse>('/auth/login', {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  register(input: RegistrationInput) {
    return request<{
      user: { id: string; email: string; status: UserStatus; createdAt: string };
      message: string;
    }>('/auth/register', {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  logout() {
    return request<void>('/auth/logout', { method: 'POST' });
  },

  departments() {
    return request<{ departments: Department[] }>('/departments');
  },

  venues(params: VenueListParams = {}) {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.building) query.set('building', params.building);
    if (params.departmentId) query.set('departmentId', params.departmentId);
    if (params.minCapacity) query.set('minCapacity', String(params.minCapacity));
    if (params.active !== undefined) query.set('active', String(params.active));
    query.set('limit', String(params.limit ?? 50));
    query.set('offset', String(params.offset ?? 0));
    return request<VenueList>(`/venues?${query.toString()}`);
  },

  adminVenues(params: VenueListParams = {}) {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.building) query.set('building', params.building);
    if (params.departmentId) query.set('departmentId', params.departmentId);
    if (params.minCapacity) query.set('minCapacity', String(params.minCapacity));
    if (params.active !== undefined) query.set('active', String(params.active));
    query.set('limit', String(params.limit ?? 50));
    query.set('offset', String(params.offset ?? 0));
    return request<VenueList>(`/admin/venues?${query.toString()}`);
  },

  venue(id: string) {
    return request<{ venue: Venue }>(`/venues/${id}`);
  },

  venueCalendar(id: string, from: string, to: string) {
    const query = new URLSearchParams({ from, to });
    return request<VenueCalendar>(`/venues/${id}/calendar?${query.toString()}`);
  },

  venueAvailability(id: string, from: string, to: string, excludeRequestId?: string) {
    const query = new URLSearchParams({ from, to });
    if (excludeRequestId) query.set('excludeRequestId', excludeRequestId);
    return request<Availability>(`/venues/${id}/availability?${query.toString()}`);
  },

  createVenue(input: VenueInput) {
    return request<{ venue: Venue }>('/admin/venues', {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  updateVenue(id: string, input: VenueUpdateInput) {
    return request<{ venue: Venue }>(`/admin/venues/${id}`, {
      method: 'PATCH',
      body: jsonBody(input),
    });
  },

  archiveVenue(id: string) {
    return request<{ venue: Venue }>(`/admin/venues/${id}`, { method: 'DELETE' });
  },

  myEvents() {
    return request<{ events: EventView[] }>('/events/mine');
  },

  event(id: string) {
    return request<{ event: EventView }>(`/events/${id}`);
  },

  createEvent(input: EventInput) {
    return request<{ event: EventView }>('/events', {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  updateEvent(id: string, input: EventUpdateInput) {
    return request<{ event: EventView }>(`/events/${id}`, {
      method: 'PATCH',
      body: jsonBody(input),
    });
  },

  cancelEvent(id: string) {
    return request<{ event: EventView }>(`/events/${id}`, { method: 'DELETE' });
  },

  requestDetail(id: string) {
    return request<RequestDetailView>(`/venue-requests/${id}`);
  },

  approvalInbox(params: { limit?: number; offset?: number } = {}) {
    const query = new URLSearchParams();
    query.set('limit', String(params.limit ?? 25));
    query.set('offset', String(params.offset ?? 0));
    return request<ApprovalInboxList>(`/approvals/inbox?${query.toString()}`);
  },

  approvalDetail(id: string) {
    return request<RequestDetailView>(`/approvals/${id}`);
  },

  decideApproval(id: string, input: ApprovalDecisionInput) {
    return request<RequestDetailView & { outcome: { status: RequestStatus; finalised: boolean } }>(
      `/approvals/${id}/decision`,
      {
        method: 'POST',
        body: jsonBody(input),
      },
    );
  },

  workflows() {
    return request<{ workflows: WorkflowView[] }>('/workflows');
  },

  adminWorkflows() {
    return request<{ workflows: WorkflowView[] }>('/admin/workflows');
  },

  createWorkflow(input: WorkflowInput) {
    return request<{ workflow: WorkflowView }>('/admin/workflows', {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  updateWorkflow(id: string, input: WorkflowUpdateInput) {
    return request<{ workflow: WorkflowView }>(`/admin/workflows/${id}`, {
      method: 'PATCH',
      body: jsonBody(input),
    });
  },

  createRequest(input: VenueRequestInput) {
    return request<RequestDetail>('/venue-requests', {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  updateRequest(id: string, input: VenueRequestUpdateInput) {
    return request<RequestDetail>(`/venue-requests/${id}`, {
      method: 'PATCH',
      body: jsonBody(input),
    });
  },

  cancelRequest(id: string) {
    return request<RequestDetail>(`/venue-requests/${id}`, { method: 'DELETE' });
  },

  adminStats() {
    return request<AdminStats>('/admin/stats');
  },

  adminUsers(params: UserListParams = {}) {
    const query = new URLSearchParams();
    if (params.status && params.status !== 'ALL') query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    query.set('limit', String(params.limit ?? 25));
    query.set('offset', String(params.offset ?? 0));
    return request<UserList>(`/admin/users?${query.toString()}`);
  },

  approveUser(userId: string, roles: RoleAssignment[]) {
    return request<{ user: UserView }>(`/admin/users/${userId}/approve`, {
      method: 'PATCH',
      body: jsonBody({ roles }),
    });
  },

  rejectUser(userId: string, reason: string) {
    return request<{ user: UserView }>(`/admin/users/${userId}/reject`, {
      method: 'PATCH',
      body: jsonBody({ reason }),
    });
  },

  updateUserRoles(userId: string, roles: RoleAssignment[]) {
    return request<{ user: UserView }>(`/admin/users/${userId}/roles`, {
      method: 'PATCH',
      body: jsonBody({ roles }),
    });
  },

  confirmAllotment(input: AllotmentConfirmInput) {
    return request<AllotmentConfirmResult>('/allotments/confirm', {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  cancelAllotment(allotmentId: string, input: AllotmentCancelInput) {
    return request<AllotmentCancelResult>(`/allotments/${allotmentId}/cancel`, {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  competingRequests(requestId: string) {
    return request<CompetingRequestsView>(`/allotments/competing/${requestId}`);
  },

  adminDepartments() {
    return request<{ departments: DepartmentWithStats[] }>('/admin/departments');
  },

  createDepartment(input: DepartmentInput) {
    return request<{ department: DepartmentWithStats }>('/admin/departments', {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  updateDepartment(id: string, input: DepartmentUpdateInput) {
    return request<{ department: DepartmentWithStats }>(`/admin/departments/${id}`, {
      method: 'PATCH',
      body: jsonBody(input),
    });
  },

  deleteDepartment(id: string) {
    return request<null>(`/admin/departments/${id}`, {
      method: 'DELETE',
    });
  },

  departmentFaculty(departmentId: string) {
    return request<{ faculty: FacultyMember[] }>(`/departments/${departmentId}/faculty`);
  },

  eventTeam(eventId: string) {
    return request<{ team: EventTeamView }>(`/events/${eventId}/team`);
  },

  organizerCandidates(eventId: string, search: string) {
    return request<{ candidates: OrganizerCandidate[] }>(
      `/events/${eventId}/organizer-candidates?search=${encodeURIComponent(search)}`,
    );
  },

  setEventCoordinator(eventId: string, facultyCoordinatorId: string) {
    return request<{ team: EventTeamView }>(`/events/${eventId}/coordinator`, {
      method: 'POST',
      body: jsonBody({ facultyCoordinatorId }),
    });
  },

  addEventOrganizer(eventId: string, userId: string) {
    return request<{ team: EventTeamView }>(`/events/${eventId}/organizers`, {
      method: 'POST',
      body: jsonBody({ userId }),
    });
  },

  removeEventOrganizer(eventId: string, userId: string) {
    return request<{ team: EventTeamView }>(`/events/${eventId}/organizers/${userId}`, {
      method: 'DELETE',
    });
  },
};

export function fieldError(error: unknown, field: string) {
  if (!(error instanceof ApiError)) return undefined;
  return error.fieldErrors?.[field]?.[0];
}
