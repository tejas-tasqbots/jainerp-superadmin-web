import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, type ApiMeta } from '../api/client';
import type { MaharajProfile } from '../api/types';
import { ActionForm, Badge, ErrorBox, Modal, Pagination, useToast } from '../components/ui';
import { PhotoPicker } from '../components/PhotoPicker';
import { StateSelect, CitySelect } from '../components/GeoSelect';
import { LocationPicker } from '../components/LocationPicker';

export function MaharajPage() {
  const [rows, setRows] = useState<MaharajProfile[]>([]);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [verifiedFilter, setVerifiedFilter] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: '25' });
    if (q) params.set('q', q);
    if (verifiedFilter) params.set('verified', verifiedFilter);
    api<MaharajProfile[]>(`/admin/maharaj?${params}`)
      .then((r) => { setRows(r.data); setMeta(r.meta); })
      .catch(setError);
  }, [page, q, verifiedFilter]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setError(null);
    try {
      await fn();
      load();
      if (done) toast.show(done);
    } catch (e) { setError(e); }
  }

  return (
    <div>
      {toast.node}
      <h1>Sadhu-Sadhvi Directory</h1>
      <ErrorBox error={error} />
      <div className="toolbar">
        <input placeholder="Search name / samuday…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select value={verifiedFilter} onChange={(e) => { setVerifiedFilter(e.target.value); setPage(1); }}>
          <option value="">All</option>
          <option value="false">Pending verification</option>
          <option value="true">Verified</option>
        </select>
        <div className="grow" />
        <button className="btn primary" onClick={() => setShowCreate(true)}>+ Add Sadhu-Sadhvi</button>
      </div>

      <table className="data">
        <thead>
          <tr><th>Name</th><th>Type</th><th>Samuday</th><th>City / State</th><th>Followers</th><th>Verified</th><th>Registered</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td className="capitalize">{m.type}</td>
              <td>{m.samuday ?? <span className="muted">—</span>}</td>
              <td>{[m.current_city ?? m.city, m.state].filter(Boolean).join(', ') || '—'}</td>
              <td>{m.followers_count}</td>
              <td><Badge value={m.verified} /></td>
              <td>{formatDate(m.created_at)}</td>
              <td>
                <button className="btn sm" onClick={() => setManageId(m.id)}>Manage</button>{' '}
                {!m.verified ? (
                  <button className="btn sm primary" onClick={() => run(() =>
                    api(`/admin/maharaj/${m.id}/verify`, { method: 'PATCH', body: { verified: true } }),
                    `${m.name} is now verified and visible to devotees.`,
                  )}>Verify</button>
                ) : (
                  <button className="btn sm" onClick={() => run(() =>
                    api(`/admin/maharaj/${m.id}/verify`, { method: 'PATCH', body: { verified: false } }),
                    `${m.name} is no longer verified — hidden from devotees.`,
                  )}>Un-verify</button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} className="muted">No profiles found.</td></tr>}
        </tbody>
      </table>
      {meta && <Pagination page={page} total={meta.total} limit={25} onPage={setPage} />}

      {showCreate && (
        <Modal title="Add Sadhu-Sadhvi" onClose={() => setShowCreate(false)}>
          <MaharajCreateForm onDone={() => { setShowCreate(false); load(); toast.show('Profile created.'); }} />
        </Modal>
      )}
      {manageId && (
        <Modal title="Manage profile" onClose={() => setManageId(null)}>
          <MaharajManage id={manageId} onClose={() => setManageId(null)} onChanged={load}
            onToast={toast.show} />
        </Modal>
      )}
    </div>
  );
}

// Canonical ascetic ranks, mirroring maharaj-api/src/profiles/ascetic.ts.
// The stored value is the rank; the label is how it is addressed — "Maharaj Ji"
// and "Mataji" are honorifics, not types, and conflating them loses the
// distinction between a Muni and an Ailak.
//
// The Shwetambar pair (migration 040) was missing here, so opening a Sadhu or
// Sadhvi for moderation showed a rank list that did not contain that profile's
// own rank — the select fell back to the first entry, and saving would have
// re-filed a Shwetambar ascetic as a Digambar Muni.
const TYPES: { value: string; label: string }[] = [
  { value: 'muni', label: 'Maharaj Ji (Muni)' },
  { value: 'aryika', label: 'Mataji (Aryika)' },
  { value: 'kshullak', label: 'Kshullak Ji' },
  { value: 'kshullika', label: 'Kshullika Ji' },
  { value: 'ailak', label: 'Ailak Ji' },
  // Shwetambar: "Maharaj Saheb", not the Digambara "Maharaj Ji".
  { value: 'sadhu', label: 'Maharaj Saheb (Sadhu)' },
  { value: 'sadhvi', label: 'Sadhviji (Sadhvi)' },
];

