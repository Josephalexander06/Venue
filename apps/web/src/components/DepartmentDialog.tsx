import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DepartmentWithStats } from '../lib/api';
import { api, ApiError, fieldError } from '../lib/api';
import {
  Alert,
  Button,
  Dialog,
  TextField,
  useToast,
} from './ui';

interface DepartmentDialogProps {
  department?: DepartmentWithStats;
  onClose: () => void;
}

export function DepartmentDialog({ department, onClose }: DepartmentDialogProps) {
  const editing = Boolean(department);
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [code, setCode] = useState(department?.code ?? '');
  const [name, setName] = useState(department?.name ?? '');

  const save = useMutation({
    mutationFn: () => {
      const input = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
      };
      return department
        ? api.updateDepartment(department.id, input)
        : api.createDepartment(input);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-departments'] }),
        queryClient.invalidateQueries({ queryKey: ['departments'] }),
      ]);
      pushToast({
        tone: 'success',
        title: editing ? 'Department updated' : 'Department created',
        message: `${name.trim()} (${code.trim().toUpperCase()}) is ready.`,
      });
      onClose();
    },
  });

  const canSave = code.trim().length >= 2 && name.trim().length >= 3;

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? `Edit ${department?.name}` : 'New department'}
      description="Departments establish academic boundaries for members, venues, and preliminary approvals."
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="md"
            loading={save.isPending}
            disabled={!canSave}
            onClick={() => save.mutate()}
          >
            {editing ? 'Save changes' : 'Create department'}
          </Button>
        </>
      }
    >
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save.mutate();
        }}
      >
        {save.isError && (
          <Alert tone="danger" title="Could not save department">
            {save.error instanceof ApiError ? save.error.message : 'Please try again.'}
          </Alert>
        )}

        <div className="form-row">
          <TextField
            label="Department code"
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. CS, ME, ECE"
            maxLength={10}
            error={fieldError(save.error, 'code')}
            required
          />
        </div>

        <TextField
          label="Department name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Computer Science & Engineering"
          maxLength={100}
          error={fieldError(save.error, 'name')}
          required
        />
      </form>
    </Dialog>
  );
}
