import { useCallback, useEffect, useState } from 'react';
import { api, formatDate } from '../api/client';
import { Badge, ErrorBox, Modal } from '../components/ui';

/**
 * Review queue for changes to verified fields (migration 028).
 *
 * A verified mandir cannot rewrite its own bank account, UPI ID or 80G/PAN
 * numbers, and a verified ascetic cannot rename itself — those are what devotees
 * pay into and who they follow. Requests land here; approving writes the value
 * the reviewer read, on the mandir's behalf.
 */

interface ChangeRequest {
  id: string;
  // 'maharaj' is the pre-migration-035 value; still tolerated on read for one
  // release because an older sant-api may write it during a rolling deploy.
  subject_type: 'tenant' | 'sant' | 'maharaj';
  subject_id: string;
  subject_label: string | null;
  field: string;
  current_value: string | null;
  requested_value: string | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  requested_by_name: string | null;
  requested_at: string;
  reviewed_at: string | null;
  review_note: string | null;
}

/** Field keys are stable API identifiers; these are what a reviewer reads. */
const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  upi_id: 'UPI ID',
  upi_qr_cdn_url: 'UPI QR image',
  bank_account_name: 'Account holder',
  bank_account_no: 'Bank account number',
  bank_ifsc: 'IFSC',
  bank_name: 'Bank',
  pan: 'PAN',
  gstin: 'GSTIN',
  tan: 'TAN',
  reg_12a_number: '12A registration',
  reg_12ab_number: '12AB registration',
  reg_80g_number: '80G registration',
  reg_80g_urn: '80G URN',
  reg_80g_valid_upto: '80G valid up to',
  fssai_license: 'FSSAI licence',
  samuday: 'Samuday',
  guru_name: 'Guru',
};

export function ChangeRequestsPage() {
  const [rows, setRows] = useState<ChangeRequest[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [status, setStatus] = useState('pending');
  const [subjectType, setSubjectType] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [review, setReview] = useState<{ row: ChangeRequest; mode: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: '200' });
    if (status) params.set('status', status);
    if (subjectType) params.set('subject_type', subjectType);
    api<ChangeRequest[]>(`/admin/change-requests?${params}`)
      .then((r) => {
        setRows(r.data);
        setPendingCount(((r.meta as unknown as { pending?: number })?.pending) ?? 0);
      })
      .catch(setError);
  }, [status, subjectType]);
  useEffect(load, [load]);

  async function submit() {
    if (!review) return;
    // A rejection without a reason just produces a support call — the API
    // enforces this too, but failing here keeps the round trip off the wire.
    if (review.mode === 'reject' && !note.trim()) return;
    setSaving(true);
    setError(null);
    try {
      // `api()` serialises the body itself — passing a pre-stringified body
      // would send a bare JSON *string*, which body-parser rejects in strict
      // mode ("Unexpected token '\"' … is not valid JSON").
      await api(`/admin/change-requests/${review.row.id}/${review.mode}`, {
        method: 'PATCH',
        body: { note: note.trim() || undefined },
      });
      setReview(null);
      setNote('');
      load();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1>Change Requests {pendingCount > 0 && <Badge value={`${pendingCount} pending`} />}</h1>
      <p className="muted">
        Verified mandirs and ascetics cannot edit their own bank, tax or identity
        details. Check each request against the mandir's paperwork before approving —
        approving writes the new value immediately.
      </p>
      <ErrorBox error={error} />

      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="withdrawn">Withdrawn</option>
          <option value="">All</option>
        </select>
        <select value={subjectType} onChange={(e) => setSubjectType(e.target.value)}>
          <option value="">Mandirs & ascetics</option>
          <option value="tenant">Mandirs</option>
          <option value="sant">Ascetics</option>
        </select>
      </div>

      <table className="data">
        <thead>
          <tr>
            <th>Who</th>
            <th>Field</th>
            <th>Current</th>
            <th>Requested</th>
            <th>Reason</th>
            <th>Raised</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={8} className="muted">Nothing to review.</td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.subject_label || r.subject_id}
                <div className="muted text-xs">{r.subject_type === 'tenant' ? 'Mandir' : 'Ascetic'}</div>
              </td>
              <td>{FIELD_LABELS[r.field] ?? r.field}</td>
              <td className="mono">{r.current_value || '—'}</td>
              <td className="mono"><strong>{r.requested_value || '—'}</strong></td>
              <td>{r.reason || <span className="muted">—</span>}</td>
              <td>
                {formatDate(r.requested_at)}
                {r.requested_by_name && <div className="muted text-xs">{r.requested_by_name}</div>}
              </td>
              <td>
                <Badge value={r.status} />
                {r.review_note && <div className="muted text-xs">{r.review_note}</div>}
              </td>
              <td>
                {r.status === 'pending' && (
                  <div className="flex gap-2">
                    <button className="btn sm" onClick={() => { setNote(''); setReview({ row: r, mode: 'approve' }); }}>
                      Approve
                    </button>
                    <button className="btn sm danger" onClick={() => { setNote(''); setReview({ row: r, mode: 'reject' }); }}>
                      Reject
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {review && (
        <Modal
          title={review.mode === 'approve' ? 'Approve this change' : 'Reject this change'}
          onClose={() => setReview(null)}
        >
          <p>
            <strong>{review.row.subject_label || review.row.subject_id}</strong> —{' '}
            {FIELD_LABELS[review.row.field] ?? review.row.field}
          </p>
          <p className="mono">
            {review.row.current_value || '—'} → <strong>{review.row.requested_value}</strong>
          </p>
          {review.row.reason && <p className="muted">Reason given: {review.row.reason}</p>}
          {review.mode === 'approve' && (
            <p className="muted">
              This writes the new value to the mandir's profile straight away.
            </p>
          )}
          <label className="field">
            <span>{review.mode === 'reject' ? 'Why (the mandir sees this)' : 'Note (optional)'}</span>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="actions">
            <button className="btn" onClick={() => setReview(null)}>Cancel</button>
            <button
              className={review.mode === 'reject' ? 'btn danger' : 'btn primary'}
              disabled={saving || (review.mode === 'reject' && !note.trim())}
              onClick={submit}
            >
              {saving ? 'Saving…' : review.mode === 'approve' ? 'Approve' : 'Reject'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
