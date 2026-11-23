import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarBlank, Check, MapPin, Users } from '@phosphor-icons/react';
import type { ApprovalDecision } from '@venue/shared';
import { useAuth, usePageTitle } from '../auth';
import { AllotmentCancelDialog } from '../components/approvals/AllotmentCancelDialog';
import { AllotmentConfirmDialog } from '../components/approvals/AllotmentConfirmDialog';
import { ApprovalDecisionDialog } from '../components/approvals/ApprovalDecisionDialog';
import { ApprovalTimeline } from '../components/approvals/ApprovalTimeline';
import { CompetitorComparison } from '../components/approvals/CompetitorComparison';
import { RequestStatusBadge } from '../components/booking';
import { Alert, Button, Skeleton, TextareaField, useToast } from '../components/ui';
import { api, type RequestDetailView } from '../lib/api';
import { formatDate } from '../lib/format';
import { displaySlot } from '../lib/slot-schedule';

export function ApprovalDetailPage() {
  const { id = '' } = useParams();
  const { isApprover } = useAuth();
  const query = useQuery({ queryKey: ['approval', id], queryFn: () => api.approvalDetail(id) });
  usePageTitle('Review booking');
  return <div className="product-page approval-detail-page">
    <Link className="text-link back-link" to={isApprover ? '/approvals' : '/bookings'}>
      <ArrowLeft size={18} /> {isApprover ? 'Approvals' : 'My bookings'}
    </Link>
    {query.isPending ? <Skeleton className="detail-skeleton" /> : !query.data ? <Alert tone="danger" title="Could not load this request">
      <button type="button" className="inline-link" onClick={() => void query.refetch()}>Try again</button>
    </Alert> : <ApprovalReview detail={query.data} />}
  </div>;
}

