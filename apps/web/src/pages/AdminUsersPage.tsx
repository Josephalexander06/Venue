import { useDeferredValue, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import type { UserStatus } from '@venue/shared';
import {
  ArrowLeft,
  ArrowRight,
  MagnifyingGlass,
  ShieldCheck,
  UsersThree,
  X,
} from '@phosphor-icons/react';
import { api, type UserView } from '../lib/api';
import { usePageTitle } from '../auth';
import { formatDate } from '../lib/format';
import {
  Alert,
  Avatar,
  Button,
  EmptyState,
  PageHeader,
  RoleBadge,
  Skeleton,
  StatusBadge,
  useToast,
} from '../components/ui';
import { SuspendUserDialog } from '../components/SuspendUserDialog';
import { UserReviewDialog } from '../components/UserReviewDialog';

type StatusFilter = UserStatus | 'ALL';

const PAGE_SIZE = 25;

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING_APPROVAL', label: 'Awaiting review' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'SUSPENDED', label: 'Suspended' },
];

interface DialogTarget {
  user: UserView;
  mode: 'review' | 'roles';
}

export function AdminUsersPage() {
  usePageTitle('User approvals');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [offset, setOffset] = useState(0);
  const [target, setTarget] = useState<DialogTarget | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<UserView | null>(null);
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const reactivate = useMutation({
    mutationFn: (userId: string) => api.reactivateUser(userId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      pushToast({
        tone: 'success',
        title: 'Account reactivated',
        message: `${result.user.firstName} ${result.user.lastName} can sign in again.`,
      });
    },
  });

  const stats = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: api.adminStats,
    staleTime: 15_000,
    retry: false,
  });

  const users = useQuery({
    queryKey: ['admin', 'users', { status, search: deferredSearch.trim(), offset }],
    queryFn: () =>
      api.adminUsers({
        status,
        search: deferredSearch.trim(),
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const counts = stats.data?.counts;
  const totalCount = counts
    ? counts.PENDING_APPROVAL + counts.ACTIVE + counts.REJECTED + counts.SUSPENDED
    : undefined;

  function countFor(filter: StatusFilter) {
    if (!counts) return undefined;
    return filter === 'ALL' ? totalCount : counts[filter];
  }

  function changeFilter(next: StatusFilter) {
    setStatus(next);
    setOffset(0);
  }

  const result = users.data;
  const shownFrom = result && result.total > 0 ? offset + 1 : 0;
  const shownTo = result ? Math.min(offset + PAGE_SIZE, result.total) : 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const hasSearch = deferredSearch.trim().length > 0;

  return (
    <>
      <PageHeader
        eyebrow="Access control"
        title="User accounts"
        description="Review new registrations, assign roles and audit the access held across the college."
        actions={
          <span className="header-chip">
            <ShieldCheck size={16} />
            Administrator only
          </span>
        }
      />

      {users.isError && (
        <div className="page-alert">
          <Alert tone="danger" title="Could not load accounts">
            Check the API connection and{' '}
            <button type="button" className="inline-link" onClick={() => void users.refetch()}>
              try again
            </button>
            .
          </Alert>
        </div>
      )}

      <section className="card directory-card" aria-label="Account directory">
        <div className="directory-toolbar">
          <div className="filter-tabs" role="group" aria-label="Filter accounts by status">
            {FILTERS.map((filter) => {
              const count = countFor(filter.value);
              return (
                <button
                  key={filter.value}
                  type="button"
                  className={`filter-tab ${status === filter.value ? 'is-active' : ''}`}
                  aria-pressed={status === filter.value}
                  onClick={() => changeFilter(filter.value)}
                >
                  {filter.label}
                  {count !== undefined && <span className="filter-count">{count}</span>}
                </button>
              );
            })}
          </div>

          <div className="search-field">
            <MagnifyingGlass size={17} className="search-icon" aria-hidden="true" />
            <label className="sr-only" htmlFor="account-search">
              Search accounts by name or email
            </label>
            <input
              id="account-search"
              type="search"
              className="input search-input"
              placeholder="Search name or email"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
            />
            {search && (
              <button
                type="button"
                className="search-clear"
                aria-label="Clear search"
                onClick={() => {
                  setSearch('');
                  setOffset(0);
                }}
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        {users.isPending ? (
          <div className="table-skeleton" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((row) => (
              <div className="table-skeleton-row" key={row}>
                <Skeleton className="skeleton-avatar" />
                <Skeleton className="skeleton-line skeleton-line-wide" />
                <Skeleton className="skeleton-line" />
                <Skeleton className="skeleton-button" />
              </div>
            ))}
          </div>
        ) : result && result.users.length === 0 ? (
          <EmptyState
            icon={<UsersThree size={28} weight="duotone" />}
            title={hasSearch ? 'No matching accounts' : 'No accounts in this view'}
            description={
              hasSearch
                ? `Nothing matched “${deferredSearch.trim()}”. Try a different name or email.`
                : status === 'PENDING_APPROVAL'
                  ? 'There are no registrations waiting for review.'
                  : 'Accounts will appear here once they match this status.'
            }
            action={
              hasSearch ? (
                <Button variant="secondary" size="sm" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              ) : status !== 'ALL' ? (
                <Button variant="secondary" size="sm" onClick={() => changeFilter('ALL')}>
                  View all accounts
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className={`table-scroll ${users.isFetching ? 'is-refreshing' : ''}`}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Department</th>
                    <th scope="col">Status</th>
                    <th scope="col">Roles</th>
                    <th scope="col">Registered</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result?.users.map((account) => (
                    <tr key={account.id}>
                      <td data-label="Account">
                        <div className="user-cell">
                          <Avatar
                            firstName={account.firstName}
                            lastName={account.lastName}
                            size="md"
                          />
                          <div>
                            <strong>
                              {account.firstName} {account.lastName}
                            </strong>
                            <span>{account.email}</span>
                          </div>
                        </div>
                      </td>
                      <td data-label="Department">
                        <span className="department-tag">{account.department.code}</span>
                        <span className="department-name">{account.department.name}</span>
                      </td>
                      <td data-label="Status">
                        <StatusBadge status={account.status} />
                        {account.status === 'REJECTED' && account.statusReason && (
                          <span className="status-reason" title={account.statusReason}>
                            {account.statusReason}
                          </span>
                        )}
                      </td>
                      <td data-label="Roles">
                        {account.roles.length === 0 ? (
                          <span className="muted-dash">Not assigned</span>
                        ) : (
                          <span className="role-stack">
                            {account.roles.map((entry) => (
                              <RoleBadge
                                key={`${entry.role}-${entry.departmentId ?? 'college'}`}
                                role={entry.role}
                              />
                            ))}
                          </span>
                        )}
                      </td>
                      <td data-label="Registered">
                        <span className="date-cell">{formatDate(account.createdAt)}</span>
                      </td>
                      <td className="table-actions">
                        {account.status === 'PENDING_APPROVAL' ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setTarget({ user: account, mode: 'review' })}
                          >
                            Review
                          </Button>
                        ) : account.status === 'ACTIVE' ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setTarget({ user: account, mode: 'roles' })}
                            >
                              Manage access
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSuspendTarget(account)}
                            >
                              Suspend
                            </Button>
                          </>
                        ) : account.status === 'SUSPENDED' ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={reactivate.isPending && reactivate.variables === account.id}
                            onClick={() => reactivate.mutate(account.id)}
                          >
                            Reactivate
                          </Button>
                        ) : (
                          <span className="muted-dash">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="table-foot">
              <p>
                Showing <strong>{shownFrom}–{shownTo}</strong> of{' '}
                <strong>{result?.total ?? 0}</strong> accounts
              </p>
              <div className="pagination">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  <ArrowLeft size={15} /> Previous
                </Button>
                <span className="page-indicator">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!result || offset + PAGE_SIZE >= result.total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next <ArrowRight size={15} />
                </Button>
              </div>
            </footer>
          </>
        )}
      </section>

      {target && (
        <UserReviewDialog
          user={target.user}
          mode={target.mode}
          onClose={() => setTarget(null)}
        />
      )}

      {suspendTarget && (
        <SuspendUserDialog user={suspendTarget} onClose={() => setSuspendTarget(null)} />
      )}
    </>
  );
}
