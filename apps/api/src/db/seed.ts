import { eq } from 'drizzle-orm';
import { ROLE_LABELS, ROLE_NAMES } from '@venue/shared';
import { createDatabase } from './index.js';
import { departments, roles, userRoles, users } from './schema.js';
import { env } from '../env.js';
import { hashPassword } from '../lib/password.js';

const DEPARTMENTS = [
  ['ADMIN', 'College Administration'],
  ['CS', 'Computer Science'],
  ['ME', 'Mechanical Engineering'],
  ['EE', 'Electrical Engineering'],
  ['CE', 'Civil Engineering'],
  ['PH', 'Physics'],
  ['CH', 'Chemistry'],
  ['MA', 'Mathematics'],
  ['EN', 'English'],
  ['CO', 'Commerce'],
  ['MG', 'Management Studies'],
  ['AR', 'Architecture'],
] as const;

const { pool, db } = createDatabase(env.DATABASE_URL, 1);

try {
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD before running the seed.');
  }

  await db.transaction(async (tx) => {
    for (const [code, name] of DEPARTMENTS) {
      await tx
        .insert(departments)
        .values({ code, name })
        .onConflictDoUpdate({ target: departments.code, set: { name, updatedAt: new Date() } });
    }

    for (const name of ROLE_NAMES) {
      await tx
        .insert(roles)
        .values({ name, description: ROLE_LABELS[name] })
        .onConflictDoNothing({ target: roles.name });
    }

    const [adminDepartment] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.code, 'ADMIN'))
      .limit(1);
    const [adminRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, 'ADMINISTRATOR'))
      .limit(1);
    if (!adminDepartment || !adminRole) throw new Error('Seed prerequisites were not created.');

    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, env.SEED_ADMIN_EMAIL!))
      .limit(1);

    let adminId = existing?.id;
    if (!adminId) {
      const [created] = await tx
        .insert(users)
        .values({
          email: env.SEED_ADMIN_EMAIL!,
          passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD!),
          firstName: env.SEED_ADMIN_FIRST_NAME,
          lastName: env.SEED_ADMIN_LAST_NAME,
          departmentId: adminDepartment.id,
          status: 'ACTIVE',
          approvedAt: new Date(),
        })
        .returning({ id: users.id });
      adminId = created?.id;
    }

    if (!adminId) throw new Error('Could not create the administrator account.');

    await tx
      .insert(userRoles)
      .values({ userId: adminId, roleId: adminRole.id })
      .onConflictDoNothing();

    console.log(`Administrator ready: ${env.SEED_ADMIN_EMAIL}`);
    console.log('Departments and roles are seeded.');
  });
} finally {
  await pool.end();
}
