import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarBlank, Check, Clock, PencilSimple, Users, UsersThree, X } from '@phosphor-icons/react';
import { DEFAULT_BOOKING_TITLE } from '@venue/shared';
import { useAuth, usePageTitle } from '../auth';
import { BookingProgress } from '../components/BookingCard';
import { EventTeamDialog } from '../components/EventTeamDialog';
import { Alert, Button, Dialog, Skeleton, useToast } from '../components/ui';
import { api, type RequestDetailView } from '../lib/api';
import { formatDate } from '../lib/format';
import { displaySlot } from '../lib/slot-schedule';

function BookingTracker({ detail }: { detail: RequestDetailView }) {
  const { request, timeline, allotment } = detail;
  const confirmed = request.status === 'CONFIRMED';
  const steps = [
    { label: 'Submitted', state: 'done', when: request.createdAt },
    ...timeline.filter((item) => !(confirmed && item.isFinalAllotmentStep)).map((item) => ({
      label: item.stepOrder === 0 ? 'Faculty endorsement' : item.stepName,
      state: item.state === 'APPROVED' ? 'done' : item.state === 'REJECTED' || item.state === 'CHANGES_REQUESTED'
        ? 'closed' : item.state === 'CURRENT' ? 'current' : 'waiting',
      when: item.decision?.decidedAt,
    })),
    { label: 'Confirmed', state: confirmed ? 'done' : request.status === 'APPROVED_PENDING_ALLOTMENT' ? 'current' : 'waiting', when: allotment?.createdAt },
  ];
  return <ol className="booking-tracker">{steps.map(({ label, state, when }, index) => (
    <li key={`${label}-${index}`} className={`tracker-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
      <span className="tracker-marker" aria-hidden="true">{state === 'done' ? <Check size={15} weight="bold" />
        : state === 'closed' ? <X size={15} weight="bold" /> : state === 'current' ? <Clock size={15} weight="bold" /> : null}</span>
      <strong>{label}</strong>
      <span>{when ? formatDate(when) : state === 'current' ? 'In progress' : '—'}</span>
    </li>
  ))}</ol>;
}

export function BookingStatusPage() {
  const { id = '' } = useParams();
  const { approvalOnly } = useAuth();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [cancelling, setCancelling] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const teamTrigger = useRef<HTMLButtonElement>(null);
  const booking = useQuery({ queryKey: ['request', id], queryFn: () => api.requestDetail(id), refetchInterval: 30_000 });
  const detail = booking.data;
  usePageTitle(detail?.request.venue.name ?? 'Booking');

  const cancel = useMutation({
    mutationFn: () => api.cancelRequest(id),
    onSuccess: () => {
      for (const key of ['request', 'my-events', 'venue-schedule', 'venue-calendar', 'venue-availability', 'approvals', 'approval']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      pushToast({ tone: 'success', title: 'Booking cancelled' });
      setCancelling(false);
    },
  });

  return <div className="product-page booking-status-page">
    <Link className="text-link back-link" to={approvalOnly ? '/approvals' : '/bookings'}><ArrowLeft size={18} /> {approvalOnly ? 'Approvals' : 'My bookings'}</Link>
    {booking.isError && <Alert tone="danger" title="Could not load booking">
      <button className="inline-link" type="button" onClick={() => void booking.refetch()}>Try again</button>
    </Alert>}
    {booking.isPending && <Skeleton className="detail-skeleton" />}
    {detail && <>
      <div className="product-page-heading">
        <div>
          <h1>{detail.request.venue.name}</h1>
          {detail.event.title !== DEFAULT_BOOKING_TITLE && <p>{detail.event.title}</p>}
          <div className="catalog-meta">
            <span><CalendarBlank size={18} aria-hidden="true" />{formatDate(detail.request.startTime)} · {displaySlot(detail.request.startTime, detail.request.endTime)}</span>
            <span><Users size={19} aria-hidden="true" />{detail.event.expectedAttendance} attendees</span>
          </div>
        </div>
        <BookingProgress request={detail.request} />
      </div>
      <section className="product-panel tracker-panel"><h2>Progress</h2><BookingTracker detail={detail} /></section>
      {detail.request.rejectionReason && <Alert tone="warning" title="Booking update">{detail.request.rejectionReason}</Alert>}
      <button type="button" ref={teamTrigger} className="product-panel team-launch" onClick={() => setShowTeam(true)} aria-haspopup="dialog">
        <span className="product-icon"><UsersThree size={21} aria-hidden="true" /></span>
        <strong>Event team</strong>
        <ArrowRight size={19} aria-hidden="true" />
      </button>
      {detail.conflicts.pending.length > 0 && <details className="product-panel product-disclosure">
        <summary>Show competing requests</summary>
        <p className="status-details">{detail.conflicts.pending.length} other {detail.conflicts.pending.length === 1 ? 'request overlaps' : 'requests overlap'} this time.</p>
      </details>}
      {(detail.permissions.canEdit || detail.permissions.canCancel) && <div className="product-actions">
        {detail.permissions.canEdit && <Link className="btn btn-secondary btn-lg" to={`/venues/${detail.request.venue.id}?editRequest=${id}`}>
          <PencilSimple size={19} aria-hidden="true" /> Modify booking
        </Link>}
        {detail.permissions.canCancel && <Button variant="danger-ghost" size="lg" onClick={() => { cancel.reset(); setCancelling(true); }}>
          <X size={19} aria-hidden="true" /> Cancel booking
        </Button>}
      </div>}
      {cancelling && <Dialog open onClose={() => { if (!cancel.isPending) setCancelling(false); }} title="Cancel booking?"
        description={detail.request.venue.name} footer={<>
          <Button variant="secondary" onClick={() => setCancelling(false)} disabled={cancel.isPending}>Keep booking</Button>
          <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending}>Cancel booking</Button>
        </>}>{cancel.error && <Alert tone="danger" title={cancel.error.message} />}</Dialog>}
      {showTeam && <EventTeamDialog event={detail.event} onClose={() => {
        setShowTeam(false);
        requestAnimationFrame(() => teamTrigger.current?.focus());
      }} />}
    </>}
  </div>;
}
