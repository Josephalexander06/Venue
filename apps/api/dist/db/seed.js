import { eq } from 'drizzle-orm';
import { ROLE_LABELS, ROLE_NAMES } from '@venue/shared';
import { createDatabase } from './index.js';
import { approvalWorkflows, departments, roles, userRoles, users, venues, workflowSteps, } from './schema.js';
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
];
const DEFAULT_WORKFLOW = 'Default venue review';
const SAMPLE_VENUES = [
    {
        code: 'AUD',
        name: 'Main Auditorium',
        building: 'Central Block',
        floor: 0,
        capacity: 500,
        facilities: ['Stage', 'Projector', 'Sound system', 'Air conditioning'],
        setupBufferMins: 60,
        teardownBufferMins: 60,
        departmentCode: null,
    },
    {
        code: 'SEM-A',
        name: 'Seminar Hall A',
        building: 'Academic Block A',
        floor: 2,
        capacity: 120,
        facilities: ['Projector', 'Air conditioning', 'Video conferencing'],
        setupBufferMins: 30,
        teardownBufferMins: 30,
        departmentCode: 'CS',
    },
    {
        code: 'LAB-1',
        name: 'Computer Lab 1',
        building: 'IT Block',
        floor: 1,
        capacity: 60,
        facilities: ['Workstations', 'Projector', 'Air conditioning'],
        setupBufferMins: 15,
        teardownBufferMins: 15,
        departmentCode: 'CS',
    },
    {
        code: 'WS-ME',
        name: 'Mechanical Workshop',
        building: 'Engineering Block',
        floor: 0,
        capacity: 80,
        facilities: ['Workbenches', 'Tooling', 'Safety equipment'],
        setupBufferMins: 30,
        teardownBufferMins: 30,
        departmentCode: 'ME',
    },
];
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
        let [defaultWorkflow] = await tx
            .select({ id: approvalWorkflows.id, isDefault: approvalWorkflows.isDefault })
            .from(approvalWorkflows)
            .where(eq(approvalWorkflows.name, DEFAULT_WORKFLOW))
            .limit(1);
        if (!defaultWorkflow) {
            [defaultWorkflow] = await tx
                .insert(approvalWorkflows)
                .values({
                name: DEFAULT_WORKFLOW,
                description: 'Department endorsement followed by college venue allotment.',
                isDefault: true,
            })
                .returning({ id: approvalWorkflows.id, isDefault: approvalWorkflows.isDefault });
        }
        else if (!defaultWorkflow.isDefault) {
            await tx
                .update(approvalWorkflows)
                .set({ isDefault: true })
                .where(eq(approvalWorkflows.id, defaultWorkflow.id));
        }
        if (!defaultWorkflow)
            throw new Error('Default approval workflow was not created.');
        await tx
            .insert(workflowSteps)
            .values([
            {
                workflowId: defaultWorkflow.id,
                stepOrder: 1,
                stepName: 'Department endorsement',
                requiredRole: 'HOD',
                scopeType: 'CREATOR_DEPARTMENT',
            },
            {
                workflowId: defaultWorkflow.id,
                stepOrder: 2,
                stepName: 'Venue allotment',
                requiredRole: 'ADMINISTRATOR',
                scopeType: 'COLLEGE_WIDE',
                isFinalAllotmentStep: true,
            },
        ])
            .onConflictDoNothing();
        const departmentRows = await tx
            .select({ id: departments.id, code: departments.code })
            .from(departments);
        const departmentIds = new Map(departmentRows.map((row) => [row.code, row.id]));
        for (const venue of SAMPLE_VENUES) {
            await tx
                .insert(venues)
                .values({
                code: venue.code,
                name: venue.name,
                building: venue.building,
                floor: venue.floor,
                capacity: venue.capacity,
                facilities: [...venue.facilities],
                setupBufferMins: venue.setupBufferMins,
                teardownBufferMins: venue.teardownBufferMins,
                departmentId: venue.departmentCode
                    ? (departmentIds.get(venue.departmentCode) ?? null)
                    : null,
            })
                .onConflictDoNothing({ target: venues.code });
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
        if (!adminDepartment || !adminRole)
            throw new Error('Seed prerequisites were not created.');
        const [existing] = await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, env.SEED_ADMIN_EMAIL))
            .limit(1);
        let adminId = existing?.id;
        if (!adminId) {
            const [created] = await tx
                .insert(users)
                .values({
                email: env.SEED_ADMIN_EMAIL,
                passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
                firstName: env.SEED_ADMIN_FIRST_NAME,
                lastName: env.SEED_ADMIN_LAST_NAME,
                departmentId: adminDepartment.id,
                status: 'ACTIVE',
                approvedAt: new Date(),
            })
                .returning({ id: users.id });
            adminId = created?.id;
        }
        if (!adminId)
            throw new Error('Could not create the administrator account.');
        await tx
            .insert(userRoles)
            .values({ userId: adminId, roleId: adminRole.id })
            .onConflictDoNothing();
        console.log(`Administrator ready: ${env.SEED_ADMIN_EMAIL}`);
        console.log('Departments, roles, workflow and sample venues are seeded.');
    });
}
finally {
    await pool.end();
}
//# sourceMappingURL=seed.js.map