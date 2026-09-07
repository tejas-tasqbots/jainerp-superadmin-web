import { useCallback, useEffect, useState } from 'react';
import { api, formatDate } from '../api/client';
import { Badge, ErrorBox, Modal } from '../components/ui';

/**
 * What sangh representatives have posted, waiting to be published.
 *
 * ── WHY THIS PAGE EXISTS ────────────────────────────────────────────────────
 * Since 2026-09 a sangh representative may change the sant's LOCATION directly
 * and nothing else. Corrections to the profile columns go to the Change
 * requests queue; what lands here is the content they POST — events,
 * aahaar/vihar requirements, broadcasts, web links and published works.
 *
 * Those are not corrections to an existing value, so they are not change
 * requests: the row is created immediately in `review_state = 'pending'` and
 * simply is not published until it is approved here (migration 078 §5). The
 * representative can still edit their own pending item, which is the thing a
 * store-the-proposal-beside-the-record design cannot do.
 *
 * ── APPROVING IS ALSO WHAT NOTIFIES ─────────────────────────────────────────
 * An event, a requirement and a broadcast used to fan out to every follower the
 * instant the representative pressed send. They now fan out on approval, from
 * this page. That is stated in the modal, because "Approve" reading as a filing
 * action when it actually sends a WhatsApp to two thousand people is exactly
 * the sort of surprise that makes a reviewer stop trusting the queue.
 */

type Kind = 'event' | 'requirement' | 'broadcast' | 'link' | 'publication';

interface PendingItem {
  id: string;
  kind: Kind;
  sant_id: string;
  sant_name: string | null;
  verification_state: 'unverified' | 'verified' | null;
  label: string | null;
  preview: string | null;
  created_at: string;
}

/** What a reviewer is looking at, in words rather than table names. */
const KIND_LABELS: Record<Kind, string> = {
  event: 'Event',
  requirement: 'Requirement',
  broadcast: 'Broadcast',
  link: 'Web link',
  publication: 'Published work',
};

/**
 * What approving actually does, per kind.
 *
 * Only the three that notify carry a warning. A link and a published work
 * simply become visible, and padding those with a caution nobody needs is how
 * a warning stops being read on the three where it matters.
 */
const ON_APPROVE: Partial<Record<Kind, string>> = {
  event:
    'Approving publishes this event AND notifies every follower of this ascetic. '
    + 'Nothing has been sent yet.',
  requirement:
    'Approving publishes this requirement AND notifies every follower — in the app '
    + 'and, where a mobile number is on file, by WhatsApp. Nothing has been sent yet.',
  broadcast:
    'Approving sends this message to every follower of this ascetic, in the app and '
    + 'by WhatsApp. This is the loudest action in the console and it cannot be recalled.',
};

const KINDS: Array<{ value: '' | Kind; label: string }> = [
  { value: '', label: 'Everything' },
  { value: 'event', label: 'Events' },
  { value: 'requirement', label: 'Requirements' },
  { value: 'broadcast', label: 'Broadcasts' },
  { value: 'link', label: 'Web links' },
  { value: 'publication', label: 'Published works' },
];

export function SantContentPage() {
  const [rows, setRows] = useState<PendingItem[]>([]);
  const [kind, setKind] = useState<'' | Kind>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [review, setReview] = useState<{ row: PendingItem; mode: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<PendingItem[]>(`/admin/maharaj/pending-content${kind ? `?kind=${kind}` : ''}`)
      .then((r) => setRows(r.data ?? []))
      .catch(setError)
      .finally(() => setLoading(false));
  }, [kind]);

  useEffect(load, [load]);

  async function decide() {
    if (!review) return;
    // A rejection with no reason produces a support call and a re-submission of
    // the same thing, so the server refuses it — checked here too, so the
    // reviewer is told before the round trip rather than by a 400.
    if (review.mode === 'reject' && !note.trim()) return;
    setBusy(true);
    try {
      await api(
        `/admin/maharaj/content/${review.row.kind}/${review.row.id}/${review.mode}`,
        { method: 'POST', body: { note: note.trim() || undefined } },
      );
      setReview(null);
      setNote('');
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Pending sant content</h1>
      <p className="muted" style={{ maxWidth: 760 }}>
        Posted by sangh representatives and not yet visible to devotees. A representative
        changes the ascetic&apos;s location directly; everything else — events, requirements,
        broadcasts, links and published works — comes here first.
      </p>
      <label className="field" style={{ maxWidth: 320 }}>
        <span>Show</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as '' | Kind)}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>
      </label>

      <ErrorBox error={error} />

      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">Nothing is waiting for review.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Sadhu-Sadhvi</th>
              <th>What</th>
              <th>Submitted</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.kind}:${row.id}`}>
                <td><Badge value={row.kind} /></td>
                <td>
                  {row.sant_name ?? row.sant_id}
                  {/* The attestation of the PROFILE, shown beside its pending
                      content: approving a broadcast under a name nobody has
                      checked is a different decision from approving one under a
                      name we have stood behind, and the reviewer should not
                      have to open another tab to find out which this is. */}
                  {row.verification_state !== 'verified' && (
                    <span className="muted"> · profile not verified</span>
                  )}
                </td>
                <td>
                  <strong>{row.label || '—'}</strong>
                  {row.preview && (
                    <div className="muted" style={{ maxWidth: 460 }}>
                      {row.preview.length > 180 ? `${row.preview.slice(0, 180)}…` : row.preview}
                    </div>
                  )}
                </td>
                <td className="mono">{formatDate(row.created_at)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn primary"
                      onClick={() => { setReview({ row, mode: 'approve' }); setNote(''); }}
                    >
                      Publish
                    </button>
                    <button
                      className="btn"
                      onClick={() => { setReview({ row, mode: 'reject' }); setNote(''); }}
                    >
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {review && (
        <Modal
          title={review.mode === 'approve' ? `Publish this ${KIND_LABELS[review.row.kind].toLowerCase()}` : 'Reject'}
          onClose={() => setReview(null)}
        >
          <p>
            <strong>{review.row.sant_name ?? review.row.sant_id}</strong> —{' '}
            {KIND_LABELS[review.row.kind]}
          </p>
          <p><strong>{review.row.label}</strong></p>
          {review.row.preview && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{review.row.preview}</p>}

          {review.mode === 'approve' && ON_APPROVE[review.row.kind] && (
            <p style={{
              margin: '8px 0', padding: 10, borderRadius: 8,
              background: '#fffbeb', border: '1px solid #fde68a', fontSize: 13,
            }}>
              <strong>This also notifies followers.</strong>{' '}
              {ON_APPROVE[review.row.kind]}
            </p>
          )}

          <label className="field">
            <span>
              {review.mode === 'reject'
                ? 'Why (the sangh representative sees this)'
                : 'Note (optional)'}
            </span>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="actions">
            <button className="btn" onClick={() => setReview(null)}>Cancel</button>
            <button
              className="btn primary"
              disabled={busy || (review.mode === 'reject' && !note.trim())}
              onClick={decide}
            >
              {busy ? 'Working…' : review.mode === 'approve' ? 'Publish' : 'Reject'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
