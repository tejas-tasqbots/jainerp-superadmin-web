import { useCallback, useEffect, useState } from 'react';
import { api, loadSession } from '../api/client';
import { DeleteEntryButton } from '../components/DeleteEntryButton';
import { ActionForm, ErrorBox, Modal, Pagination } from '../components/ui';

/**
 * Demo requests from the "Request a demo" form on jainerp.org.
 *
 * Leads, not subscriptions — like Custom Requests beside it. The job here is to
 * call the trust back, agree a time, and record how it went. A trust that wants
 * to go ahead registers itself (or is set up from Manage Mandir); nothing on this
 * page provisions anything.
 */

interface DemoRequest {
  id: string;
  reference: string;
  contact_name: string;
  mobile: string;
  email: string | null;
  trust_name: string;
  city: string | null;
  state: string | null;
  preferred_date: string | null; // yyyy-mm-dd
  preferred_slot: string | null;
  preferred_language: string | null;
  message: string | null;
  status: string;
  scheduled_at: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  internal_notes: string | null;
  source: string;
  created_at: string;
}

type Meta = { page: number; limit: number; total: number; counts?: Record<string, number> };

const STATUSES = ['new', 'contacted', 'scheduled', 'completed', 'converted', 'lost'] as const;

const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  scheduled: 'Scheduled',
  completed: 'Demo done',
  converted: 'Converted',
  lost: 'Lost',
};

const SLOT_LABEL: Record<string, string> = {
  morning: 'Morning (10am–1pm)',
  afternoon: 'Afternoon (1pm–5pm)',
  evening: 'Evening (5pm–8pm)',
};

const LANGUAGE_LABEL: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  mr: 'Marathi',
  gu: 'Gujarati',
  kn: 'Kannada',
  mwr: 'Marwadi',
};

const LIMIT = 50;

/**
 * Colour by phase, so the list scans without reading: blue waits on us, gold is
 * in hand, green went well, red did not. Every status needs one — a bare
 * `.badge` renders colourless (see styles.css).
 */
const STATUS_TONE: Record<string, string> = {
  new: 'blue',
  contacted: 'in_progress',
  scheduled: 'in_progress',
  completed: 'green',
  converted: 'green',
  lost: 'red',
};

function statusBadge(status: string) {
  return <span className={`badge ${STATUS_TONE[status] ?? ''}`}>{STATUS_LABEL[status] ?? status}</span>;
}

