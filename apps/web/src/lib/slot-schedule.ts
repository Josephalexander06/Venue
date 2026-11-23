import { queryOptions } from '@tanstack/react-query';
import { api, type CalendarEntry, type Venue } from './api';
import { addDays, dateKey, startOfDay } from './datetime';
import { getVenueSlot, type VenueSlot } from './venue-slot';

type Entry = Pick<CalendarEntry, 'kind' | 'rangeStart' | 'rangeEnd'>;
export type SlotState = 'open' | 'competing' | 'booked' | 'past';

export function scheduleOptions(id: string, from: Date, to: Date) {
  return queryOptions({
    queryKey: ['venue-schedule', id, from.toISOString(), to.toISOString()],
    queryFn: ({ signal }) => api.venueSlotSchedule(id, from.toISOString(), to.toISOString(), signal),
    staleTime: 25_000,
  });
}

export function dayScheduleOptions(id: string, date: Date) {
  const start = startOfDay(date);
  return scheduleOptions(id, start, addDays(start, 1));
}

export function hourlySlots(date: Date) {
  return Array.from({ length: 12 }, (_, index) => {
    const time = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
    return getVenueSlot(dateKey(date), time(index + 8), time(index + 9))!;
  });
}

export function slotAvailability(
  slot: VenueSlot,
  venue: Pick<Venue, 'setupBufferMins' | 'teardownBufferMins'>,
  entries: Entry[],
): { state: SlotState; competing: number } {
  if (slot.from.getTime() <= Date.now()) return { state: 'past', competing: 0 };
  const from = slot.from.getTime() - venue.setupBufferMins * 60_000;
  const to = slot.to.getTime() + venue.teardownBufferMins * 60_000;
  const conflicts = entries.filter((entry) => Date.parse(entry.rangeStart) < to && Date.parse(entry.rangeEnd) > from);
  const competing = conflicts.filter((entry) => entry.kind === 'PENDING').length;
  return {
    state: conflicts.some((entry) => entry.kind === 'CONFIRMED') ? 'booked' : competing ? 'competing' : 'open',
    competing,
  };
}

export function dayAvailability(date: Date, venue: Venue, entries: Entry[]) {
  return hourlySlots(date).reduce((counts, slot) => {
    counts[slotAvailability(slot, venue, entries).state]++;
    return counts;
  }, { open: 0, competing: 0, booked: 0, past: 0 });
}

const clock = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', hour12: true });

export function displaySlot(from: Date | string, to: Date | string) {
  const start = clock.format(new Date(from)).replace(':00', '');
  const end = clock.format(new Date(to)).replace(':00', '');
  return `${start.slice(-2) === end.slice(-2) ? start.slice(0, -3) : start}–${end}`;
}
