import { LICENCE_STATE } from '../lib/offlineMandir';

/** A licence's state as a coloured badge, with days left while it runs. */
export function LicenceBadge({ state, days }: { state: string; days: number | null }) {
  const s = LICENCE_STATE[state] ?? { label: state, tone: '' };
  const extra = state === 'active' || state === 'expiring' ? ` · ${days} days left` : '';
  return <span className={`badge ${s.tone}`}>{s.label}{extra}</span>;
}


/** The onboarding / edit fields of an offline mandir. */
export function MandirFields({ form, set }: { form: Record<string, string>; set: (k: string) => (e: { target: { value: string } }) => void }) {
  return (
    <>
      <label className="field"><span>Mandir name * (exactly as it should print — it goes into the licence)</span>
        <input value={form.name ?? ''} onChange={set('name')} required placeholder="Shri Parshwanath Digambar Jain Mandir" />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>Contact person</span><input value={form.contact_name ?? ''} onChange={set('contact_name')} /></label>
        <label className="field"><span>Mobile (+91…)</span><input value={form.mobile ?? ''} onChange={set('mobile')} placeholder="+919876543210" /></label>
        <label className="field"><span>Email</span><input type="email" value={form.email ?? ''} onChange={set('email')} /></label>
        <label className="field"><span>Sampradaya</span>
          <select value={form.sect ?? ''} onChange={set('sect')}>
            <option value="">—</option><option value="digambar">Digambar</option><option value="shwetambar">Shwetambar</option><option value="other">Other</option>
          </select>
        </label>
      </div>
      <label className="field"><span>Address</span><input value={form.address ?? ''} onChange={set('address')} /></label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: 10 }}>
        <label className="field"><span>City</span><input value={form.city ?? ''} onChange={set('city')} /></label>
        <label className="field"><span>State</span><input value={form.state ?? ''} onChange={set('state')} /></label>
        <label className="field"><span>PIN code</span><input value={form.pincode ?? ''} onChange={set('pincode')} /></label>
      </div>
      <label className="field"><span>Notes (internal)</span><textarea rows={2} value={form.notes ?? ''} onChange={set('notes')} /></label>
    </>
  );
}

