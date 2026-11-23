import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check } from '@phosphor-icons/react';
import { APPROVAL_ONLY_ROLES, type BookingPeople, type BookingReviewNote, type RequestStatus } from '@venue/shared';
import { api, type ApprovalDetailView } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { displaySlot } from '../../lib/slot-schedule';
import { BookingPeopleSummary } from './BookingPeopleSummary';
import { RequestStatusBadge } from '../booking';
import { Alert, Button, Skeleton } from '../ui';

function RequestOption({ title, department, description, attendance, status, start, end, people, stage, notes, children }: {
  title: string;
  department: string;
  description: string | null;
  attendance: number;
  status: RequestStatus;
  start: string;
  end: string;
  people: BookingPeople | null;
  stage?: string | null;
  notes: BookingReviewNote[];
  children?: ReactNode;
}) {
  return <article className="product-panel comparison-option">
    <h3>{title}</h3>
    <RequestStatusBadge status={status} />
    <BookingPeopleSummary people={people} />
    <dl>
      <div><dt>Event department</dt><dd>{department}</dd></div>
      {stage && <div><dt>Current step</dt><dd>{stage}</dd></div>}
      <div><dt>Requested time</dt><dd>{formatDate(start)} · {displaySlot(start, end)}</dd></div>
      <div><dt>Attendees</dt><dd>{attendance}</dd></div>
      <div><dt>Event purpose</dt><dd>{description || 'No description provided'}</dd></div>
      {notes.map(({ role, stepName, note }, index) => (
        <div key={`${role}-${index}`}><dt>{stepName} note</dt><dd>{note}</dd></div>
      ))}
    </dl>
    {children}
  </article>;
}

export function CompetitorComparison({ detail, canChoose, chosen, onChoose, onRefresh }: {
  detail: ApprovalDetailView;
  canChoose: boolean;
  chosen: boolean;
  onChoose: (ids: string[]) => void;
  onRefresh: () => void;
}) {
  const { request, event, conflicts, timeline } = detail;
  const query = useQuery({
    queryKey: ['approval', request.id, 'competitors'],
    queryFn: () => api.competingRequests(request.id),
  });
  const others = query.data?.competingRequests ?? [];
  const matches = query.isSuccess && others.length === conflicts.pending.length &&
    conflicts.pending.every(({ requestId }) => others.some(({ request }) => request.id === requestId));
  const notes = timeline.flatMap(({ requiredRole, decision, stepName, state }) =>
    APPROVAL_ONLY_ROLES.includes(requiredRole) && state === 'APPROVED' && decision?.remarks
      ? [{ role: requiredRole, stepName, note: decision.remarks }] : []);
  const stage = request.status === 'APPROVED_PENDING_ALLOTMENT' ? 'Final allotment'
    : timeline.find(({ stepOrder }) => stepOrder === request.currentStepOrder)?.stepName;

  function refresh() {
    onRefresh();
    void query.refetch();
  }

  return <section id="competing-requests" className="product-section conflict-review" aria-labelledby="competition-heading">
    <div className="product-heading-row">
      <div><h2 id="competition-heading">Compare competing requests</h2><p>{request.venue.name} · {request.venue.capacity} seats</p></div>
    </div>
    {query.isPending && <div role="status"><span className="sr-only">Loading competing requests</span><Skeleton className="skeleton-block" /></div>}
    {(query.isError || (query.isSuccess && !matches)) && <Alert tone="warning"
      title={query.isError ? 'Could not load competing requests' : 'The competing requests changed'}>
      <button type="button" className="inline-link" onClick={refresh}>Refresh comparison</button>
    </Alert>}
    {matches && <div className="conflict-options">
      <RequestOption title={event.title} department={event.department.name} description={event.description}
        attendance={event.expectedAttendance} status={request.status} start={request.startTime} end={request.endTime} people={detail.people} stage={stage} notes={notes}>
        {canChoose && <Button type="button" variant={chosen ? 'secondary' : 'primary'} aria-pressed={chosen}
          onClick={() => onChoose(others.map(({ request }) => request.id))}>
          {chosen && <Check size={17} aria-hidden="true" />} {chosen ? 'Selected request' : 'Choose this request'}
        </Button>}
      </RequestOption>
      {others.map(({ request: alternative, event: contender, canReview, reviewNotes, people, stage: competitorStage }) => <RequestOption key={alternative.id}
        title={contender.title} department={contender.department.name} description={contender.description}
        attendance={contender.expectedAttendance} status={alternative.status} start={alternative.startTime} end={alternative.endTime}
        people={people} stage={competitorStage} notes={reviewNotes}>
        {canReview && <Link className="btn btn-secondary btn-md" to={`/approvals/${alternative.id}#competing-requests`}
          aria-label={`Review ${contender.title}`}>Review request <ArrowRight size={16} aria-hidden="true" /></Link>}
      </RequestOption>)}
    </div>}
  </section>;
}
