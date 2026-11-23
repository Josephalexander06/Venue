import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { VENUE_STATUSES, VENUE_STATUS_LABELS, type VenueStatus } from '@venue/shared';
import type { Venue } from '../lib/api';
import { api, ApiError, fieldError } from '../lib/api';
import {
  Alert,
  Button,
  Dialog,
  SelectField,
  TextField,
  useToast,
} from './ui';

interface VenueDialogProps {
  venue?: Venue;
  departments: { id: string; code: string; name: string }[];
  onClose: () => void;
}

export function VenueDialog({ venue, departments, onClose }: VenueDialogProps) {
  const editing = Boolean(venue);
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [code, setCode] = useState(venue?.code ?? '');
  const [name, setName] = useState(venue?.name ?? '');
  const [building, setBuilding] = useState(venue?.building ?? '');
  const [floor, setFloor] = useState(String(venue?.floor ?? 1));
  const [capacity, setCapacity] = useState(String(venue?.capacity ?? 60));
  const [departmentId, setDepartmentId] = useState(venue?.department?.id ?? '');
  const [workflowId, setWorkflowId] = useState(venue?.workflow?.id ?? '');
  const [facilities, setFacilities] = useState(venue?.facilities.join(', ') ?? '');
  const [setupBufferMins, setSetupBufferMins] = useState(String(venue?.setupBufferMins ?? 30));
  const [teardownBufferMins, setTeardownBufferMins] = useState(String(venue?.teardownBufferMins ?? 30));
  const [status, setStatus] = useState<VenueStatus>(venue?.status ?? 'ACTIVE');

  const workflowsQuery = useQuery({
    queryKey: ['workflows'],
    queryFn: api.workflows,
  });

  const save = useMutation({
    mutationFn: () => {
      const input = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        building: building.trim(),
        floor: Number(floor),
        capacity: Number(capacity),
        facilities: facilities
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        setupBufferMins: Number(setupBufferMins),
        teardownBufferMins: Number(teardownBufferMins),
        isActive: status === 'ACTIVE',
        status,
        departmentId: departmentId || null,
        workflowId: workflowId || undefined,
      };
      return venue ? api.updateVenue(venue.id, input) : api.createVenue(input);
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'venues'] }),
        queryClient.invalidateQueries({ queryKey: ['venues'] }),
        queryClient.invalidateQueries({ queryKey: ['venue'] }),
        queryClient.invalidateQueries({ queryKey: ['venue-calendar'] }),
        queryClient.invalidateQueries({ queryKey: ['venue-schedule'] }),
      ]);
      pushToast({
        tone: 'success',
        title: editing ? 'Venue updated' : 'Venue created',
        message: `${result.venue.name} is ready.`,
      });
      onClose();
    },
  });

  const errorFor = (field: string) =>
    save.error instanceof ApiError ? fieldError(save.error, field) : undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? 'Edit venue' : 'Add a venue'}
      description="Capacity, facilities and buffers are used for every booking request."
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="md"
            loading={save.isPending}
            disabled={!code.trim() || !name.trim() || !building.trim()}
            onClick={() => save.mutate()}
          >
            {editing ? 'Save venue' : 'Create venue'}
          </Button>
        </>
      }
    >
      <div className="venue-form">
        <div className="form-row">
          <TextField
            label="Venue code"
            name="venue-code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="SEM-A"
            maxLength={30}
            required
            error={errorFor('code')}
          />
          <TextField
            label="Venue name"
            name="venue-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Seminar Hall A"
            maxLength={120}
            required
            error={errorFor('name')}
          />
        </div>

        <div className="form-row">
          <TextField
            label="Building"
            name="venue-building"
            value={building}
            onChange={(event) => setBuilding(event.target.value)}
            placeholder="Academic Block A"
            maxLength={100}
            required
            error={errorFor('building')}
          />
          <TextField
            label="Floor"
            name="venue-floor"
            type="number"
            value={floor}
            onChange={(event) => setFloor(event.target.value)}
            min={-5}
            max={100}
            required
            error={errorFor('floor')}
          />
        </div>

        <div className="form-row">
          <TextField
            label="Capacity"
            name="venue-capacity"
            type="number"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            min={1}
            required
            error={errorFor('capacity')}
          />
          <SelectField
            label="Owning department"
            name="venue-department"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            hint="Leave blank for a college-common venue."
          >
            <option value="">College common</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </SelectField>
        </div>

        <SelectField
          label="Approval workflow"
          name="venue-workflow"
          value={workflowId}
          onChange={(event) => setWorkflowId(event.target.value)}
          hint="Sequential approval chain required for booking requests. Defaults to the college default."
        >
          <option value="">Default approval workflow</option>
          {workflowsQuery.data?.workflows.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.name} {workflow.isDefault ? '(Default)' : ''} (
              {workflow.steps.map((step) => step.requiredRole).join(' → ')})
            </option>
          ))}
        </SelectField>

        <TextField
          label="Facilities"
          name="venue-facilities"
          value={facilities}
          onChange={(event) => setFacilities(event.target.value)}
          placeholder="Projector, Stage, Air conditioning"
          hint="Separate facilities with commas."
          error={errorFor('facilities')}
        />

        <div className="form-row">
          <TextField
            label="Setup buffer (minutes)"
            name="venue-setup"
            type="number"
            value={setupBufferMins}
            onChange={(event) => setSetupBufferMins(event.target.value)}
            min={0}
            max={240}
            required
            error={errorFor('setupBufferMins')}
          />
          <TextField
            label="Cleanup buffer (minutes)"
            name="venue-teardown"
            type="number"
            value={teardownBufferMins}
            onChange={(event) => setTeardownBufferMins(event.target.value)}
            min={0}
            max={240}
            required
            error={errorFor('teardownBufferMins')}
          />
        </div>

        <SelectField label="Status" name="venue-status" value={status}
          onChange={(event) => setStatus(event.target.value as VenueStatus)}>
          {VENUE_STATUSES.map((item) => <option key={item} value={item}>{VENUE_STATUS_LABELS[item]}</option>)}
        </SelectField>

        {save.isError && (
          <Alert tone="danger" title="Could not save venue">
            {save.error instanceof ApiError ? save.error.message : 'Check the details and try again.'}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
