import { useState } from 'react';
import type { RequestDetailView } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { formatTimeRange } from '../../lib/datetime';
import { Alert, Button, Dialog, TextareaField } from '../ui';

interface AllotmentConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: RequestDetailView;
  action: string;
  unavailable: boolean;
  onConfirm: (remarks: string) => Promise<void>;
  isOverride?: boolean;
}

export function AllotmentConfirmDialog({
  open,
  onOpenChange,
  detail,
  action,
  unavailable,
  onConfirm,
  isOverride = false,
}: AllotmentConfirmDialogProps) {
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { request, event, conflicts } = detail;
  const competingCount = conflicts.pending.length;
  const blocked = conflicts.confirmed.length > 0 || unavailable;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || blocked) return;
    setError(null);

    if (isOverride && remarks.trim().length < 5) {
      setError('An administrative override requires remarks explaining the decision (at least 5 characters).');
      return;
    }

    setSubmitting(true);
    try {
      await onConfirm(remarks.trim());
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to commit allotment. Another approver may have acted.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => { if (!submitting) onOpenChange(false); }}
      title={action}
      description="This reserves the venue for the event, including setup and cleanup time."
    >
      <form onSubmit={handleSubmit} className="allotment-dialog-form">
        <div className="allotment-review">
          <h3>{event.title}</h3>
          <dl>
            <div><dt>Venue</dt><dd>{request.venue.name}</dd></div>
            <div><dt>Event time</dt><dd>{formatDate(request.startTime)} · {formatTimeRange(request.startTime, request.endTime)}</dd></div>
            <div><dt>Reserved window</dt><dd>{formatTimeRange(request.effectiveStart, request.effectiveEnd)} including buffers</dd></div>
          </dl>
        </div>

        {conflicts.confirmed.length > 0 ? (
          <Alert tone="danger" title="Confirmed reservation overlaps this slot">
            Return to the request to review the existing reservation.
          </Alert>
        ) : competingCount > 0 && (
          <>
            <Alert tone="warning" title={`${competingCount} competing ${competingCount === 1 ? 'request' : 'requests'} will be superseded`}>
              The other organizers will receive rescheduling guidance. Their decision history will remain available.
            </Alert>
            <ul aria-label="Competing requests">
              {conflicts.pending.map((conflict) => (
                <li key={conflict.requestId}>
                  {conflict.title} · {formatDate(conflict.startTime)} · {formatTimeRange(conflict.startTime, conflict.endTime)}
                </li>
              ))}
            </ul>
          </>
        )}

        <TextareaField
          label={isOverride ? 'Administrative reason' : 'Remarks'}
          optional={!isOverride}
          maxLength={1000}
          required={isOverride}
          hint="Visible in the audit record and to institutional administrators."
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder={
            isOverride
              ? 'Explain why this event is allotted under administrative authority…'
              : 'Add any operational guidance or remarks for this reservation…'
          }
          rows={3}
        />
        {error && <Alert tone="danger" title="Could not allot venue">{error}</Alert>}

        <div className="dialog-actions">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting || blocked} loading={submitting}>
            {action}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
