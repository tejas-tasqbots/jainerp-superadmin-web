import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, formatDate, formatPaise, openReceipt } from '../api/client';
import type { Invoice, InvoicePayment } from '../api/types';
import { useCan } from '../auth/permissions';
import { BillEditor, BillHistory } from './BillEditor';
import { ActionForm, Badge, ErrorBox, Modal } from './ui';
import { OPEN_STATUSES, PAYMENT_METHOD_LABEL } from '../lib/paymentMethods';

/**
 * A customer's bills: raise, edit, record payments (each with its own
 * receipt), cancel a payment, void, and print the invoice and receipts.
 *
 * One component for both kinds of customer — an online mandir (tenant) and a
 * JainERP Offline mandir (migration 104) — because they are billed through the
 * same invoices, series and payment ledger. Only an online mandir has payment
 * links (Razorpay, sent by WhatsApp to its portal contact).
 */

export type BillCustomer =
  | { tenantId: string }
  | { offlineMandirId: string; term?: { start: string; end: string } | null };

export function InvoicesCard({ listPath, customer, customerName, onChanged, onLoaded, reloadKey, title, intro }: {
  listPath: string;
  customer: BillCustomer;
  customerName: string;
  onChanged: (msg: string) => void;
  /** The bills as loaded — the online tab re-keys its terms card on them. */
  onLoaded?: (invoices: Invoice[]) => void;
  /** Change it to make the list load again (e.g. a bill raised elsewhere on the page). */
  reloadKey?: unknown;
  /** Card heading; "Invoices" by default. */
  title?: string;
  /** Replaces the paragraph under the heading. */
  intro?: ReactNode;
}) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  /** The bill editor: 'new' raises one, an invoice edits it (migration 102). */
  const [billing, setBilling] = useState<'new' | Invoice | null>(null);
  const [history, setHistory] = useState<Invoice | null>(null);
  const [recording, setRecording] = useState<Invoice | null>(null);
  const [cancelling, setCancelling] = useState<{ invoice: Invoice; payment: InvoicePayment } | null>(null);
  const canBill = useCan('billing.manage');
  const tenantId = 'tenantId' in customer ? customer.tenantId : null;

  const load = useCallback(() => {
    api<Invoice[]>(listPath).then((r) => { setInvoices(r.data); onLoaded?.(r.data); }).catch(setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listPath, reloadKey]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try { await fn(); } catch (e) { setError(e); }
  }
  const open = (path: string) => run(() => openReceipt(path));

  return (
    <>
      <ErrorBox error={error} />
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>{title ?? 'Invoices'}</h2>
          {canBill && <button className="btn primary" data-testid="new-bill" onClick={() => setBilling('new')}>New bill</button>}
        </div>
        <p className="muted" style={{ marginTop: 6 }}>
          {intro ?? <>
            A bill can carry any charges — subscription, website, hosting, domain, setup, anything else — priced with GST
            included. It can be paid in parts; each payment gets its own receipt and the bill lists them all with the balance due.
          </>}
        </p>
        {linkUrl && (
          <div className="success-box" data-testid="payment-link">
            Payment link: <a href={linkUrl} target="_blank" rel="noreferrer">{linkUrl}</a>
          </div>
        )}
        <table className="data">
          <thead>
            <tr>
              <th>Invoice #</th><th>Period</th><th>Due</th><th>Total</th><th>Received</th><th>Balance</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => {
              const live = (inv.payments ?? []).filter((p) => !p.voided_at);
              const isOpen = OPEN_STATUSES.includes(inv.status);
              return (
                <Fragment key={inv.id}>
                  <tr>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                      {inv.invoiceNumber}
                      <div className="sub">{formatDate(inv.invoiceDate ?? inv.createdAt ?? null)}{inv.editCount ? ` · edited ${inv.editCount}×` : ''}</div>
                    </td>
                    <td>
                      {(() => {
                        const lines = inv.lines ?? [];
                        const sub = lines.find((l) => l.item_type === 'subscription' && l.period_start && l.period_end);
                        return (
                          <>
                            {!lines.length || sub ? <>{formatDate(sub?.period_start ?? inv.periodStart)} → {formatDate(sub?.period_end ?? inv.periodEnd)}</> : <span className="muted">—</span>}
                            {lines.length > 0 && (
                              <div className="muted small" data-testid={`lines-${inv.invoiceNumber}`}>
                                {lines.map((l) => `${l.description} ${formatPaise(l.total_paise)}`).join(' · ')}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{(() => {
                      // Pay-by date (migration 095), or issue + 15 days on an older invoice.
                      const due = inv.dueDate ? new Date(inv.dueDate) : inv.createdAt ? new Date(new Date(inv.createdAt).getTime() + 15 * 86400000) : null;
                      if (!due || !isOpen) return due ? formatDate(due.toISOString()) : '—';
                      const late = Math.floor((Date.now() - due.getTime()) / 86400000);
                      return <>{formatDate(due.toISOString())}{late > 0 && <div className="small" style={{ color: 'var(--color-danger)', fontWeight: 600 }}>{late} day{late === 1 ? '' : 's'} overdue</div>}</>;
                    })()}</td>
                    <td>
                      {formatPaise(inv.totalPaise)}
                      <div className="muted small">
                        {inv.priceIncludesGst ? 'incl. GST ' + formatPaise(inv.gstAmountPaise) : <>{formatPaise(inv.totalPaise - inv.gstAmountPaise)} + GST {formatPaise(inv.gstAmountPaise)}</>}
                        {inv.discountPaise ? ` · − ${formatPaise(inv.discountPaise)} discount` : ''}
                      </div>
                    </td>
                    <td data-testid={`received-${inv.invoiceNumber}`}>{inv.amountPaidPaise ? formatPaise(inv.amountPaidPaise) : <span className="muted">—</span>}</td>
                    <td data-testid={`balance-${inv.invoiceNumber}`}>
                      {inv.status === 'void' ? <span className="muted">—</span> : inv.balancePaise > 0 ? <b>{formatPaise(inv.balancePaise)}</b> : <span className="muted">nil</span>}
                    </td>
                    <td><Badge value={inv.status} /></td>
                    <td>
                      <div className="toolbar" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {canBill && isOpen && (
                          <button className="btn sm primary" data-testid={`record-payment-${inv.invoiceNumber}`} onClick={() => setRecording(inv)}>
                            {inv.amountPaidPaise ? 'Record next payment' : 'Record payment'}
                          </button>
                        )}
                        {canBill && isOpen && tenantId && (
                          <button className="btn sm" onClick={() => run(async () => {
                            const { data } = await api<{ short_url: string }>(`/admin/tenants/${tenantId}/payment-link`, {
                              method: 'POST',
                              body: { invoice_id: inv.id, channel: ['sms', 'whatsapp'] },
                            });
                            setLinkUrl(data.short_url);
                          })}>
                            {inv.amountPaidPaise ? 'Link for balance' : 'Payment link'}
                          </button>
                        )}
                        {/* Number, dates, charges — paid or not. A bill with money
                            on it needs a reason and can never total less than was
                            received; every earlier version is kept (migration 102). */}
                        {canBill && inv.status !== 'void' && (
                          <button className="btn sm" data-testid={`edit-bill-${inv.invoiceNumber}`} onClick={() => setBilling(inv)}>
                            Edit
                          </button>
                        )}
                        {!!inv.editCount && (
                          <button className="btn sm" data-testid={`bill-history-${inv.invoiceNumber}`} onClick={() => setHistory(inv)}>
                            History
                          </button>
                        )}
                        {inv.status !== 'void' && (
                          <button className="btn sm" data-testid={`invoice-doc-${inv.invoiceNumber}`}
                            title="The tax invoice, with every payment received and the balance due"
                            onClick={() => open(`/admin/invoices/${inv.id}/receipt?channel=download`)}>
                            Invoice
                          </button>
                        )}
                        {live.length > 1 && (
                          <button className="btn sm" data-testid={`all-receipts-${inv.invoiceNumber}`}
                            title="One receipt listing every payment received on this invoice"
                            onClick={() => open(`/admin/invoices/${inv.id}/payment-receipt?channel=download`)}>
                            Combined receipt
                          </button>
                        )}
                        {canBill && inv.status === 'unpaid' && !live.length && (
                          <button className="btn sm danger" onClick={() => run(async () => {
                            if (!window.confirm(`Void ${inv.invoiceNumber}? It stays on record as void and can no longer be paid.`)) return;
                            await api(`/admin/invoices/${inv.id}/void`, { method: 'POST', body: { reason: 'voided from console' } });
                            load();
                            onChanged('Invoice voided');
                          })}>
                            Void
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {(inv.payments ?? []).length > 0 && (
                    <tr className="subrow">
                      <td colSpan={8} style={{ paddingTop: 0 }}>
                        <table className="data nested" data-testid={`payments-${inv.invoiceNumber}`}>
                          <thead>
                            <tr><th>Receipt #</th><th>Received on</th><th>Method</th><th>Reference</th><th>Amount</th><th>Recorded</th><th></th></tr>
                          </thead>
                          <tbody>
                            {inv.payments.map((p) => (
                              <tr key={p.id} className={p.voided_at ? 'cancelled' : ''}>
                                <td className="mono">{p.receipt_number ?? '—'}</td>
                                <td>{formatDate(p.paid_at)}</td>
                                <td>{PAYMENT_METHOD_LABEL[p.payment_method] ?? p.payment_method}</td>
                                <td className="mono">{p.payment_ref ?? p.razorpay_payment_id ?? '—'}</td>
                                <td>{formatPaise(p.amount_paise)}</td>
                                <td className="muted small">
                                  {p.voided_at
                                    ? `cancelled ${formatDate(p.voided_at)}${p.void_reason ? ` — ${p.void_reason}` : ''}`
                                    : p.source === 'console' ? (p.recorded_by_name ?? 'console') : p.source}
                                </td>
                                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                                  <button className="btn sm" data-testid={`receipt-${p.receipt_number}`}
                                    onClick={() => open(`/admin/invoices/${inv.id}/payment-receipt?payment_id=${p.id}&channel=download`)}>
                                    Receipt
                                  </button>{' '}
                                  {canBill && !p.voided_at && (
                                    <button className="btn sm danger" data-testid={`cancel-payment-${p.receipt_number}`}
                                      onClick={() => setCancelling({ invoice: inv, payment: p })}>
                                      Cancel
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {invoices.length === 0 && <tr><td colSpan={8} className="muted">No invoices.</td></tr>}
          </tbody>
        </table>
        {/* A link already created for an invoice is kept on the row, so support
            can resend the exact link that was sent rather than minting a new
            one each time and leaving two live links for one invoice. */}
        {invoices.some((i) => i.paymentLinkUrl) && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Existing payment links:{' '}
            {invoices.filter((i) => i.paymentLinkUrl).map((i) => (
              <span key={i.id} style={{ marginRight: 12 }}>
                {i.invoiceNumber}: <a href={i.paymentLinkUrl!} target="_blank" rel="noreferrer">{i.paymentLinkUrl}</a>
              </span>
            ))}
          </div>
        )}
      </div>


      {recording && (
        <Modal title={`Record payment — ${recording.invoiceNumber}`} onClose={() => setRecording(null)}>
          <RecordPaymentForm
            invoice={recording}
            onDone={(msg) => { setRecording(null); setLinkUrl(null); load(); onChanged(msg); }}
          />
        </Modal>
      )}
      {cancelling && (
        <Modal title={`Cancel receipt ${cancelling.payment.receipt_number ?? ''}`} onClose={() => setCancelling(null)}>
          <CancelPaymentForm
            invoice={cancelling.invoice}
            payment={cancelling.payment}
            onDone={(msg) => { setCancelling(null); load(); onChanged(msg); }}
          />
        </Modal>
      )}
      {billing && (
        <Modal title={billing === 'new' ? `New bill — ${customerName}` : `Edit ${billing.invoiceNumber}`} wide onClose={() => setBilling(null)}>
          <BillEditor
            tenantId={'tenantId' in customer ? customer.tenantId : undefined}
            offlineMandirId={'offlineMandirId' in customer ? customer.offlineMandirId : undefined}
            defaultTerm={'offlineMandirId' in customer ? customer.term ?? null : undefined}
            invoiceId={billing === 'new' ? undefined : billing.id}
            onDone={(msg) => { setBilling(null); setLinkUrl(null); load(); onChanged(msg); }}
          />
        </Modal>
      )}
      {history && (
        <Modal title={`History — ${history.invoiceNumber}`} wide onClose={() => setHistory(null)}>
          <BillHistory invoiceId={history.id} />
        </Modal>
      )}
    </>
  );
}

/** Methods that always leave a reference — mirrors REFERENCE_REQUIRED in the API. */
const REF_REQUIRED = ['razorpay', 'upi', 'card', 'netbanking', 'neft', 'rtgs', 'cheque'];
const REF_LABEL: Record<string, string> = {
  upi: 'UPI reference (UTR)',
  neft: 'NEFT / bank UTR',
  rtgs: 'RTGS UTR',
  cheque: 'Cheque number',
  card: 'Card transaction id',
  netbanking: 'Bank transaction id',
  razorpay: 'Razorpay payment id',
  cash: 'Receipt / voucher no. (optional)',
  credit: 'Adjustment reference (optional)',
  manual: 'Reference (optional)',
};

/** "25000", "25,000.50", "₹ 5000" → paise; null when it is not a positive amount. */
function rupeesToPaise(v: string): number | null {
  const n = Number(v.replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/**
 * Record ONE payment against an invoice — the whole balance, or part of it.
 *
 * Each payment raises its own receipt, and the receipt prints the method, the
 * date and the reference — so they are asked for here, per payment. A ₹25,000
 * invoice paid as ₹20,000 then ₹5,000 is two visits to this form, and two
 * receipts that each quote their own UTR. Split tender (part UPI, part cash on
 * the same day) is the same: one entry per method.
 */
function RecordPaymentForm({ invoice, onDone }: { invoice: Invoice; onDone: (msg: string) => void }) {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local day
  const balance = invoice.balancePaise;
  const [f, setF] = useState({
    amount: String(balance / 100),
    payment_method: 'upi',
    payment_ref: '',
    paid_on: today,
    note: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });
  const refRequired = REF_REQUIRED.includes(f.payment_method);
  const amountPaise = rupeesToPaise(f.amount);
  const over = amountPaise != null && amountPaise > balance;
  const after = amountPaise != null && !over ? balance - amountPaise : null;
  const result = useRef<{ receipt_number: string; balance_paise: number } | null>(null);

  return (
    <ActionForm
      submitLabel={amountPaise && !over ? `Record ${formatPaise(amountPaise)} received` : 'Record payment'}
      successMessage={null}
      onDone={() => {
        const r = result.current;
        onDone(r
          ? `Payment recorded — receipt ${r.receipt_number}. ${r.balance_paise > 0 ? `${formatPaise(r.balance_paise)} still due on ${invoice.invoiceNumber}.` : `${invoice.invoiceNumber} is now fully paid.`}`
          : 'Payment recorded');
      }}
      onSubmit={async () => {
        if (amountPaise == null) throw new Error('Enter the amount received.');
        if (over) throw new Error(`Only ${formatPaise(balance)} is due on this invoice.`);
        const { data } = await api<{ receipt_number: string; balance_paise: number }>(`/admin/invoices/${invoice.id}/payments`, {
          method: 'POST',
          body: {
            amount_paise: amountPaise,
            payment_method: f.payment_method,
            payment_ref: f.payment_ref.trim() || undefined,
            paid_on: f.paid_on || undefined,
            note: f.note.trim() || undefined,
          },
        });
        result.current = data;
      }}
    >
      <dl className="kv" style={{ marginBottom: 14 }} data-testid="payment-summary">
        <dt>Invoice total</dt><dd>{formatPaise(invoice.totalPaise)}</dd>
        {invoice.amountPaidPaise > 0 && (<><dt>Received so far</dt><dd>{formatPaise(invoice.amountPaidPaise)} ({invoice.payments.filter((p) => !p.voided_at).length} payment{invoice.payments.filter((p) => !p.voided_at).length === 1 ? '' : 's'})</dd></>)}
        <dt>Balance due</dt><dd><b>{formatPaise(balance)}</b></dd>
      </dl>
      <label className="field">
        <span>Amount received (₹) *</span>
        <input value={f.amount} onChange={set('amount')} inputMode="decimal" required data-testid="payment-amount" />
        <span className="muted small" style={{ display: 'block', marginTop: 4 }} data-testid="payment-after">
          {over
            ? <span style={{ color: 'var(--color-danger-dark, #9f2f22)' }}>More than the {formatPaise(balance)} due — record at most that.</span>
            : after == null
              ? 'Enter the amount that actually arrived.'
              : after === 0
                ? 'Settles the invoice in full.'
                : `Part payment — ${formatPaise(after)} will still be due. Record the rest when it arrives; it gets its own receipt.`}
        </span>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>Method</span>
          <select value={f.payment_method} onChange={set('payment_method')} data-testid="mark-paid-method">
            {Object.entries(PAYMENT_METHOD_LABEL).map(([k, label]) => (
              <option key={k} value={k}>{k === 'manual' ? 'Manual entry (reference unknown)' : label}</option>
            ))}
          </select>
        </label>
        <label className="field"><span>Date received</span>
          <input type="date" value={f.paid_on} max={today} onChange={set('paid_on')} data-testid="mark-paid-date" />
        </label>
      </div>
      <label className="field">
        <span>{REF_LABEL[f.payment_method] ?? 'Reference'}{refRequired ? ' *' : ''}</span>
        <input value={f.payment_ref} onChange={set('payment_ref')} required={refRequired} data-testid="mark-paid-ref"
          placeholder={refRequired ? 'Printed on the receipt' : 'Optional'} />
      </label>
      <label className="field"><span>Internal note</span><input value={f.note} onChange={set('note')} /></label>
    </ActionForm>
  );
}

/**
 * Cancel a payment recorded by mistake. The receipt number stays issued — it
 * may already be with the customer — and re-prints CANCELLED; the invoice
 * goes back to owing that amount.
 */
function CancelPaymentForm({ invoice, payment, onDone }: { invoice: Invoice; payment: InvoicePayment; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <ActionForm
      submitLabel="Cancel this payment"
      successMessage={null}
      onDone={() => onDone(`Receipt ${payment.receipt_number ?? ''} cancelled — ${formatPaise(payment.amount_paise)} is due again on ${invoice.invoiceNumber}.`)}
      onSubmit={async () => {
        await api(`/admin/invoices/${invoice.id}/payments/${payment.id}/void`, { method: 'POST', body: { reason } });
      }}
    >
      <p style={{ marginTop: 0 }}>
        {formatPaise(payment.amount_paise)} received on {formatDate(payment.paid_at)} by{' '}
        {PAYMENT_METHOD_LABEL[payment.payment_method] ?? payment.payment_method}
        {payment.payment_ref ? ` (${payment.payment_ref})` : ''}.
      </p>
      <p className="muted">
        Use this for a wrong amount, a wrong invoice or a bounced cheque. The receipt number is not reused — its
        re-print will say CANCELLED — and the amount becomes due again.
      </p>
      <label className="field"><span>Reason *</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={300}
          placeholder="Cheque bounced / entered twice / wrong amount" data-testid="cancel-payment-reason" />
      </label>
    </ActionForm>
  );
}
