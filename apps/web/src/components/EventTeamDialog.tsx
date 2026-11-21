import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChalkboardTeacher,
  Plus,
  Trash,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react';
import type { EventSummary } from '../lib/api';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../auth';
import {
  Alert,
  Avatar,
  Button,
  Dialog,
  SelectField,
  Skeleton,
  TextField,
  useToast,
} from './ui';

interface EventTeamDialogProps {
  event: EventSummary;
  onClose: () => void;
}

export function EventTeamDialog({ event, onClose }: EventTeamDialogProps) {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const [selectedCoordId, setSelectedCoordId] = useState('');
  const [organizerEmail, setOrganizerEmail] = useState('');
  const [organizerSearchError, setOrganizerSearchError] = useState<string | null>(null);

  // Fetch event team
  const teamQuery = useQuery({
    queryKey: ['event-team', event.id],
    queryFn: () => api.eventTeam(event.id),
  });

  // Fetch department faculty for coordinator assignment
  const facultyQuery = useQuery({
    queryKey: ['department-faculty', event.department.id],
    queryFn: () => api.departmentFaculty(event.department.id),
    staleTime: 60_000,
  });

  const team = teamQuery.data?.team;
  const facultyList = facultyQuery.data?.faculty ?? [];

  // Coordinator mutation
  const setCoordMutation = useMutation({
    mutationFn: (coordId: string) => api.setEventCoordinator(event.id, coordId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['event-team', event.id] }),
        queryClient.invalidateQueries({ queryKey: ['my-events'] }),
        queryClient.invalidateQueries({ queryKey: ['event', event.id] }),
      ]);
      pushToast({
        tone: 'success',
        title: 'Faculty coordinator assigned',
        message: 'Student organizers can now submit venue requests for this event.',
      });
      setSelectedCoordId('');
    },
  });

  // Add organizer mutation
  const addOrgMutation = useMutation({
    mutationFn: async (userId: string) => api.addEventOrganizer(event.id, userId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['event-team', event.id] }),
        queryClient.invalidateQueries({ queryKey: ['my-events'] }),
      ]);
      pushToast({
        tone: 'success',
        title: 'Organizer added',
        message: 'The co-organizer can now request venues and manage this event.',
      });
      setOrganizerEmail('');
      setOrganizerSearchError(null);
    },
  });

  // Remove organizer mutation
  const removeOrgMutation = useMutation({
    mutationFn: (userId: string) => api.removeEventOrganizer(event.id, userId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['event-team', event.id] }),
        queryClient.invalidateQueries({ queryKey: ['my-events'] }),
      ]);
      pushToast({
        tone: 'info',
        title: 'Organizer removed',
        message: 'Organizer privileges revoked for this event.',
      });
    },
  });

  // Find user by email to add as organizer
  async function handleAddOrganizer(e: React.FormEvent) {
    e.preventDefault();
    setOrganizerSearchError(null);
    const email = organizerEmail.trim().toLowerCase();
    if (!email) return;

    try {
      const { candidates } = await api.organizerCandidates(event.id, email);
      const matched = candidates.find((candidate) => candidate.email.toLowerCase() === email);
      if (!matched) {
        setOrganizerSearchError('No active user found with this email address.');
        return;
      }
      if (team?.creator.userId === matched.userId) {
        setOrganizerSearchError('The event creator is already the primary organizer.');
        return;
      }
      if (team?.organizers.some((org) => org.userId === matched.userId)) {
        setOrganizerSearchError('This user is already an organizer for this event.');
        return;
      }
      await addOrgMutation.mutateAsync(matched.userId);
    } catch (err) {
      if (err instanceof ApiError) {
        setOrganizerSearchError(err.message);
      } else {
        setOrganizerSearchError('Failed to lookup user.');
      }
    }
  }

  const isCreatorOrAdmin =
    isAdmin ||
    team?.creator.userId === user?.id ||
    team?.facultyCoordinator?.userId === user?.id ||
    event.creatorId === user?.id;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Event team"
      description={event.title}
      footer={
        <Button variant="ghost" size="md" onClick={onClose}>
          Done
        </Button>
      }
    >
      {teamQuery.isPending ? (
        <div className="venue-table-loading" aria-hidden="true">
          <Skeleton className="skeleton-line skeleton-line-wide" />
          <Skeleton className="skeleton-block" />
        </div>
      ) : teamQuery.isError || !team ? (
        <Alert tone="danger" title="Could not load event team">
          {teamQuery.error instanceof ApiError ? teamQuery.error.message : 'Please try again.'}
        </Alert>
      ) : (
        <div className="event-team-dialog-content">
          {/* Section: Faculty Coordinator */}
          <div className="team-section">
            <div className="team-section-header">
              <ChalkboardTeacher size={20} weight="fill" className="text-primary" />
              <div>
                <h3>Faculty coordinator</h3>
                <p className="team-section-hint">
                  The coordinator endorses venue requests made by students.
                </p>
              </div>
            </div>

            {team.facultyCoordinator ? (
              <div className="team-member-card coordinator-card">
                <Avatar
                  firstName={team.facultyCoordinator.firstName}
                  lastName={team.facultyCoordinator.lastName}
                  size="md"
                />
                <div className="member-info">
                  <strong>
                    {team.facultyCoordinator.firstName} {team.facultyCoordinator.lastName}
                  </strong>
                  <span className="member-email">{team.facultyCoordinator.email}</span>
                  <span className="member-dept">
                    {team.facultyCoordinator.department.name} ({team.facultyCoordinator.department.code})
                  </span>
                </div>

              </div>
            ) : (
              <div className="team-alert-missing">
                <WarningCircle size={20} className="text-amber" />
                <div className="alert-copy">
                  <strong>No coordinator assigned</strong>
                  <p>Students cannot submit venue requests until an active faculty member from {event.department.code} is assigned.</p>
                </div>
              </div>
            )}

            {isCreatorOrAdmin && (
              <div className="coordinator-assign-form">
                <SelectField
                  label={team.facultyCoordinator ? 'Change coordinator' : 'Assign coordinator'}
                  name="faculty-coordinator"
                  value={selectedCoordId || (team.facultyCoordinator?.userId ?? '')}
                  onChange={(e) => setSelectedCoordId(e.target.value)}
                  disabled={setCoordMutation.isPending || facultyQuery.isPending}
                >
                  <option value="">Select a faculty member from {event.department.code}…</option>
                  {facultyList.map((f) => (
                    <option key={f.userId} value={f.userId}>
                      {f.firstName} {f.lastName} ({f.email})
                    </option>
                  ))}
                </SelectField>
                {selectedCoordId && selectedCoordId !== team.facultyCoordinator?.userId && (
                  <Button
                    size="sm"
                    loading={setCoordMutation.isPending}
                    onClick={() => setCoordMutation.mutate(selectedCoordId)}
                  >
                    Confirm assignment
                  </Button>
                )}
              </div>
            )}
            {setCoordMutation.isError && (
              <Alert tone="danger" title="Could not assign coordinator">
                {setCoordMutation.error instanceof ApiError
                  ? setCoordMutation.error.message
                  : 'Please try again.'}
              </Alert>
            )}
          </div>

          {/* Section: Event Organizers */}
          <div className="team-section">
            <div className="team-section-header">
              <UsersThree size={20} weight="fill" className="text-primary" />
              <div>
                <h3>Organizers</h3>
                <p className="team-section-hint">
                  Organizers can submit venue requests for this event.
                </p>
              </div>
            </div>

            {/* Primary Creator */}
            <div className="team-member-card">
              <Avatar
                firstName={team.creator.firstName}
                lastName={team.creator.lastName}
                size="md"
              />
              <div className="member-info">
                <strong>
                  {team.creator.firstName} {team.creator.lastName}
                </strong>
                <span className="member-email">{team.creator.email}</span>
                <span className="member-dept">{team.creator.department.name}</span>
              </div>
              <span className="member-role-tag">Creator</span>
            </div>

            {/* Additional Organizers */}
            {team.organizers.map((org) => (
              <div key={org.userId} className="team-member-card">
                <Avatar firstName={org.firstName} lastName={org.lastName} size="md" />
                <div className="member-info">
                  <strong>
                    {org.firstName} {org.lastName}
                  </strong>
                  <span className="member-email">{org.email}</span>
                  <span className="member-dept">{org.department.name}</span>
                </div>
                <div className="member-actions">
                  <span className="member-role-tag">Organizer</span>
                  {isCreatorOrAdmin && (
                    <button
                      type="button"
                      className="btn-icon-danger"
                      title="Remove organizer"
                      aria-label={`Remove ${org.firstName} ${org.lastName}`}
                      disabled={removeOrgMutation.isPending}
                      onClick={() => removeOrgMutation.mutate(org.userId)}
                    >
                      <Trash size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Add Organizer Form */}
            {isCreatorOrAdmin && (
              <form className="add-organizer-row" onSubmit={handleAddOrganizer}>
                <TextField
                  label="Organizer’s college email"
                  name="organizer-email"
                  type="email"
                  value={organizerEmail}
                  onChange={(e) => setOrganizerEmail(e.target.value)}
                  placeholder="student@college.edu"
                />
                <Button
                  type="submit"
                  size="sm"
                  loading={addOrgMutation.isPending}
                  disabled={!organizerEmail.trim()}
                >
                  <Plus size={15} /> Add organizer
                </Button>
              </form>
            )}

            {organizerSearchError && (
              <Alert tone="danger" title="Cannot add organizer">
                {organizerSearchError}
              </Alert>
            )}
            {addOrgMutation.isError && (
              <Alert tone="danger" title="Could not add organizer">
                {addOrgMutation.error instanceof ApiError
                  ? addOrgMutation.error.message
                  : 'Please try again.'}
              </Alert>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
