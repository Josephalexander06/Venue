import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { SelectField } from './ui';

export interface FacultySelection {
  departmentId: string;
  facultyId: string;
}

interface FacultyCoordinatorFieldProps {
  label: string;
  name: string;
  value: FacultySelection;
  onChange: (selection: FacultySelection) => void;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
}

export function FacultyCoordinatorField({
  label, name, value, onChange, required, disabled, hint,
}: FacultyCoordinatorFieldProps) {
  const { departmentId, facultyId } = value;
  const departments = useQuery({ queryKey: ['departments'], queryFn: api.departments, staleTime: 60_000 });
  const faculty = useQuery({
    queryKey: ['department-faculty', departmentId],
    queryFn: () => api.departmentFaculty(departmentId),
    enabled: Boolean(departmentId),
    staleTime: 60_000,
  });
  const people = faculty.data?.faculty ?? [];

  return <>
    <SelectField label="Faculty department" name={`${name}-department`} value={departmentId}
      required={required} disabled={disabled || departments.isPending}
      error={departments.isError ? 'Could not load departments.' : undefined}
      onChange={(event) => onChange({ departmentId: event.target.value, facultyId: '' })}>
      <option value="">{departments.isPending ? 'Loading departments…' : 'Select a department'}</option>
      {departments.data?.departments.map((department) => (
        <option key={department.id} value={department.id}>{department.name}</option>
      ))}
    </SelectField>
    <SelectField label={label} name={name} value={facultyId} required={required}
      disabled={disabled || !departmentId || faculty.isPending} hint={hint}
      error={faculty.isError ? 'Could not load faculty.' : undefined}
      onChange={(event) => onChange({ departmentId, facultyId: event.target.value })}>
      <option value="">{!departmentId ? 'Select a department first' : faculty.isPending ? 'Loading faculty…'
        : people.length ? 'Select a faculty member' : 'No faculty available'}</option>
      {people.map(({ userId, firstName, lastName }) => (
        <option key={userId} value={userId}>{firstName} {lastName}</option>
      ))}
    </SelectField>
    {(departments.isError || faculty.isError) && <button type="button" className="inline-link"
      onClick={() => void (departments.isError ? departments.refetch() : faculty.refetch())}>Try again</button>}
  </>;
}
