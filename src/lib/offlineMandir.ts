import { useState } from 'react';

/** Shared by the Offline Mandirs list and detail pages (migration 093). */

export const LICENCE_STATE: Record<string, { label: string; tone: string }> = {
  none: { label: 'No licence yet', tone: 'blue' },
  active: { label: 'Active', tone: 'green' },
  expiring: { label: 'Ends soon', tone: 'in_progress' },
  grace: { label: 'Expired — grace', tone: 'red' },
  expired: { label: 'Expired', tone: 'red' },
};

export const rupees = (paise: string | number | null | undefined) =>
  `₹${(Number(paise ?? 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export function useForm(initial: Record<string, string>) {
  const [form, setForm] = useState<Record<string, string>>(initial);
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return { form, set, setForm };
}

/** Empty strings become absent, so optional fields stay null. */
export const clean = (form: Record<string, string>) =>
  Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === 'string' && v.trim() === '' ? undefined : v]));

