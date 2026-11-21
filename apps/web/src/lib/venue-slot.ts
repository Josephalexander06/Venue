import { queryOptions } from '@tanstack/react-query';
import { api } from './api';
import { combineDateTime, dateInputValue, parseDateKey } from './datetime';

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function parseBookingDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = parseDateKey(value);
  return dateInputValue(date) === value ? date : null;
}

export function getVenueSlot(date: string, start: string, end: string) {
  if (!parseBookingDate(date) || !TIME.test(start) || !TIME.test(end)) return null;
  const from = combineDateTime(date, start);
  const to = combineDateTime(date, end);
  return to > from ? { date, start, end, from, to } : null;
}

export type VenueSlot = NonNullable<ReturnType<typeof getVenueSlot>>;

export function readVenueSlot(params: URLSearchParams) {
  return getVenueSlot(params.get('date') ?? '', params.get('start') ?? '', params.get('end') ?? '');
}

export function readGuestCount(params: URLSearchParams) {
  const value = Number(params.get('guests'));
  return Number.isInteger(value) && value >= 1 && value <= 100_000 ? value : null;
}

export function venueAvailabilityOptions(
  id: string | undefined,
  slot: VenueSlot | null,
  excludeRequestId: string | null = null,
) {
  const from = slot?.from.toISOString();
  const to = slot?.to.toISOString();
  return queryOptions({
    queryKey: ['venue-availability', id, from, to, excludeRequestId],
    queryFn: ({ signal }) => api.venueAvailability(id!, from!, to!, excludeRequestId ?? undefined, signal),
    enabled: Boolean(id && from && to),
    staleTime: 15_000,
  });
}
