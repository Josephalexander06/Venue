import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CalendarBlank, Check, CheckCircle, MapPin, WarningCircle } from '@phosphor-icons/react';
import { useAuth, usePageTitle } from '../auth';
import { APPROVAL_PREVIEW_KEY } from '../components/AppShell';
import { ApprovalDecisionDialog } from '../components/approvals/ApprovalDecisionDialog';
import { BookingPeopleSummary } from '../components/approvals/BookingPeopleSummary';
import { RequestStatusBadge } from '../components/booking';
import { Alert, Button, EmptyState, Skeleton, useToast } from '../components/ui';
import { api, type ApprovalInboxItem } from '../lib/api';
import { formatShortDay } from '../lib/datetime';
import { displaySlot } from '../lib/slot-schedule';

const PAGE_SIZE = 12;
const TABS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Needs action' },
  { id: 'overlaps', label: 'Overlaps' },
  { id: 'decided', label: 'Decided' },
] as const;

export function ApprovalInboxPage() {
  const { isFacultyOnlyApprover } = useAuth();
  const title = isFacultyOnlyApprover ? 'Incoming requests' : 'Approvals';
  usePageTitle(title);
  const client = useQueryClient();
  const { pushToast } = useToast();
  const [view, setView] = useState<(typeof TABS)[number]['id']>('pending');
  const [page, setPage] = useState(0);
  const [rejecting, setRejecting] = useState<ApprovalInboxItem>();
  const inbox = useQuery({
    queryKey: ['approvals', 'inbox', view, page],
    queryFn: ({ signal }) => api.approvalInbox({ view, limit: PAGE_SIZE, offset: page * PAGE_SIZE }, signal),
    refetchInterval: 30_000,
  });
  const preview = useQuery({
    queryKey: APPROVAL_PREVIEW_KEY,
    queryFn: () => api.approvalInbox({ limit: 3 }),
    staleTime: 15_000,
  });
  const approve = useMutation({
    mutationFn: ({ request }: ApprovalInboxItem) => api.decideApproval(request.id, {
      decision: 'APPROVED', expectedUpdatedAt: request.updatedAt,
    }),
    onSuccess: (_, item) => {
      pushToast({ tone: 'success', title: item.step.stepOrder === 0 ? 'Request endorsed' : 'Request approved' });
      for (const key of ['approvals', 'approval', 'request', 'my-events', 'venue-schedule', 'venue-availability']) {
        void client.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (error) => {
      pushToast({ tone: 'danger', title: 'Could not approve', message: error.message });
      void inbox.refetch();
    },
  });
  const total = inbox.data?.total ?? 0;

  const overlapsByVenue = new Map<string, ApprovalInboxItem[]>();
  if (view === 'overlaps') {
    for (const item of inbox.data?.items ?? []) {
      const venueId = item.request.venue.id;
      const items = overlapsByVenue.get(venueId) ?? [];
      items.push(item);
      overlapsByVenue.set(venueId, items);
    }
  }

  function renderCard(item: ApprovalInboxItem) {
    const { request, event, step, needsAction, conflicts, people } = item;
    const active = needsAction && view !== 'decided';
    const final = active && (step.isFinalAllotmentStep || request.status === 'APPROVED_PENDING_ALLOTMENT');
    const overlap = conflicts.confirmedCount + conflicts.pendingCount;
    const compare = active && conflicts.pendingCount > 0;
    const action = step.stepOrder === 0 ? 'Endorse' : 'Approve';
    return <article key={request.id} className="product-panel approval-card">
      <div className="product-heading-row">
        {active ? <span className="review-tag">{final ? 'Ready for allotment' : step.stepOrder === 0 ? 'Needs endorsement' : 'Needs review'}</span>
          : <RequestStatusBadge status={request.status} />}
        {active && overlap > 0 && <span className="availability-label availability-competing"><WarningCircle size={17} /> {overlap} overlapping</span>}
      </div>
      <h2>{event.title}</h2>
      <BookingPeopleSummary people={people} />
      <div className="approval-card-facts">
        <span><MapPin size={17} aria-hidden="true" /> {request.venue.name}</span>
        <span><CalendarBlank size={17} aria-hidden="true" /> {formatShortDay(new Date(request.startTime))} · {displaySlot(request.startTime, request.endTime)}</span>
      </div>
      <div className="product-actions">
        {active && !final && overlap === 0 && <Button size="sm" loading={approve.isPending && approve.variables?.request.id === request.id}
          disabled={approve.isPending} onClick={() => approve.mutate(item)}><Check size={17} /> {action}</Button>}
        {active && request.status !== 'APPROVED_PENDING_ALLOTMENT' && <Button variant="danger-ghost" size="sm" onClick={() => setRejecting(item)}>Reject</Button>}
        <Link to={`/approvals/${request.id}${compare ? '#competing-requests' : ''}`} className={`btn btn-sm ${final || compare ? 'btn-primary' : 'btn-secondary'}`}>
          {compare ? 'Compare requests' : active && conflicts.confirmedCount > 0 ? 'Review conflict' : final ? 'Review allotment' : 'Details'} <ArrowRight size={17} />
        </Link>
      </div>
    </article>;
  }

  return <div className="product-page approvals-page">
    <div className="product-page-heading"><div>
      <h1>{title} {Boolean(preview.data?.total) && <span className="product-count">{preview.data!.total}</span>}</h1>
      <p>Review venue requests that need your decision.</p>
    </div></div>
    <div className="product-chips" aria-label="Filter approvals">
      {TABS.filter(({ id }) => id !== 'overlaps' || !isFacultyOnlyApprover).map(({ id, label }) => <button key={id} type="button" aria-pressed={view === id} onClick={() => { setView(id); setPage(0); }}>
        {label}{id === 'pending' && Boolean(preview.data?.total) && <span className="product-count">{preview.data!.total}</span>}
      </button>)}
    </div>
    {inbox.isError ? <Alert tone="danger" title="Could not load approvals">
      <button type="button" className="inline-link" onClick={() => void inbox.refetch()}>Try again</button>
    </Alert> : inbox.isPending ? <div className="product-grid" role="status">
      <span className="sr-only">Loading approvals</span><Skeleton className="skeleton-block" /><Skeleton className="skeleton-block" />
    </div> : !inbox.data?.items.length ? <div className="product-panel">
      <EmptyState icon={<CheckCircle size={27} />} title={view === 'decided' ? 'No decisions yet' : view === 'overlaps' ? 'No overlaps to review' : 'You’re caught up'}
        action={page > 0 ? <Button variant="secondary" onClick={() => setPage(0)}>Back to first page</Button> : undefined} />
    </div> : view === 'overlaps'
      ? [...overlapsByVenue.entries()].map(([venueId, items]) => <section className="product-section" key={venueId}>
        <h2>{items[0]!.request.venue.name}</h2>
        <div className="product-grid">{items.map(renderCard)}</div>
      </section>)
      : <div className="product-grid">{inbox.data.items.map(renderCard)}</div>}
    {(page > 0 || total > PAGE_SIZE) && <div className="venue-pagination">
      <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}><ArrowLeft size={17} /> Previous</Button>
      <span>Page {page + 1}</span>
      <Button variant="secondary" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>Next <ArrowRight size={17} /></Button>
    </div>}
    {rejecting && <ApprovalDecisionDialog requestId={rejecting.request.id} updatedAt={rejecting.request.updatedAt}
      stepName={rejecting.step.stepName} allowApproval={false} initialDecision="REJECTED" onClose={() => setRejecting(undefined)} />}
  </div>;
}
