import { AppError } from './errors.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function parseInstant(value: string, field: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, 'INVALID_TIMESTAMP', `Provide a valid ${field}.`);
  }
  return date;
}

export function assertBookingInterval(start: Date, end: Date) {
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

export function assertCalendarWindow(from: Date, to: Date) {
  if (to.getTime() <= from.getTime()) {
    throw new AppError(400, 'INVALID_INTERVAL', 'The calendar end must be after its start.');
  }
  if (to.getTime() - from.getTime() > 120 * DAY) {
    throw new AppError(400, 'WINDOW_TOO_LONG', 'Choose a calendar window of 120 days or less.');
  }
}

export function bufferedRange(
  start: Date,
  end: Date,
  setupBufferMins: number,
  teardownBufferMins: number,
) {
  return {
    start: new Date(start.getTime() - setupBufferMins * MINUTE),
    end: new Date(end.getTime() + teardownBufferMins * MINUTE),
  };
}
