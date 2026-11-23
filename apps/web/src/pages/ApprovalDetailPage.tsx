import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarBlank, Check, MapPin, Users } from '@phosphor-icons/react';
import { APPROVAL_ONLY_ROLES, type ApprovalDecision } from '@venue/shared';
import { useAuth, usePageTitle } from '../auth';
import { AllotmentCancelDialog } from '../components/approvals/AllotmentCancelDialog';
import { AllotmentConfirmDialog } from '../components/approvals/AllotmentConfirmDialog';
import { ApprovalDecisionDialog } from '../components/approvals/ApprovalDecisionDialog';
import { ApprovalTimeline } from '../components/approvals/ApprovalTimeline';
import { BookingPeopleSummary } from '../components/approvals/BookingPeopleSummary';
import { CompetitorComparison } from '../components/approvals/CompetitorComparison';
import { RequestStatusBadge } from '../components/booking';
import { Alert, Button, Skeleton, TextareaField, useToast } from '../components/ui';
import { api, type ApprovalDetailView } from '../lib/api';
import { formatDate } from '../lib/format';
import { displaySlot } from '../lib/slot-schedule';

export function ApprovalDetailPage() {
  const { id = '' } = useParams();
  const { isApprover, isFacultyOnlyApprover } = useAuth();
  const query = useQuery({ queryKey: ['approval', id], queryFn: () => api.approvalDetail(id) });
  usePageTitle('Review booking');
  return <div className="product-page approval-detail-page">
    <Link className="text-link back-link" to={isApprover ? '/approvals' : '/bookings'}>
      <ArrowLeft size={18} /> {isFacultyOnlyApprover ? 'Incoming requests' : isApprover ? 'Approvals' : 'My bookings'}
    </Link>
    {query.isPending ? <Skeleton className="detail-skeleton" /> : !query.data ? <Alert tone="danger" title="Could not load this request">
      <button type="button" className="inline-link" onClick={() => void query.refetch()}>Try again</button>
    </Alert> : <ApprovalReview key={id} detail={query.data} />}
  </div>;
}

function ApprovalReview({ detail }: { detail: ApprovalDetailView }) {
  const { request, event, timeline, decisions, conflicts, permissions, currentRound, allotment } = detail;
  const { pushToast } = useToast();
  const client = useQueryClient();
  const [comments, setComments] = useState('');
  const [decision, setDecision] = useState<ApprovalDecision>();
  const [allot, setAllot] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [choice, setChoice] = useState<{ snapshot: string; ids: string[] }>();
  const { hash } = useLocation();
  const { isApprover } = useAuth();
  const step = timeline.find((item) => item.stepOrder === request.currentStepOrder);
  const approving = permissions.canDecide && !permissions.canApproveAndAllot;
  const allotting = permissions.canApproveAndAllot || permissions.canAllot;
  const disputed = conflicts.pending.length > 0;
  const priorityReview = approving && Boolean(step && APPROVAL_ONLY_ROLES.includes(step.requiredRole));
  const needsChoice = disputed && (allotting || priorityReview);
  const snapshot = JSON.stringify([request.updatedAt, ...conflicts.pending.map(({ requestId }) => requestId).sort()]);
  const reviewed = choice?.snapshot === snapshot ? choice.ids : undefined;
  const reasonRequired = disputed && priorityReview;

  useEffect(() => {
    if (hash === '#competing-requests') document.getElementById('competing-requests')?.scrollIntoView();
  }, [hash, disputed]);

  function refresh() {
    for (const key of ['approval', 'approvals', 'my-events', 'request', 'venue-calendar', 'venue-schedule', 'venue-availability']) {
      void client.invalidateQueries({ queryKey: [key] });
    }
  }

  const approve = useMutation({
    mutationFn: () => api.decideApproval(request.id, {
      decision: 'APPROVED', expectedUpdatedAt: request.updatedAt, comments: comments.trim(),
      reviewedCompetingRequestIds: priorityReview ? reviewed ?? [] : undefined,
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
      remarks, expectedUpdatedAt: request.updatedAt, reviewedCompetingRequestIds: reviewed ?? [],
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
      <p>{event.department.name}</p>
    </div><RequestStatusBadge status={request.status} /></div>

    <section className="product-panel approval-facts">
      <div><MapPin size={22} aria-hidden="true" /><strong>{request.venue.name}</strong></div>
      <div><CalendarBlank size={22} aria-hidden="true" /><strong>{formatDate(request.startTime)} · {displaySlot(request.startTime, request.endTime)}</strong></div>
      <div><Users size={22} aria-hidden="true" /><strong>{event.expectedAttendance} attendees</strong></div>
      <BookingPeopleSummary people={detail.people} />
      {event.description && <p>{event.description}</p>}
    </section>
    {request.rejectionReason && <Alert tone="warning" title="Booking update">{request.rejectionReason}</Alert>}
    {conflicts.confirmed.length > 0 && <Alert tone="warning" title="This slot overlaps a confirmed reservation">
      <ul>{conflicts.confirmed.map((item) => <li key={item.requestId}>{item.title} · {formatDate(item.startTime)} · {displaySlot(item.startTime, item.endTime)}</li>)}</ul>
    </Alert>}
    {isApprover && disputed && <CompetitorComparison detail={detail}
      canChoose={needsChoice && (!allotting || conflicts.confirmed.length === 0)} chosen={Boolean(reviewed)}
      onChoose={(ids) => setChoice({ snapshot, ids })}
      onRefresh={() => { setChoice(undefined); refresh(); }} />}
    <details className="product-panel product-disclosure"><summary>History</summary>
      <ApprovalTimeline timeline={timeline} decisions={decisions} currentRound={currentRound} status={request.status} />
    </details>
    {approving && <section className="product-panel">
      <TextareaField name="approval-note" label={reasonRequired ? 'Why this request has priority' : 'Notes'}
        optional={!reasonRequired} required={reasonRequired} rows={2} value={comments} maxLength={1000}
        onChange={(event) => setComments(event.target.value)} />
      {approve.error && <Alert tone="danger" title={approve.error.message} />}
    </section>}
    {(permissions.canDecide || allotting || permissions.canCancelAllotment) && <div className="product-actions approval-actions">
      {approving && <Button size="lg" loading={approve.isPending}
        disabled={(needsChoice && !reviewed) || (reasonRequired && comments.trim().length < 5)}
        onClick={() => approve.mutate()}>
        <Check size={20} aria-hidden="true" /> {step?.stepOrder === 0 ? 'Endorse' : reasonRequired ? 'Approve with recommendation' : 'Approve'}
      </Button>}
      {allotting && <Button size="lg" disabled={(needsChoice && !reviewed) || conflicts.confirmed.length > 0}
        onClick={() => setAllot(true)}>
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
    {allot && (!needsChoice || reviewed) && <AllotmentConfirmDialog open onOpenChange={setAllot} detail={detail} action="Confirm allotment"
      unavailable={false} onConfirm={confirm} isOverride={permissions.requiresAllotmentRemarks} />}
    {cancel && allotment && <AllotmentCancelDialog open onOpenChange={setCancel} detail={detail} onConfirm={async (reason) => {
      await api.cancelAllotment(allotment.id, { reason });
      pushToast({ tone: 'info', title: 'Allotment cancelled' });
      refresh();
    }} />}
  </>;
}
