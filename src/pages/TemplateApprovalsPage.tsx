import { useCallback, useEffect, useState } from 'react';
import { api, formatDate } from '../api/client';
import { ActionForm, Badge, ErrorBox, Modal } from '../components/ui';

/**
 * Review queue for trust-authored receipt designs (migration 085).
 *
 * ── WHAT A REVIEWER IS ACTUALLY DECIDING ────────────────────────────────────
 * A receipt is the document a devotee files with a CA and a trust is judged
 * by. A trust designing its own is fine; a trust producing something that
 * reads as a tax certificate, or that drops the fields a receipt has to carry,
 * is not. So the reviewer needs to SEE the receipt, not read a JSON blob —
 * which is why this is its own queue and not a `field_change_requests` row
 * (that queue holds one scalar: `field`, `current_value`, `requested_value`).
 *
 * The design cannot contain markup: a trust composes from a fixed vocabulary
 * of blocks and our renderer draws it (see receiptDefinition.ts for why). So
 * the reviewer is reading a composition, not auditing HTML — which is the only
 * reason this review is a human-sized job.
 */

interface TemplateApproval {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  draft_id: string;
  doc_kind: 'donation' | 'stay' | 'hall';
  template_name: string;
  /** The shipped design this was started from — "what did they change". */
  based_on: string | null;
  definition: {
    blocks?: string[];
    frame?: string;
    density?: string;
    font?: string;
    header_align?: string;
    accent?: string;
    amount_emphasis?: boolean;
    show_qr?: boolean;
    title?: Record<string, string>;
    custom_text?: Record<string, string>;
  };
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  requested_by_name: string | null;
  requested_at: string;
  reviewed_at: string | null;
  review_note: string | null;
}

const DOC_KIND_LABELS: Record<string, string> = {
  donation: 'Donation receipt',
  stay: 'Room bill',
  hall: 'Hall bill',
};

/**
 * The blocks a receipt MUST carry, mirrored from `REQUIRED_BLOCKS` in the
 * validator. Shown so a reviewer can see at a glance that nothing statutory
 * was dropped — the API refuses a design without them, so this is a reading
 * aid rather than a check.
 */
const BLOCK_LABELS: Record<string, string> = {
  invocation: 'Jain invocation',
  logo: 'Logo',
  trust_name: 'Trust name',
  trust_address: 'Address & contact',
  trust_identity: 'PAN / registration numbers',
  doc_title: 'Document title',
  doc_meta: 'Receipt number & date',
  party: 'Donor / guest',
  amount: 'Amount',
  amount_words: 'Amount in words',
  details: 'Category, mode, 80G row',
  items: 'Itemised lines',
  stay: 'Check-in / check-out',
  tax_note: '80G certification',
  blessing: 'Blessing / thanks',
  remittance: 'Bank details & QR',
  custom_text: "Trust's own line",
  signature: 'Signature block',
};

