import type { BookingPeople } from '@venue/shared';

const REQUESTER_LABEL = {
  STUDENT: 'Student requester',
  FACULTY: 'Faculty requester',
  OTHER: 'Requester',
} as const;

export function BookingPeopleSummary({ people }: { people: BookingPeople | null }) {
  if (!people?.requester) return null;
  const { requester, facultyCoordinator } = people;

  return <dl className="booking-people" aria-label="Booking participants">
    <div>
      <dt>{REQUESTER_LABEL[requester.kind]}</dt>
      <dd><strong>{requester.name}</strong><span>{requester.department.name}</span></dd>
    </div>
    {requester.kind === 'STUDENT' && <div>
      <dt>Faculty coordinator</dt>
      <dd>{facultyCoordinator
        ? <><strong>{facultyCoordinator.name}</strong><span>{facultyCoordinator.department.name}</span></>
        : <span>Unassigned</span>}</dd>
    </div>}
  </dl>;
}
