import { useEffect, useState } from 'react';
import { api } from '../api/client';

/** India state dropdown backed by the bundled geo lookup (/admin/geo/states). */
export function StateSelect({ value, onChange, name = 'state' }: {
  value: string; onChange: (state: string) => void; name?: string;
}) {
  const [states, setStates] = useState<string[]>([]);
  useEffect(() => { api<string[]>('/admin/geo/states').then((r) => setStates(r.data)).catch(() => setStates([])); }, []);
  const opts = value && !states.includes(value) ? [value, ...states] : states;
  return (
    <select name={name} value={value} autoComplete="off" onChange={(e) => onChange(e.target.value)}>
      <option value="">Select state…</option>
      {opts.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

/** City dropdown for the chosen state (/admin/geo/states/:state/cities). */
export function CitySelect({ state, value, onChange, name = 'city' }: {
  state: string; value: string; onChange: (city: string) => void; name?: string;
}) {
  const [cities, setCities] = useState<string[]>([]);
  useEffect(() => {
    if (!state) { setCities([]); return; }
    api<string[]>(`/admin/geo/states/${encodeURIComponent(state)}/cities`)
      .then((r) => setCities(r.data))
      .catch(() => setCities([]));
  }, [state]);
  const opts = value && !cities.includes(value) ? [value, ...cities] : cities;
  return (
    <select name={name} value={value} autoComplete="off" disabled={!state} onChange={(e) => onChange(e.target.value)}>
      <option value="">{state ? 'Select city…' : 'Pick a state first'}</option>
      {opts.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}
