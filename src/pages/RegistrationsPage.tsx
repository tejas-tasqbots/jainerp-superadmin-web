import { useCallback, useEffect, useState } from 'react';
import { api, formatPaise } from '../api/client';
import { ActionForm, ErrorBox, Modal } from '../components/ui';

/**
 * Self-serve registrations — every Trust/Temple that started signing up from
 * jainerp.org or the mandir login page, and where each one got to.
 *
 * This is the operational screen for the onboarding funnel: who paid, who is
 * stuck, whose provisioning failed. The levers here are deliberately the ones
 * support actually needs:
 *   - re-price a registration before payment (the negotiated-deal case)
 *   - send a payment link directly instead of waiting for them to come back
 *   - record an offline payment (NEFT/cheque) and onboard
 *   - retry provisioning for a payment that landed but whose setup failed
 */

interface Registration {
  id: string;
  reference: string;
  status: string;
  trust_name: string;
  temple_type: string;
  admin_name: string;
  admin_mobile: string;
  admin_email: string | null;
  address: Record<string, string> | null;
  mobile_verified_at: string | null;
  plan_name: string | null;
  billing_cycle: string;
  tenancy_tier: string;
  modules: string[];
  subtotal_paise: number;
  discount_paise: number;
  additional_charges_paise: number;
  gst_rate: number;
  gst_amount_paise: number;
  total_paise: number;
  currency: string;
  quote_note: string | null;
  quoted_at: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  payment_method: string | null;
  paid_at: string | null;
  tenant_id: string | null;
  tenant_slug: string | null;
  provisioned_at: string | null;
  failure_reason: string | null;
  source: string;
  created_at: string;
  invoice_id: string | null;
  invoice_number: string | null;
  receipt_number: string | null;
  invoice_status: string | null;
  payment_link_url: string | null;
}

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'details_submitted', label: 'Details submitted' },
  { value: 'mobile_verified', label: 'Mobile verified' },
  { value: 'plan_selected', label: 'Plan selected' },
  { value: 'payment_pending', label: 'Payment pending' },
  { value: 'payment_failed', label: 'Payment failed' },
  { value: 'paid', label: 'Paid' },
  { value: 'provisioning', label: 'Provisioning' },
  { value: 'active', label: 'Active' },
  { value: 'failed', label: 'Setup failed' },
];

/** Colour follows what an operator should DO about it, not the state's name. */
function statusBadge(status: string) {
  if (status === 'active') return <span className="badge green">Active</span>;
  if (status === 'failed') return <span className="badge red">Setup failed</span>;
  if (status === 'payment_failed') return <span className="badge red">Payment failed</span>;
  if (status === 'paid' || status === 'provisioning') return <span className="badge blue">Provisioning</span>;
  return <span className="badge">{status.replace(/_/g, ' ')}</span>;
}

