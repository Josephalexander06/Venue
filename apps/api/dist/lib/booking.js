import { AppError } from './errors.js';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
export function parseInstant(value, field) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new AppError(400, 'INVALID_TIMESTAMP', `Provide a valid ${field}.`);
    }
    return date;
}
export function assertBookingInterval(start, end) {
    if (end.getTime() <= start.getTime()) {
        throw new AppError(400, 'INVALID_INTERVAL', 'The end time must be after the start time.');
    }
    if (end.getTime() - start.getTime() > 30 * DAY) {
        throw new AppError(400, 'INTERVAL_TOO_LONG', 'A booking cannot span more than 30 days.');
    }
    if (start.getTime() < Date.now() - 5 * MINUTE) {
        throw new AppError(400, 'START_IN_PAST', 'Choose a start time in the future.');
    }
}
export function assertCalendarWindow(from, to) {
    if (to.getTime() <= from.getTime()) {
        throw new AppError(400, 'INVALID_INTERVAL', 'The calendar end must be after its start.');
    }
    if (to.getTime() - from.getTime() > 120 * DAY) {
        throw new AppError(400, 'WINDOW_TOO_LONG', 'Choose a calendar window of 120 days or less.');
    }
}
export function bufferedRange(start, end, setupBufferMins, teardownBufferMins) {
    return {
        start: new Date(start.getTime() - setupBufferMins * MINUTE),
        end: new Date(end.getTime() + teardownBufferMins * MINUTE),
    };
}
//# sourceMappingURL=booking.js.map