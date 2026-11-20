import { useState } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
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
      title="Cancel Confirmed Venue Allotment"
      description="Release the reserved time slot on the public campus calendar."
    >
      <form onSubmit={handleSubmit} className="allotment-dialog-form">
        <div className="allotment-cancel-warning">
          <WarningCircle size={22} weight="fill" className="text-danger" />
          <div>
            <strong>Are you sure you want to cancel this reservation?</strong>
            <p>
              Cancelling will release the slot for <strong>{request.venue.name}</strong> on{' '}
              {formatDate(request.startTime)} ({formatTimeRange(request.startTime, request.endTime)}). Any competing
              organizers who were previously superseded will be notified that the slot has reopened.
            </p>
          </div>
        </div>

        <div className="allotment-summary-card">
          <h4 className="allotment-event-title">{event.title}</h4>
          <p className="allotment-dept-meta">
            {event.department.name} · Headcount: {event.expectedAttendance}
          </p>
        </div>

        <TextareaField
          label="Cancellation reason (required)"
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
            Keep Booking
          </Button>
          <Button type="submit" variant="danger" disabled={submitting} loading={submitting}>
            {submitting ? 'Releasing slot…' : 'Cancel Allotment & Release Slot'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
