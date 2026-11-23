import { and, count, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import type { RoleName, SessionUser, UserStatus } from '@venue/shared';
import type { Database } from '../../db/index.js';
import { departments, roles, userRoles, users } from '../../db/schema.js';

export interface UserView extends SessionUser {
  phone: string | null;
  statusReason: string | null;
  approvedAt: string | null;
  createdAt: string;
}

interface UserBaseRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  status: UserStatus;
  statusReason: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
}

const userSelection = {
  id: users.id,
  email: users.email,
  firstName: users.firstName,
  lastName: users.lastName,
  phone: users.phone,
  status: users.status,
  statusReason: users.statusReason,
  approvedAt: users.approvedAt,
  createdAt: users.createdAt,
  departmentId: departments.id,
  departmentCode: departments.code,
  departmentName: departments.name,
};

async function rolesForUsers(db: Database, userIds: string[]) {
  const result = new Map<string, SessionUser['roles']>();
  if (userIds.length === 0) return result;

  const rows = await db
    .select({
      userId: userRoles.userId,
      role: roles.name,
      departmentId: userRoles.departmentId,
      venueId: userRoles.venueId,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(inArray(userRoles.userId, userIds));

  for (const row of rows) {
    const list = result.get(row.userId) ?? [];
    list.push({ role: row.role as RoleName, departmentId: row.departmentId, venueId: row.venueId });
    result.set(row.userId, list);
  }
  return result;
}

function mapUser(row: UserBaseRow, roleList: SessionUser['roles']): UserView {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    status: row.status,
    statusReason: row.statusReason,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    department: { id: row.departmentId, code: row.departmentCode, name: row.departmentName },
    roles: roleList,
  };
}

export async function findUserView(db: Database, userId: string): Promise<UserView | null> {
  const [row] = await db
    .select(userSelection)
    .from(users)
    .innerJoin(departments, eq(departments.id, users.departmentId))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;
  const rolesByUser = await rolesForUsers(db, [userId]);
  return mapUser(row, rolesByUser.get(userId) ?? []);
}

export async function listUserViews(
  db: Database,
  filters: { status?: UserStatus; departmentId?: string; search?: string; limit: number; offset: number },
) {
  const conditions: SQL[] = [];
  if (filters.departmentId) conditions.push(eq(users.departmentId, filters.departmentId));
  if (filters.status) conditions.push(eq(users.status, filters.status));
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    const searchCondition = or(
      ilike(users.email, pattern),
      ilike(users.firstName, pattern),
      ilike(users.lastName, pattern),
    );
    if (searchCondition) conditions.push(searchCondition);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select(userSelection)
    .from(users)
    .innerJoin(departments, eq(departments.id, users.departmentId))
    .where(where)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(filters.limit)
    .offset(filters.offset);

  const [totalRow] = await db.select({ value: count() }).from(users).where(where);
  const rolesByUser = await rolesForUsers(
    db,
    rows.map((row) => row.id),
  );

  return {
    users: rows.map((row) => mapUser(row, rolesByUser.get(row.id) ?? [])),
    total: totalRow?.value ?? 0,
  };
}