const SECTS: { value: string; label: string }[] = [
  { value: '', label: '—' },
  { value: 'digambar', label: 'Digambar' },
  { value: 'shwetambar', label: 'Shwetambar' },
];

function MaharajCreateForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    name: '', type: 'muni', samuday: '', sect: '', sub_sect: '', state: '', city: '',
    diksha_year: '', guru_name: '', bio: '', rep_mobile: '', photo_base64: '', verified: false,
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <ActionForm submitLabel="Create" onDone={onDone} successMessage={null}
      onSubmit={async () => {
        await api('/admin/maharaj', {
          method: 'POST',
          body: {
            name: form.name, type: form.type, samuday: form.samuday || undefined,
            // Sampradaya is a separate field from samuday (migration 024) and
            // this form never sent it, so every sant added from the console
            // arrived sect NULL. `|| undefined` because the DTO validates
            // against the two sects — '' would 400.
            sect: form.sect || undefined, sub_sect: form.sub_sect || undefined,
            state: form.state || undefined, city: form.city || undefined,
            diksha_year: form.diksha_year ? Number(form.diksha_year) : undefined,
            guru_name: form.guru_name || undefined, bio: form.bio || undefined,
            rep_mobile: form.rep_mobile || undefined, verified: form.verified,
            // Sent with the create so a curator attaches the photograph in one
            // step, rather than saving a faceless profile and reopening it.
            photo_base64: form.photo_base64 || undefined,
          },
        });
      }}>
      <label className="field"><span>Name *</span><input value={form.name} onChange={set('name')} required /></label>
      <label className="field"><span>Type</span>
        <select value={form.type} onChange={set('type')}>{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
      </label>
      {/* samuday, sect and sub_sect are three different things (migration 024).
          This field was labelled "Samuday / Sect" and suggested "Tapagachha" —
          a gaccha, i.e. a sub_sect — which conflated all three at once. */}
      <label className="field"><span>Samuday (community)</span><input value={form.samuday} onChange={set('samuday')} placeholder="e.g. Oswal, Porwal, Agarwal" /></label>
      <label className="field"><span>Sampradaya</span>
        <select value={form.sect} onChange={(e) => setForm({ ...form, sect: e.target.value, sub_sect: '' })}>
          {SECTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      {form.sect && (
        <label className="field"><span>Panth / Gaccha</span>
          <input value={form.sub_sect} onChange={set('sub_sect')}
            placeholder={form.sect === 'digambar' ? 'Terapanth, Bisapanth, Taran Panth…' : 'Murtipujak, Sthanakvasi, Tapagachha…'} />
        </label>
      )}
      <label className="field"><span>State</span>
        <StateSelect value={form.state} onChange={(s) => setForm({ ...form, state: s, city: '' })} />
      </label>
      <label className="field"><span>City (home base)</span>
        <CitySelect state={form.state} value={form.city} onChange={(c) => setForm({ ...form, city: c })} />
      </label>
      <label className="field"><span>Diksha year</span><input type="number" value={form.diksha_year} onChange={set('diksha_year')} /></label>
      <label className="field"><span>Guru name</span><input value={form.guru_name} onChange={set('guru_name')} /></label>
      <label className="field"><span>Bio</span><textarea value={form.bio} onChange={set('bio')} rows={3} /></label>
      <PhotoPicker value={form.photo_base64} onChange={(v) => setForm({ ...form, photo_base64: v })} />
      <label className="field"><span>Rep mobile (their login, optional)</span>
        <input value={form.rep_mobile} onChange={set('rep_mobile')} inputMode="numeric" maxLength={10} placeholder="9876543210" />
      </label>
      <label className="field-check">
        <input type="checkbox" checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} />
        <span>Mark verified (visible to devotees immediately)</span>
      </label>
    </ActionForm>
  );
}

