import { useState } from 'react';
import type { RequestDetailView } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { formatTimeRange } from '../../lib/datetime';
import { Button, Dialog, TextareaField } from '../ui';

interface AllotmentCancelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: RequestDetailView;
  onConfirm: (reason: string) => Promise<void>;
}

export function AllotmentCancelDialog({
  open,
  onOpenChange,
  detail,
  onConfirm,
}: AllotmentCancelDialogProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { request, event } = detail;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (reason.trim().length < 3) {
      setError('Please provide a cancellation reason (at least 3 characters).');
      return;
    }

    setSubmitting(true);
    try {
      await onConfirm(reason.trim());
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to cancel allotment. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="Cancel this reservation?"
      description="The venue and its setup and cleanup windows will be released on the campus calendar."
    >
      <form onSubmit={handleSubmit} className="allotment-dialog-form">
        <div className="allotment-review">
          <h3>{event.title}</h3>
          <dl>
            <div><dt>Venue</dt><dd>{request.venue.name}</dd></div>
            <div><dt>Event time</dt><dd>{formatDate(request.startTime)} · {formatTimeRange(request.startTime, request.endTime)}</dd></div>
          </dl>
        </div>

        <TextareaField
          label="Cancellation reason"
          maxLength={1000}
          hint="Visible in the cancellation notice and audit history."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="State why this confirmed booking is being cancelled…"
          rows={3}
          error={error || undefined}
          required
        />

        <div className="dialog-actions">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Keep reservation
          </Button>
          <Button type="submit" variant="danger" disabled={submitting} loading={submitting}>
            {submitting ? 'Releasing slot…' : 'Cancel reservation'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
