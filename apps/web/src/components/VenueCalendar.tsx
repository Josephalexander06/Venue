import {
  CaretLeft,
  CaretRight,
  Clock,
  Info,
} from '@phosphor-icons/react';
import { Button, Spinner } from './ui';
import type { CalendarEntry } from '../lib/api';
import {
  addDays,
  dateKey,
  formatLongDay,
  formatShortDay,
  formatTimeRange,
  monthGridRange,
  sameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from '../lib/datetime';

export type CalendarMode = 'month' | 'week' | 'day';

interface VenueCalendarProps {
  entries: CalendarEntry[];
  mode: CalendarMode;
  anchor: Date;
  selectedDate: Date;
  loading?: boolean;
  onModeChange: (mode: CalendarMode) => void;
  onAnchorChange: (date: Date) => void;
  onSelectDate: (date: Date) => void;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function overlaps(left: CalendarEntry, right: CalendarEntry) {
  const leftStart = new Date(left.rangeStart).getTime();
  const leftEnd = new Date(left.rangeEnd).getTime();
  const rightStart = new Date(right.rangeStart).getTime();
  const rightEnd = new Date(right.rangeEnd).getTime();
  return leftStart < rightEnd && rightStart < leftEnd;
}

function entriesForDay(entries: CalendarEntry[], day: Date) {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(startOfDay(day), 1).getTime();
  return entries.filter((entry) => {
    const start = new Date(entry.startTime).getTime();
    const end = new Date(entry.endTime).getTime();
    return start < dayEnd && end > dayStart;
  });
}

function entryTone(entry: CalendarEntry) {
  return entry.kind === 'CONFIRMED' ? 'confirmed' : 'pending';
}

function shiftAnchor(anchor: Date, mode: CalendarMode, direction: number) {
  if (mode === 'month') {
    return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
  }
  return addDays(anchor, mode === 'week' ? direction * 7 : direction);
}

function titleFor(anchor: Date, mode: CalendarMode) {
  if (mode === 'month') {
    return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(anchor);
  }
  if (mode === 'week') {
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    return `${formatShortDay(start)} – ${formatShortDay(end)}`;
  }
  return formatLongDay(anchor);
}

export function VenueCalendar({
  entries,
  mode,
  anchor,
  selectedDate,
  loading = false,
  onModeChange,
  onAnchorChange,
  onSelectDate,
}: VenueCalendarProps) {
  const today = new Date();
  const title = mode === 'day' ? formatLongDay(selectedDate) : titleFor(anchor, mode);

  function goToday() {
    onAnchorChange(today);
    onSelectDate(today);
  }

  function move(direction: number) {
    const next = shiftAnchor(anchor, mode, direction);
    onAnchorChange(next);
    if (mode === 'day') onSelectDate(next);
  }

  return (
    <section className="venue-calendar" aria-label="Venue calendar">
      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button
            type="button"
            className="icon-button"
            onClick={() => move(-1)}
            aria-label={`Previous ${mode}`}
          >
            <CaretLeft size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => move(1)}
            aria-label={`Next ${mode}`}
          >
            <CaretRight size={17} />
          </button>
          <Button variant="ghost" size="sm" onClick={goToday}>
            Today
          </Button>
          <h2 className="calendar-title">{title}</h2>
        </div>
        <div className="calendar-modes" role="group" aria-label="Calendar view">
          {(['month', 'week', 'day'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`calendar-mode ${mode === value ? 'is-active' : ''}`}
              onClick={() => onModeChange(value)}
              aria-pressed={mode === value}
            >
              {value[0]!.toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="calendar-legend">
        <span className="legend-item">
          <span className="legend-swatch is-confirmed" aria-hidden="true" /> Confirmed booking
        </span>
        <span className="legend-item">
          <span className="legend-swatch is-pending" aria-hidden="true" /> Pending request
        </span>
        <span className="legend-note">
          <Info size={14} aria-hidden="true" /> Pending requests do not guarantee the venue.
        </span>
      </div>

      {loading ? (
        <div className="calendar-loading" role="status">
          <Spinner size={18} /> Loading calendar…
        </div>
      ) : mode === 'month' ? (
        <MonthView
          entries={entries}
          anchor={anchor}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          onAnchorChange={onAnchorChange}
        />
      ) : mode === 'week' ? (
        <WeekView
          entries={entries}
          anchor={anchor}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
        />
      ) : (
        <DayView entries={entries} selectedDate={selectedDate} />
      )}
    </section>
  );
}

function MonthView({
  entries,
  anchor,
  selectedDate,
  onSelectDate,
  onAnchorChange,
}: {
  entries: CalendarEntry[];
  anchor: Date;
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  onAnchorChange: (date: Date) => void;
}) {
  const range = monthGridRange(anchor);
  const days = Array.from({ length: 42 }, (_, index) => addDays(range.start, index));
  const currentMonth = anchor.getMonth();

  return (
    <div className="calendar-month" role="grid" aria-label="Month calendar">
      {WEEKDAYS.map((day) => (
        <div className="calendar-weekday" role="columnheader" key={day}>
          {day}
        </div>
      ))}
      {days.map((day) => {
        const dayEntries = entriesForDay(entries, day);
        const isOutside = day.getMonth() !== currentMonth;
        return (
          <button
            key={dateKey(day)}
            type="button"
            role="gridcell"
            className={[
              'calendar-day',
              isOutside ? 'is-outside' : '',
              sameDay(day, selectedDate) ? 'is-selected' : '',
              sameDay(day, new Date()) ? 'is-today' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => {
              onSelectDate(day);
              if (isOutside) onAnchorChange(startOfMonth(day));
            }}
            aria-label={`${formatLongDay(day)}, ${dayEntries.length} booking${dayEntries.length === 1 ? '' : 's'}`}
            aria-selected={sameDay(day, selectedDate)}
          >
            <span className="calendar-day-number">{day.getDate()}</span>
            <span className="calendar-day-entries">
              {dayEntries.slice(0, 3).map((entry) => {
                const isOverlap = entries.some(
                  (other) => other.id !== entry.id && overlaps(entry, other),
                );
                return (
                  <span
                    className={`calendar-entry-mini is-${entryTone(entry)} ${isOverlap ? 'is-overlap' : ''}`}
                    key={`${entry.kind}-${entry.id}`}
                  >
                    <span className="mini-time">{formatTimeRange(entry.startTime, entry.endTime)}</span>{' '}
                    <span className="mini-title">{entry.title}</span>
                  </span>
                );
              })}
              {dayEntries.length > 3 && (
                <span className="calendar-more">+{dayEntries.length - 3} more</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function WeekView({
  entries,
  anchor,
  selectedDate,
  onSelectDate,
}: {
  entries: CalendarEntry[];
  anchor: Date;
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));

  return (
    <div className="calendar-week">
      {days.map((day) => {
        const dayEntries = entriesForDay(entries, day);
        return (
          <button
            key={dateKey(day)}
            type="button"
            className={`calendar-week-day ${sameDay(day, selectedDate) ? 'is-selected' : ''} ${sameDay(day, new Date()) ? 'is-today' : ''}`}
            onClick={() => onSelectDate(day)}
            aria-label={`${formatLongDay(day)}, ${dayEntries.length} booking${dayEntries.length === 1 ? '' : 's'}`}
          >
            <span className="calendar-week-head">
              <span>{new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(day)}</span>
              <strong>{day.getDate()}</strong>
            </span>
            <span className="calendar-week-list">
              {dayEntries.length === 0 ? (
                <span className="calendar-no-entry">Open</span>
              ) : (
                dayEntries.map((entry) => {
                  const isOverlap = entries.some(
                    (other) => other.id !== entry.id && overlaps(entry, other),
                  );
                  return (
                    <span
                      className={`calendar-week-entry is-${entryTone(entry)} ${isOverlap ? 'is-overlap' : ''}`}
                      key={`${entry.kind}-${entry.id}`}
                    >
                      <strong>{formatTimeRange(entry.startTime, entry.endTime)}</strong>
                      <span>{entry.title}</span>
                      {isOverlap && <em>Overlaps</em>}
                    </span>
                  );
                })
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DayView({ entries, selectedDate }: { entries: CalendarEntry[]; selectedDate: Date }) {
  const dayEntries = entriesForDay(entries, selectedDate).sort((left, right) =>
    left.startTime.localeCompare(right.startTime),
  );

  if (dayEntries.length === 0) {
    return (
      <div className="calendar-day-empty">
        <Clock size={28} weight="duotone" aria-hidden="true" />
        <h3>No bookings on {formatLongDay(selectedDate)}</h3>
        <p>The venue is open. Choose a start and end time to request this slot.</p>
      </div>
    );
  }

  return (
    <ol className="calendar-day-list">
      {dayEntries.map((entry) => {
        const isOverlap = entries.some(
          (other) => other.id !== entry.id && overlaps(entry, other),
        );
        return (
          <li
            key={`${entry.kind}-${entry.id}`}
            className={`calendar-day-entry is-${entryTone(entry)} ${isOverlap ? 'is-overlap' : ''}`}
          >
            <span className="calendar-day-time">
              <strong>{formatTimeRange(entry.startTime, entry.endTime)}</strong>
              <span>
                {entry.setupBufferMins > 0 && `Setup ${entry.setupBufferMins}m · `}
                {entry.teardownBufferMins > 0 && `Cleanup ${entry.teardownBufferMins}m`}
              </span>
            </span>
            <span className="calendar-day-copy">
              <strong>{entry.title}</strong>
              <span>{entry.kind === 'CONFIRMED' ? 'Confirmed booking' : 'Pending request'}</span>
            </span>
            {isOverlap && <span className="overlap-tag">Overlaps another slot</span>}
          </li>
        );
      })}
    </ol>
  );
}
