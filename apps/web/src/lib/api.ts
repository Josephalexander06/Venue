import type {
  ApiErrorBody,
  AuthSessionResponse,
  RegistrationInput,
  RoleName,
  SessionUser,
  UserStatus,
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
};

export function fieldError(error: unknown, field: string) {
  if (!(error instanceof ApiError)) return undefined;
  return error.fieldErrors?.[field]?.[0];
}