function ApprovalReview({ detail }: { detail: RequestDetailView }) {
  const { request, event, timeline, decisions, conflicts, permissions, currentRound, allotment } = detail;
  const { pushToast } = useToast();
  const client = useQueryClient();
  const [comments, setComments] = useState('');
  const [decision, setDecision] = useState<ApprovalDecision>();
  const [allot, setAllot] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [compare, setCompare] = useState(false);
  const step = timeline.find((item) => item.stepOrder === request.currentStepOrder);
  const approving = permissions.canDecide && !permissions.canApproveAndAllot;
  const allotting = permissions.canApproveAndAllot || permissions.canAllot;
  const overlaps = conflicts.pending.length + conflicts.confirmed.length;

  function refresh() {
    for (const key of ['approval', 'approvals', 'my-events', 'request', 'venue-calendar', 'venue-schedule', 'venue-availability']) {
      void client.invalidateQueries({ queryKey: [key] });
    }
  }

  const approve = useMutation({
    mutationFn: () => api.decideApproval(request.id, {
      decision: 'APPROVED', expectedUpdatedAt: request.updatedAt, comments: comments.trim(),
    }),
    onSuccess: () => {
      setComments('');
      pushToast({ tone: 'success', title: step?.stepOrder === 0 ? 'Request endorsed' : 'Request approved' });
      refresh();
    },
    onError: () => { void client.invalidateQueries({ queryKey: ['approval', request.id] }); },
  });

  async function confirm(remarks: string) {
    const input = {
      remarks, expectedUpdatedAt: request.updatedAt, reviewedCompetingRequestIds: conflicts.pending.map(({ requestId }) => requestId),
    };
    try {
      if (permissions.canApproveAndAllot) await api.approveAndAllot(request.id, input);
      else await api.confirmAllotment({ ...input, venueRequestId: request.id, conflictResolutionPolicy: 'AUTO_REJECT_CONFLICTS' });
      pushToast({ tone: 'success', title: 'Venue reservation confirmed' });
    } finally {
      refresh();
    }
  }

  return <>
    <div className="product-page-heading"><div><h1>{event.title}</h1>
      <p>{event.submittedByName && <>{event.submittedByName} · </>}{event.department.name}</p>
    </div><RequestStatusBadge status={request.status} /></div>

    <section className="product-panel approval-facts">
      <div><MapPin size={22} aria-hidden="true" /><strong>{request.venue.name}</strong></div>
      <div><CalendarBlank size={22} aria-hidden="true" /><strong>{formatDate(request.startTime)} · {displaySlot(request.startTime, request.endTime)}</strong></div>
      <div><Users size={22} aria-hidden="true" /><strong>{event.expectedAttendance} attendees</strong></div>
      {event.description && <p>{event.description}</p>}
    </section>
    {request.rejectionReason && <Alert tone="warning" title="Booking update">{request.rejectionReason}</Alert>}
    {overlaps > 0 && <Alert tone="warning" title={`${overlaps} ${overlaps === 1 ? 'conflict' : 'conflicts'} for this slot`}>
      <Button variant="ghost" size="sm" aria-expanded={compare} onClick={() => setCompare(!compare)}>{compare ? 'Hide conflicts' : 'Review conflicts'}</Button>
    </Alert>}
    {compare && <>
      {conflicts.confirmed.length > 0 && <div className="product-panel">
        <h2>Confirmed reservations</h2>
        <ul>{conflicts.confirmed.map((item) => <li key={item.requestId}>{item.title} · {displaySlot(item.startTime, item.endTime)}</li>)}</ul>
      </div>}
      <CompetitorComparison detail={detail} canReadOrganizer={allotting} />
    </>}
    <details className="product-panel product-disclosure"><summary>History</summary>
      <ApprovalTimeline timeline={timeline} decisions={decisions} currentRound={currentRound} status={request.status} />
    </details>
    {approving && <section className="product-panel">
      <TextareaField name="approval-note" label="Notes" optional rows={2} value={comments} maxLength={1000}
        onChange={(event) => setComments(event.target.value)} />
      {approve.error && <Alert tone="danger" title={approve.error.message} />}
    </section>}
    {(permissions.canDecide || allotting || permissions.canCancelAllotment) && <div className="product-actions approval-actions">
      {approving && <Button size="lg" loading={approve.isPending} onClick={() => approve.mutate()}>
        <Check size={20} aria-hidden="true" /> {step?.stepOrder === 0 ? 'Endorse' : 'Approve'}
      </Button>}
      {allotting && <Button size="lg" onClick={() => setAllot(true)}>
        <Check size={20} aria-hidden="true" /> {permissions.canApproveAndAllot ? 'Approve and confirm' : 'Confirm allotment'}
      </Button>}
      {permissions.canDecide && <>
        <Button size="lg" variant="danger-ghost" onClick={() => setDecision('REJECTED')}>Reject</Button>
        <Button size="lg" variant="secondary" onClick={() => setDecision('CHANGES_REQUESTED')}>Request changes</Button>
      </>}
      {permissions.canCancelAllotment && <Button size="lg" variant="danger-ghost" onClick={() => setCancel(true)}>Cancel allotment</Button>}
    </div>}
    {decision && <ApprovalDecisionDialog requestId={request.id} updatedAt={request.updatedAt}
      stepName={step?.stepName ?? 'Review'} initialDecision={decision} allowApproval={false} onClose={() => setDecision(undefined)} />}
    {allot && <AllotmentConfirmDialog open onOpenChange={setAllot} detail={detail} action="Confirm allotment"
      unavailable={false} onConfirm={confirm} isOverride={permissions.requiresAllotmentRemarks} />}
    {cancel && allotment && <AllotmentCancelDialog open onOpenChange={setCancel} detail={detail} onConfirm={async (reason) => {
      await api.cancelAllotment(allotment.id, { reason });
      pushToast({ tone: 'info', title: 'Allotment cancelled' });
      refresh();
    }} />}
  </>;
}
