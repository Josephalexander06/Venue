import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type UserView } from '../lib/api';
import { Alert, Button, Dialog, TextareaField, useToast } from './ui';

export function SuspendUserDialog({
  user,
  onClose,
}: {
  user: UserView;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const suspend = useMutation({
    mutationFn: () => api.suspendUser(user.id, reason.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      pushToast({
        tone: 'success',
        title: 'Account suspended',
        message: `${user.firstName} ${user.lastName} can no longer sign in.`,
      });
      onClose();
    },
  });

  const error = suspend.error instanceof ApiError ? suspend.error : null;

  function submit() {
    if (reason.trim().length < 5) {
      setReasonError('Give a brief reason (at least 5 characters).');
      return;
    }
    setReasonError(undefined);
    suspend.mutate();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Suspend account"
      description="The user is signed out immediately and cannot sign in until an administrator reactivates the account."
    >
      <div className="form-section-head">
        <h3>
          {user.firstName} {user.lastName}
        </h3>
        <p>{user.email}</p>
      </div>

      {error && !error.fieldErrors && (
        <Alert tone="danger" title="Could not suspend account">
          {error.message}
        </Alert>
      )}

      <TextareaField
        name="suspensionReason"
        label="Reason for suspension"
        placeholder="For example: account activity is under review."
        value={reason}
        onChange={(event) => {
          setReason(event.target.value);
          setReasonError(undefined);
          if (suspend.isError) suspend.reset();
        }}
        error={reasonError ?? (error?.fieldErrors ? error.message : undefined)}
        hint="Recorded in the audit log and sent to the account holder."
        rows={4}
        maxLength={500}
        required
      />

      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose} type="button">
          Cancel
        </Button>
        <Button variant="danger" onClick={submit} loading={suspend.isPending} type="button">
          Suspend account
        </Button>
      </div>
    </Dialog>
  );
}