export function RegistrationsPage() {
  const [rows, setRows] = useState<Registration[]>([]);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [detail, setDetail] = useState<Registration | null>(null);
  const [quoting, setQuoting] = useState<Registration | null>(null);
  const [markingPaid, setMarkingPaid] = useState<Registration | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (q.trim()) params.set('q', q.trim());
    api<Registration[]>(`/admin/registrations?${params}`)
      .then((r) => setRows(r.data))
      .catch(setError);
  }, [status, q]);
  useEffect(load, [load]);

  async function act(row: Registration, path: string, body?: unknown) {
    setBusyId(row.id);
    setError(null);
    try {
      await api(`/admin/registrations/${row.id}/${path}`, { method: 'POST', body });
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusyId(null);
    }
  }

  async function sendPaymentLink(row: Registration) {
    setBusyId(row.id);
    setError(null);
    try {
      const { data } = await api<{ short_url: string; mock: boolean }>(
        `/admin/registrations/${row.id}/payment-link`,
        { method: 'POST', body: { channel: ['whatsapp'] } },
      );
      // Put the link in front of the operator rather than only WhatsApping it —
      // they usually want to paste it into an email or a chat themselves.
      await navigator.clipboard?.writeText(data.short_url).catch(() => undefined);
      alert(
        `Payment link created and sent on WhatsApp${data.mock ? ' (MOCK — no Razorpay keys configured)' : ''}:\n\n${data.short_url}\n\n(copied to your clipboard)`,
      );
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1>Registrations</h1>
      <ErrorBox error={error} />

      <div className="toolbar">
        <p className="muted" style={{ margin: 0 }}>
          Trusts/Temples that signed up themselves from the website or the Mandir login page. Paid registrations
          are onboarded automatically — these controls are for the ones that need a hand.
        </p>
      </div>

      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <input
          placeholder="Search name, mobile, email or reference"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 280 }}
        />
        <div className="grow" />
        <button className="btn" onClick={load}>Refresh</button>
      </div>

      <table className="data">
        <thead>
          <tr>
            <th>Trust/Temple</th>
            <th>Contact</th>
            <th>Plan</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Mandir</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-testid={`registration-${r.reference}`}>
              <td>
                <strong>{r.trust_name}</strong>
                <br />
                <span className="muted mono">{r.reference}</span>
                <div className="muted" style={{ fontSize: 11 }}>
                  {new Date(r.created_at).toLocaleDateString('en-IN')} · via {r.source.replace(/_/g, ' ')}
                </div>
              </td>
              <td>
                {r.admin_name}
                <br />
                <span className="muted mono">{r.admin_mobile}</span>
                {r.mobile_verified_at
                  ? <div><span className="badge green" style={{ fontSize: 10 }}>verified</span></div>
                  : <div><span className="badge" style={{ fontSize: 10 }}>unverified</span></div>}
              </td>
              <td>
                {r.plan_name ?? <span className="muted">—</span>}
                {r.plan_name && (
                  <div className="muted" style={{ fontSize: 11 }}>
                    {r.billing_cycle} · {r.tenancy_tier}
                  </div>
                )}
              </td>
              <td>
                {r.total_paise > 0 ? formatPaise(r.total_paise) : <span className="muted">—</span>}
                {r.discount_paise > 0 && (
                  <div className="muted" style={{ fontSize: 11 }}>less {formatPaise(r.discount_paise)}</div>
                )}
                {r.quoted_at && <div className="badge" style={{ fontSize: 10 }}>revised</div>}
              </td>
              <td>
                {statusBadge(r.status)}
                {r.invoice_number && (
                  <div className="muted mono" style={{ fontSize: 11 }}>{r.invoice_number}</div>
                )}
                {r.receipt_number && (
                  <div className="muted mono" style={{ fontSize: 11 }}>{r.receipt_number}</div>
                )}
              </td>
              <td>
                {r.tenant_slug
                  ? <a href={`/mandirs/${r.tenant_id}`}>{r.tenant_slug}</a>
                  : <span className="muted">—</span>}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn sm" onClick={() => setDetail(r)}>Details</button>{' '}
                {r.invoice_id && (
                  <>
                    <a className="btn sm" href={`/api/v1/admin/invoices/${r.invoice_id}/receipt`} target="_blank" rel="noreferrer">
                      Invoice
                    </a>{' '}
                  </>
                )}
                {/* Only meaningful before payment — after it the numbers are a
                    tax document and re-pricing is refused by the API. */}
                {!r.paid_at && (
                  <>
                    <button className="btn sm" onClick={() => setQuoting(r)}>Re-price</button>{' '}
                    <button
                      className="btn sm"
                      disabled={busyId === r.id || !r.plan_name}
                      title={r.plan_name ? 'Create and WhatsApp a payment link' : 'Set a plan first'}
                      onClick={() => sendPaymentLink(r)}
                    >
                      Payment link
                    </button>{' '}
                    <button className="btn sm" disabled={busyId === r.id || !r.plan_name} onClick={() => setMarkingPaid(r)}>
                      Mark paid
                    </button>
                  </>
                )}
                {r.status === 'failed' && (
                  <button
                    className="btn sm primary"
                    disabled={busyId === r.id}
                    onClick={() => act(r, 'retry-provisioning')}
                  >
                    Retry setup
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="muted">No registrations match this filter.</td></tr>
          )}
        </tbody>
      </table>

      {detail && (
        <Modal title={`${detail.trust_name} — ${detail.reference}`} onClose={() => setDetail(null)}>
          <RegistrationDetail id={detail.id} />
        </Modal>
      )}

      {quoting && (
        <Modal title={`Re-price ${quoting.trust_name}`} onClose={() => setQuoting(null)}>
          <QuoteForm reg={quoting} onDone={() => { setQuoting(null); load(); }} />
        </Modal>
      )}

      {markingPaid && (
        <Modal title={`Record payment — ${markingPaid.trust_name}`} onClose={() => setMarkingPaid(null)}>
          <MarkPaidForm reg={markingPaid} onDone={() => { setMarkingPaid(null); load(); }} />
        </Modal>
      )}
    </div>
  );
}

