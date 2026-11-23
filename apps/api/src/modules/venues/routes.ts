import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  availabilityQuerySchema,
  BOOKING_ROLES,
  venueInputSchema,
  venueListQuerySchema,
  venueScheduleQuerySchema,
  venueUpdateSchema,
} from '@venue/shared';
import type { Database } from '../../db/index.js';
import { parseInput } from '../../lib/validation.js';
import { assertCalendarWindow, parseInstant } from '../../lib/booking.js';
import { assertEventViewAccess, findEventRow } from '../events/service.js';
import { effectiveStepScope } from '../approvals/eligibility.js';
import { loadBookingWorkflow } from '../requests/service.js';
import {
  archiveVenue,
  checkAvailability,
  createVenue,
  getVenueCalendar,
  listVenues,
  requireVenue,
  updateVenue,
} from './service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });
const bookingVenueListQuery = venueListQuerySchema.extend({
  eventId: z.string().uuid().optional(),
  facility: z.string().trim().max(100).optional(),
  from: availabilityQuerySchema.shape.from.optional(),
  to: availabilityQuerySchema.shape.to.optional(),
}).refine(({ from, to }) => Boolean(from) === Boolean(to), {
  path: ['to'],
  message: 'Provide both a start and end time to filter by availability.',
});

const venueRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  const adminOnly = { preHandler: app.requireRole('ADMINISTRATOR' as const) };

  app.get('/venues', { preHandler: app.authenticateCatalog }, async (request) => {
    const { eventId, from, to, ...query } = parseInput(bookingVenueListQuery, request.query);
    const availableDuring = from && to
      ? { from: parseInstant(from, 'start'), to: parseInstant(to, 'end') }
      : undefined;
    if (availableDuring) assertCalendarWindow(availableDuring.from, availableDuring.to);
    if (eventId && request.auth!.user.status === 'ACTIVE') {
      const event = await findEventRow(db, eventId);
      const user = request.auth!.user;
      await assertEventViewAccess(db, event, {
        userId: user.id,
        isAdmin: user.roles.some((entry) => entry.role === 'ADMINISTRATOR'),
      });
      query.minCapacity = Math.max(query.minCapacity ?? 0, event.expectedAttendance);
    }
    return listVenues(db, { ...query, active: true, availableDuring });
  });

  app.get('/venues/:id', { preHandler: app.authenticateCatalog }, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const isAdmin = request.auth!.user.roles.some((entry) => entry.role === 'ADMINISTRATOR');
    return { venue: await requireVenue(db, id, isAdmin) };
  });

  app.get('/venues/:id/approval-preview', { preHandler: app.requireAnyRole(BOOKING_ROLES) }, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const venue = await requireVenue(db, id);
    const departmentId = venue.department?.id ?? null;
    const { steps } = await loadBookingWorkflow(db, { workflowId: venue.workflow?.id ?? null, departmentId });
    return {
      steps: steps.map((step) => ({
        stepName: step.stepName,
        requiredRole: step.requiredRole,
        scopeType: effectiveStepScope(step, departmentId),
      })),
    };
  });

  app.get('/venues/:id/calendar', { preHandler: app.authenticate }, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const query = parseInput(venueScheduleQuerySchema, request.query);
    const from = parseInstant(query.from, 'calendar start');
    const to = parseInstant(query.to, 'calendar end');
    assertCalendarWindow(from, to);
    const isAdmin = request.auth!.user.roles.some((entry) => entry.role === 'ADMINISTRATOR');
    return getVenueCalendar(db, id, from, to, isAdmin);
  });

  app.get('/venues/:id/slot-schedule', { preHandler: app.authenticateCatalog }, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const query = parseInput(venueScheduleQuerySchema, request.query);
    const from = parseInstant(query.from, 'start');
    const to = parseInstant(query.to, 'end');
    assertCalendarWindow(from, to);
    const { entries } = await getVenueCalendar(
      db, id, new Date(from.getTime() - 4 * 60 * 60_000), new Date(to.getTime() + 4 * 60 * 60_000),
    );
    return { entries: entries.map(({ kind, rangeStart, rangeEnd }) => ({ kind, rangeStart, rangeEnd })) };
  });

  app.get('/venues/:id/availability', { preHandler: app.authenticate }, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const query = parseInput(availabilityQuerySchema, request.query);
    const from = parseInstant(query.from, 'start');
    const to = parseInstant(query.to, 'end');
    assertCalendarWindow(from, to);
    return checkAvailability(db, {
      venueId: id,
      from,
      to,
      excludeRequestId: query.excludeRequestId,
      viewerId: request.auth!.user.id,
      viewerIsAdmin: request.auth!.user.roles.some((entry) => entry.role === 'ADMINISTRATOR'),
    });
  });

  app.get('/admin/venues', adminOnly, async (request) => {
    const query = parseInput(venueListQuerySchema, request.query);
    return listVenues(db, {
      ...query,
      active: query.active === undefined ? undefined : query.active === 'true',
    });
  });

  app.post('/admin/venues', adminOnly, async (request, reply) => {
    const input = parseInput(venueInputSchema, request.body);
    const venue = await createVenue(db, input);
    return reply.status(201).send({ venue });
  });

  app.patch('/admin/venues/:id', adminOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(venueUpdateSchema, request.body);
    return { venue: await updateVenue(db, id, input) };
  });

  app.delete('/admin/venues/:id', adminOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    return { venue: await archiveVenue(db, id) };
  });
};

export default venueRoutes;