interface Rep {
  id: string; mobile: string; name: string | null; user_id: string | null;
  /** Null until an invite message actually left the building — see migration 043. */
  invite_sent_at: string | null; invite_channel: string | null; invite_error: string | null;
}
interface FullProfile extends MaharajProfile {
  bio: string | null; languages: string[]; photo_url: string | null; photo_base64: string | null;
  rep_mobile: string | null; rep_name: string | null;
  current_location: { place: string; city: string | null; state: string | null; lat: number | null; lng: number | null; from_date: string | null; to_date: string | null; chaturmas: boolean; notes: string | null } | null;
  reps: Rep[];
}

function MaharajManage({ id, onClose, onChanged, onToast }: {
  id: string; onClose: () => void; onChanged: () => void;
  onToast: (text: string, tone?: 'ok' | 'bad') => void;
}) {
  const [p, setP] = useState<FullProfile | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<'details' | 'location' | 'reps'>('details');

  const load = useCallback(() => {
    api<FullProfile>(`/admin/maharaj/${id}`).then((r) => setP(r.data)).catch(setError);
  }, [id]);
  useEffect(load, [load]);

  if (error) return <ErrorBox error={error} />;
  if (!p) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="tabs" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['details', 'location', 'reps'] as const).map((t) => (
          <button key={t} className={`btn sm ${tab === t ? 'primary' : ''}`} onClick={() => setTab(t)}>
            {t === 'details' ? 'Details' : t === 'location' ? 'Location' : 'Representatives'}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <DetailsTab p={p} onDone={() => { load(); onChanged(); onToast('Profile saved.'); }}
          onDeleted={() => { onChanged(); onClose(); onToast('Profile deleted.'); }} />
      )}
      {tab === 'location' && (
        <LocationTab p={p} onDone={() => { load(); onChanged(); onToast('Current location saved.'); }} />
      )}
      {tab === 'reps' && <RepsTab p={p} onChanged={load} onToast={onToast} />}
    </div>
  );
}

function DetailsTab({ p, onDone, onDeleted }: { p: FullProfile; onDone: () => void; onDeleted: () => void }) {
  const [form, setForm] = useState({
    name: p.name, type: p.type, samuday: p.samuday ?? '',
    sect: p.sect ?? '', sub_sect: p.sub_sect ?? '', state: p.state ?? '', city: p.city ?? '',
    diksha_year: p.diksha_year != null ? String(p.diksha_year) : '', guru_name: p.guru_name ?? '',
    bio: p.bio ?? '', languages: (p.languages ?? []).join(', '), verified: p.verified,
  });
  // Kept out of `form` because it does not travel with the PATCH: the photo
  // has its own endpoint (as it does in the sant portal), so a 200 KB data URI
  // is not re-posted every time somebody fixes a typo in the bio.
  // Inline wins over the legacy URL on read, so it wins here too.
  const [photo, setPhoto] = useState(p.photo_base64 ?? p.photo_url ?? '');
  const originalPhoto = p.photo_base64 ?? p.photo_url ?? '';
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div>
      <ActionForm submitLabel="Save changes" onDone={onDone}
        onSubmit={async () => {
          await api(`/admin/maharaj/${p.id}`, {
            method: 'PATCH',
            body: {
              name: form.name, type: form.type, samuday: form.samuday || null,
              // Editable so the readiness report's outstanding sants can be
              // fixed here. `undefined` (omit) rather than null when unset:
              // the DTO validates against the two sects, so '' or null would
              // be rejected — leaving it out keeps whatever is on file.
              sect: form.sect || undefined, sub_sect: form.sub_sect || undefined,
              state: form.state || null, city: form.city || null,
              diksha_year: form.diksha_year ? Number(form.diksha_year) : null,
              guru_name: form.guru_name || null, bio: form.bio || null,
              languages: form.languages.split(',').map((l) => l.trim()).filter(Boolean),
            },
          });
          // Only when it actually changed — re-posting an unchanged photo would
          // put a needless 200 KB on the wire for every text edit.
          if (photo !== originalPhoto) {
            if (photo) await api(`/admin/maharaj/${p.id}/photo`, { method: 'POST', body: { photo_base64: photo } });
            else await api(`/admin/maharaj/${p.id}/photo`, { method: 'DELETE' });
          }
          if (form.verified !== p.verified) {
            await api(`/admin/maharaj/${p.id}/verify`, { method: 'PATCH', body: { verified: form.verified } });
          }
        }}>
        <label className="field"><span>Name *</span><input value={form.name} onChange={set('name')} required /></label>
        <label className="field"><span>Type</span>
          <select value={form.type} onChange={set('type')}>{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
        </label>
        <label className="field"><span>Samuday (community)</span><input value={form.samuday} onChange={set('samuday')} placeholder="e.g. Oswal, Porwal, Agarwal" /></label>
        <label className="field"><span>Sampradaya</span>
          <select value={form.sect} onChange={(e) => setForm({ ...form, sect: e.target.value, sub_sect: '' })}>
            {SECTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        {form.sect && (
          <label className="field"><span>Panth / Gaccha</span>
            <input value={form.sub_sect} onChange={set('sub_sect')}
              placeholder={form.sect === 'digambar' ? 'Terapanth, Bisapanth, Taran Panth…' : 'Murtipujak, Sthanakvasi, Tapagachha…'} />
          </label>
        )}
        <label className="field"><span>State</span>
          <StateSelect value={form.state} onChange={(s) => setForm({ ...form, state: s, city: '' })} />
        </label>
        <label className="field"><span>City (home base)</span>
          <CitySelect state={form.state} value={form.city} onChange={(c) => setForm({ ...form, city: c })} />
        </label>
        <label className="field"><span>Diksha year</span><input type="number" value={form.diksha_year} onChange={set('diksha_year')} /></label>
        <label className="field"><span>Guru name</span><input value={form.guru_name} onChange={set('guru_name')} /></label>
        <label className="field"><span>Languages (comma-separated)</span><input value={form.languages} onChange={set('languages')} placeholder="gujarati, hindi" /></label>
        <PhotoPicker value={photo} onChange={setPhoto} />
        <label className="field"><span>Bio</span><textarea value={form.bio} onChange={set('bio')} rows={3} /></label>
        <label className="field-check">
          <input type="checkbox" checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} />
          <span>Verified (visible to devotees)</span>
        </label>
      </ActionForm>

      <hr style={{ margin: '20px 0', border: 'none', borderTop: '1px solid #e2e8f0' }} />
      <button className="btn sm danger" onClick={async () => {
        if (confirm(`Delete ${p.name}? This removes the profile, its locations, followers and representative links.`)) {
          await api(`/admin/maharaj/${p.id}`, { method: 'DELETE' });
          onDeleted();
        }
      }}>Delete profile</button>
    </div>
  );
}

