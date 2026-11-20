import { useQuery } from '@tanstack/react-query';
import {
  MapPin,
  NotePencil,
  UsersThree,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { formatTimeRange } from '../lib/datetime';
import { Alert, Button, Dialog, Skeleton } from './ui';
import { RequestStatusBadge } from './booking';
import { ApprovalTimeline } from './approvals/ApprovalTimeline';
import { ConflictSummary } from './approvals/ConflictSummary';

interface RequestStatusDialogProps {
  requestId: string;
  onClose: () => void;
  onChangeSlot?: () => void;
}

export function RequestStatusDialog({
  requestId,
  onClose,
  onChangeSlot,
}: RequestStatusDialogProps) {
  const query = useQuery({
    queryKey: ['request', requestId],
    queryFn: () => api.requestDetail(requestId),
  });

  const detail = query.data;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Booking request status & progress"
      description={detail ? `${detail.event.title} at ${detail.request.venue.name}` : 'Loading status…'}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            Close
          </Button>
          {onChangeSlot && detail && detail.permissions.canEdit && (
            <Button variant="secondary" size="md" onClick={onChangeSlot}>
              <NotePencil size={15} /> Change slot
            </Button>
          )}
        </>
      }
    >
      {query.isPending ? (
        <div className="status-dialog-loading" aria-busy="true">
          <Skeleton className="skeleton-line skeleton-line-wide" />
          <Skeleton className="skeleton-line" />
          <Skeleton className="skeleton-block" />
        </div>
      ) : query.isError || !detail ? (
        <Alert tone="danger" title="Could not load request status">
          Please check your connection and try again.
        </Alert>
      ) : (
        <div className="status-dialog-content">
          <div className="status-dialog-header-pill">
            <RequestStatusBadge status={detail.request.status} />
            <span className="status-dialog-time">
              {formatDate(detail.request.startTime)} ·{' '}
              {formatTimeRange(detail.request.startTime, detail.request.endTime)}
            </span>
          </div>

          {detail.request.status === 'REJECTED' && detail.request.rejectionReason && (
            <Alert tone="danger" title="Booking request rejected">
              <strong>Reason:</strong> {detail.request.rejectionReason}
            </Alert>
          )}

          {/* Show recent change requests */}
          {detail.decisions.length > 0 &&
            detail.decisions[detail.decisions.length - 1]?.decision === 'CHANGES_REQUESTED' && (
              <Alert tone="info" title="Changes requested by reviewer">
                <p>
                  <strong>Instructions:</strong> &ldquo;
                  {detail.decisions[detail.decisions.length - 1]?.remarks}&rdquo;
                </p>
                <p className="mt-2 text-sm text-ink-3">
                  You can update your requested slot or event details. Note that changing the venue, date or time will restart the workflow from stage 1.
                </p>
              </Alert>
            )}

          <div className="status-dialog-particulars">
            <div className="particulars-row">
              <span>
                <MapPin size={14} /> {detail.request.venue.name} ({detail.request.venue.building} · Floor {detail.request.venue.floor})
              </span>
              <span>
                <UsersThree size={14} /> {detail.event.expectedAttendance} attendees expected
              </span>
            </div>
          </div>

          <ApprovalTimeline
            timeline={detail.timeline}
            decisions={detail.decisions}
            currentRound={detail.currentRound}
            status={detail.request.status}
          />

          {detail.conflicts && (detail.conflicts.confirmed.length > 0 || detail.conflicts.pending.length > 0) && (
            <div className="mt-4">
              <h5 className="text-sm font-semibold mb-2">Scheduling competition</h5>
              <ConflictSummary conflicts={detail.conflicts} />
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
