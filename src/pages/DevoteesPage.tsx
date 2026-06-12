import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, type ApiMeta } from '../api/client';
import type { Devotee } from '../api/types';
import { ActionForm, Badge, ErrorBox, Modal, Pagination } from '../components/ui';

export function DevoteesPage() {
  const [rows, setRows] = useState<Devotee[]>([]);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [verifiedFilter, setVerifiedFilter] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Devotee | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: '25' });
    if (q) params.set('q', q);
    if (verifiedFilter) params.set('verified', verifiedFilter);
    api<Devotee[]>(`/admin/devotees?${params}`)
      .then((r) => { setRows(r.data); setMeta(r.meta); })
      .catch(setError);
  }, [page, q, verifiedFilter]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); load(); } catch (e) { setError(e); }
  }

  return (
    <div>
      <h1>Manage Devotees</h1>
      <ErrorBox error={error} />
      <div className="toolbar">
        <input placeholder="Search name / mobile / email…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select value={verifiedFilter} onChange={(e) => { setVerifiedFilter(e.target.value); setPage(1); }}>
          <option value="">All</option>
          <option value="true">Verified</option>
          <option value="false">Not verified</option>
        </select>
        <div className="grow" />
        <button className="btn primary" onClick={() => setShowCreate(true)}>+ Add Devotee</button>
      </div>

      <table className="data">
        <thead>
          <tr><th>Name</th><th>Mobile</th><th>City / State</th><th>Verified</th><th>Joined</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td>{d.name ?? <span className="muted">—</span>}</td>
              <td className="mono">{d.mobile}</td>
              <td>{[d.city, d.state].filter(Boolean).join(', ') || '—'}</td>
              <td><Badge value={d.verified} /></td>
              <td>{formatDate(d.created_at)}</td>
              <td>
                <button className="btn sm" onClick={() => setEditing(d)}>Edit</button>{' '}
                {!d.verified ? (
                  <button className="btn sm" onClick={() => run(() =>
                    api(`/admin/devotees/${d.id}/verify`, { method: 'PATCH', body: { verified: true, method: 'manual', note: 'verified from console' } }),
                  )}>Verify</button>
                ) : (
                  <button className="btn sm" onClick={() => run(() =>
                    api(`/admin/devotees/${d.id}/verify`, { method: 'PATCH', body: { verified: false } }),
                  )}>Un-verify</button>
                )}{' '}
                <button className="btn sm danger" onClick={() => {
                  if (confirm(`Delete devotee ${d.mobile}? (DPDPA erasure workflow)`)) {
                    run(() => api(`/admin/devotees/${d.id}`, { method: 'DELETE' }));
                  }
                }}>Delete</button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="muted">No devotees found.</td></tr>}
        </tbody>
      </table>
      {meta && <Pagination page={page} total={meta.total} limit={25} onPage={setPage} />}

      {showCreate && (
        <Modal title="Add devotee" onClose={() => setShowCreate(false)}>
          <DevoteeForm onDone={() => { setShowCreate(false); load(); }} />
        </Modal>
      )}
      {editing && (
        <Modal title={`Edit ${editing.mobile}`} onClose={() => setEditing(null)}>
          <DevoteeForm devotee={editing} onDone={() => { setEditing(null); load(); }} />
        </Modal>
      )}
    </div>
  );
}

function DevoteeForm({ devotee, onDone }: { devotee?: Devotee; onDone: () => void }) {
  const [form, setForm] = useState({
    mobile: devotee?.mobile ?? '',
    name: devotee?.name ?? '',
    email: devotee?.email ?? '',
    city: devotee?.city ?? '',
    state: devotee?.state ?? '',
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <ActionForm submitLabel={devotee ? 'Save' : 'Create'} onDone={onDone}
      onSubmit={async () => {
        if (devotee) {
          await api(`/admin/devotees/${devotee.id}`, {
            method: 'PATCH',
            body: { name: form.name, email: form.email || undefined, city: form.city || undefined, state: form.state || undefined },
          });
        } else {
          await api('/admin/devotees', {
            method: 'POST',
            body: { mobile: form.mobile, name: form.name || undefined, email: form.email || undefined, city: form.city || undefined, state: form.state || undefined },
          });
        }
      }}>
      {!devotee && (
        <label className="field"><span>Mobile (+91…)</span><input name="mobile" value={form.mobile} onChange={set('mobile')} required /></label>
      )}
      <label className="field"><span>Name</span><input name="name" value={form.name} onChange={set('name')} /></label>
      <label className="field"><span>Email</span><input value={form.email} onChange={set('email')} /></label>
      <label className="field"><span>City</span><input value={form.city} onChange={set('city')} /></label>
      <label className="field"><span>State</span><input value={form.state} onChange={set('state')} /></label>
    </ActionForm>
  );
}
