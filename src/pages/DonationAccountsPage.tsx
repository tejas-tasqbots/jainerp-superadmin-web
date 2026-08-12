import { useCallback, useEffect, useState } from 'react';
import { api, formatDate } from '../api/client';
import { Badge, ErrorBox, Modal } from '../components/ui';

/**
 * Verification queue for the account each trust tells devotees to pay into.
 *
 * A trust nominates one of its own bank accounts; until somebody here approves
 * it, the devotee app shows no bank-transfer option at all. That gate exists
 * because the details used to be free text on the temple profile, handed to any
 * devotee the moment the trust switched donations on — a donor could be given,
 * and pay into, digits no human had ever read.
 *
 * WHAT TO CHECK BEFORE APPROVING
 * The account holder name should be the trust, not an individual. Approving
 * records a hash of these exact digits, so if the trust edits the account
 * afterwards it drops back to unverified by itself and reappears here.
 *
 * `changed_since_verification` rows sort first and are called out: those were
 * approved once and have been edited since, so donors are already seeing
 * nothing and the trust is blocked until someone looks.
 */

interface DonationAccount {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  account_id: string;
  account_name: string;
  account_no: string | null;
  ifsc: string | null;
  bank_name: string | null;
  is_verified: boolean;
  verified_at: string | null;
  changed_since_verification: boolean;
  verify_note: string | null;
}

export function DonationAccountsPage() {
  const [rows, setRows] = useState<DonationAccount[]>([]);
  const [status, setStatus] = useState<'pending' | 'verified' | 'all'>('pending');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ row: DonationAccount; mode: 'verify' | 'reject' } | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api<DonationAccount[]>(`/admin/donation-accounts?status=${status}`);
      setRows(r.data ?? []);
    } catch (e) {
      setError(e);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (!review) return;
    setBusy(true);
    try {
      // api() serialises the body itself — a pre-stringified body would arrive
      // as a bare JSON string and body-parser rejects it in strict mode.
      await api(`/admin/tenants/${review.row.tenant_id}/donation-account/${review.mode}`, {
        method: 'PATCH',
        body: review.mode === 'verify' ? { note: note.trim() || undefined } : { reason: note.trim() },
      });
      setReview(null);
      setNote('');
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const pending = rows.filter(r => !r.is_verified).length;

  return (
    <div>
      <h1>Donation Accounts {pending > 0 && <Badge value={`${pending} to review`} />}</h1>
      <p className="muted">
        The bank account each trust tells devotees to pay into. A devotee is shown nothing until it
        is verified here. Check the holder name is the trust itself, not a trustee's own account —
        approving records these exact digits, so a later edit brings it straight back to this queue.
      </p>
      <div>
        <div className="filters">
          {(['pending', 'verified', 'all'] as const).map(s => (
            <button
              key={s}
              className={status === s ? 'chip chip-on' : 'chip'}
              onClick={() => setStatus(s)}
            >
              {s === 'pending' ? `Needs review${pending ? ` (${pending})` : ''}` : s === 'verified' ? 'Verified' : 'All'}
            </button>
          ))}
        </div>
      </div>

      <ErrorBox error={error} />

      <table className="table">
        <thead>
          <tr>
            <th>Trust</th>
            <th>Account holder</th>
            <th>Bank</th>
            <th>Account number</th>
            <th>IFSC</th>
            <th>State</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="muted">
                {status === 'pending'
                  ? 'Nothing waiting. Every nominated account has been verified.'
                  : 'No accounts to show.'}
              </td>
            </tr>
          ) : rows.map(r => (
            <tr key={r.tenant_id}>
              <td>
                <strong>{r.tenant_name}</strong>
                <div className="muted small">{r.tenant_slug}</div>
              </td>
              {/* The holder name is the thing most worth reading: it should be
                  the trust, not a trustee's personal account. */}
              <td>{r.account_name}</td>
              <td>{r.bank_name ?? '—'}</td>
              <td className="mono">{r.account_no ?? '—'}</td>
              <td className="mono">{r.ifsc ?? '—'}</td>
              <td>
                {r.changed_since_verification ? (
                  <Badge value="edited after approval" />
                ) : r.is_verified ? (
                  <Badge value={`verified ${r.verified_at ? formatDate(r.verified_at) : ''}`.trim()} />
                ) : (
                  <Badge value="awaiting review" />
                )}
                {r.verify_note && <div className="muted small">{r.verify_note}</div>}
              </td>
              <td>
                {!r.is_verified && (
                  <button className="btn btn-primary btn-sm" onClick={() => { setReview({ row: r, mode: 'verify' }); setNote(''); }}>
                    Verify
                  </button>
                )}
                {r.is_verified && (
                  <button className="btn btn-danger btn-sm" onClick={() => { setReview({ row: r, mode: 'reject' }); setNote(''); }}>
                    Withdraw
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {review && (
        <Modal
          title={review.mode === 'verify' ? 'Verify donation account' : 'Withdraw verification'}
          onClose={() => setReview(null)}
        >
          <p>
            <strong>{review.row.tenant_name}</strong>
          </p>
          <p className="mono">
            {review.row.account_name} · {review.row.bank_name ?? '—'} · {review.row.account_no ?? '—'} ·{' '}
            {review.row.ifsc ?? '—'}
          </p>
          <p className="muted small">
            {review.mode === 'verify'
              ? 'Devotees will be shown these details. Approving records these exact digits — if the trust edits the account afterwards it returns here automatically.'
              : 'Devotees stop seeing this account immediately. The reason is shown to the trust, so make it something they can act on.'}
          </p>
          <label className="field">
            <span>{review.mode === 'verify' ? 'Note (optional)' : 'Reason (required)'}</span>
            <textarea
              rows={3}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={review.mode === 'verify' ? 'Cancelled cheque checked' : 'IFSC does not match the cheque'}
            />
          </label>
          <div className="modal-actions">
            <button className="btn" onClick={() => setReview(null)}>Cancel</button>
            <button
              className={review.mode === 'verify' ? 'btn btn-primary' : 'btn btn-danger'}
              disabled={busy || (review.mode === 'reject' && !note.trim())}
              onClick={submit}
            >
              {review.mode === 'verify' ? 'Verify' : 'Withdraw'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
