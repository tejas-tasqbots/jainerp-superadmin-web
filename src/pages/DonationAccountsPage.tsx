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
  has_proof: boolean;
  proof_kind: string | null;
  proof_uploaded_at: string | null;
}

const PROOF_LABEL: Record<string, string> = {
  passbook: 'Passbook first page',
  statement: 'Statement first page',
  cheque: 'Cancelled cheque',
};

export function DonationAccountsPage() {
  const [rows, setRows] = useState<DonationAccount[]>([]);
  const [status, setStatus] = useState<'pending' | 'verified' | 'all'>('pending');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ row: DonationAccount; mode: 'verify' | 'reject' } | null>(null);
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<{ src: string; kind: string | null } | null>(null);
  const [proofBusy, setProofBusy] = useState(false);

  /**
   * The document is fetched only when a review is opened, never with the list.
   * Fifty trusts in the queue would otherwise mean fifty base64 images down the
   * wire to draw fifty table rows, and the reviewer looks at one at a time.
   */
  const openReview = useCallback(async (row: DonationAccount, mode: 'verify' | 'reject') => {
    setReview({ row, mode });
    setNote('');
    setProof(null);
    if (!row.has_proof) return;
    setProofBusy(true);
    try {
      const r = await api<{ data: string; mime: string; kind: string | null }>(
        `/admin/tenants/${row.tenant_id}/donation-account/proof`,
      );
      const p = r.data;
      if (p) setProof({ src: `data:${p.mime};base64,${p.data}`, kind: p.kind });
    } catch {
      // A missing image must not block a withdrawal, which is the action a
      // reviewer takes precisely when something is wrong with the account.
      setProof(null);
    } finally {
      setProofBusy(false);
    }
  }, []);

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
        <div className="toolbar">
          {(['pending', 'verified', 'all'] as const).map(s => (
            <button
              key={s}
              className={status === s ? 'chip chip-active' : 'chip'}
              onClick={() => setStatus(s)}
            >
              {s === 'pending' ? `Needs review${pending ? ` (${pending})` : ''}` : s === 'verified' ? 'Verified' : 'All'}
            </button>
          ))}
        </div>
      </div>

      <ErrorBox error={error} />

      <table className="data">
        <thead>
          <tr>
            <th>Trust</th>
            <th>Account holder</th>
            <th>Bank</th>
            <th>Account number</th>
            <th>IFSC</th>
            <th>Proof</th>
            <th>State</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="muted">
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
              {/* IFSC. Its cell was missing while the header was not, so every
                  cell after it rendered one column to the left: "not uploaded"
                  sat under IFSC, the state badge under Proof, and the button
                  under State. Nothing was wrong with the data — the table was
                  reading a column short. */}
              <td className="mono">{r.ifsc ?? '—'}</td>
              {/* The reviewer's first question is "is there anything to check
                  this against?" — answering it in the row means they do not
                  open a review only to find an empty modal. */}
              <td>
                {r.has_proof
                  ? <span className="small">{PROOF_LABEL[r.proof_kind ?? ''] ?? 'Uploaded'}</span>
                  : <span className="muted small">not uploaded</span>}
              </td>
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
                  // Opening the review is always allowed; APPROVING without the
                  // document is not — the modal's Verify button stays disabled
                  // and the API refuses it too, because an approval on typed
                  // digits alone is the failure this queue exists to prevent.
                  //
                  // But REJECTING needs no document, and that is why it is here
                  // rather than only on a verified account. A reviewer looking
                  // at a trust whose account holder is a person's name — the
                  // case this page's own subtitle warns about — can see the
                  // problem without a passbook, and used to have no way to say
                  // so: the dialog's only working button was Cancel, reported as
                  // "why in the donation account review is there if I cant
                  // apporve or reject".
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <button
                      className={r.has_proof ? 'btn primary sm' : 'btn sm'}
                      onClick={() => void openReview(r, 'verify')}
                    >
                      {r.has_proof ? 'Review & verify' : 'Review'}
                    </button>
                    <button
                      className="btn danger sm"
                      onClick={() => void openReview(r, 'reject')}
                      title="Send it back to the trust with a reason"
                    >
                      Reject
                    </button>
                    {!r.has_proof && (
                      <div className="muted small" style={{ flexBasis: '100%' }}>
                        Waiting on a passbook or statement page
                      </div>
                    )}
                  </div>
                )}
                {r.is_verified && (
                  <button className="btn danger sm" onClick={() => void openReview(r, 'reject')}>
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
          // Three different decisions, three different titles. "Withdraw
          // verification" on an account that was never verified is confusing on
          // its own terms.
          title={
            review.mode === 'verify' ? 'Verify donation account'
              : review.row.is_verified ? 'Withdraw verification'
                : 'Send this account back to the trust'
          }
          onClose={() => setReview(null)}
        >
          <p>
            <strong>{review.row.tenant_name}</strong>
          </p>

          {/* What the trust typed, laid out field by field rather than as one
              run-on line — the reviewer is comparing these against the image
              below, value by value, and a comma-separated string makes that
              needlessly hard. */}
          {/* A two-column grid rather than the page's `table` class, which is
              tuned for full-width lists and packs the label hard against the
              value at modal width — exactly where these have to be read
              carefully, one line at a time, against the image below. */}
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              columnGap: 16,
              rowGap: 6,
              margin: '12px 0',
            }}
          >
            <dt className="muted">Account holder</dt>
            <dd style={{ margin: 0 }}><strong>{review.row.account_name}</strong></dd>
            <dt className="muted">Bank</dt>
            <dd style={{ margin: 0 }}>{review.row.bank_name ?? '—'}</dd>
            <dt className="muted">Account number</dt>
            <dd className="mono" style={{ margin: 0 }}>{review.row.account_no ?? '—'}</dd>
            <dt className="muted">IFSC</dt>
            <dd className="mono" style={{ margin: 0 }}>{review.row.ifsc ?? '—'}</dd>
          </dl>

          {/* The document. This is the only independent evidence in the whole
              flow — everything above was typed by the trust itself. */}
          {review.row.has_proof ? (
            <div>
              <p className="muted small">
                {PROOF_LABEL[review.row.proof_kind ?? ''] ?? 'Uploaded document'}
                {review.row.proof_uploaded_at ? ` · uploaded ${formatDate(review.row.proof_uploaded_at)}` : ''}
                {' — check the holder name, account number and IFSC above appear on it.'}
              </p>
              {proofBusy && <p className="muted">Loading the document…</p>}
              {proof && (
                <a href={proof.src} target="_blank" rel="noreferrer" title="Open full size in a new tab">
                  <img
                    src={proof.src}
                    alt="Passbook or statement page uploaded by the trust"
                    style={{ maxWidth: '100%', maxHeight: 420, border: '1px solid var(--border, #ddd)', borderRadius: 8 }}
                  />
                </a>
              )}
              {!proofBusy && !proof && <p className="muted">The document could not be loaded.</p>}
            </div>
          ) : (
            <p className="muted">
              No passbook or statement page has been uploaded, so there is nothing to check these
              details against. Verification stays blocked until the trust uploads one — ask them to
              add it under Settings → Donor Payments. You can still reject the account from the list
              if what the trust has typed is wrong on its face.
            </p>
          )}

          <p className="muted small">
            {review.mode === 'verify'
              ? 'Devotees will be shown these details. Approving records these exact digits — if the trust edits the account afterwards it returns here automatically.'
              : review.row.is_verified
                ? 'Devotees stop seeing this account immediately. The reason is shown to the trust, so make it something they can act on.'
                : 'Nothing was being shown to devotees, so nothing changes for them. The reason goes to the trust — say what is wrong with the account or what document you need, because this is the only thing they will see.'}
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
          <div className="actions">
            <button className="btn" onClick={() => setReview(null)}>Cancel</button>
            <button
              className={review.mode === 'verify' ? 'btn primary' : 'btn danger'}
              disabled={
                busy ||
                (review.mode === 'reject' && !note.trim()) ||
                (review.mode === 'verify' && !review.row.has_proof)
              }
              onClick={submit}
            >
              {review.mode === 'verify' ? 'Verify'
                : review.row.is_verified ? 'Withdraw' : 'Reject'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