function LocationTab({ p, onDone }: { p: FullProfile; onDone: () => void }) {
  const cl = p.current_location;
  const [form, setForm] = useState({
    place: cl?.place ?? '', state: cl?.state ?? '', city: cl?.city ?? '',
    from_date: cl?.from_date ?? '', to_date: cl?.to_date ?? '', chaturmas: cl?.chaturmas ?? false,
    notes: cl?.notes ?? '',
    lat: cl?.lat != null ? Number(cl.lat) : null as number | null,
    lng: cl?.lng != null ? Number(cl.lng) : null as number | null,
  });

  return (
    <ActionForm submitLabel="Save current location" onDone={onDone}
      onSubmit={async () => {
        await api(`/admin/maharaj/${p.id}/location`, {
          method: 'PUT',
          body: {
            place: form.place, state: form.state || null, city: form.city || null,
            from_date: form.from_date || null, to_date: form.to_date || null,
            chaturmas: form.chaturmas, notes: form.notes || null,
            lat: form.lat, lng: form.lng,
          },
        });
      }}>
      <label className="field"><span>Place / Venue *</span><input value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} required placeholder="e.g. Shree Jain Derasar" /></label>
      <label className="field"><span>State</span>
        <StateSelect value={form.state} onChange={(s) => setForm({ ...form, state: s, city: '' })} />
      </label>
      <label className="field"><span>City</span>
        <CitySelect state={form.state} value={form.city} onChange={(c) => setForm({ ...form, city: c })} />
      </label>
      <label className="field"><span>From</span><input type="date" value={form.from_date ?? ''} onChange={(e) => setForm({ ...form, from_date: e.target.value })} /></label>
      <label className="field"><span>To</span><input type="date" value={form.to_date ?? ''} onChange={(e) => setForm({ ...form, to_date: e.target.value })} /></label>
      <label className="field-check">
        <input type="checkbox" checked={form.chaturmas} onChange={(e) => setForm({ ...form, chaturmas: e.target.checked })} />
        <span>Chaturmas stay</span>
      </label>
      <label className="field"><span>Notes</span><textarea value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></label>
      <div style={{ margin: '8px 0 16px' }}>
        <LocationPicker lat={form.lat} lng={form.lng} onChange={(lat, lng) => setForm({ ...form, lat, lng })} />
      </div>
    </ActionForm>
  );
}

