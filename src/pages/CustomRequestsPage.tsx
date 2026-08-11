import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { ActionForm, ErrorBox, Modal } from '../components/ui';

/**
 * Custom-plan enquiry queue.
 *
 * Trusts that picked "Custom" instead of a priced plan — typically several
 * mandirs under one trust, a bespoke module set, or an integration. Nothing
 * here is auto-provisioned: the commercial conversation happens first, and the
 * deal is then set up as a normal tenant with a per-tenant `custom_plan`
 * override.
 */

interface CustomRequest {
  id: string;
  reference: string;
  registration_id: string | null;
  trust_name: string;
  contact_name: string;
  mobile: string;
  email: string | null;
  city: string | null;
  state: string | null;
  modules: string[];
  num_mandirs: number | null;
  num_trusts: number | null;
  num_users: number | null;
  needs_separate_dbs: boolean;
  expected_scale: string | null;
  integrations: string | null;
  special_requirements: string | null;
  notes: string | null;
  status: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
  follow_up_at: string | null;
  internal_notes: string | null;
  tenant_id: string | null;
  source: string;
  created_at: string;
}

const STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost'];

function statusBadge(status: string) {
  if (status === 'won') return <span className="badge green">Won</span>;
  if (status === 'lost') return <span className="badge red">Lost</span>;
  if (status === 'new') return <span className="badge blue">New</span>;
  return <span className="badge">{status}</span>;
}

export function CustomRequestsPage() {
  const [rows, setRows] = useState<CustomRequest[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<CustomRequest | null>(null);

  const load = useCallback(() => {
    const qs = status ? `?status=${status}` : '';
    api<CustomRequest[]>(`/admin/custom-requests${qs}`).then((r) => setRows(r.data)).catch(setError);
  }, [status]);
  useEffect(load, [load]);

  return (
    <div>
      <h1>Custom Requests</h1>
      <ErrorBox error={error} />

      <div className="toolbar">
        <p className="muted" style={{ margin: 0 }}>
          Enquiries from the Custom plan on the website and the registration wizard. These are leads, not
          subscriptions — nothing is activated until the commercial process is complete.
        </p>
      </div>

      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="grow" />
        <button className="btn" onClick={load}>Refresh</button>
      </div>

      <table className="data">
        <thead>
          <tr>
            <th>Organisation</th>
            <th>Contact</th>
            <th>Scale</th>
            <th>Modules</th>
            <th>Status</th>
            <th>Follow-up</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-testid={`custom-request-${r.reference}`}>
              <td>
                <strong>{r.trust_name}</strong>
                <br />
                <span className="muted mono">{r.reference}</span>
                <div className="muted" style={{ fontSize: 11 }}>
                  {new Date(r.created_at).toLocaleDateString('en-IN')}
                  {r.city ? ` · ${r.city}` : ''}
                </div>
              </td>
              <td>
                {r.contact_name}
                <br />
                <span className="muted mono">{r.mobile}</span>
                {r.email && <div className="muted" style={{ fontSize: 11 }}>{r.email}</div>}
              </td>
              <td>
                {[
                  r.num_mandirs ? `${r.num_mandirs} mandirs` : null,
                  r.num_trusts ? `${r.num_trusts} trusts` : null,
                  r.num_users ? `${r.num_users} users` : null,
                ].filter(Boolean).join(', ') || <span className="muted">—</span>}
                {r.needs_separate_dbs && (
                  <div><span className="badge" style={{ fontSize: 10 }}>separate DBs</span></div>
                )}
              </td>
              <td style={{ maxWidth: 220 }}>
                {r.modules?.length ? r.modules.join(', ') : <span className="muted">—</span>}
              </td>
              <td>{statusBadge(r.status)}</td>
              <td>
                {r.follow_up_at
                  ? new Date(r.follow_up_at).toLocaleDateString('en-IN')
                  : <span className="muted">—</span>}
                {r.assigned_to_name && (
                  <div className="muted" style={{ fontSize: 11 }}>{r.assigned_to_name}</div>
                )}
              </td>
              <td>
                <button className="btn sm" onClick={() => setEditing(r)}>Open</button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="muted">No custom requests yet.</td></tr>
          )}
        </tbody>
      </table>

      {editing && (
        <Modal title={`${editing.trust_name} — ${editing.reference}`} onClose={() => setEditing(null)}>
          <RequestDetail req={editing} onDone={() => { setEditing(null); load(); }} />
        </Modal>
      )}
    </div>
  );
}

function RequestDetail({ req, onDone }: { req: CustomRequest; onDone: () => void }) {
  const [f, setF] = useState({
    status: req.status,
    internal_notes: req.internal_notes ?? '',
    // <input type="date"> wants yyyy-mm-dd; a full ISO timestamp renders blank.
    follow_up_at: req.follow_up_at ? req.follow_up_at.slice(0, 10) : '',
  });

  return (
    <div>
      <table className="data">
        <tbody>
          <tr><th style={{ textAlign: 'left', width: 180 }}>Contact</th><td>{req.contact_name} · {req.mobile}{req.email ? ` · ${req.email}` : ''}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Location</th><td>{[req.city, req.state].filter(Boolean).join(', ') || '—'}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Mandirs / Trusts / Users</th><td>{[req.num_mandirs, req.num_trusts, req.num_users].map((n) => n ?? '—').join(' / ')}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Separate databases</th><td>{req.needs_separate_dbs ? 'Yes' : 'No'}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Modules requested</th><td>{req.modules?.length ? req.modules.join(', ') : '—'}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Expected scale</th><td>{req.expected_scale ?? '—'}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Integrations</th><td>{req.integrations ?? '—'}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Special requirements</th><td style={{ whiteSpace: 'pre-wrap' }}>{req.special_requirements ?? '—'}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Other notes</th><td style={{ whiteSpace: 'pre-wrap' }}>{req.notes ?? '—'}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Source</th><td>{req.source.replace(/_/g, ' ')}</td></tr>
        </tbody>
      </table>

      <h3 style={{ marginTop: 16 }}>Follow-up</h3>
      <ActionForm
        submitLabel="Save"
        onDone={onDone}
        onSubmit={async () => {
          await api(`/admin/custom-requests/${req.id}`, {
            method: 'PATCH',
            body: {
              status: f.status,
              internal_notes: f.internal_notes || undefined,
              // Sent as a full timestamp — the column is timestamptz and the
              // API validates an ISO string.
              follow_up_at: f.follow_up_at ? new Date(f.follow_up_at).toISOString() : undefined,
            },
          });
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field"><span>Status</span>
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="field"><span>Follow up on</span>
            <input type="date" value={f.follow_up_at} onChange={(e) => setF({ ...f, follow_up_at: e.target.value })} />
          </label>
        </div>
        <label className="field"><span>Internal notes (never shown to the customer)</span>
          <textarea rows={4} value={f.internal_notes} onChange={(e) => setF({ ...f, internal_notes: e.target.value })} />
        </label>
      </ActionForm>
    </div>
  );
}