interface RegistrationDetailRow extends Registration {
  profile: Record<string, string | null> | null;
  timeline: Array<{ status: string; message: string; is_public: boolean; actor_type: string; created_at: string }>;
}

function RegistrationDetail({ id }: { id: string }) {
  const [row, setRow] = useState<RegistrationDetailRow | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<RegistrationDetailRow>(`/admin/registrations/${id}`).then((r) => setRow(r.data)).catch(setError);
  }, [id]);

  if (error) return <ErrorBox error={error} />;
  if (!row) return <p className="muted">Loading…</p>;

  const addr = row.address ?? {};
  const p = row.profile ?? {};

  return (
    <div>
      <table className="data">
        <tbody>
          <Info label="Status" value={row.status.replace(/_/g, ' ')} />
          <Info label="Contact" value={`${row.admin_name} · ${row.admin_mobile}${row.admin_email ? ` · ${row.admin_email}` : ''}`} />
          <Info label="Address" value={[addr.line1, addr.line2, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ') || '—'} />
          <Info label="Type" value={row.temple_type} />
          <Info label="PAN / GSTIN" value={[p.pan, p.gstin].filter(Boolean).join(' · ') || '—'} />
          <Info label="80G / 12A" value={[p.reg_80g_number, p.reg_12a_number].filter(Boolean).join(' · ') || '—'} />
          <Info label="Plan" value={row.plan_name ? `${row.plan_name} · ${row.billing_cycle} · ${row.tenancy_tier}` : '—'} />
          <Info label="Modules" value={row.modules?.length ? row.modules.join(', ') : '—'} />
          <Info label="Subtotal" value={formatPaise(row.subtotal_paise)} />
          {row.discount_paise > 0 && <Info label="Discount" value={`− ${formatPaise(row.discount_paise)}`} />}
          {row.additional_charges_paise > 0 && <Info label="Additional charges" value={formatPaise(row.additional_charges_paise)} />}
          <Info label={`GST @ ${row.gst_rate}%`} value={formatPaise(row.gst_amount_paise)} />
          <Info label="Total" value={`${formatPaise(row.total_paise)} ${row.currency}`} />
          {row.quote_note && <Info label="Quote note" value={row.quote_note} />}
          <Info label="Order ID" value={row.razorpay_order_id ?? '—'} />
          <Info label="Payment ID" value={row.razorpay_payment_id ?? '—'} />
          <Info label="Payment method" value={row.payment_method ?? '—'} />
          <Info label="Paid at" value={row.paid_at ? new Date(row.paid_at).toLocaleString('en-IN') : '—'} />
          <Info label="Invoice / receipt" value={[row.invoice_number, row.receipt_number].filter(Boolean).join(' · ') || '—'} />
          <Info label="Mandir" value={row.tenant_slug ?? '—'} />
          {row.failure_reason && <Info label="Failure" value={row.failure_reason} />}
        </tbody>
      </table>

      <h3 style={{ marginTop: 16 }}>Timeline</h3>
      <table className="data">
        <tbody>
          {row.timeline?.map((e, i) => (
            <tr key={i}>
              <td style={{ whiteSpace: 'nowrap' }} className="muted mono">
                {new Date(e.created_at).toLocaleString('en-IN')}
              </td>
              <td>
                {e.message}
                {!e.is_public && <span className="badge" style={{ marginLeft: 6, fontSize: 10 }}>internal</span>}
              </td>
              <td className="muted">{e.actor_type}</td>
            </tr>
          ))}
          {!row.timeline?.length && <tr><td className="muted">No events recorded.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <th style={{ width: 190, textAlign: 'left' }}>{label}</th>
      <td>{value}</td>
    </tr>
  );
}

/**
 * Re-price a registration before it is paid. Amounts are entered in rupees and
 * converted here — the API only ever accepts paise.
 */
function QuoteForm({ reg, onDone }: { reg: Registration; onDone: () => void }) {
  const [f, setF] = useState({
    plan: reg.plan_name ?? '',
    billing_cycle: reg.billing_cycle,
    subtotal: String(reg.subtotal_paise / 100),
    discount: String(reg.discount_paise / 100),
    charges: String(reg.additional_charges_paise / 100),
    note: reg.quote_note ?? '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <ActionForm
      submitLabel="Save price"
      onDone={onDone}
      onSubmit={async () => {
        await api(`/admin/registrations/${reg.id}/quote`, {
          method: 'PATCH',
          body: {
            plan: f.plan || undefined,
            billing_cycle: f.billing_cycle as 'monthly' | 'yearly',
            subtotal_paise: Math.round(Number(f.subtotal || 0) * 100),
            discount_paise: Math.round(Number(f.discount || 0) * 100),
            additional_charges_paise: Math.round(Number(f.charges || 0) * 100),
            note: f.note || undefined,
          },
        });
      }}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        GST is recalculated on the net (subtotal − discount + charges), and any payment link already sent for the
        old amount is cleared so it cannot be paid.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>Plan key</span><input value={f.plan} onChange={set('plan')} /></label>
        <label className="field"><span>Billing cycle</span>
          <select value={f.billing_cycle} onChange={set('billing_cycle')}>
            <option value="yearly">Yearly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <label className="field"><span>Subtotal (₹)</span><input type="number" value={f.subtotal} onChange={set('subtotal')} /></label>
        <label className="field"><span>Discount (₹)</span><input type="number" value={f.discount} onChange={set('discount')} /></label>
        <label className="field"><span>Additional charges (₹)</span><input type="number" value={f.charges} onChange={set('charges')} /></label>
      </div>
      <label className="field"><span>Note (shown to the applicant)</span><input value={f.note} onChange={set('note')} /></label>
    </ActionForm>
  );
}

/** Record an off-gateway payment and onboard, the manual twin of a verified Razorpay payment. */
function MarkPaidForm({ reg, onDone }: { reg: Registration; onDone: () => void }) {
  const [f, setF] = useState({ payment_method: 'neft', payment_ref: '', note: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <ActionForm
      submitLabel={`Record ${formatPaise(reg.total_paise)} and onboard`}
      onDone={onDone}
      onSubmit={async () => {
        await api(`/admin/registrations/${reg.id}/mark-paid`, { method: 'POST', body: f });
      }}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        This raises the tax invoice and provisions the Mandir immediately — use it only once the money has
        actually cleared.
      </p>
      <label className="field"><span>Method</span>
        <select value={f.payment_method} onChange={set('payment_method')}>
          <option value="neft">NEFT / bank transfer</option>
          <option value="upi">UPI</option>
          <option value="cheque">Cheque</option>
          <option value="cash">Cash</option>
          <option value="credit">Credit / adjustment</option>
        </select>
      </label>
      <label className="field"><span>Reference (UTR / cheque no.)</span><input value={f.payment_ref} onChange={set('payment_ref')} /></label>
      <label className="field"><span>Note</span><input value={f.note} onChange={set('note')} /></label>
    </ActionForm>
  );
}