/** "Sat 20 Sep" — the day of the week matters when agreeing a time by phone. */
function formatDay(isoDate: string) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The requester's wish, in one line: "Sat 20 Sep · Morning · Hindi". */
function preference(r: DemoRequest) {
  const parts = [
    r.preferred_date ? formatDay(r.preferred_date) : null,
    r.preferred_slot ? (SLOT_LABEL[r.preferred_slot] ?? r.preferred_slot).split(' (')[0] : null,
    r.preferred_language ? (LANGUAGE_LABEL[r.preferred_language] ?? r.preferred_language) : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export function DemoRequestsPage() {
  const [rows, setRows] = useState<DemoRequest[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<DemoRequest | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) qs.set('status', status);
    if (q) qs.set('q', q);
    api<DemoRequest[]>(`/admin/demo-requests?${qs}`)
      .then((r) => {
        setRows(r.data);
        setMeta(r.meta as Meta | null);
        setError(null);
      })
      .catch(setError);
  }, [status, q, page]);
  useEffect(load, [load]);

  const counts = meta?.counts ?? {};
  const all = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div>
      <h1>Demo Requests</h1>
      <p className="muted">People who asked for a demo on jainerp.org. Call them, then mark the request handled.</p>
      <ErrorBox error={error} />
      {notice && <div className="success-box" data-testid="notice">{notice}</div>}

      <div className="toolbar">
        <p className="muted" style={{ margin: 0 }}>
          From the “Request a demo” form on jainerp.org. Call the trust back, agree a time and mark it
          scheduled. These are leads — nothing here creates a mandir.
        </p>
      </div>

      <div className="tabs" role="tablist">
        {[['', `All (${all})`] as const, ...STATUSES.map((s) => [s, `${STATUS_LABEL[s]} (${counts[s] ?? 0})`] as const)].map(
          ([value, label]) => (
            <button
              key={value || 'all'}
              role="tab"
              aria-selected={status === value}
              className={status === value ? 'active' : ''}
              onClick={() => {
                setStatus(value);
                setPage(1);
              }}
            >
              {label}
            </button>
          ),
        )}
      </div>

      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQ(search.trim());
        }}
      >
        <input
          type="search"
          placeholder="Search name, trust, mobile, city or DEMO- reference"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          // Inputs are full-width by default here, which pushed Search onto a
          // line of its own.
          style={{ width: 400, maxWidth: '100%' }}
        />
        <button className="btn" type="submit">Search</button>
        <div className="grow" />
        <button className="btn" type="button" onClick={load}>Refresh</button>
      </form>

      <table className="data">
        <thead>
          <tr>
            <th>Trust / Temple</th>
            <th>Contact</th>
            <th>Asked for</th>
            <th>Status</th>
            <th>Booked for</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-testid={`demo-request-${r.reference}`}>
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
                <a className="mono" href={`tel:${r.mobile}`}>{r.mobile}</a>
                {r.email && <div className="muted" style={{ fontSize: 11 }}>{r.email}</div>}
              </td>
              <td>
                {preference(r) ?? <span className="muted">Any time</span>}
                {r.message && (
                  <div className="muted" style={{ fontSize: 11, maxWidth: 260 }} title={r.message}>
                    “{r.message.length > 80 ? `${r.message.slice(0, 80)}…` : r.message}”
                  </div>
                )}
              </td>
              <td>{statusBadge(r.status)}</td>
              <td>
                {r.scheduled_at ? formatDateTime(r.scheduled_at) : <span className="muted">—</span>}
                {r.assigned_to_name && (
                  <div className="muted" style={{ fontSize: 11 }}>{r.assigned_to_name}</div>
                )}
              </td>
              <td>
                <button className="btn sm" onClick={() => setEditing(r)}>Open</button>
                {(<>{' '}<DeleteEntryButton
                  path={`/admin/demo-requests/${r.id}`}
                  what={`demo request ${r.reference}`}
                  note="If it was added to Leads, that lead is deleted with it."
                  onDeleted={(m) => { setError(null); setNotice(m); load(); }}
                  onError={setError}
                /></>)}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                {q || status ? 'No demo requests match.' : 'No demo requests yet.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {meta && <Pagination page={meta.page} total={meta.total} limit={meta.limit} onPage={setPage} />}

      {editing && (
        <Modal title={`${editing.trust_name} — ${editing.reference}`} onClose={() => setEditing(null)}>
          <DemoRequestDetail
            req={editing}
            onDone={() => {
              setEditing(null);
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

/** ISO timestamp → the local "yyyy-mm-ddThh:mm" a datetime-local input needs. */
function toLocalInput(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function DemoRequestDetail({ req, onDone }: { req: DemoRequest; onDone: () => void }) {
  const me = loadSession()?.user;
  const [f, setF] = useState({
    status: req.status,
    scheduled_at: toLocalInput(req.scheduled_at),
    internal_notes: req.internal_notes ?? '',
    assign_to_me: false,
  });

  return (
    <div>
      <table className="data">
        <tbody>
          <tr>
            <th style={{ textAlign: 'left', width: 180 }}>Contact</th>
            <td>
              {req.contact_name} · <a href={`tel:${req.mobile}`}>{req.mobile}</a>
              {req.email ? <> · <a href={`mailto:${req.email}`}>{req.email}</a></> : ''}
            </td>
          </tr>
          <tr><th style={{ textAlign: 'left' }}>Location</th><td>{[req.city, req.state].filter(Boolean).join(', ') || '—'}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Preferred date</th><td>{req.preferred_date ? formatDay(req.preferred_date) : 'Any'}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Preferred time</th><td>{req.preferred_slot ? (SLOT_LABEL[req.preferred_slot] ?? req.preferred_slot) : 'Any'}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Demo language</th><td>{req.preferred_language ? (LANGUAGE_LABEL[req.preferred_language] ?? req.preferred_language) : '—'}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Message</th><td style={{ whiteSpace: 'pre-wrap' }}>{req.message ?? '—'}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Received</th><td>{new Date(req.created_at).toLocaleString('en-IN')} · {req.source.replace(/_/g, ' ')}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Assigned to</th><td>{req.assigned_to_name ?? '—'}</td></tr>
        </tbody>
      </table>

      <h3 style={{ marginTop: 16 }}>Follow-up</h3>
      <ActionForm
        submitLabel="Save"
        onDone={onDone}
        onSubmit={async () => {
          await api(`/admin/demo-requests/${req.id}`, {
            method: 'PATCH',
            body: {
              status: f.status,
              // Present-means-write on this endpoint: an emptied box is sent as
              // null so a cancelled demo really loses its time, and emptied
              // notes really clear.
              scheduled_at: f.scheduled_at ? new Date(f.scheduled_at).toISOString() : null,
              internal_notes: f.internal_notes.trim() || null,
              ...(f.assign_to_me && me ? { assigned_to: me.id } : {}),
            },
          });
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field"><span>Status</span>
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="field"><span>Demo booked for{f.status === 'scheduled' ? ' *' : ''}</span>
            <input
              type="datetime-local"
              value={f.scheduled_at}
              onChange={(e) => setF({ ...f, scheduled_at: e.target.value })}
            />
          </label>
        </div>
        {me && req.assigned_to !== me.id && (
          <label className="field-check">
            <input
              type="checkbox"
              checked={f.assign_to_me}
              onChange={(e) => setF({ ...f, assign_to_me: e.target.checked })}
            />
            Assign to me
          </label>
        )}
        <label className="field"><span>Internal notes (never shown to the trust)</span>
          <textarea rows={4} value={f.internal_notes} onChange={(e) => setF({ ...f, internal_notes: e.target.value })} />
        </label>
      </ActionForm>
    </div>
  );
}
