import { z } from 'zod';
import { availabilityQuerySchema, venueInputSchema, venueListQuerySchema, venueScheduleQuerySchema, venueUpdateSchema, } from '@venue/shared';
import { parseInput } from '../../lib/validation.js';
import { assertCalendarWindow, parseInstant } from '../../lib/booking.js';
import { archiveVenue, checkAvailability, createVenue, getVenueCalendar, listVenues, requireVenue, updateVenue, } from './service.js';
const idParamsSchema = z.object({ id: z.string().uuid() });
const venueRoutes = async (app, { db }) => {
    const adminOnly = { preHandler: app.requireRole('ADMINISTRATOR') };
    app.get('/venues', { preHandler: app.authenticate }, async (request) => {
        const query = parseInput(venueListQuerySchema, request.query);
        return listVenues(db, { ...query, active: true });
    });
    app.get('/venues/:id', { preHandler: app.authenticate }, async (request) => {
        const { id } = parseInput(idParamsSchema, request.params);
        const isAdmin = request.auth.user.roles.some((entry) => entry.role === 'ADMINISTRATOR');
        return { venue: await requireVenue(db, id, isAdmin) };
    });
    app.get('/venues/:id/calendar', { preHandler: app.authenticate }, async (request) => {
        const { id } = parseInput(idParamsSchema, request.params);
        const query = parseInput(venueScheduleQuerySchema, request.query);
        const from = parseInstant(query.from, 'calendar start');
        const to = parseInstant(query.to, 'calendar end');
        assertCalendarWindow(from, to);
        const isAdmin = request.auth.user.roles.some((entry) => entry.role === 'ADMINISTRATOR');
        return getVenueCalendar(db, id, from, to, isAdmin);
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
            viewerId: request.auth.user.id,
            viewerIsAdmin: request.auth.user.roles.some((entry) => entry.role === 'ADMINISTRATOR'),
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
//# sourceMappingURL=routes.js.map