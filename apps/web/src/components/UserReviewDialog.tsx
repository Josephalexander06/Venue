import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DEPARTMENT_SCOPED_ROLES, ROLE_NAMES, type RoleName } from '@venue/shared';
import {
  ArrowRight,
  CheckCircle,
  ShieldCheck,
  WarningCircle,
} from '@phosphor-icons/react';
import { api, ApiError, type RoleAssignment, type UserView } from '../lib/api';
import { formatDate } from '../lib/format';
import { useAuth } from '../auth';
import {
  Alert,
  Avatar,
  Button,
  Dialog,
  RoleOption,
  TextareaField,
  useToast,
} from './ui';

type Mode = 'review' | 'roles';
type Tab = 'approve' | 'reject';

export function UserReviewDialog({
  user,
  mode,
  onClose,
}: {
  user: UserView;
  mode: Mode;
  onClose: () => void;
}) {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const panelId = useId();
  const [tab, setTab] = useState<Tab>('approve');
  const [selected, setSelected] = useState<Set<RoleName>>(() => {
    if (mode === 'roles') return new Set(user.roles.map((entry) => entry.role));
    return new Set<RoleName>(['STUDENT']);
  });
  const [selectedError, setSelectedError] = useState<string>();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();

  const isSelf = currentUser?.id === user.id;
  const roleList = ROLE_NAMES.filter((role) => selected.has(role));

  function assignments(): RoleAssignment[] {
    return roleList.map((role) => ({
      role,
      departmentId: DEPARTMENT_SCOPED_ROLES.includes(role) ? user.department.id : null,
    }));
  }

  function refreshCaches() {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    if (isSelf) void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
  }

  const approve = useMutation({
    mutationFn: () =>
      mode === 'review'
        ? api.approveUser(user.id, assignments())
        : api.updateUserRoles(user.id, assignments()),
    onSuccess: () => {
      refreshCaches();
      pushToast({
        tone: 'success',
        title: mode === 'review' ? 'Account approved' : 'Access updated',
        message:
          mode === 'review'
            ? `${user.firstName} ${user.lastName} can now sign in.`
            : `Roles for ${user.firstName} ${user.lastName} were saved.`,
      });
      onClose();
    },
  });

  const reject = useMutation({
    mutationFn: () => api.rejectUser(user.id, reason.trim()),
    onSuccess: () => {
      refreshCaches();
      pushToast({
        tone: 'success',
        title: 'Registration rejected',
        message: `${user.firstName} ${user.lastName}'s request was closed.`,
      });
      onClose();
    },
  });

  const approveError = approve.error instanceof ApiError ? approve.error : null;
  const rejectError = reject.error instanceof ApiError ? reject.error : null;

  function toggleRole(role: RoleName, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(role);
      else next.delete(role);
      return next;
    });
    setSelectedError(undefined);
    if (approve.isError) approve.reset();
  }

  function handleApprove() {
    if (selected.size === 0) {
      setSelectedError('Choose at least one role before approving this account.');
      return;
    }
    setSelectedError(undefined);
    approve.mutate();
  }

  function handleReject() {
    if (reason.trim().length < 5) {
      setReasonError('Give a brief reason (at least 5 characters).');
      return;
    }
    setReasonError(undefined);
    reject.mutate();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === 'review' ? 'Review access request' : 'Manage access'}
      description={
        mode === 'review'
          ? 'Verify the applicant and assign the least access they need.'
          : 'Update the roles carried by this account.'
      }
    >
      <div className="review-identity">
        <Avatar firstName={user.firstName} lastName={user.lastName} size="lg" />
        <div className="review-identity-copy">
          <strong>
            {user.firstName} {user.lastName}
          </strong>
          <span>{user.email}</span>
          <span className="review-meta">
            {user.department.name} · {user.phone || 'No phone provided'}
          </span>
        </div>
        <span className="review-date">Registered {formatDate(user.createdAt)}</span>
      </div>

      {mode === 'review' && (
        <div className="dialog-tabs" role="tablist" aria-label="Review action">
          <button
            type="button"
            role="tab"
            id={`${panelId}-approve-tab`}
            aria-selected={tab === 'approve'}
            aria-controls={`${panelId}-approve-panel`}
            className={`dialog-tab ${tab === 'approve' ? 'is-active' : ''}`}
            onClick={() => setTab('approve')}
          >
            <CheckCircle size={17} /> Approve
          </button>
          <button
            type="button"
            role="tab"
            id={`${panelId}-reject-tab`}
            aria-selected={tab === 'reject'}
            aria-controls={`${panelId}-reject-panel`}
            className={`dialog-tab ${tab === 'reject' ? 'is-active' : ''}`}
            onClick={() => setTab('reject')}
          >
            <WarningCircle size={17} /> Reject
          </button>
        </div>
      )}

      {tab === 'approve' ? (
        <div
          role={mode === 'review' ? 'tabpanel' : undefined}
          id={mode === 'review' ? `${panelId}-approve-panel` : undefined}
          aria-labelledby={mode === 'review' ? `${panelId}-approve-tab` : undefined}
        >
          <div className="form-section-head">
            <h3>Assign roles</h3>
            <p>
              Department-scoped roles apply to {user.department.code}. College-wide roles apply
              across the institution.
            </p>
          </div>

          {isSelf && (
            <Alert tone="info">
              You cannot remove your own administrator role.
            </Alert>
          )}

          {approveError && !approveError.fieldErrors && (
            <Alert tone="danger" title="Could not save access">
              {approveError.message}
            </Alert>
          )}

          {selectedError && (
            <Alert tone="danger" title="Roles required">
              {selectedError}
            </Alert>
          )}

          <div className="role-options">
            {ROLE_NAMES.map((role) => (
              <RoleOption
                key={role}
                role={role}
                checked={selected.has(role)}
                departmentCode={user.department.code}
                disabled={isSelf && role === 'ADMINISTRATOR'}
                onChange={(checked) => toggleRole(role, checked)}
              />
            ))}
          </div>

          <div className="review-assurance">
            <ShieldCheck size={17} aria-hidden="true" />
            <span>The decision and role assignment are recorded in the audit trail.</span>
          </div>

          <div className="dialog-actions">
            <Button variant="ghost" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button onClick={handleApprove} loading={approve.isPending} type="button">
              {mode === 'review' ? 'Approve account' : 'Save roles'}
              {!approve.isPending && <ArrowRight size={16} />}
            </Button>
          </div>
        </div>
      ) : (
        <div
          role="tabpanel"
          id={`${panelId}-reject-panel`}
          aria-labelledby={`${panelId}-reject-tab`}
        >
          <div className="form-section-head">
            <h3>Reject this registration</h3>
            <p>
              The applicant will remain unable to sign in. Record why the request cannot be
              approved for the audit trail.
            </p>
          </div>

          {rejectError && (
            <Alert tone="danger" title="Could not reject request">
              {rejectError.message}
            </Alert>
          )}

          <TextareaField
            name="rejectionReason"
            label="Reason for rejection"
            placeholder="For example: college email could not be verified."
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setReasonError(undefined);
              if (reject.isError) reject.reset();
            }}
            error={reasonError ?? (rejectError?.fieldErrors ? rejectError.message : undefined)}
            hint="Kept in the audit log and visible to administrators."
            rows={4}
            maxLength={500}
            required
          />

          <div className="dialog-actions">
            <Button variant="ghost" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button variant="danger" onClick={handleReject} loading={reject.isPending} type="button">
              Reject registration
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
