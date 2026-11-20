import { Link } from 'react-router-dom';
import { ArrowSquareOut, Clock, UsersThree, WarningCircle } from '@phosphor-icons/react';
import type { Conflict } from '../../lib/api';
import { formatTimeRange } from '../../lib/datetime';
import { RequestStatusBadge } from '../booking';

interface CompetitorComparisonProps {
  currentRequestId: string;
  conflicts: Conflict[];
  venueCapacity: number;
}

export function CompetitorComparison({
  currentRequestId,
  conflicts,
  venueCapacity,
}: CompetitorComparisonProps) {
  const competitors = conflicts.filter((c) => c.requestId !== currentRequestId);
  if (competitors.length === 0) return null;

  return (
    <div className="competitor-comparison-panel card">
      <div className="card-head">
        <div>
          <div className="competitor-badge-title">
            <WarningCircle size={18} weight="fill" className="text-amber" />
            <h3>Competing Requests ({competitors.length})</h3>
          </div>
          <p>
            Other applications overlapping this time window. As the final decision-maker, selecting one request
            atomically marks the others as superseded.
          </p>
        </div>
      </div>

      <div className="competitor-grid">
        {competitors.map((item) => {
          const attendance = item.expectedAttendance ?? 0;
          const capacityRatio = venueCapacity > 0 ? Math.round((attendance / venueCapacity) * 100) : 0;

          return (
            <div key={item.requestId} className="competitor-card">
              <div className="competitor-header">
                <div>
                  <h4 className="competitor-title">{item.title}</h4>
                  <p className="competitor-dept">
                    {item.departmentName ? `${item.departmentName} (${item.departmentCode})` : 'Department Event'}
                  </p>
                </div>
                <RequestStatusBadge status={item.status} />
              </div>

              <div className="competitor-details">
                <div className="competitor-detail-row">
                  <Clock size={16} aria-hidden="true" />
                  <span>{formatTimeRange(item.startTime, item.endTime)}</span>
                </div>
                {attendance > 0 && (
                  <div className="competitor-detail-row">
                    <UsersThree size={16} aria-hidden="true" />
                    <span>
                      {attendance} attendees ({capacityRatio}% venue capacity)
                    </span>
                  </div>
                )}
              </div>

              <div className="competitor-actions">
                <Link
                  to={`/approvals/${item.requestId}`}
                  className="btn btn-quiet btn-sm"
                  target="_blank"
                  rel="noreferrer"
                >
                  Inspect application
                  <ArrowSquareOut size={14} aria-hidden="true" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
