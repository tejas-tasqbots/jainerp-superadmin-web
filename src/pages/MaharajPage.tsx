import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, type ApiMeta } from '../api/client';
import type { MaharajProfile, Sangh } from '../api/types';
import { ActionForm, Badge, ErrorBox, Modal, Pagination, useToast } from '../components/ui';
import { PhotoPicker } from '../components/PhotoPicker';
import { StateSelect, CitySelect } from '../components/GeoSelect';
import { LocationPicker } from '../components/LocationPicker';

/** One row of the cross-profile queue. */
interface GlobalRepRequest {
  id: string;
  sant_id: string;
  sant_name: string;
  sant_name_hi: string | null;
  mobile: string;
  name: string | null;
  reason: string | null;
  requested_by_name: string | null;
  requested_at: string;
}

export function MaharajPage() {
  const [rows, setRows] = useState<MaharajProfile[]>([]);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [verifiedFilter, setVerifiedFilter] = useState('');
  // Living / samadhistha (migration 044). Unset shows BOTH here, unlike the
  // devotee app: a moderation queue that hid memorials would hide the ones
  // nobody has verified yet from the only person who can publish them.
  const [statusFilter, setStatusFilter] = useState('');
  // The readiness report for 044: who is still English-only, and therefore
  // rendered in Latin script to every Hindi-reading devotee.
  const [hindiMissing, setHindiMissing] = useState(false);
  // Sangh (migration 047). '' = every sangh, 'none' = the curation report for
  // ascetics not yet placed in one.
  const [sanghFilter, setSanghFilter] = useState('');
  // 25 suits a moderation queue; reviewing a seeded sangh of 200 does not.
  const [limit, setLimit] = useState(25);
  const [sanghs, setSanghs] = useState<Sangh[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showBulkSangh, setShowBulkSangh] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [queue, setQueue] = useState<GlobalRepRequest[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q) params.set('q', q);
    if (verifiedFilter) params.set('verified', verifiedFilter);
    if (statusFilter) params.set('status', statusFilter);
    if (hindiMissing) params.set('name_hi_missing', 'true');
    if (sanghFilter === 'none') params.set('sangh_missing', 'true');
    else if (sanghFilter) params.set('sangh_id', sanghFilter);
    api<MaharajProfile[]>(`/admin/maharaj?${params}`)
      .then((r) => { setRows(r.data); setMeta(r.meta); })
      .catch(setError);
  }, [page, q, verifiedFilter, statusFilter, hindiMissing, sanghFilter, limit]);
  useEffect(load, [load]);

  // Every sangh, verified or not: this is the console that verifies them, and a
  // curator must be able to file an ascetic into one they have just created.
  const loadSanghs = useCallback(() => {
    api<Sangh[]>('/admin/sanghs')
      .then((r) => setSanghs(r.data ?? []))
      .catch(() => { /* the directory is the page; an empty sangh list only disables a filter */ });
  }, []);
  useEffect(loadSanghs, [loadSanghs]);

  /**
   * Requests waiting on a Sanghpati admin, across every profile.
   *
   * We are the escalation path. An admin whose phone is lost, or who has left
   * the sangh, leaves requests nobody can decide — and without a cross-profile
   * view nobody would ever know, because the only other place they appear is
   * inside a profile somebody has to think to open.
   */
  const loadQueue = useCallback(() => {
    api<GlobalRepRequest[]>('/admin/maharaj/rep-requests?status=pending')
      .then((r) => setQueue(r.data ?? []))
      .catch(() => { /* the directory below is the page; a queue failure is not fatal */ });
  }, []);
  useEffect(loadQueue, [loadQueue]);

  async function decideQueued(req: GlobalRepRequest, decision: 'approve' | 'reject') {
    await run(
      () => api(`/admin/maharaj/rep-requests/${req.id}/${decision}`, { method: 'POST' }),
      decision === 'approve' ? 'Approved — the sangh representative has been invited.' : 'Request rejected.',
    );
    loadQueue();
  }

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

      {queue.length > 0 && (
        <div style={{
          margin: '0 0 16px', padding: 12, borderRadius: 8,
          background: '#fffbeb', border: '1px solid #fde68a',
        }}>
          <strong style={{ fontSize: 13 }}>
            {queue.length} request(s) to add a sangh representative are waiting on a Sanghpati admin
          </strong>
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 8px' }}>
            The Sanghpati admin normally decides these. Act here only when they cannot — a lost phone,
            or somebody no longer with the sangh.
          </p>
          <table className="data">
            <thead><tr><th>Sadhu-Sadhvi</th><th>Mobile</th><th>Name</th><th>Asked by</th><th>Waiting since</th><th></th></tr></thead>
            <tbody>
              {queue.map((r) => (
                <tr key={r.id}>
                  <td>{r.sant_name_hi || r.sant_name}</td>
                  <td className="mono">{r.mobile}</td>
                  <td>{r.name ?? <span className="muted">—</span>}</td>
                  <td className="muted">{r.requested_by_name ?? '—'}</td>
                  <td className="muted">{formatDate(r.requested_at)}</td>
                  <td>
                    <button className="btn sm primary" onClick={() => decideQueued(r, 'approve')}>Approve</button>{' '}
                    <button className="btn sm" onClick={() => decideQueued(r, 'reject')}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="toolbar">
        {/* Searches BOTH scripts — a curator looking for a Devanagari name used
            to find nothing and add the ascetic a second time. */}
        <input placeholder="Search name (either script) / samuday…" value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select value={verifiedFilter} onChange={(e) => { setVerifiedFilter(e.target.value); setPage(1); }}>
          <option value="">All</option>
          <option value="false">Pending verification</option>
          <option value="true">Verified</option>
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">Living &amp; samadhistha</option>
          <option value="living">Living only</option>
          <option value="samadhistha">Samadhistha only</option>
        </select>
        <select value={sanghFilter} onChange={(e) => { setSanghFilter(e.target.value); setPage(1); }}>
          <option value="">All sanghs</option>
          <option value="none">No sangh set</option>
          {sanghs.map((sg) => (
            <option key={sg.id} value={sg.id}>
              {sg.name_en}{sg.members_count ? ` (${sg.members_count})` : ''}
            </option>
          ))}
        </select>
        <label className="field-check" style={{ margin: 0 }}>
          <input type="checkbox" checked={hindiMissing}
            onChange={(e) => { setHindiMissing(e.target.checked); setPage(1); }} />
          <span>No Hindi name</span>
        </label>
        <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
          aria-label="Rows per page">
          <option value={25}>25 / page</option>
          <option value={100}>100 / page</option>
          <option value={200}>200 / page</option>
        </select>
        <div className="grow" />
        <button className="btn" onClick={() => setShowImport(true)}>Import list</button>
        <button className="btn" disabled={selected.length === 0} onClick={() => setShowBulk(true)}>
          Set location{selected.length ? ` (${selected.length})` : ''}
        </button>
        <button className="btn" disabled={selected.length === 0} onClick={() => setShowBulkSangh(true)}>
          Set sangh{selected.length ? ` (${selected.length})` : ''}
        </button>
        {/* The seeded directory (migration 049) lands unverified on purpose, so
            publishing it one row at a time would be a few thousand clicks and
            therefore would not happen. Explicit selection only — there is no
            "verify everything matching this filter", because the unverified
            state exists precisely so that somebody reads them. */}
        <button className="btn" disabled={selected.length === 0} onClick={() => run(
          () => api('/admin/maharaj/bulk-verify', {
            method: 'POST', body: { sant_ids: selected, verified: true },
          }).then(() => setSelected([])),
          `${selected.length} verified — now visible to devotees.`,
        )}>
          Verify{selected.length ? ` (${selected.length})` : ''}
        </button>
        <button className="btn primary" onClick={() => setShowCreate(true)}>+ Add Sadhu-Sadhvi</button>
      </div>

      <table className="data">
        <thead>
          <tr>
            <th style={{ width: 28 }}>
              {/* Selecting a memorial would only ever produce SANT_SAMADHISTHA
                  from the bulk endpoint, so they are not selectable at all. */}
              <input type="checkbox"
                checked={selected.length > 0 && selected.length === rows.filter((r) => !r.is_samadhistha).length}
                onChange={(e) => setSelected(e.target.checked
                  ? rows.filter((r) => !r.is_samadhistha).map((r) => r.id)
                  : [])} />
            </th>
            <th>Name</th><th>Hindi</th><th>Type</th><th>Sangh</th><th>Reps</th><th>City / State</th>
            <th>Followers</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td>
                {!m.is_samadhistha && (
                  <input type="checkbox" checked={selected.includes(m.id)}
                    onChange={() => setSelected((sel) =>
                      sel.includes(m.id) ? sel.filter((x) => x !== m.id) : [...sel, m.id])} />
                )}
              </td>
              <td>
                {m.name_en || m.name}
                {m.samuday ? <div className="muted" style={{ fontSize: 11 }}>{m.samuday}</div> : null}
              </td>
              {/* Its own column, not a subtitle: the readiness filter above is
                  about the blanks in it, and a blank is only obvious in a column. */}
              <td>{m.name_hi || <span className="muted">— not set</span>}</td>
              <td className="capitalize">
                {m.type}
                {m.pad && m.pad !== 'none' ? <div className="muted" style={{ fontSize: 11 }}>{m.pad}</div> : null}
              </td>
              <td>
                {m.sangh_name
                  ? <>
                      {m.sangh_name}
                      {m.is_sangh_head && (
                        <div style={{ fontSize: 11, color: '#b45309' }}>head</div>
                      )}
                    </>
                  : <span className="muted">— not set</span>}
              </td>
              <td>
                {m.is_samadhistha ? <span className="muted">—</span> : (m.reps_count ?? 0)}
                {m.pending_rep_requests
                  ? <div style={{ fontSize: 11, color: '#b45309' }}>{m.pending_rep_requests} waiting</div>
                  : null}
              </td>
              {/* Both halves come from the SAME place or neither does. Pairing
                  `current_city` with `state` printed "Sangli, Jammu and Kashmir"
                  — the city they have travelled to beside the state they are
                  based in, a place that does not exist. When an ascetic is away
                  from their base the row says so, so a curator can tell the two
                  readings apart instead of guessing. */}
              <td>{(() => {
                const away = !!m.current_city;
                const city = away ? m.current_city : m.city;
                const st = away ? m.current_state : m.state;
                const place = [city, st].filter(Boolean).join(', ');
                if (!place) return '—';
                return (
                  <>
                    {place}
                    {away && (m.city || m.state) && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        based in {[m.city, m.state].filter(Boolean).join(', ')}
                      </div>
                    )}
                  </>
                );
              })()}</td>
              <td>{m.followers_count}</td>
              <td>
                {m.is_samadhistha
                  ? <span className="muted">Samadhistha</span>
                  : <Badge value={m.verified} />}
                <div className="muted" style={{ fontSize: 11 }}>{formatDate(m.created_at)}</div>
              </td>
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
          {rows.length === 0 && <tr><td colSpan={10} className="muted">No profiles found.</td></tr>}
        </tbody>
      </table>
      {meta && <Pagination page={page} total={meta.total} limit={limit} onPage={setPage} />}

      {showCreate && (
        <Modal title="Add Sadhu-Sadhvi" onClose={() => setShowCreate(false)}>
          <MaharajCreateForm onDone={() => { setShowCreate(false); load(); toast.show('Profile created.'); }} />
        </Modal>
      )}
      {showImport && (
        <Modal title="Import a sant list" onClose={() => setShowImport(false)}>
          <ImportForm onDone={() => { setShowImport(false); load(); }} />
        </Modal>
      )}
      {showBulk && (
        <Modal title={`Set location for ${selected.length} Sadhu-Sadhvi`} onClose={() => setShowBulk(false)}>
          <BulkLocationForm
            santIds={selected}
            onDone={(msg) => { setShowBulk(false); setSelected([]); load(); toast.show(msg); }}
          />
        </Modal>
      )}
      {showBulkSangh && (
        <Modal title={`Set sangh for ${selected.length} Sadhu-Sadhvi`} onClose={() => setShowBulkSangh(false)}>
          <BulkSanghForm
            santIds={selected}
            sanghs={sanghs}
            onDone={(msg) => { setShowBulkSangh(false); setSelected([]); load(); loadSanghs(); toast.show(msg); }}
          />
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

/**
 * Posts (pad) — migration 039, widened by 044.
 *
 * A POST, not a rank: an Acharya is still a Muni. The original four were all
 * Digambara-leaning, so the whole Shwetambar hierarchy (Panyas, Gani,
 * Pravartak, Pravartini, Mahattara, Sadhvi Pramukha) had to be filed as 'none'
 * with the post buried in free-text `honours`, where the directory cannot
 * filter on it. `sects` narrows the picker so a curator is never offered a post
 * the ascetic's own tradition does not confer.
 */
const PADS: { value: string; label: string; sects: string[] }[] = [
  { value: 'none', label: '—', sects: ['digambar', 'shwetambar'] },
  { value: 'acharya', label: 'Acharya', sects: ['digambar', 'shwetambar'] },
  { value: 'upadhyaya', label: 'Upadhyaya', sects: ['digambar', 'shwetambar'] },
  { value: 'elacharya', label: 'Elacharya', sects: ['digambar'] },
  { value: 'ganini', label: 'Ganini', sects: ['digambar'] },
  { value: 'bhattarak', label: 'Bhattarak', sects: ['digambar'] },
  { value: 'panyas', label: 'Panyas', sects: ['shwetambar'] },
  { value: 'gani', label: 'Gani', sects: ['shwetambar'] },
  { value: 'pravartak', label: 'Pravartak', sects: ['shwetambar'] },
  { value: 'pravartini', label: 'Pravartini', sects: ['shwetambar'] },
  { value: 'mahattara', label: 'Mahattara', sects: ['shwetambar'] },
  { value: 'sadhvi_pramukha', label: 'Sadhvi Pramukha', sects: ['shwetambar'] },
];

const FEMALE_PADS = ['ganini', 'pravartini', 'mahattara', 'sadhvi_pramukha'];
const FEMALE_TYPES = ['aryika', 'sadhvi'];
const DIGAMBAR_TYPES = ['muni', 'aryika', 'kshullak', 'kshullika', 'ailak'];

/** Only this tradition's ranks — a flat list is how a Sadhvi got filed as a Muni. */
function typesForSect(sect: string) {
  if (!sect) return TYPES;
  return TYPES.filter((t) =>
    sect === 'digambar' ? DIGAMBAR_TYPES.includes(t.value) : !DIGAMBAR_TYPES.includes(t.value));
}

/** Only the posts this rank, in this tradition, may actually hold. */
function padsFor(type: string, sect: string) {
  const inTradition = sect ? PADS.filter((p) => p.sects.includes(sect)) : PADS;
  if (FEMALE_TYPES.includes(type)) {
    return inTradition.filter((p) => p.value === 'none' || FEMALE_PADS.includes(p.value));
  }
  if (['muni', 'ailak', 'sadhu'].includes(type)) {
    return inTradition.filter((p) => !FEMALE_PADS.includes(p.value));
  }
  // Kshullak and Kshullika are junior ranks and hold no sangh office.
  return PADS.filter((p) => p.value === 'none');
}

function MaharajCreateForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    name_en: '', name_hi: '', type: 'muni', pad: 'none', samuday: '', sect: '', sub_sect: '',
    state: '', city: '',
    diksha_year: '', guru_name: '', bio: '', rep_mobile: '', rep_name: '',
    photo_base64: '', verified: false,
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <ActionForm submitLabel="Create" onDone={onDone} successMessage={null}
      onSubmit={async () => {
        await api('/admin/maharaj', {
          method: 'POST',
          body: {
            // `name` is the canonical display value every reader falls back to.
            // Whichever script the curator filled in becomes it; the API works
            // the pair out from there and never transliterates.
            name: form.name_en || form.name_hi,
            name_en: form.name_en || undefined,
            name_hi: form.name_hi || undefined,
            type: form.type, pad: form.pad || undefined,
            samuday: form.samuday || undefined,
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
      {/* Both scripts. At least one is required — the API refuses a nameless
          profile — and whichever is left blank falls back on read, so a curator
          working from a single-script list is never forced to invent the other. */}
      <label className="field"><span>Name (English)</span>
        <input value={form.name_en} onChange={set('name_en')} placeholder="Muni Kshamasagar Ji" />
      </label>
      <label className="field"><span>Name (Hindi / Devanagari)</span>
        <input value={form.name_hi} onChange={set('name_hi')} placeholder="मुनि क्षमासागर जी" lang="hi" />
      </label>
      {!form.name_en && !form.name_hi && (
        <p className="muted" style={{ fontSize: 12, marginTop: -8 }}>Enter the name in at least one script.</p>
      )}
      <label className="field"><span>Sampradaya</span>
        <select value={form.sect} onChange={(e) => setForm({
          ...form, sect: e.target.value, sub_sect: '',
          // Changing tradition can strand a rank and a post that belong to the
          // other one; clear rather than submit a pair the API will reject.
          type: typesForSect(e.target.value)[0]?.value ?? form.type,
          pad: 'none',
        })}>
          {SECTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      <label className="field"><span>Type (rank)</span>
        <select value={form.type} onChange={(e) => setForm({
          ...form, type: e.target.value,
          pad: padsFor(e.target.value, form.sect).some((p) => p.value === form.pad) ? form.pad : 'none',
        })}>
          {typesForSect(form.sect).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <label className="field"><span>Pad (post held)</span>
        <select value={form.pad} onChange={set('pad')}>
          {padsFor(form.type, form.sect).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      {/* samuday, sect and sub_sect are three different things (migration 024).
          This field was labelled "Samuday / Sect" and suggested "Tapagachha" —
          a gaccha, i.e. a sub_sect — which conflated all three at once. */}
      <label className="field"><span>Samuday (community)</span><input value={form.samuday} onChange={set('samuday')} placeholder="e.g. Oswal, Porwal, Agarwal" /></label>
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
      {/* THE HANDOVER. Whoever is named here becomes the profile's Sanghpati admin:
          they can then add and remove the other sangh representatives themselves,
          without coming back to us. Leaving it blank creates a profile nobody
          can manage until somebody is added from the Sangh Representatives tab. */}
      <label className="field"><span>Sanghpati admin mobile (their login)</span>
        <input value={form.rep_mobile} onChange={set('rep_mobile')} inputMode="numeric" maxLength={10} placeholder="9876543210" />
      </label>
      <p className="muted" style={{ fontSize: 12, marginTop: -8 }}>
        They are invited by WhatsApp or SMS and become the Sanghpati admin, who manages the other
        sangh representatives. Leave blank for a historical record with no sangh representative.
      </p>
      <label className="field-check">
        <input type="checkbox" checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} />
        <span>Mark verified (visible to devotees immediately)</span>
      </label>
    </ActionForm>
  );
}

interface Rep {
  id: string; mobile: string; name: string | null; user_id: string | null;
  /** admin = the Sanghpati admin, who manages the rest themselves (migration 044). */
  role: 'admin' | 'rep';
  /** Null until an invite message actually left the building — see migration 043. */
  invite_sent_at: string | null; invite_channel: string | null; invite_error: string | null;
}

interface RepRequest {
  id: string; mobile: string; name: string | null; reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  requested_by_name: string | null; requested_at: string; review_note: string | null;
}
interface FullProfile extends MaharajProfile {
  bio: string | null; languages: string[]; photo_url: string | null; photo_base64: string | null;
  rep_mobile: string | null; rep_name: string | null;
  name_en: string | null; name_hi: string | null;
  samadhi_date: string | null; tithi_note: string | null;
  is_samadhistha: boolean;
  rep_requests: RepRequest[];
  current_location: { place: string; city: string | null; state: string | null; lat: number | null; lng: number | null; from_date: string | null; to_date: string | null; chaturmas: boolean; notes: string | null } | null;
  reps: Rep[];
}

function MaharajManage({ id, onClose, onChanged, onToast }: {
  id: string; onClose: () => void; onChanged: () => void;
  onToast: (text: string, tone?: 'ok' | 'bad') => void;
}) {
  const [p, setP] = useState<FullProfile | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<'details' | 'location' | 'reps' | 'samadhi'>('details');

  const load = useCallback(() => {
    api<FullProfile>(`/admin/maharaj/${id}`).then((r) => setP(r.data)).catch(setError);
  }, [id]);
  useEffect(load, [load]);

  if (error) return <ErrorBox error={error} />;
  if (!p) return <p className="muted">Loading…</p>;

  return (
    <div>
      {/* A memorial is deliberately still here and still visible to devotees.
          Saying so is what stops a curator reading the missing actions as a
          fault and re-adding a sangh representative to "fix" it. */}
      {p.is_samadhistha && (
        <div style={{
          marginBottom: 16, padding: 12, borderRadius: 8,
          background: '#f8fafc', border: '1px solid #e2e8f0',
        }}>
          <strong style={{ fontSize: 13 }}>
            Samadhistha{p.samadhi_date ? ` — ${p.samadhi_date.slice(0, 10)}` : ' — date not recorded'}
          </strong>
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
            This profile is a record. It has no sangh representatives and no current location, and stays
            fully visible to devotees. Reverse it on the Samadhi tab if it was entered by mistake.
          </p>
        </div>
      )}

      <div className="tabs" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['details', 'location', 'reps', 'samadhi'] as const).map((t) => (
          <button key={t} className={`btn sm ${tab === t ? 'primary' : ''}`} onClick={() => setTab(t)}>
            {t === 'details' ? 'Details'
              : t === 'location' ? 'Location'
              : t === 'reps' ? `Sangh Representatives${p.rep_requests?.some((r) => r.status === 'pending') ? ' •' : ''}`
              : 'Samadhi'}
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
      {tab === 'samadhi' && (
        <SamadhiTab p={p} onDone={() => { load(); onChanged(); }} onToast={onToast} />
      )}
    </div>
  );
}

function DetailsTab({ p, onDone, onDeleted }: { p: FullProfile; onDone: () => void; onDeleted: () => void }) {
  const [form, setForm] = useState({
    name_en: p.name_en ?? '', name_hi: p.name_hi ?? '',
    // `as string`: the pickers below narrow by tradition and hand back whatever
    // the select holds, so the form state is the wider type and the API — which
    // validates against the same list — is the thing that enforces it.
    type: p.type as string, pad: p.pad ?? 'none', samuday: p.samuday ?? '',
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
              // The only place in the estate that writes these. A rep raises a
              // change request; nothing else touches them.
              name_en: form.name_en || null,
              name_hi: form.name_hi || null,
              // `name` is kept in step with whichever script is filled in, so
              // the fallback every other reader uses never points at a stale
              // spelling after a correction is applied here.
              name: form.name_en || form.name_hi || p.name,
              type: form.type, pad: form.pad || undefined,
              samuday: form.samuday || null,
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
        <label className="field"><span>Name (English)</span>
          <input value={form.name_en} onChange={set('name_en')} />
        </label>
        <label className="field"><span>Name (Hindi / Devanagari)</span>
          <input value={form.name_hi} onChange={set('name_hi')} lang="hi" />
        </label>
        <label className="field"><span>Type (rank)</span>
          <select value={form.type} onChange={(e) => setForm({
            ...form, type: e.target.value,
            pad: padsFor(e.target.value, form.sect).some((x) => x.value === form.pad) ? form.pad : 'none',
          })}>
            {typesForSect(form.sect).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Pad (post held)</span>
          <select value={form.pad} onChange={set('pad')}>
            {padsFor(form.type, form.sect).map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Samuday (community)</span><input value={form.samuday} onChange={set('samuday')} placeholder="e.g. Oswal, Porwal, Agarwal" /></label>
        <label className="field"><span>Sampradaya</span>
          <select value={form.sect} onChange={(e) => setForm({
            ...form, sect: e.target.value, sub_sect: '',
            type: typesForSect(e.target.value).some((t) => t.value === form.type)
              ? form.type
              : (typesForSect(e.target.value)[0]?.value ?? form.type),
            pad: 'none',
          })}>
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
        if (confirm(`Delete ${p.name}? This removes the profile, its locations, followers and sangh representative links.`)) {
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
  const [asAdmin, setAsAdmin] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const hasAdmin = p.reps.some((r) => r.role === 'admin');
  const pendingRequests = (p.rep_requests ?? []).filter((r) => r.status === 'pending');

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      // The response now says whether the invite reached them, so the console
      // can stop claiming "Invited" for a message that was never sent.
      const { data } = await api<{ invite_sent?: boolean; invite_channel?: string | null; invite_error?: string | null }>(
        `/admin/maharaj/${p.id}/reps`,
        { method: 'POST', body: { mobile, name: name || undefined, role: asAdmin || !hasAdmin ? 'admin' : 'rep' } },
      );
      setMobile(''); setName(''); setAsAdmin(false); onChanged();
      if (data?.invite_sent) onToast(`Sangh Representative added — invite sent by ${data.invite_channel ?? 'message'}.`);
      else onToast(`Sangh Representative added, but the invite could not be sent (${data?.invite_error ?? 'unknown reason'}). They can still sign in with this number.`, 'bad');
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
   * Make somebody the Sanghpati admin — the Super Admin's override of a handover the
   * Sanghpati admin can normally do themselves.
   *
   * Needed precisely because the ordinary path requires the CURRENT admin to
   * act, and the cases that reach us are the ones where they cannot: a phone
   * lost, a person no longer with the sangh, an admin who has stopped
   * answering. Promoting demotes the incumbent in the same transaction.
   */
  async function setRole(rep: Rep, role: 'admin' | 'rep') {
    const verb = role === 'admin' ? 'make the Sanghpati admin' : 'demote to a plain sangh representative';
    if (!confirm(`${rep.name || rep.mobile} — ${verb}?${
      role === 'admin' && hasAdmin ? '\n\nThe current Sanghpati admin becomes a plain sangh representative.' : ''
    }`)) return;
    try {
      await api(`/admin/maharaj/${p.id}/reps/${rep.id}/role`, { method: 'PATCH', body: { role } });
      onChanged();
      onToast(role === 'admin' ? `${rep.name || rep.mobile} is now the Sanghpati admin.` : 'Role updated.');
    } catch (err) { setError(err); }
  }

  async function decide(req: RepRequest, decision: 'approve' | 'reject') {
    try {
      await api(`/admin/maharaj/rep-requests/${req.id}/${decision}`, { method: 'POST' });
      onChanged();
      onToast(decision === 'approve' ? 'Approved — the sangh representative has been invited.' : 'Request rejected.');
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

  if (p.is_samadhistha) {
    return (
      <p className="muted">
        This ascetic has attained samadhi, so the profile is a record and has no sangh representatives.
        Reverse the samadhi record on the Samadhi tab if it was entered by mistake — the previous
        sangh representatives are not restored automatically and would need re-inviting.
      </p>
    );
  }

  return (
    <div>
      <p className="muted" style={{ marginBottom: 12 }}>
        Logins that can manage this profile. The <strong>Sanghpati admin</strong> adds and removes the
        others themselves, without coming back here.
      </p>
      <ErrorBox error={error} />

      {!hasAdmin && (
        <p style={{ color: '#b45309', fontSize: 13, marginBottom: 12 }}>
          No Sanghpati admin. Nobody can add sangh representatives to this profile from the sant portal until
          one is named — the first person added below becomes the Sanghpati admin.
        </p>
      )}

      {/* Requests a Sanghpati admin has not acted on. Shown here because we are the
          escalation path: an admin who has gone quiet leaves these with nobody
          able to decide them. */}
      {pendingRequests.length > 0 && (
        <div style={{
          marginBottom: 16, padding: 12, borderRadius: 8,
          background: '#fffbeb', border: '1px solid #fde68a',
        }}>
          <strong style={{ fontSize: 13 }}>
            {pendingRequests.length} request(s) waiting for the Sanghpati admin
          </strong>
          <table className="data" style={{ marginTop: 8 }}>
            <tbody>
              {pendingRequests.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.mobile}</td>
                  <td>{r.name ?? <span className="muted">—</span>}</td>
                  <td className="muted">
                    {r.requested_by_name ? `asked by ${r.requested_by_name}` : ''}
                    {r.reason ? ` · ${r.reason}` : ''}
                  </td>
                  <td>
                    <button className="btn sm primary" onClick={() => decide(r, 'approve')}>Approve</button>{' '}
                    <button className="btn sm" onClick={() => decide(r, 'reject')}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <table className="data">
        <thead><tr><th>Mobile</th><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {p.reps.map((r) => (
            <tr key={r.id}>
              <td className="mono">{r.mobile}</td>
              <td>{r.name ?? <span className="muted">—</span>}</td>
              <td>
                {r.role === 'admin'
                  ? <strong>Sanghpati admin</strong>
                  : <span className="muted">Sangh Representative</span>}
              </td>
              <td>{status(r)}</td>
              <td>
                {!r.user_id && (
                  <>
                    <button className="btn sm" onClick={() => resend(r)}>
                      {r.invite_sent_at ? 'Resend invite' : 'Send invite'}
                    </button>{' '}
                  </>
                )}
                {r.role !== 'admin' && (
                  <>
                    <button className="btn sm" onClick={() => setRole(r, 'admin')}>Make Sanghpati admin</button>{' '}
                  </>
                )}
                {/* No Remove on the Sanghpati admin: the API refuses it (409
                    LAST_ADMIN) because a profile with no admin is one nobody
                    can add anybody to. Hand the role over first. */}
                {r.role !== 'admin' && (
                  <button className="btn sm danger" onClick={async () => {
                    if (confirm('Remove this sangh representative?')) {
                      await api(`/admin/maharaj/${p.id}/reps/${r.id}`, { method: 'DELETE' });
                      onChanged();
                      onToast('Sangh Representative removed.');
                    }
                  }}>Remove</button>
                )}
              </td>
            </tr>
          ))}
          {p.reps.length === 0 && <tr><td colSpan={5} className="muted">No sangh representatives yet.</td></tr>}
        </tbody>
      </table>

      <form onSubmit={add} style={{ marginTop: 16 }}>
        <label className="field"><span>Name (optional)</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Mobile number</span>
          <input value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={10} placeholder="9876543210" />
        </label>
        <label className="field-check">
          <input type="checkbox" checked={asAdmin || !hasAdmin} disabled={!hasAdmin}
            onChange={(e) => setAsAdmin(e.target.checked)} />
          <span>
            {hasAdmin
              ? 'Make them the Sanghpati admin (the current one becomes a plain sangh representative)'
              : 'They become the Sanghpati admin — this profile has none'}
          </span>
        </label>
        <div className="actions"><button className="btn primary" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add sangh representative'}</button></div>
      </form>
    </div>
  );
}

/**
 * Record that an ascetic has attained samadhi — or clear a date entered by
 * mistake.
 *
 * ITS OWN TAB, not a field on the details form, because it is not a field
 * edit: applying it detaches every sangh representative, retires the current
 * location and closes any open request. That must never happen as a side
 * effect of somebody fixing a typo in a bio, and the person doing it needs to
 * have read what it will do.
 */
function SamadhiTab({ p, onDone, onToast }: {
  p: FullProfile; onDone: () => void; onToast: (text: string, tone?: 'ok' | 'bad') => void;
}) {
  const [date, setDate] = useState(p.samadhi_date?.slice(0, 10) ?? '');
  const [tithi, setTithi] = useState(p.tithi_note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save(clear: boolean) {
    const repCount = p.reps?.length ?? 0;
    if (!clear && !confirm(
      `Record samadhi for ${p.name_en || p.name}${date ? ` on ${date}` : ', with no date'}?\n\n` +
      `This detaches ${repCount} sangh representative(s), retires the current location and closes any ` +
      `pending request. The profile stays visible to devotees.`,
    )) return;
    setBusy(true); setError(null);
    try {
      await api(`/admin/maharaj/${p.id}/samadhi`, {
        method: 'PATCH',
        // The state is sent explicitly. Deriving it from the date was what made
        // an undated samadhi unrecordable — and the historical part of a real
        // sant list, which is most of it, has no dates at all.
        body: { samadhi: !clear, samadhi_date: clear || !date ? null : date, tithi_note: tithi || undefined },
      });
      onDone();
      onToast(clear ? 'Reversed — the profile is a living one again.' : 'Recorded.');
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <div>
      <ErrorBox error={error} />
      <p className="muted" style={{ marginBottom: 12 }}>
        Recording samadhi turns this profile into a record: it keeps its history, its chaturmas
        entries and its anniversary dates, and stays fully visible in the devotee directory — but
        it has no sangh representatives and no current whereabouts. The devotee app can filter on it.
      </p>
      <label className="field"><span>Samadhi date <em style={{ fontWeight: 400 }}>— if known</em></span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 12 }}>
        Leave this empty when the date was never recorded — the normal case for historical entries.
        What matters is that the profile stops reading as living; a date can be added later without
        changing anything else. Never enter an approximate one.
      </p>
      <label className="field"><span>Tithi (as observed)</span>
        <input value={tithi} onChange={(e) => setTithi(e.target.value)} placeholder="e.g. Kartik Krishna 14" />
      </label>
      <p className="muted" style={{ fontSize: 12 }}>
        Free text on purpose: the community observes the tithi, not the Gregorian anniversary, and
        tithi-to-date varies by panchang and region.
      </p>
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={busy} onClick={() => save(false)}>
          {busy ? 'Saving…' : date ? 'Record samadhi' : 'Record samadhi — date not known'}
        </button>{' '}
        {p.is_samadhistha && (
          <button className="btn" disabled={busy} onClick={() => save(true)}>
            Reverse — entered by mistake
          </button>
        )}
      </div>
      {p.is_samadhistha && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Reversing this restores the profile to a living one, but does <strong>not</strong> bring
          the sangh representatives back — their access was removed and re-inviting them is a deliberate act.
        </p>
      )}
    </div>
  );
}

/**
 * Set one location for several ascetics — a sangh travelling together.
 *
 * The console's counterpart to the sant portal's bulk update, and here for the
 * same reason: a group arrives in one town on one day, and retyping the place
 * and pin for each member is how one of them ends up in the wrong district.
 */
/**
 * File a set of ascetics into a sangh, or take them out of one.
 *
 * Bulk because that is how a sangh is actually curated — a list of forty
 * arrives at once, and forty passes through the single-profile form is not how
 * anybody will do it.
 */
function BulkSanghForm({ santIds, sanghs, onDone }: {
  santIds: string[]; sanghs: Sangh[]; onDone: (msg: string) => void;
}) {
  const [sanghId, setSanghId] = useState('');
  const [asHead, setAsHead] = useState(false);

  return (
    <ActionForm submitLabel={`Set sangh for ${santIds.length}`} onDone={() => { /* handled below */ }}
      successMessage={null}
      onSubmit={async () => {
        const { data } = await api<{ updated: number }>('/admin/sanghs/members', {
          method: 'POST',
          body: {
            // '' is the deliberate "remove from sangh" choice, sent as null.
            sangh_id: sanghId || null,
            sant_ids: santIds,
            as_head: sanghId ? asHead : false,
          },
        });
        const name = sanghs.find((sg) => sg.id === sanghId)?.name_en;
        onDone(sanghId
          ? `${data.updated} moved into ${name ?? 'the sangh'}${asHead ? ' as head' : ''}.`
          : `${data.updated} removed from their sangh.`);
      }}>
      <label className="field">
        <span>Sangh</span>
        <select value={sanghId} onChange={(e) => setSanghId(e.target.value)}>
          <option value="">— remove from sangh —</option>
          {sanghs.map((sg) => (
            <option key={sg.id} value={sg.id}>
              {sg.name_en}{sg.parampara ? ` · ${sg.parampara}` : ''}
            </option>
          ))}
        </select>
      </label>
      {/* A sangh has several heads at once — an Acharya who has handed the pad
          on, the Upadhyaya and the Aryika leading their own groups — so this is
          a plain flag, never a swap that demotes whoever currently holds it. */}
      <label className="field-check">
        <input type="checkbox" checked={asHead} disabled={!sanghId}
          onChange={(e) => setAsHead(e.target.checked)} />
        <span>Mark as head of this sangh</span>
      </label>
      {sanghs.length === 0 && (
        <p className="muted" style={{ fontSize: 12 }}>
          No sanghs exist yet. Create one on the Sanghs page first.
        </p>
      )}
    </ActionForm>
  );
}

function BulkLocationForm({ santIds, onDone }: { santIds: string[]; onDone: (msg: string) => void }) {
  const [form, setForm] = useState({
    place: '', state: '', city: '', from_date: '', to_date: '', chaturmas: false, notes: '',
    lat: null as number | null, lng: null as number | null,
  });
  const [errors, setErrors] = useState<Array<{ sant_id: string; message: string }>>([]);

  return (
    <ActionForm submitLabel={`Set location for ${santIds.length}`} onDone={() => { /* handled below */ }}
      successMessage={null}
      onSubmit={async () => {
        const { data } = await api<{ updated: number; skipped: number; errors: Array<{ sant_id: string; message: string }> }>(
          '/admin/maharaj/locations/bulk',
          {
            method: 'POST',
            body: {
              sant_ids: santIds,
              place: form.place, state: form.state || null, city: form.city || null,
              from_date: form.from_date || null, to_date: form.to_date || null,
              chaturmas: form.chaturmas, notes: form.notes || null,
              lat: form.lat, lng: form.lng,
            },
          },
        );
        // Partial success is the contract, so it is reported rather than
        // swallowed: "5 of 7 updated" with no indication of which two is worse
        // than an outright failure.
        if (data.skipped > 0) {
          setErrors(data.errors ?? []);
          return;
        }
        onDone(`Location set for ${data.updated} Sadhu-Sadhvi.`);
      }}>
      <label className="field"><span>Place / Venue *</span>
        <input value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} required
          placeholder="e.g. Shree Jain Derasar" />
      </label>
      <label className="field"><span>State</span>
        <StateSelect value={form.state} onChange={(st) => setForm({ ...form, state: st, city: '' })} />
      </label>
      <label className="field"><span>City</span>
        <CitySelect state={form.state} value={form.city} onChange={(c) => setForm({ ...form, city: c })} />
      </label>
      <label className="field"><span>From</span>
        <input type="date" value={form.from_date} onChange={(e) => setForm({ ...form, from_date: e.target.value })} />
      </label>
      <label className="field"><span>To</span>
        <input type="date" value={form.to_date} onChange={(e) => setForm({ ...form, to_date: e.target.value })} />
      </label>
      <label className="field-check">
        <input type="checkbox" checked={form.chaturmas} onChange={(e) => setForm({ ...form, chaturmas: e.target.checked })} />
        <span>Chaturmas stay</span>
      </label>
      <label className="field"><span>Notes</span>
        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
      </label>
      <div style={{ margin: '8px 0 16px' }}>
        <LocationPicker lat={form.lat} lng={form.lng} onChange={(lat, lng) => setForm({ ...form, lat, lng })} />
      </div>
      {errors.length > 0 && (
        <div style={{ padding: 10, borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a' }}>
          <strong style={{ fontSize: 13 }}>{errors.length} could not be updated</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>
            {errors.map((e) => <li key={e.sant_id}>{e.message}</li>)}
          </ul>
        </div>
      )}
    </ActionForm>
  );
}

/**
 * Load a sant list.
 *
 * A real directory arrives as a spreadsheet of a few hundred ascetics, most of
 * them historical, in one script. Typing those in one form at a time is not a
 * plan, and neither is a one-off script nobody can re-run: the list gets
 * corrected and re-sent.
 *
 * DRY RUN FIRST, ALWAYS. The preview is what a real run would do, row by row,
 * so a bad column mapping is discovered before it becomes three hundred public
 * profiles of named people. Only after reading it can the curator commit.
 */
function ImportForm({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('');
  const [verified, setVerified] = useState(false);
  const [onDuplicate, setOnDuplicate] = useState('skip');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  interface ImportResult {
    dry_run: boolean; total: number; created: number; updated: number; skipped: number; failed: number;
    results: Array<{ row: number; action: string; name: string; message?: string }>;
  }

  /**
   * CSV or JSON, because a curator has whichever the list arrived as.
   *
   * The CSV branch is deliberately simple — split on commas, first row is the
   * header — and says so: a name containing a comma has to be quoted, and the
   * dry-run preview is where that shows up as a wrong-looking name rather than
   * as a corrupted profile.
   */
  function parse(raw: string): Record<string, unknown>[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [parsed];
    }
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
    const header = splitCsv(lines[0]).map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cells = splitCsv(line);
      const row: Record<string, unknown> = {};
      header.forEach((h, i) => {
        const v = (cells[i] ?? '').trim();
        if (!v) return;
        row[h] = h === 'diksha_year' ? Number(v) : v;
      });
      return row;
    });
  }

  /** Splits one CSV line, honouring "quoted, fields". */
  function splitCsv(line: string): string[] {
    const out: string[] = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  async function run(dryRun: boolean) {
    setBusy(true); setError(null);
    try {
      const rows = parse(text);
      if (!rows.length) throw new Error('Nothing to import — paste the list above.');
      const { data } = await api<ImportResult>('/admin/maharaj/import', {
        method: 'POST',
        body: { rows, dry_run: dryRun, verified, on_duplicate: onDuplicate },
      });
      setPreview(data);
      if (!dryRun) onDone();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <div>
      <ErrorBox error={error} />
      <p className="muted" style={{ marginBottom: 8 }}>
        Paste CSV (first row = column names) or a JSON array. Columns:{' '}
        <code>name_en, name_hi, type, pad, sect, sub_sect, samuday, city, state, diksha_year,
        guru_name, bio, samadhi, samadhi_date, tithi_note, rep_mobile, rep_name</code>. At least one
        of name_en / name_hi is required per row.
      </p>
      <p className="muted" style={{ marginBottom: 8, fontSize: 12 }}>
        <code>samadhi</code> takes <code>true</code>/<code>false</code> and is what marks an entry as
        a memorial — set it for every ascetic the list records as having attained samadhi, whether or
        not <code>samadhi_date</code> is known. A list whose status column says so but carries no
        date is the usual shape, and leaving those rows unmarked files them as living: devotees then
        set out for a darshan that cannot happen.
      </p>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setPreview(null); }}
        rows={10}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
        placeholder={'name_en,name_hi,type,pad,sect,samadhi,samadhi_date\nAcharya Vidyasagar Ji,आचार्य विद्यासागर जी,muni,acharya,digambar,true,2024-02-17\nMuni Shri Kshama Sagar Ji,मुनिश्री क्षमासागर जी,muni,none,digambar,true,'}
      />
      <label className="field-check">
        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
        <span>Publish immediately (otherwise they land in the verification queue)</span>
      </label>
      <label className="field"><span>If a name already exists</span>
        <select value={onDuplicate} onChange={(e) => setOnDuplicate(e.target.value)}>
          <option value="skip">Skip it — leave the existing profile alone</option>
          <option value="update">Fill in the fields this list carries</option>
        </select>
      </label>
      <p className="muted" style={{ fontSize: 12 }}>
        Updating never blanks a field a curator filled in by hand — only empty ones are filled.
      </p>

      {preview && (
        <div style={{
          margin: '12px 0', padding: 10, borderRadius: 8,
          background: preview.failed ? '#fffbeb' : '#f0fdf4',
          border: `1px solid ${preview.failed ? '#fde68a' : '#bbf7d0'}`,
        }}>
          <strong style={{ fontSize: 13 }}>
            {preview.dry_run ? 'Preview — nothing has been written' : 'Imported'}: {preview.created} new,
            {' '}{preview.updated} updated, {preview.skipped} skipped, {preview.failed} failed
          </strong>
          <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6 }}>
            <table className="data">
              <tbody>
                {preview.results.map((r) => (
                  <tr key={r.row}>
                    <td className="muted" style={{ width: 32 }}>{r.row}</td>
                    <td>{r.name || <span className="muted">(no name)</span>}</td>
                    <td className={r.action === 'error' ? 'danger' : 'muted'}>{r.action}</td>
                    <td className="muted">{r.message ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="actions">
        <button className="btn" disabled={busy || !text.trim()} onClick={() => run(true)}>
          {busy ? 'Checking…' : 'Preview'}
        </button>{' '}
        {/* Commit is unavailable until a preview has been read. The whole point
            of the dry run is that somebody looked at it. */}
        <button className="btn primary" disabled={busy || !preview?.dry_run} onClick={() => run(false)}>
          Import for real
        </button>
      </div>
    </div>
  );
}