function RepsTab({ p, onChanged, onToast }: {
  p: FullProfile; onChanged: () => void;
  onToast: (text: string, tone?: 'ok' | 'bad') => void;
}) {
  const [mobile, setMobile] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      // The response now says whether the invite reached them, so the console
      // can stop claiming "Invited" for a message that was never sent.
      const { data } = await api<{ invite_sent?: boolean; invite_channel?: string | null; invite_error?: string | null }>(
        `/admin/maharaj/${p.id}/reps`, { method: 'POST', body: { mobile, name: name || undefined } },
      );
      setMobile(''); setName(''); onChanged();
      if (data?.invite_sent) onToast(`Representative added — invite sent by ${data.invite_channel ?? 'message'}.`);
      else onToast(`Representative added, but the invite could not be sent (${data?.invite_error ?? 'unknown reason'}). They can still sign in with this number.`, 'bad');
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  async function resend(rep: Rep) {
    try {
      const { data } = await api<{ invite_sent?: boolean; invite_channel?: string | null; invite_error?: string | null }>(
        `/admin/maharaj/${p.id}/reps/${rep.id}/resend-invite`, { method: 'POST' },
      );
      onChanged();
      if (data?.invite_sent) onToast(`Invite re-sent to ${rep.mobile} by ${data.invite_channel ?? 'message'}.`);
      else onToast(`Could not send the invite: ${data?.invite_error ?? 'unknown reason'}`, 'bad');
    } catch (err) { setError(err); }
  }

  /**
   * What the row says about this person, in the order that matters to the
   * curator: signed in > invite delivered > nothing sent.
   *
   * The last case used to read "Invited", which was simply untrue — no message
   * had ever gone out and there was nothing on screen to suggest otherwise.
   */
  function status(r: Rep) {
    if (r.user_id) return <span>Signed in</span>;
    if (r.invite_sent_at) {
      return (
        <span>
          Invited {formatDate(r.invite_sent_at)}
          {r.invite_channel ? <span className="muted"> · {r.invite_channel}</span> : null}
        </span>
      );
    }
    return (
      <span style={{ color: '#b45309' }}>
        Not invited yet
        {r.invite_error ? <span className="muted" title={r.invite_error}> · send failed</span> : null}
      </span>
    );
  }

  return (
    <div>
      <p className="muted" style={{ marginBottom: 12 }}>
        Logins that can manage this profile. The primary rep is
        {p.rep_mobile ? <> <strong>{p.rep_name || 'linked'} ({p.rep_mobile})</strong></> : <> not set</>}.
      </p>
      <ErrorBox error={error} />
      <table className="data">
        <thead><tr><th>Mobile</th><th>Name</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {p.reps.map((r) => (
            <tr key={r.id}>
              <td className="mono">{r.mobile}</td>
              <td>{r.name ?? <span className="muted">—</span>}</td>
              <td>{status(r)}</td>
              <td>
                {!r.user_id && (
                  <>
                    <button className="btn sm" onClick={() => resend(r)}>
                      {r.invite_sent_at ? 'Resend invite' : 'Send invite'}
                    </button>{' '}
                  </>
                )}
                <button className="btn sm danger" onClick={async () => {
                  if (confirm('Remove this representative?')) {
                    await api(`/admin/maharaj/${p.id}/reps/${r.id}`, { method: 'DELETE' });
                    onChanged();
                    onToast('Representative removed.');
                  }
                }}>Remove</button>
              </td>
            </tr>
          ))}
          {p.reps.length === 0 && <tr><td colSpan={4} className="muted">No co-representatives yet.</td></tr>}
        </tbody>
      </table>
      <form onSubmit={add} style={{ marginTop: 16 }}>
        <label className="field"><span>Name (optional)</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Mobile number</span>
          <input value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={10} placeholder="9876543210" />
        </label>
        <div className="actions"><button className="btn primary" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add representative'}</button></div>
      </form>
    </div>
  );
}