export function TemplateApprovalsPage() {
  const [rows, setRows] = useState<TemplateApproval[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const [reviewing, setReviewing] = useState<TemplateApproval | null>(null);
  const [verdict, setVerdict] = useState<'approved' | 'rejected'>('approved');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: '200' });
    if (status === 'pending') params.set('status', 'pending');
    try {
      const r = await api<TemplateApproval[]>(`/admin/template-approvals?${params}`);
      setRows(r.data);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  function openReview(row: TemplateApproval, initial: 'approved' | 'rejected') {
    setReviewing(row);
    setVerdict(initial);
    setNote('');
  }

  async function submitReview() {
    if (!reviewing) return;
    const path = verdict === 'approved' ? 'approve' : 'reject';
    // `api()` serialises the body itself — a pre-stringified one sends a bare
    // JSON string, which body-parser rejects in strict mode.
    await api(`/admin/template-approvals/${reviewing.id}/${path}`, {
      method: 'PATCH',
      body: { note: note.trim() || undefined },
    });
  }

  const pending = rows.filter((r) => r.status === 'pending').length;

  // The console's own idiom: `h1` + `Badge`, a `toolbar` of `chip` buttons, a
  // `table`. The previous version used `page`, `page-head`, `seg` and an
  // `active` class, none of which exist in styles.css — so the filters rendered
  // as two words of unstyled text ("Awaiting reviewAll") and the page had no
  // card around it at all. An unknown className is not an error anywhere in the
  // toolchain; it is simply nothing.
  return (
    <div>
      <h1>Receipt Designs {pending > 0 && <Badge value={`${pending} to review`} />}</h1>
      <p className="muted">
        Designs a trust built for itself, composed from a fixed set of blocks — there is no markup
        in one, so what you are reading is a composition rather than code. Nothing here prints
        until it is approved, and the trust keeps printing whatever it had until then.
      </p>
      <div>
        <div className="toolbar">
          {(['pending', 'all'] as const).map((v) => (
            <button
              key={v} type="button" onClick={() => setStatus(v)}
              className={status === v ? 'chip chip-active' : 'chip'}
              data-testid={`template-filter-${v}`}
            >
              {v === 'pending' ? `Awaiting review${pending ? ` (${pending})` : ''}` : 'All'}
            </button>
          ))}
        </div>
      </div>

      <ErrorBox error={error} />

      {!rows.length ? (
        <p className="muted">
          {status === 'pending' ? 'Nothing is waiting for review.' : 'No trust has designed a receipt yet.'}
        </p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Trust</th>
              <th>Design</th>
              <th>For</th>
              <th>Blocks</th>
              <th>Requested</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-testid={`template-approval-${row.id}`}>
                <td>{row.tenant_name ?? row.tenant_id}</td>
                <td>
                  {row.template_name}
                  {row.based_on ? <span className="muted"> · from {row.based_on}</span> : null}
                </td>
                <td>{DOC_KIND_LABELS[row.doc_kind] ?? row.doc_kind}</td>
                <td>{row.definition?.blocks?.length ?? 0}</td>
                <td>
                  {formatDate(row.requested_at)}
                  {row.requested_by_name ? <span className="muted"> · {row.requested_by_name}</span> : null}
                </td>
                <td><Badge value={row.status} /></td>
                <td>
                  {row.status === 'pending' ? (
                    <button
                      type="button" className="btn primary sm"
                      onClick={() => openReview(row, 'approved')}
                    >Review</button>
                  ) : row.review_note ? (
                    <span className="muted" title={row.review_note}>{row.review_note.slice(0, 40)}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {reviewing ? (
        <Modal title={`${reviewing.template_name} — ${reviewing.tenant_name ?? ''}`} onClose={() => setReviewing(null)}>
          {/* What the trust composed, in reading order. The blocks ARE the
              design — everything else is a colour and a density — so listing
              them in order is the review. */}
          <dl className="kv">
            <dt>For</dt><dd>{DOC_KIND_LABELS[reviewing.doc_kind] ?? reviewing.doc_kind}</dd>
            <dt>Started from</dt><dd>{reviewing.based_on ?? '—'}</dd>
            <dt>Colour</dt>
            <dd>
              <span
                aria-hidden
                style={{
                  display: 'inline-block', width: 12, height: 12, verticalAlign: 'middle',
                  marginRight: 6, border: '1px solid #ccc',
                  background: reviewing.definition?.accent ?? '#0D1B2E',
                }}
              />
              {reviewing.definition?.accent ?? '—'}
            </dd>
            <dt>Layout</dt>
            <dd>
              {[reviewing.definition?.font, reviewing.definition?.density,
                `${reviewing.definition?.frame} frame`, `${reviewing.definition?.header_align} header`]
                .filter(Boolean).join(' · ')}
            </dd>
            <dt>QR</dt><dd>{reviewing.definition?.show_qr ? 'Shown' : 'Hidden'}</dd>
          </dl>

          <h3>Blocks, in order</h3>
          <ol>
            {(reviewing.definition?.blocks ?? []).map((b) => (
              <li key={b}>{BLOCK_LABELS[b] ?? b}</li>
            ))}
          </ol>

          {/* The trust's own words are the only free text in a design, so they
              are the only part a reviewer has to actually read. */}
          {Object.keys(reviewing.definition?.title ?? {}).length ? (
            <>
              <h3>Their title for the document</h3>
              <ul>
                {Object.entries(reviewing.definition!.title!).map(([lang, text]) => (
                  <li key={lang}><b>{lang}</b> — {text}</li>
                ))}
              </ul>
            </>
          ) : null}
          {Object.keys(reviewing.definition?.custom_text ?? {}).length ? (
            <>
              <h3>Their own line on the receipt</h3>
              <ul>
                {Object.entries(reviewing.definition!.custom_text!).map(([lang, text]) => (
                  <li key={lang}><b>{lang}</b> — {text}</li>
                ))}
              </ul>
            </>
          ) : null}

          <ActionForm
            onSubmit={submitReview}
            submitLabel={verdict === 'approved' ? 'Approve this design' : 'Reject it'}
            onDone={() => { setReviewing(null); void load(); }}
            successMessage={verdict === 'approved' ? 'Approved — the trust can use it now.' : 'Rejected.'}
          >
            <label>
              Decision
              <select value={verdict} onChange={(e) => setVerdict(e.target.value as 'approved' | 'rejected')}>
                <option value="approved">Approve</option>
                <option value="rejected">Reject</option>
              </select>
            </label>
            <label>
              {/* Required on a rejection — the API refuses one without it,
                  because a trust that is not told what is wrong resubmits the
                  same design. */}
              Note {verdict === 'rejected' ? '(required)' : '(optional)'}
              <textarea
                rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder={verdict === 'rejected'
                  ? 'What has to change before this can be approved?'
                  : 'Anything the trust should know'}
              />
            </label>
          </ActionForm>
        </Modal>
      ) : null}
    </div>
  );
}
