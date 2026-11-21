import { useDeferredValue, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Buildings,
  MagnifyingGlass,
  NotePencil,
  Plus,
  Trash,
  X,
} from '@phosphor-icons/react';
import type { DepartmentWithStats } from '../lib/api';
import { api, ApiError } from '../lib/api';
import { usePageTitle } from '../auth';
import { formatDate } from '../lib/format';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  PageHeader,
  Skeleton,
  useToast,
} from '../components/ui';
import { DepartmentDialog } from '../components/DepartmentDialog';

export function AdminDepartmentsPage() {
  usePageTitle('Department management');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [dialogTarget, setDialogTarget] = useState<{ department?: DepartmentWithStats } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DepartmentWithStats | null>(null);
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const departmentsQuery = useQuery({
    queryKey: ['admin-departments'],
    queryFn: api.adminDepartments,
  });

  const departments = departmentsQuery.data?.departments ?? [];
  const filtered = departments.filter(
    (dept) =>
      !deferredSearch ||
      dept.code.toLowerCase().includes(deferredSearch) ||
      dept.name.toLowerCase().includes(deferredSearch),
  );

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteDepartment(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-departments'] }),
        queryClient.invalidateQueries({ queryKey: ['departments'] }),
      ]);
      pushToast({
        tone: 'success',
        title: 'Department deleted',
        message: `${deleteTarget?.name} was deleted successfully.`,
      });
      setDeleteTarget(null);
    },
  });

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Academic departments"
        description="Departments establish academic boundaries for members, student organizers, venues, and preliminary approvals."
        actions={
          <Button size="md" onClick={() => setDialogTarget({})}>
            <Plus size={16} /> Add department
          </Button>
        }
      />

      <div className="card table-card">
        <div className="table-toolbar">
          <div className="search-field">
            <MagnifyingGlass size={17} className="search-icon" aria-hidden="true" />
            <input
              type="search"
              placeholder="Filter by department code or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Filter departments"
            />
            {search && (
              <button
                type="button"
                className="search-clear"
                aria-label="Clear search"
                onClick={() => setSearch('')}
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        {departmentsQuery.isError ? (
          <div className="page-alert venue-table-alert">
            <Alert tone="danger" title="Could not load departments">
              Check your connection and{' '}
              <button
                type="button"
                className="inline-link"
                onClick={() => void departmentsQuery.refetch()}
              >
                try again
              </button>
              .
            </Alert>
          </div>
        ) : departmentsQuery.isPending ? (
          <div className="venue-table-loading" aria-hidden="true">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton className="skeleton-line skeleton-line-wide" key={item} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Buildings size={28} weight="duotone" />}
            title={search ? 'No departments match that query' : 'No departments yet'}
            description={
              search
                ? 'Try a different search term.'
                : 'Add the first academic department to begin organizing users and venues.'
            }
            action={
              search ? (
                <Button variant="secondary" size="sm" onClick={() => setSearch('')}>
                  Clear filter
                </Button>
              ) : (
                <Button size="sm" onClick={() => setDialogTarget({})}>
                  <Plus size={15} /> Add department
                </Button>
              )
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Members</th>
                  <th>Venues</th>
                  <th>Events</th>
                  <th>Created</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((dept) => {
                  const hasUsage =
                    dept.usersCount > 0 || dept.venuesCount > 0 || dept.eventsCount > 0;
                  return (
                    <tr key={dept.id}>
                      <td data-label="Department">
                        <span className="table-venue-cell">
                          <strong>{dept.name}</strong>
                          <span className="department-tag">{dept.code}</span>
                        </span>
                      </td>
                      <td data-label="Members">
                        <span className="table-muted">
                          {dept.usersCount} {dept.usersCount === 1 ? 'member' : 'members'}
                        </span>
                      </td>
                      <td data-label="Venues">
                        <span className="table-muted">
                          {dept.venuesCount} {dept.venuesCount === 1 ? 'venue' : 'venues'}
                        </span>
                      </td>
                      <td data-label="Events">
                        <span className="table-muted">
                          {dept.eventsCount} {dept.eventsCount === 1 ? 'event' : 'events'}
                        </span>
                      </td>
                      <td data-label="Created">
                        <span className="table-muted">{formatDate(dept.createdAt)}</span>
                      </td>
                      <td className="table-actions">
                        <div className="table-action-group">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Edit ${dept.name}`}
                            onClick={() => setDialogTarget({ department: dept })}
                          >
                            <NotePencil size={15} /> Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger"
                            aria-label={`Delete ${dept.name}`}
                            disabled={hasUsage}
                            title={
                              hasUsage
                                ? 'Cannot delete department with assigned users, venues, or events'
                                : undefined
                            }
                            onClick={() => setDeleteTarget(dept)}
                          >
                            <Trash size={15} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialogTarget && (
        <DepartmentDialog
          department={dialogTarget.department}
          onClose={() => setDialogTarget(null)}
        />
      )}

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name}?`}
        description="Are you sure you want to remove this academic department? This action cannot be undone."
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Delete department
            </Button>
          </>
        }
      >
        {deleteMutation.isError && (
          <Alert tone="danger" title="Could not delete department">
            {deleteMutation.error instanceof ApiError
              ? deleteMutation.error.message
              : 'Please try again.'}
          </Alert>
        )}
        <p className="dialog-confirm-copy">
          This department has no assigned members, venues, or events and can be safely deleted.
        </p>
      </Dialog>
    </>
  );
}
