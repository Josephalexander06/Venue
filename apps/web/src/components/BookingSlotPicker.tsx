import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarBlank, Clock } from '@phosphor-icons/react';
import type { Venue } from '../lib/api';
import { addDays, dateKey, formatLongDay, monthGridRange, sameDay, startOfWeek } from '../lib/datetime';
import { dayAvailability, displaySlot, hourlySlots, scheduleOptions, slotAvailability } from '../lib/slot-schedule';
import { getVenueSlot, type VenueSlot } from '../lib/venue-slot';
import { VenueCalendar } from './VenueCalendar';
import { Alert, Skeleton, TextField } from './ui';

type Selection = { date: Date; start: string; end: string };

export function BookingSlotPicker({ venue, value, onChange }: {
  venue: Venue;
  value: Selection;
  onChange: (selection: Selection) => void;
}) {
  const { date, start, end } = value;
  const [anchor, setAnchor] = useState(date);
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const hourly = hourlySlots(date);
  const month = monthGridRange(anchor);
  const week = startOfWeek(anchor);
  const from = new Date(Math.min(month.start.getTime(), week.getTime()));
  const to = new Date(Math.max(month.end.getTime(), addDays(week, 7).getTime()));
  const visibleDate = date >= from && date < to;
  const calendar = useQuery(scheduleOptions(venue.id, from, to));
  const selected = useQuery({
    ...scheduleOptions(venue.id, date, addDays(date, 1)),
    enabled: !visibleDate,
  });
  const entries = visibleDate ? calendar.data?.entries : selected.data?.entries;
  const didFail = visibleDate ? calendar.isError : selected.isError;

  function setDate(day: Date) {
    setAnchor(day);
    if (!sameDay(date, day)) {
      setAnchorIndex(null);
      onChange({ date: day, start: '', end: '' });
    }
  }

  function selectHour(index: number) {
    const first = Math.min(index, anchorIndex ?? index);
    const last = Math.max(index, anchorIndex ?? index);
    const candidate = getVenueSlot(dateKey(date), hourly[first]!.start, hourly[last]!.end)!;
    if (entries && slotAvailability(candidate, venue, entries).state === 'booked') {
      onChange({ date, start: hourly[index]!.start, end: hourly[index]!.end });
      setAnchorIndex(index);
      return;
    }
    onChange({ date, start: candidate.start, end: candidate.end });
    setAnchorIndex(anchorIndex === null ? index : null);
  }

  function getStatus(day: Date) {
    if (!calendar.data) return undefined;
    const counts = dayAvailability(day, venue, calendar.data.entries);
    return counts.open ? 'open' : counts.competing ? 'competing' : 'booked';
  }

  function isSelected(slot: VenueSlot) {
    return Boolean(start && end && slot.start >= start && slot.end <= end);
  }

  return <>
    <section className="product-panel booking-date-panel">
      <h2><CalendarBlank size={22} aria-hidden="true" /> Pick a date</h2>
      <VenueCalendar date={date} anchor={anchor} onSelect={setDate} onNavigate={setAnchor} getStatus={getStatus} />
    </section>
    <section className="product-panel booking-time-panel">
      <div className="product-heading-row">
        <div><h2><Clock size={22} aria-hidden="true" /> Pick a time</h2><p>{formatLongDay(date)}</p></div>
      </div>
      {didFail ? <Alert tone="warning" title="Could not check time slots">
        <button type="button" className="inline-link" onClick={() => void (visibleDate ? calendar : selected).refetch()}>Try again</button>
      </Alert> : !entries ? <div className="time-grid" role="status">
        <span className="sr-only">Loading time slots</span>
        {hourly.map((slot) => <Skeleton key={slot.start} className="time-skeleton" />)}
      </div> : <div className="time-grid" role="group" aria-label="Hourly time slots">
        {hourly.map((slot, index) => {
          const { state, competing } = slotAvailability(slot, venue, entries);
          return <button type="button" key={slot.start} aria-pressed={isSelected(slot)}
            disabled={state === 'past' || state === 'booked'} onClick={() => selectHour(index)}>
            <strong>{displaySlot(slot.from, slot.to)}</strong>
            <span className={`availability-label availability-${state}`}><i aria-hidden="true" />
              {state === 'open' ? 'Open' : state === 'competing' ? `${competing} pending` : state === 'booked' ? 'Booked' : 'Past'}
            </span>
          </button>;
        })}
      </div>}
      {anchorIndex !== null && <p className="picker-hint" role="status">Tap another slot to extend your booking.</p>}
      <details className="product-disclosure">
        <summary>Choose a custom time</summary>
        <div className="form-row">
          <TextField label="Start time" name="start-time" type="time" value={start} onChange={(event) => {
            setAnchorIndex(null);
            onChange({ date, start: event.target.value, end });
          }} />
          <TextField label="End time" name="end-time" type="time" value={end} onChange={(event) => {
            setAnchorIndex(null);
            onChange({ date, start, end: event.target.value });
          }} />
        </div>
      </details>
    </section>
  </>;
}
