import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';
import type { RequestStatus } from '@venue/shared';
import { usePageTitle } from '../auth';
import { ApprovalTimeline } from '../components/approvals/ApprovalTimeline';
import { RequestStatusBadge } from '../components/booking';
import { Alert, PageHeader, Skeleton } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatTimeRange } from '../lib/datetime';
import { formatDate } from '../lib/format';

const statusMessage: Record<RequestStatus, string> = {
  SUBMITTED: 'Your request is awaiting review. The venue is reserved once allotment is confirmed.',
  IN_REVIEW: 'The approval workflow is in progress. The venue is reserved once allotment is confirmed.',
  APPROVED_PENDING_ALLOTMENT: 'Approval is complete. The venue is awaiting final allotment.',
  CONFIRMED: 'Your venue is reserved for the dates and times below.',
  REJECTED: 'The reviewer declined this request.',
  SUPERSEDED_CONFLICT: 'The venue was allotted to another event. You can choose a new slot in My events.',
  CANCELLED: 'This booking request is closed.',
};

export function BookingStatusPage() {
  const { id } = useParams<{ id: string }>();
  const { state } = useLocation();
  const query = useQuery({
    queryKey: ['request', id],
    queryFn: () => api.requestDetail(id!),
    enabled: Boolean(id),
  });
  const detail = query.data;
  const confirmed = detail?.request.status === 'CONFIRMED';
  const submitted = state?.submitted &&
    (detail?.request.status === 'SUBMITTED' || detail?.request.status === 'IN_REVIEW');
  const title = confirmed ? 'Booking confirmed' : submitted ? 'Booking request submitted' : 'Booking status';
  usePageTitle(title);

  const backToEvents = detail
    ? `/my-events?highlight=${detail.request.id}#event-${detail.event.id}`
    : '/my-events';

  return (
    <div className="booking-status-page">
      <PageHeader title={title} description={detail && statusMessage[detail.request.status]}
        actions={<Link className="btn btn-secondary btn-md" to={backToEvents}>Manage in My events</Link>} />
      {query.isPending ? <Skeleton className="skeleton-block" /> : query.isError || !detail ? (
        <Alert tone="danger" title="Could not load booking">
          {query.error instanceof ApiError ? query.error.message : 'Check your connection and try again.'}
          {' '}<button className="inline-link" type="button" onClick={() => void query.refetch()}>Try again</button>
        </Alert>
      ) : (
        <>
          <section className="allotment-review" aria-label="Booking details">
            <RequestStatusBadge status={detail.request.status} />
            <h2>{detail.event.title}</h2>
            <dl>
              <div><dt>Venue</dt><dd>{detail.request.venue.name} · {detail.request.venue.building}</dd></div>
              <div><dt>Date and time</dt><dd>{formatDate(detail.request.startTime)} · {formatTimeRange(detail.request.startTime, detail.request.endTime)}</dd></div>
              {confirmed && (
                <div><dt>Reserved window</dt><dd>{formatTimeRange(detail.request.effectiveStart, detail.request.effectiveEnd)} including setup and cleanup</dd></div>
              )}
              <div><dt>Request reference</dt><dd className="booking-reference">{detail.request.id}</dd></div>
              {confirmed && detail.allotment?.status === 'ACTIVE' && (
                <div><dt>Confirmed on</dt><dd>{formatDate(detail.allotment.createdAt)}</dd></div>
              )}
            </dl>
          </section>
          {detail.request.rejectionReason && (
            <Alert tone="warning" title="Reviewer update">{detail.request.rejectionReason}</Alert>
          )}
          <ApprovalTimeline timeline={detail.timeline} decisions={detail.decisions}
            currentRound={detail.currentRound} status={detail.request.status} />
        </>
      )}
    </div>
  );
}
