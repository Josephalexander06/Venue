import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowSquareOut, WarningCircle } from '@phosphor-icons/react';
import { api, type RequestDetailView } from '../../lib/api';
import { formatTimeRange } from '../../lib/datetime';
import { formatDate } from '../../lib/format';
import { RequestStatusBadge } from '../booking';
import { SelectField } from '../ui';

export function CompetitorComparison({
  detail,
  canReadOrganizer,
}: {
  detail: RequestDetailView;
  canReadOrganizer: boolean;
}) {
  const [selectedId, setSelectedId] = useState('');
  const { request, event, conflicts } = detail;
  const organizers = useQuery({
    queryKey: ['approval', request.id, 'competitors'],
    queryFn: () => api.competingRequests(request.id),
    enabled: canReadOrganizer,
  });

  const competitor = conflicts.pending.find((item) => item.requestId === selectedId) ?? conflicts.pending[0];
  if (!competitor) return null;
  const organizer = organizers.data?.competingRequests.find((item) => item.request.id === competitor.requestId)?.organizer;

  return (
    <section className="card comparison-panel" aria-labelledby="competition-heading">
      <div className="card-head">
        <div>
          <h2 id="competition-heading">Competing requests</h2>
          <p>Compare event times and reservation buffers before confirming an allotment.</p>
        </div>
        <span className="queue-overlap"><WarningCircle size={16} aria-hidden="true" /> {conflicts.pending.length} overlapping</span>
      </div>

      {conflicts.pending.length > 1 && (
        <SelectField label="Compare with" value={competitor.requestId} onChange={(change) => setSelectedId(change.target.value)}>
          {conflicts.pending.map((item) => (
            <option value={item.requestId} key={item.requestId}>{item.title} · {formatTimeRange(item.startTime, item.endTime)}</option>
          ))}
        </SelectField>
      )}

      <div className="comparison-grid">
        <section>
          <div className="comparison-kicker">Current request</div>
          <h3>{event.title}</h3>
          <RequestStatusBadge status={request.status} />
          <dl>
            <div><dt>Department</dt><dd>{event.department.name}</dd></div>
            <div><dt>Event time</dt><dd>{formatDate(request.startTime)} · {formatTimeRange(request.startTime, request.endTime)}</dd></div>
            <div><dt>With buffers</dt><dd>{formatTimeRange(request.effectiveStart, request.effectiveEnd)}</dd></div>
            <div><dt>Attendance</dt><dd>{event.expectedAttendance} of {request.venue.capacity} seats</dd></div>
          </dl>
        </section>

        <section>
          <div className="comparison-kicker">Overlapping request</div>
          <h3>{competitor.title}</h3>
          <RequestStatusBadge status={competitor.status} />
          <dl>
            <div><dt>Department</dt><dd>{competitor.departmentName ?? '—'}</dd></div>
            <div><dt>Event time</dt><dd>{formatDate(competitor.startTime)} · {formatTimeRange(competitor.startTime, competitor.endTime)}</dd></div>
            <div><dt>With buffers</dt><dd>{formatTimeRange(competitor.rangeStart, competitor.rangeEnd)}</dd></div>
            <div><dt>Attendance</dt><dd>{competitor.expectedAttendance === undefined ? '—' : `${competitor.expectedAttendance} of ${request.venue.capacity} seats`}</dd></div>
            {organizer && <div><dt>Organizer</dt><dd>{organizer.firstName} {organizer.lastName}</dd></div>}
          </dl>
          {canReadOrganizer && (
            <Link className="text-link" to={`/approvals/${competitor.requestId}`}>
              Open request <ArrowSquareOut size={14} aria-hidden="true" />
            </Link>
          )}
        </section>
      </div>
    </section>
  );
}
