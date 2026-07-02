import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, type ApiMeta } from '../api/client';
import type { MaharajProfile } from '../api/types';
import { Badge, ErrorBox, Pagination } from '../components/ui';

export function MaharajPage() {
  const [rows, setRows] = useState<MaharajProfile[]>([]);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [verifiedFilter, setVerifiedFilter] = useState('false');
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: '25' });
    if (q) params.set('q', q);
    if (verifiedFilter) params.set('verified', verifiedFilter);
    api<MaharajProfile[]>(`/admin/maharaj?${params}`)
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
      <h1>Maharaj / Mataji Directory</h1>
      <ErrorBox error={error} />
      <div className="toolbar">
        <input placeholder="Search name / samuday…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select value={verifiedFilter} onChange={(e) => { setVerifiedFilter(e.target.value); setPage(1); }}>
          <option value="false">Pending verification</option>
          <option value="true">Verified</option>
          <option value="">All</option>
        </select>
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
                {!m.verified ? (
                  <button className="btn sm primary" onClick={() => run(() =>
                    api(`/admin/maharaj/${m.id}/verify`, { method: 'PATCH', body: { verified: true } }),
                  )}>Verify</button>
                ) : (
                  <button className="btn sm" onClick={() => run(() =>
                    api(`/admin/maharaj/${m.id}/verify`, { method: 'PATCH', body: { verified: false } }),
                  )}>Un-verify</button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} className="muted">No profiles found.</td></tr>}
        </tbody>
      </table>
      {meta && <Pagination page={page} total={meta.total} limit={25} onPage={setPage} />}
    </div>
  );
}
