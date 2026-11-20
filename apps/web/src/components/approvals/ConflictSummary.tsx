import { Clock, UsersThree, WarningCircle } from '@phosphor-icons/react';
import type { Conflict } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { formatTimeRange } from '../../lib/datetime';

interface ConflictSummaryProps {
  conflicts: {
    confirmed: Conflict[];
    pending: Conflict[];
  };
}

export function ConflictSummary({ conflicts }: ConflictSummaryProps) {
  const hasConfirmed = conflicts.confirmed.length > 0;
  const hasPending = conflicts.pending.length > 0;

  if (!hasConfirmed && !hasPending) {
    return (
      <div className="conflicts-clean-note">
        <Clock size={16} /> No scheduling conflicts detected with other requests or bookings.
      </div>
    );
  }

  return (
    <div className="conflicts-summary-panel">
      {hasConfirmed && (
        <div className="conflict-banner is-confirmed">
          <div className="conflict-banner-head">
            <WarningCircle size={18} weight="fill" />
            <strong>Confirmed booking conflict</strong>
          </div>
          <p className="conflict-banner-msg">
            This venue is already confirmed for another event during this window (including buffer times):
          </p>
          <ul className="conflict-items-list">
            {conflicts.confirmed.map((item) => (
              <li key={item.requestId} className="conflict-item">
                <span className="conflict-item-title">{item.title}</span>
                <span className="conflict-item-time">
                  {formatDate(item.startTime)} · {formatTimeRange(item.startTime, item.endTime)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasPending && (
        <div className="conflict-banner is-pending">
          <div className="conflict-banner-head">
            <UsersThree size={18} weight="fill" />
            <strong>Competing booking requests ({conflicts.pending.length})</strong>
          </div>
          <p className="conflict-banner-msg">
            Other organizers have submitted requests for overlapping times. Preliminary approvals can be given to multiple requests, but only one will receive final venue allotment:
          </p>
          <ul className="conflict-items-list">
            {conflicts.pending.map((item) => (
              <li key={item.requestId} className="conflict-item">
                <span className="conflict-item-title">{item.title}</span>
                <span className="conflict-item-time">
                  {formatDate(item.startTime)} · {formatTimeRange(item.startTime, item.endTime)}
                </span>
                <span className="conflict-item-status status-pill">{item.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
