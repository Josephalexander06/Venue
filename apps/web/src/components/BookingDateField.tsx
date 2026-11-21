import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarBlank, CaretLeft, CaretRight } from '@phosphor-icons/react';
import { addDays, dateInputValue, formatMonthYear, monthGridRange, sameDay, startOfDay, startOfMonth } from '../lib/datetime';
import { parseBookingDate } from '../lib/venue-slot';
import { Button, Dialog, IconButton, TextField } from './ui';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_SHIFT: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
const fullDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full' });

export function BookingDateField({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeDay, setActiveDay] = useState(() => startOfDay(new Date()));
  const calendar = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  const today = startOfDay(new Date());
  const selected = parseBookingDate(value);
  const month = startOfMonth(activeDay);
  const gridStart = monthGridRange(month).start;
  const activeKey = dateInputValue(activeDay);

  useEffect(() => {
    if (!open || !moveFocus.current) return;
    moveFocus.current = false;
    calendar.current?.querySelector<HTMLButtonElement>(`button[data-date="${activeKey}"]`)?.focus();
  }, [open, activeKey]);

  function openCalendar() {
    moveFocus.current = true;
    setActiveDay(selected && selected >= today ? selected : today);
    setOpen(true);
  }

  function choose(day: Date) {
    onChange(dateInputValue(day));
    setOpen(false);
  }

  function changeMonth(amount: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + amount, 1);
    setActiveDay(next >= today ? next : today);
  }

  function handleDayKey(event: KeyboardEvent<HTMLButtonElement>, day: Date) {
    let next: Date;
    if (event.key === 'Home' || event.key === 'End') {
      const weekday = (day.getDay() + 6) % 7;
      next = addDays(day, event.key === 'Home' ? -weekday : 6 - weekday);
    } else if (event.key in DAY_SHIFT) {
      next = addDays(day, DAY_SHIFT[event.key]!);
    } else {
      return;
    }
    event.preventDefault();
    if (next < today || sameDay(next, activeDay)) return;
    moveFocus.current = true;
    setActiveDay(next);
  }

  return (
    <>
      <TextField
        label={label}
        name={name}
        type="date"
        className="booking-date-input"
        min={dateInputValue(today)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        trailing={
          <button type="button" className="field-action" aria-label="Open date calendar" aria-haspopup="dialog" onClick={openCalendar}>
            <CalendarBlank size={20} aria-hidden="true" />
          </button>
        }
      />
      <Dialog open={open} onClose={() => setOpen(false)} title="Choose a date" className="booking-date-dialog">
        <div className="booking-picker-toolbar">
          <IconButton label="Previous month" onClick={() => changeMonth(-1)} disabled={sameDay(month, startOfMonth(today))}>
            <CaretLeft size={18} aria-hidden="true" />
          </IconButton>
          <strong aria-live="polite">{formatMonthYear(month)}</strong>
          <IconButton label="Next month" onClick={() => changeMonth(1)}>
            <CaretRight size={18} aria-hidden="true" />
          </IconButton>
        </div>
        <div className="booking-picker-grid" ref={calendar} role="group" aria-label="Calendar dates">
          {WEEKDAYS.map((day) => <span key={day} aria-hidden="true">{day}</span>)}
          {Array.from({ length: 42 }, (_, index) => {
            const day = addDays(gridStart, index);
            const key = dateInputValue(day);
            const isSelected = key === value;
            return (
              <button
                type="button"
                key={key}
                data-date={key}
                data-outside={day.getMonth() !== month.getMonth()}
                aria-label={fullDate.format(day)}
                aria-pressed={isSelected}
                aria-current={sameDay(day, today) ? 'date' : undefined}
                tabIndex={key === activeKey ? 0 : -1}
                disabled={day < today}
                onKeyDown={(event) => handleDayKey(event, day)}
                onClick={() => choose(day)}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
        <div className="booking-picker-shortcuts" role="group" aria-label="Quick dates">
          <Button type="button" size="sm" variant="secondary" onClick={() => choose(today)}>Today</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => choose(addDays(today, 1))}>Tomorrow</Button>
        </div>
      </Dialog>
    </>
  );
}
