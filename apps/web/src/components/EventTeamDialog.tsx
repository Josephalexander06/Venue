import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash } from '@phosphor-icons/react';
import { DEFAULT_BOOKING_TITLE } from '@venue/shared';
import { useAuth } from '../auth';
import { api, type EventSummary, type EventTeamMember, type EventTeamView } from '../lib/api';
import { FacultyCoordinatorField, type FacultySelection } from './FacultyCoordinatorField';
import { Alert, Avatar, Button, Dialog, Skeleton, TextField, useToast } from './ui';

type TeamAction = 'coordinator' | 'organizer';
type TeamChange =
  | { action: 'coordinator'; userId: string }
  | { action: 'remove'; userId: string }
  | { action: 'organizer'; email: string };

function TeamPerson({ person, badge, onRemove }: {
  person: EventTeamMember;
  badge?: string;
  onRemove?: () => void;
}) {
  return <div className="team-person">
    <Avatar firstName={person.firstName} lastName={person.lastName} size="md" />
    <div className="team-person-info">
      <strong>{person.firstName} {person.lastName}</strong>
      <span>{person.email}</span>
    </div>
    {badge && <span className="team-person-role">{badge}</span>}
    {onRemove && <Button variant="danger-ghost" size="sm" className="team-remove"
      aria-label={`Remove ${person.firstName} ${person.lastName}`} onClick={onRemove}>
      <Trash size={18} aria-hidden="true" />
    </Button>}
  </div>;
}

