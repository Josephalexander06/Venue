import { useRef } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { addDays, dateKey, formatMonthYear, formatShortDay, monthGridRange, sameDay, startOfWeek } from '../lib/datetime';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
type DateStatus = 'open' | 'competing' | 'booked';

export function VenueCalendar({ date, anchor, onSelect, onNavigate, getStatus }: {
  date: Date;
  anchor: Date;
  onSelect: (date: Date) => void;
  onNavigate: (anchor: Date) => void;
  getStatus: (date: Date) => DateStatus | undefined;
}) {
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const firstOfWeek = startOfWeek(anchor);
  const firstOfMonthGrid = monthGridRange(anchor).start;
  const today = dateKey(new Date());

  function panel(weekly: boolean) {
    const first = weekly ? firstOfWeek : firstOfMonthGrid;
    const days = Array.from({ length: weekly ? 7 : 42 }, (_, index) => addDays(first, index));
    const move = (direction: number) => onNavigate(weekly
      ? addDays(anchor, direction * 7)
      : new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1));
    const previousDisabled = weekly ? dateKey(addDays(first, -1)) < today
      : dateKey(new Date(anchor.getFullYear(), anchor.getMonth(), 0)) < today;
    return <div className={weekly ? 'date-week' : 'date-month'}
      onTouchStart={weekly ? (event) => {
        const touch = event.touches[0];
        swipe.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
      } : undefined}
      onTouchEnd={weekly ? (event) => {
        const start = swipe.current;
        swipe.current = null;
        const touch = event.changedTouches[0];
        if (!start || !touch) return;
        const x = touch.clientX - start.x;
        if (Math.abs(x) > 45 && Math.abs(x) > Math.abs(touch.clientY - start.y) * 1.5 && (x < 0 || !previousDisabled)) {
          move(x < 0 ? 1 : -1);
        }
      } : undefined}>
      <div className="date-nav">
        <button type="button" onClick={() => move(-1)} disabled={previousDisabled} aria-label={weekly ? 'Previous week' : 'Previous month'}><CaretLeft size={18} /></button>
        <strong aria-live="polite">{formatMonthYear(anchor)}</strong>
        <button type="button" onClick={() => move(1)} aria-label={weekly ? 'Next week' : 'Next month'}><CaretRight size={18} /></button>
      </div>
      <div className="date-cells">
        {DAYS.map((day) => <span key={day} className="date-weekday" aria-hidden="true">{day}</span>)}
        {days.map((day) => {
          const key = dateKey(day);
          const status = key >= today ? getStatus(day) : undefined;
          const picked = sameDay(day, date);
          return <button type="button" key={key} aria-pressed={picked}
            aria-label={`${formatShortDay(day)}${status ? `, ${status === 'competing' ? 'requests pending' : status === 'booked' ? 'no slots open' : 'slots open'}` : ''}`}
            disabled={key < today} className={!weekly && day.getMonth() !== anchor.getMonth() ? 'outside-month' : ''}
            onClick={() => onSelect(day)}>
            {day.getDate()}{status && <i className={`date-dot date-dot-${status}`} aria-hidden="true" />}
          </button>;
        })}
      </div>
    </div>;
  }

  return <div className="booking-calendar">{panel(false)}{panel(true)}</div>;
}
