import { and, eq, exists, inArray, sql } from 'drizzle-orm';
import type { BookingPeople, BookingPerson } from '@venue/shared';
import type { Database } from '../../db/index.js';
import { departments, roles, userRoles, users } from '../../db/schema.js';

interface BookingParticipants {
  submittedById: string;
  requiresFacultyEndorsement: boolean;
  facultyCoordinatorId?: string | null;
}

export async function loadBookingPeople(db: Database, requests: BookingParticipants[]) {
  const ids = new Set<string>();
  for (const item of requests) {
    ids.add(item.submittedById);
    if (item.requiresFacultyEndorsement && item.facultyCoordinatorId) ids.add(item.facultyCoordinatorId);
  }
  const people = new Map<string, { person: BookingPerson; isFaculty: boolean }>();
  if (!ids.size) return people;

  const facultyRole = db.select({ id: userRoles.id })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(userRoles.userId, users.id), eq(roles.name, 'FACULTY')));
  const rows = await db.select({
    id: users.id,
    firstName: users.firstName,
    lastName: users.lastName,
    department: { id: departments.id, code: departments.code, name: departments.name },
    isFaculty: sql<boolean>`${exists(facultyRole)}`,
  }).from(users)
    .innerJoin(departments, eq(departments.id, users.departmentId))
    .where(inArray(users.id, [...ids]));

  for (const row of rows) {
    people.set(row.id, {
      person: { name: `${row.firstName} ${row.lastName}`.trim(), department: row.department },
      isFaculty: row.isFaculty,
    });
  }
  return people;
}

export function bookingPeople(
  item: BookingParticipants,
  people: Awaited<ReturnType<typeof loadBookingPeople>>,
): BookingPeople {
  const requester = people.get(item.submittedById);
  const coordinator = item.requiresFacultyEndorsement && item.facultyCoordinatorId
    ? people.get(item.facultyCoordinatorId)?.person ?? null : null;
  return {
    requester: requester ? {
      ...requester.person,
      kind: item.requiresFacultyEndorsement ? 'STUDENT' : requester.isFaculty ? 'FACULTY' : 'OTHER',
    } : null,
    facultyCoordinator: coordinator,
  };
}
