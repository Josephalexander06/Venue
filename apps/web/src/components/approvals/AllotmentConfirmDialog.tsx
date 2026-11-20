import { useState } from 'react';
import { CheckCircle, ShieldCheck, WarningCircle } from '@phosphor-icons/react';
import type { RequestDetailView } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { formatTimeRange } from '../../lib/datetime';
import { Button, Dialog, TextareaField } from '../ui';

interface AllotmentConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: RequestDetailView;
  onConfirm: (remarks: string) => Promise<void>;
  isOverride?: boolean;
}

export function AllotmentConfirmDialog({
  open,
  onOpenChange,
  detail,
  onConfirm,
  isOverride = false,
}: AllotmentConfirmDialogProps) {
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { request, event, conflicts } = detail;
  const competingCount = conflicts.pending.length;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      onClose={() => onOpenChange(false)}
      title="Confirm Final Venue Allotment"
      description="Binding reservation that allocates the venue and resolves scheduling conflicts."
    >
      <form onSubmit={handleSubmit} className="allotment-dialog-form">
        <div className="allotment-summary-card">
          <div className="allotment-summary-header">
            <div>
              <span className="allotment-venue-badge">{request.venue.name}</span>
              <h3 className="allotment-event-title">{event.title}</h3>
              <p className="allotment-dept-meta">
                {event.department.name} ({event.department.code}) · Expected turnout: {event.expectedAttendance}
              </p>
            </div>
            <div className="allotment-seal-icon">
              <ShieldCheck size={28} weight="duotone" />
            </div>
          </div>

          <div className="allotment-time-pill">
            <span>📅 {formatDate(request.startTime)}</span>
            <span>⏰ {formatTimeRange(request.startTime, request.endTime)}</span>
            <span className="buffer-note">
              (+{request.setupBufferMins}m setup / +{request.teardownBufferMins}m teardown buffer)
            </span>
          </div>
        </div>

        {competingCount > 0 ? (
          <div className="allotment-conflict-notice">
            <WarningCircle size={22} weight="fill" className="text-amber" />
            <div>
              <strong>{competingCount} Competing Request{competingCount > 1 ? 's' : ''} Will Be Superseded</strong>
              <p>
                Confirming this allotment will mark all other competing unconfirmed requests as{' '}
                <code>SUPERSEDED_CONFLICT</code>. Their approval records will be preserved, and organizers will receive
                rescheduling guidance.
              </p>
            </div>
          </div>
        ) : (
          <div className="allotment-clear-notice">
            <CheckCircle size={20} weight="fill" className="text-emerald" />
            <span>No conflicting holds exist for this time slot. Safe to allot immediately.</span>
          </div>
        )}

        {isOverride && (
          <div className="allotment-override-notice">
            <ShieldCheck size={20} weight="fill" className="text-indigo" />
            <div>
              <strong>Administrative Override Decision</strong>
              <p>You are allotting this venue under administrative authority. A reason must be recorded.</p>
            </div>
          </div>
        )}

        <TextareaField
          label={isOverride ? 'Override reason (required)' : 'Allocation remarks & notes (optional)'}
          hint="Visible in the audit record and to institutional administrators."
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder={
            isOverride
              ? 'Explain why this event is allotted under administrative authority…'
              : 'Add any operational guidance or remarks for this reservation…'
          }
          rows={3}
          error={error || undefined}
        />

        <div className="dialog-actions">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting} loading={submitting}>
            {submitting ? 'Committing allotment…' : 'Confirm & Allot Venue'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