export function EventTeamDialog({ event, onClose }: { event: EventSummary; onClose: () => void }) {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [editor, setEditor] = useState<TeamAction | null>(null);
  const [coordinator, setCoordinator] = useState<FacultySelection>({ departmentId: '', facultyId: '' });
  const coordinatorId = coordinator.facultyId;
  const [email, setEmail] = useState('');
  const [removing, setRemoving] = useState<EventTeamMember>();
  const teamKey = ['event-team', event.id];
  const teamQuery = useQuery({ queryKey: teamKey, queryFn: () => api.eventTeam(event.id) });
  const team = teamQuery.data?.team;
  const canManage = isAdmin || (user && (team?.creator.userId === user.id || team?.facultyCoordinator?.userId === user.id));

  const change = useMutation({
    mutationFn: async (input: TeamChange): Promise<{ team: EventTeamView }> => {
      if (input.action === 'coordinator') return api.setEventCoordinator(event.id, input.userId);
      if (input.action === 'remove') return api.removeEventOrganizer(event.id, input.userId);
      const { candidates } = await api.organizerCandidates(event.id, input.email);
      const match = candidates.find((candidate) => candidate.email.toLowerCase() === input.email);
      if (!match) throw new Error('No active college account found for this email.');
      return api.addEventOrganizer(event.id, match.userId);
    },
    onSuccess: (result, input) => {
      queryClient.setQueryData(teamKey, result);
      for (const queryKey of [['my-events'], ['event', event.id], ['request'], ['approvals']]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      const title = input.action === 'coordinator' ? 'Coordinator updated'
        : input.action === 'organizer' ? 'Organizer added' : 'Organizer removed';
      pushToast({ tone: 'success', title });
      resetEditor();
    },
  });

  function resetEditor() {
    setEditor(null);
    setRemoving(undefined);
    setCoordinator({ departmentId: '', facultyId: '' });
    setEmail('');
    change.reset();
  }

  function chooseEditor(action: TeamAction) {
    resetEditor();
    setEditor(action);
  }

  function addOrganizer(form: FormEvent<HTMLFormElement>) {
    form.preventDefault();
    const address = email.trim().toLowerCase();
    const alreadyMember = team && [team.creator, ...team.organizers].some((person) => person.email.toLowerCase() === address);
    const field = form.currentTarget.elements.namedItem('organizer-email');
    if (alreadyMember && field instanceof HTMLInputElement) {
      field.setCustomValidity('This person is already an organizer.');
      field.reportValidity();
      return;
    }
    if (address && !change.isPending) change.mutate({ action: 'organizer', email: address });
  }

  return <Dialog open onClose={onClose} title="Event team" className="team-dialog"
    description={event.title === DEFAULT_BOOKING_TITLE ? undefined : event.title}>
    {teamQuery.isPending ? <div role="status" className="team-roster">
      <span className="sr-only">Loading event team</span><Skeleton className="team-skeleton" /><Skeleton className="team-skeleton" />
    </div> : teamQuery.isError || !team ? <Alert tone="danger" title="Could not load the event team">
      <button type="button" className="inline-link" onClick={() => void teamQuery.refetch()}>Try again</button>
    </Alert> : <div className="team-roster">
      <section className="team-group" aria-labelledby="team-organizers-heading">
        <div className="team-group-head">
          <h3 id="team-organizers-heading">Organizers</h3>
          {canManage && editor !== 'organizer' && <Button variant="secondary" size="sm" disabled={change.isPending}
            onClick={() => chooseEditor('organizer')}><Plus size={16} aria-hidden="true" /> Add organizer</Button>}
        </div>
        <TeamPerson person={team.creator} badge="Owner" />
        {team.organizers.map((organizer) => <div key={organizer.userId}>
          <TeamPerson person={organizer} onRemove={canManage && !change.isPending && removing?.userId !== organizer.userId ? () => {
            resetEditor();
            setRemoving(organizer);
          } : undefined} />
          {removing?.userId === organizer.userId && <div className="team-editor team-remove-confirm">
            <p>Remove {organizer.firstName} {organizer.lastName} from the event team?</p>
            <div className="team-editor-actions">
              <Button variant="secondary" onClick={resetEditor} disabled={change.isPending}>Cancel</Button>
              <Button variant="danger" onClick={() => change.mutate({ action: 'remove', userId: organizer.userId })}
                loading={change.isPending}>Remove organizer</Button>
            </div>
            {change.error && <Alert tone="danger" title={change.error.message} />}
          </div>}
        </div>)}
        {editor === 'organizer' && <form className="team-editor" onSubmit={addOrganizer}>
          <TextField label="College email" name="organizer-email" type="email" required value={email}
            onChange={(event) => {
              event.target.setCustomValidity('');
              setEmail(event.target.value);
              if (change.isError) change.reset();
            }} placeholder="name@college.edu" />
          {change.error && <Alert tone="danger" title={change.error.message} />}
          <div className="team-editor-actions">
            <Button variant="secondary" disabled={change.isPending} onClick={resetEditor}>Cancel</Button>
            <Button type="submit" loading={change.isPending} disabled={!email.trim()}>Add organizer</Button>
          </div>
        </form>}
      </section>
      <section className="team-group" aria-labelledby="team-coordinator-heading">
        <div className="team-group-head">
          <h3 id="team-coordinator-heading">Faculty coordinator</h3>
          {canManage && editor !== 'coordinator' && <Button variant="secondary" size="sm" disabled={change.isPending}
            onClick={() => chooseEditor('coordinator')}>{team.facultyCoordinator ? 'Change' : 'Assign'}</Button>}
        </div>
        {team.facultyCoordinator ? <TeamPerson person={team.facultyCoordinator} /> : <p className="team-empty">No coordinator assigned</p>}
        {editor === 'coordinator' && <form className="team-editor" onSubmit={(form) => {
          form.preventDefault();
          if (coordinatorId && !change.isPending) change.mutate({ action: 'coordinator', userId: coordinatorId });
        }}>
          <FacultyCoordinatorField label="Choose a faculty member" name="team-coordinator" required value={coordinator}
            onChange={setCoordinator} disabled={change.isPending} />
          {change.error && <Alert tone="danger" title={change.error.message} />}
          <div className="team-editor-actions">
            <Button variant="secondary" disabled={change.isPending} onClick={resetEditor}>Cancel</Button>
            <Button type="submit" loading={change.isPending}
              disabled={!coordinatorId || coordinatorId === team.facultyCoordinator?.userId}>Save coordinator</Button>
          </div>
        </form>}
      </section>
    </div>}
  </Dialog>;
}
