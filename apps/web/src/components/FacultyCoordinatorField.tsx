import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { SelectField, TextField } from './ui';

interface FacultyCoordinatorFieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
}

export function FacultyCoordinatorField({
  label, name, value, onChange, required, disabled, hint,
}: FacultyCoordinatorFieldProps) {
  const [search, setSearch] = useState('');
  const faculty = useQuery({
    queryKey: ['faculty-candidates'],
    queryFn: api.facultyCandidates,
    staleTime: 60_000,
  });
  const terms = search.toLowerCase().trim().split(/\s+/);
  const choices = (faculty.data?.candidates ?? []).filter(({ userId, firstName, lastName, departmentName }) =>
    userId === value || terms.every((term) =>
      `${firstName} ${lastName} ${departmentName}`.toLowerCase().includes(term),
    ),
  );

  return (
    <>
      <TextField label="Search faculty" name={`${name}-search`} type="search"
        placeholder="Name or department" value={search} disabled={disabled}
        onChange={(event) => setSearch(event.target.value)} />
      <SelectField label={label} name={name} value={value}
        onChange={(event) => onChange(event.target.value)} required={required}
        disabled={disabled || faculty.isPending} hint={hint}
        error={faculty.isError ? 'Could not load faculty.' : undefined}>
        <option value="">
          {faculty.isPending ? 'Loading faculty…' :
            choices.length ? 'Select a faculty member…' : 'No matching faculty'}
        </option>
        {choices.map(({ userId, firstName, lastName, departmentName }) => (
          <option key={userId} value={userId}>{firstName} {lastName} ({departmentName})</option>
        ))}
      </SelectField>
      {faculty.isError && (
        <button type="button" className="inline-link" onClick={() => void faculty.refetch()}>Try again</button>
      )}
    </>
  );
}
