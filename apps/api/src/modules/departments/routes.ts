import type { FastifyPluginAsync } from 'fastify';
import { asc } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { departments } from '../../db/schema.js';

const departmentRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.get('/departments', async () => {
    const rows = await db
      .select({ id: departments.id, code: departments.code, name: departments.name })
      .from(departments)
      .orderBy(asc(departments.name));
    return { departments: rows };
  });
};

export default departmentRoutes;
