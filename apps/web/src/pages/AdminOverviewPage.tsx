import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Buildings,
  CheckCircle,
  ClockCountdown,
  Prohibit,
  ShieldCheck,
  UserCheck,
  UserFocus,
  UsersThree,
  XCircle,
} from '@phosphor-icons/react';
import { api, type UserView } from '../lib/api';
import { useAuth, usePageTitle } from '../auth';
import { formatDate } from '../lib/format';
import {
  Alert,
  Avatar,
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
  StatusBadge,
} from '../components/ui';
import { UserReviewDialog } from '../components/UserReviewDialog';

export function AdminOverviewPage() {
  usePageTitle('Admin overview');
  const { user } = useAuth();
  const [reviewing, setReviewing] = useState<UserView | null>(null);

  const stats = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: api.adminStats,
    staleTime: 15_000,
    retry: false,
  });

  const counts = stats.data?.counts;
  const cards = [
    {
      key: 'pending',
      label: 'Awaiting review',
      value: counts?.PENDING_APPROVAL,
      note: 'New registrations need a decision',
      icon: <ClockCountdown size={21} weight="duotone" />,
      tone: 'pending',
    },
    {
      key: 'active',
      label: 'Active accounts',
      value: counts?.ACTIVE,
      note: 'Verified and able to sign in',
      icon: <UserCheck size={21} weight="duotone" />,
      tone: 'active',
    },
    {
      key: 'rejected',
      label: 'Rejected',
      value: counts?.REJECTED,
      note: 'Registration requests declined',
      icon: <XCircle size={21} weight="duotone" />,
      tone: 'rejected',
    },
    {
      key: 'suspended',
      label: 'Suspended',
      value: counts?.SUSPENDED,
      note: 'Access currently withheld',
      icon: <Prohibit size={21} weight="duotone" />,
      tone: 'suspended',
    },
  ];

  const pending = stats.data?.recentPending ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Approval console"
        description={`Welcome back, ${user?.firstName ?? 'administrator'}. Review account requests and keep access tightly scoped.`}
        actions={
          <>
            <Link to="/admin/venues" className="btn btn-ghost btn-md">
              <Buildings size={17} /> Venues
            </Link>
            <Link to="/admin/users" className="btn btn-secondary btn-md">
              <UsersThree size={17} /> All accounts
            </Link>
            <Link to="/admin/users" className="btn btn-primary btn-md">
              Open approval queue <ArrowRight size={16} />
            </Link>
          </>
        }
      />

      {stats.isError && (
        <div className="page-alert">
          <Alert tone="danger" title="Could not load account statistics">
            Check the API connection and{' '}
            <button type="button" className="inline-link" onClick={() => void stats.refetch()}>
              try again
            </button>
            .
          </Alert>
        </div>
      )}

      <div className="stat-grid" aria-label="Account statistics">
        {cards.map((card) => (
          <article className={`stat-card stat-${card.tone}`} key={card.key}>
            <div className="stat-top">
              <span className="stat-label">{card.label}</span>
              <span className={`stat-icon stat-icon-${card.tone}`}>{card.icon}</span>
            </div>
            <strong className="stat-value">
              {card.value === undefined ? (
                stats.isError ? '—' : <Skeleton className="skeleton-stat" />
              ) : (
                card.value
              )}
            </strong>
            <span className="stat-note">{card.note}</span>
          </article>
        ))}
      </div>

      <div className="overview-grid">
        <section className="card" aria-labelledby="pending-heading">
          <div className="card-head">
            <div>
              <h2 id="pending-heading">Needs your review</h2>
              <p>The five most recent accounts waiting for verification.</p>
            </div>
            <Link to="/admin/users" className="text-link">
              View all <ArrowRight size={14} />
            </Link>
          </div>

          {stats.isPending ? (
            <div className="review-list" aria-hidden="true">
              {[0, 1, 2].map((row) => (
                <div className="review-row" key={row}>
                  <Skeleton className="skeleton-avatar" />
                  <span className="skeleton-copy">
                    <Skeleton className="skeleton-line skeleton-line-wide" />
                    <Skeleton className="skeleton-line" />
                  </span>
                  <Skeleton className="skeleton-button" />
                </div>
              ))}
            </div>
          ) : pending.length === 0 ? (
            <EmptyState
              icon={<CheckCircle size={28} weight="duotone" />}
              title="The queue is clear"
              description="There are no new accounts waiting for review. New registrations will appear here."
              action={
                <Link to="/admin/users" className="btn btn-secondary btn-sm">
                  Browse all accounts
                </Link>
              }
            />
          ) : (
            <ul className="review-list">
              {pending.map((pendingUser) => (
                <li className="review-row" key={pendingUser.id}>
                  <Avatar
                    firstName={pendingUser.firstName}
                    lastName={pendingUser.lastName}
                    size="md"
                  />
                  <div className="review-row-copy">
                    <strong>
                      {pendingUser.firstName} {pendingUser.lastName}
                    </strong>
                    <span>{pendingUser.email}</span>
                    <span className="review-row-meta">
                      {pendingUser.department.code} · Registered{' '}
                      {formatDate(pendingUser.createdAt)}
                    </span>
                  </div>
                  <StatusBadge status={pendingUser.status} />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setReviewing(pendingUser)}
                  >
                    Review
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="overview-side">
          <section className="card" aria-labelledby="checklist-heading">
            <div className="card-head">
              <div>
                <h2 id="checklist-heading">Approval checklist</h2>
                <p>Before activating an account.</p>
              </div>
              <span className="card-icon card-icon-accent">
                <UserFocus size={20} />
              </span>
            </div>
            <ol className="checklist">
              <li>
                <span className="checklist-number">01</span>
                <span>
                  <strong>Verify the person</strong>
                  <span>Confirm the name, department and college email match college records.</span>
                </span>
              </li>
              <li>
                <span className="checklist-number">02</span>
                <span>
                  <strong>Assign least privilege</strong>
                  <span>Give only the roles required for their current responsibilities.</span>
                </span>
              </li>
              <li>
                <span className="checklist-number">03</span>
                <span>
                  <strong>Record the decision</strong>
                  <span>Approve or reject with a clear reason. Every decision is audited.</span>
                </span>
              </li>
            </ol>
          </section>

          <section className="side-note">
            <ShieldCheck size={20} aria-hidden="true" />
            <div>
              <strong>Departmental boundaries</strong>
              <p>
                Student, faculty and HOD roles stay scoped to their own department. Only
                college-wide roles can act beyond it.
              </p>
            </div>
          </section>
        </aside>
      </div>

      {reviewing && (
        <UserReviewDialog
          user={reviewing}
          mode="review"
          onClose={() => setReviewing(null)}
        />
      )}
    </>
  );
}
