import { useCallback, useEffect, useState } from 'react';
import { api, formatDate } from '../api/client';
import type { Sangh, SanghHead } from '../api/types';
import { ActionForm, Badge, ErrorBox, Modal, useToast } from '../components/ui';

/**
 * Sanghs — the groups ascetics belong to (migration 047).
 *
 * Curated here and nowhere else, for the same reason sant profiles have been
 * Super-Admin-only since 044: a sangh answers to several head ascetics at once,
 * so there is no single portal user who could be trusted to rename or delete
 * it. Membership itself is set from the Sadhu-Sadhvi page, where the ascetics
 * are — this page owns the sangh, not the roster.
 */
export function SanghsPage() {
  const [rows, setRows] = useState<Sangh[]>([]);
  const [q, setQ] = useState('');
  const [verifiedFilter, setVerifiedFilter] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Sangh | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (verifiedFilter) params.set('verified', verifiedFilter);
    api<Sangh[]>(`/admin/sanghs?${params}`)
      .then((r) => setRows(r.data ?? []))
      .catch(setError);
  }, [q, verifiedFilter]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setError(null);
    try {
      await fn();
      load();
      if (done) toast.show(done);
    } catch (e) { setError(e); }
  }

  const unverified = rows.filter((r) => !r.verified).length;

  return (
    <div>
      {toast.node}
      <h1>Sanghs</h1>
      <ErrorBox error={error} />

      {unverified > 0 && (
        <div style={{
          margin: '0 0 16px', padding: 12, borderRadius: 8,
          background: '#fffbeb', border: '1px solid #fde68a',
        }}>
          <strong style={{ fontSize: 13 }}>{unverified} sangh(s) are not verified yet</strong>
          {/* The seed in migration 047 was collated from the public Digambar
              directories, so every row arrived as a starting point rather than
              a fact this system asserts. Devotees see verified sanghs only. */}
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
            Seeded names are unverified on purpose — check the spelling and the parampara,
            then verify. Only verified sanghs appear to devotees.
          </p>
        </div>
      )}

      <div className="toolbar">
        <input placeholder="Search name (either script) / parampara…" value={q}
          onChange={(e) => setQ(e.target.value)} />
        <select value={verifiedFilter} onChange={(e) => setVerifiedFilter(e.target.value)}>
          <option value="">All</option>
          <option value="false">Pending verification</option>
          <option value="true">Verified</option>
        </select>
        <div className="grow" />
        <button className="btn primary" onClick={() => setShowCreate(true)}>+ Add sangh</button>
      </div>

      <table className="data">
        <thead>
          <tr>
            <th>Name</th><th>Hindi</th><th>Parampara</th><th>Head Sadhu-Sadhvi</th>
            <th>Members</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((sg) => (
            <tr key={sg.id}>
              <td>
                {sg.name_en}
                {sg.sect && <div className="muted" style={{ fontSize: 11 }}>{sg.sect}</div>}
              </td>
              <td>{sg.name_hi || <span className="muted">— not set</span>}</td>
              <td>{sg.parampara || <span className="muted">—</span>}</td>
              {/* Several heads is the normal case, not an edge one: an Acharya
                  who has handed the pad on, plus the Upadhyayas, Munis and
                  Aryikas leading their own travelling groups. */}
              <td>
                {sg.heads.length === 0
                  ? <span className="muted">— none marked</span>
                  : sg.heads.map((h: SanghHead) => (
                      <div key={h.id} style={{ fontSize: 12 }}>{h.name_en || h.name}</div>
                    ))}
              </td>
              <td>{sg.members_count}</td>
              <td>
                <Badge value={sg.verified} />
                <div className="muted" style={{ fontSize: 11 }}>{formatDate(sg.created_at)}</div>
              </td>
              <td>
                <button className="btn sm" onClick={() => setEditing(sg)}>Edit</button>{' '}
                {!sg.verified ? (
                  <button className="btn sm primary" onClick={() => run(
                    () => api(`/admin/sanghs/${sg.id}`, { method: 'PATCH', body: { verified: true } }),
                    `${sg.name_en} is now verified and visible to devotees.`,
                  )}>Verify</button>
                ) : (
                  <button className="btn sm" onClick={() => run(
                    () => api(`/admin/sanghs/${sg.id}`, { method: 'PATCH', body: { verified: false } }),
                    `${sg.name_en} is no longer verified — hidden from devotees.`,
                  )}>Un-verify</button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="muted">No sanghs found.</td></tr>}
        </tbody>
      </table>

      {showCreate && (
        <Modal title="Add sangh" onClose={() => setShowCreate(false)}>
          <SanghForm onDone={() => { setShowCreate(false); load(); toast.show('Sangh created.'); }} />
        </Modal>
      )}
      {editing && (
        <Modal title={editing.name_en} onClose={() => setEditing(null)}>
          <SanghForm
            sangh={editing}
            onDone={() => { setEditing(null); load(); toast.show('Saved.'); }}
            onDelete={async () => {
              const { data } = await api<{ detached: number }>(`/admin/sanghs/${editing.id}`, { method: 'DELETE' });
              setEditing(null);
              load();
              toast.show(data.detached
                ? `Sangh deleted. ${data.detached} Sadhu-Sadhvi were detached, not deleted.`
                : 'Sangh deleted.');
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function SanghForm({ sangh, onDone, onDelete }: {
  sangh?: Sangh;
  onDone: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name_en: sangh?.name_en ?? '',
    name_hi: sangh?.name_hi ?? '',
    parampara: sangh?.parampara ?? '',
    sect: sangh?.sect ?? '',
    about: sangh?.about ?? '',
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <ActionForm
        submitLabel={sangh ? 'Save' : 'Create sangh'}
        onDone={onDone}
        onSubmit={async () => {
          const body = {
            name_en: form.name_en.trim(),
            name_hi: form.name_hi.trim() || null,
            parampara: form.parampara.trim() || null,
            sect: form.sect || null,
            about: form.about.trim() || null,
          };
          if (sangh) await api(`/admin/sanghs/${sangh.id}`, { method: 'PATCH', body });
          else await api('/admin/sanghs', { method: 'POST', body });
        }}>
        <label className="field">
          <span>Name (English)</span>
          <input value={form.name_en} onChange={set('name_en')}
            placeholder="Acharya Shri 108 Vidyasagarji Maharaj Sangh" />
        </label>
        {/* Never transliterated, only entered — the rule sant names have
            followed since 044. A machine-guessed Devanagari spelling would be
            shown to devotees as the sangh's name. */}
        <label className="field">
          <span>Name (Hindi)</span>
          <input value={form.name_hi} onChange={set('name_hi')} placeholder="देवनागरी में" />
        </label>
        <label className="field">
          <span>Parampara</span>
          <input value={form.parampara} onChange={set('parampara')} list="parampara-options"
            placeholder="Lineage the sangh descends from" />
          {/* A datalist, not a select: the three modern Digambar paramparas
              cover most rows, but the historical ganas (Balatkara, Nandi, Sena,
              Deshiya) are open-ended and a closed list would block them. */}
          <datalist id="parampara-options">
            <option value="Charitra Chakravarti Acharya Shantisagarji (Dakshin)" />
            <option value="Acharya Shantisagarji (Chhani)" />
            <option value="Acharya Aadisagarji (Ankalikar)" />
          </datalist>
        </label>
        <label className="field">
          <span>Sampradaya</span>
          <select value={form.sect} onChange={set('sect')}>
            <option value="">— not set —</option>
            <option value="digambar">Digambar</option>
            <option value="shwetambar">Shwetambar</option>
          </select>
        </label>
        <label className="field">
          <span>About</span>
          <textarea rows={3} value={form.about} onChange={set('about')} />
        </label>
      </ActionForm>

      {onDelete && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
          {!confirmDelete ? (
            <button className="btn sm" onClick={() => setConfirmDelete(true)}>Delete sangh</button>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
                {sangh?.members_count
                  ? `${sangh.members_count} Sadhu-Sadhvi will be detached from this sangh. Their profiles, locations and vihar are not touched.`
                  : 'This sangh has no members.'}
              </p>
              <button className="btn sm danger" onClick={onDelete}>Yes, delete</button>{' '}
              <button className="btn sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </>
          )}
        </div>
      )}
    </>
  );
}
