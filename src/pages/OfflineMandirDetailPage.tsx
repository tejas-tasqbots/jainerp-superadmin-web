import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatDate, formatPaise, openReceipt } from '../api/client';
import { ActionForm, Badge, ErrorBox, Modal, useToast } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { DeploymentPill } from './TenantsPage';
import { useCan } from '../auth/permissions';
import { LicenceBadge, MandirFields } from '../components/OfflineMandirFields';
import { InvoicesCard } from '../components/InvoicesCard';
import { PAYMENT_METHOD_LABEL } from '../lib/paymentMethods';
import { clean, day, rupees, useForm } from '../lib/offlineMandir';

/**
 * One offline mandir, in the same three places an online mandir has them:
 *
 *   Overview                 who it is, its licence today, every licence term,
 *                            and the buttons to issue, renew, or re-issue
 *   Billing                  its GST bills — raise, edit, record payments (each
 *                            with a receipt), void — the online mandir's own
 *                            invoice list, because both are billed through the
 *                            same invoices and series (migration 104)
 *   Subscription & Receipts  lifetime totals, every term and bill, who opened
 *                            which receipt, and everything done to the mandir
 *
 * A licence issued with an amount raises its bill; a paid one also gets its
 * receipt. Licences issued before that are billed from their row (Raise bill).
 * See superadmin-api offline-licences.service.ts.
 */

interface Licence {
  id: string;
  licence_id: string;
  kind: 'new' | 'renewal' | 'trial' | 'replacement';
  renews_licence_id: string | null;
  mandir_name: string;
  valid_from: string;
  valid_until: string;
  days: number;
  seats: number;
  key_id: string;
  amount_paise: string | number;
  payment_status: 'paid' | 'unpaid' | 'free';
  payment_mode: string | null;
  payment_reference: string | null;
  paid_on: string | null;
  notes: string | null;
  issued_at: string;
  issued_by_name: string | null;
  /** The live bill for this term (migration 104); null when not billed. */
  bill_id: string | null;
  bill_number: string | null;
  bill_status: string | null;
  bill_total_paise: string | number | null;
  bill_paid_paise: string | number | null;
}

interface Mandir {
  id: string;
  reference: string;
  name: string;
  contact_name: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  sect: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  /** Demo / test — out of revenue and counts (migration 094). */
  is_demo?: boolean;
  /** Onboarded for both: its online mandir. */
  tenant_id?: string | null;
  tenant_name?: string | null;
  licences: Licence[];
  subscription: {
    current_licence_id: string | null;
    valid_until: string | null;
    state: string;
    days_remaining: number | null;
    /** Payments on its bills + paid licences that were never billed. */
    total_paid_paise: number;
    /** Open bills' balance + unpaid licences that were never billed. */
    total_unpaid_paise: number;
    bill_count?: number;
    licence_count: number;
    first_licensed_at: string | null;
  };
}

interface IssueResult {
  block: string; file_name: string; text?: string;
  bill?: { id: string; invoice_number: string; total_paise: number } | null;
  receipt?: { payment_id: string; receipt_number: string } | null;
  bill_error?: string | null;
}

type Tab = 'overview' | 'billing' | 'history';
const TAB_LABEL: Record<Tab, string> = { overview: 'Overview', billing: 'Billing', history: 'Subscription & Receipts' };

const KIND_LABEL: Record<string, string> = { new: 'New', renewal: 'Renewal', trial: 'Trial', replacement: 'Re-issue' };
const PAY_TONE: Record<string, string> = { paid: 'green', unpaid: 'red', free: 'blue' };
/** How money reaches Tasqbots from an offline mandir — no gateway, so no Razorpay. */
const METHODS = Object.entries(PAYMENT_METHOD_LABEL).filter(([k]) => k !== 'razorpay');
const REF_REQUIRED = ['upi', 'card', 'netbanking', 'neft', 'rtgs', 'cheque'];
/** A timestamp as its calendar day in India. */
const istDay = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
const todayIst = () => istDay(new Date().toISOString());
/** The pre-billing payment "modes" (UPI / Bank transfer / …) as a method code. */
const MODE_METHOD: Record<string, string> = { upi: 'upi', 'bank transfer': 'neft', neft: 'neft', rtgs: 'rtgs', cheque: 'cheque', cash: 'cash', card: 'card', other: 'manual' };
const OPEN = ['unpaid', 'partially_paid'];

/** The licence just issued (or fetched again): copy it, download it. */
function LicenceBlock({ block, fileName, text }: { block: string; fileName: string; text?: string }) {
  const [copied, setCopied] = useState(false);
  const download = () => {
    const url = URL.createObjectURL(new Blob([text ?? block], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div>
      <textarea readOnly value={block} rows={9} className="mono" style={{ width: '100%', fontSize: 12 }} onFocus={(e) => e.target.select()} />
      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn primary" type="button" onClick={async () => { await navigator.clipboard.writeText(block); setCopied(true); setTimeout(() => setCopied(false), 2500); }}>
          {copied ? 'Copied ✓' : 'Copy licence'}
        </button>
        <button className="btn" type="button" onClick={download}>Download {fileName}</button>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Send this to the mandir. First start: they paste it on the licence screen. Renewal: Settings → Licence → Renew.
      </p>
    </div>
  );
}

/** What issuing billed: the bill and its receipt, with buttons to open them. */
function IssuedBill({ result, onError }: { result: IssueResult; onError: (e: unknown) => void }) {
  if (result.bill_error) {
    return (
      <div className="error-box" data-testid="issued-bill-error">
        The licence was issued, but its bill was not raised: {result.bill_error} Raise it from the licence&apos;s row (Raise bill).
      </div>
    );
  }
  if (!result.bill) return null;
  const bill = result.bill;
  const open = (path: string) => openReceipt(path).catch(onError);
  return (
    <div className="success-box" data-testid="issued-bill">
      Bill <b className="mono">{bill.invoice_number}</b> raised for {formatPaise(bill.total_paise)}
      {result.receipt ? <> · payment recorded, receipt <b className="mono">{result.receipt.receipt_number}</b></> : ' · record the payment on the Billing tab when it arrives'}.
      <div className="toolbar" style={{ marginTop: 8, gap: 6 }}>
        <button className="btn sm" type="button" onClick={() => open(`/admin/invoices/${bill.id}/receipt?channel=download`)}>Invoice</button>
        {result.receipt && (
          <button className="btn sm" type="button" onClick={() => open(`/admin/invoices/${bill.id}/payment-receipt?payment_id=${result.receipt!.payment_id}&channel=download`)}>
            Receipt
          </button>
        )}
      </div>
    </div>
  );
}

/** Method, reference and day received — what a receipt prints. */
function ReceivedFields({ form, set }: { form: Record<string, string>; set: (k: string) => (e: { target: { value: string } }) => void }) {
  const needsRef = REF_REQUIRED.includes(form.payment_method);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 10 }}>
      <label className="field"><span>Method</span>
        <select value={form.payment_method} onChange={set('payment_method')} data-testid="offline-pay-method">
          {METHODS.map(([k, label]) => <option key={k} value={k}>{k === 'manual' ? 'Manual entry (reference unknown)' : label}</option>)}
        </select>
      </label>
      <label className="field"><span>Reference (UTR / cheque no.){needsRef ? ' *' : ''}</span>
        <input value={form.payment_reference} onChange={set('payment_reference')} required={needsRef} data-testid="offline-pay-ref"
          placeholder={needsRef ? 'Printed on the receipt' : 'Optional'} />
      </label>
      <label className="field"><span>Received on</span><input type="date" value={form.paid_on} max={todayIst()} onChange={set('paid_on')} /></label>
    </div>
  );
}

function IssueForm({ mandir, kind, onIssued }: { mandir: Mandir; kind: 'new' | 'renewal' | 'trial' | 'replacement'; onIssued: (r: IssueResult) => void }) {
  const { form, set } = useForm({
    days: kind === 'trial' ? '30' : '365',
    amount: '', payment_status: kind === 'trial' || kind === 'replacement' ? 'free' : 'unpaid',
    payment_method: 'upi', payment_reference: '', paid_on: todayIst(), seats: '25', notes: '',
    bill: 'yes',
  });
  const current = mandir.subscription;
  const startsLater = kind === 'renewal' && current.valid_until && new Date(current.valid_until) > new Date();
  const from = startsLater ? new Date(current.valid_until as string) : new Date();
  const until = kind === 'replacement' && current.valid_until
    ? new Date(current.valid_until)
    : new Date(from.getTime() + (Number(form.days) || 0) * 86400000);
  const amountPaise = Math.round(Number(form.amount || 0) * 100);
  const charged = amountPaise > 0 && form.payment_status !== 'free';
  const billIt = charged && form.bill === 'yes';
  return (
    <ActionForm
      submitLabel={kind === 'replacement' ? 'Re-issue licence' : kind === 'renewal' ? 'Renew and issue licence' : 'Issue licence'}
      successMessage={null}
      onSubmit={async () => {
        const r = await api<IssueResult>(`/admin/offline-mandirs/${mandir.id}/licences`, {
          method: 'POST',
          body: {
            ...clean({ kind, days: form.days, seats: form.seats, payment_status: form.payment_status, notes: form.notes }),
            amount_paise: String(amountPaise),
            bill: billIt,
            ...(form.payment_status === 'paid' ? {
              payment_method: form.payment_method,
              // The pre-billing label, for a licence issued without a bill.
              payment_mode: PAYMENT_METHOD_LABEL[form.payment_method] ?? form.payment_method,
              payment_reference: form.payment_reference.trim() || undefined,
              paid_on: form.paid_on || undefined,
            } : {}),
          },
        });
        onIssued(r.data);
      }}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Signed for <b>{mandir.name}</b>.{' '}
        {kind === 'renewal' && (startsLater
          ? <>Starts when the current licence ends ({day(current.valid_until)}), so no days are lost.</>
          : <>The current licence has ended, so this starts today.</>)}
        {kind === 'replacement' && <>Same expiry as now ({day(current.valid_until)}) — for a lost licence file or a corrected name.</>}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {kind !== 'replacement' && (
          <label className="field"><span>Term</span>
            <select value={form.days} onChange={set('days')}>
              <option value="30">30 days (trial)</option><option value="90">3 months</option><option value="180">6 months</option>
              <option value="365">1 year</option><option value="730">2 years</option><option value="1095">3 years</option>
            </select>
          </label>
        )}
        <label className="field"><span>Valid until</span><input readOnly value={day(until.toISOString())} /></label>
        <label className="field"><span>Users (seats)</span><input type="number" min={1} max={500} value={form.seats} onChange={set('seats')} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>Amount, GST included (₹)</span>
          <input type="number" min={0} step="0.01" value={form.amount} onChange={set('amount')} placeholder="0" data-testid="offline-amount" />
        </label>
        <label className="field"><span>Payment</span>
          <select value={form.payment_status} onChange={set('payment_status')} data-testid="offline-payment-status">
            <option value="unpaid">Not paid yet</option><option value="paid">Paid</option><option value="free">Free / no charge</option>
          </select>
        </label>
      </div>
      {charged && (
        <label className="field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={form.bill === 'yes'} style={{ width: 'auto' }} data-testid="offline-raise-bill"
            onChange={(e) => set('bill')({ target: { value: e.target.checked ? 'yes' : 'no' } })} />
          <span style={{ margin: 0 }}>
            Raise the GST bill for {formatPaise(amountPaise)}
            {form.payment_status === 'paid' ? ' and record this payment on it (its own receipt number)' : ' — record the payment on it when it arrives'}
          </span>
        </label>
      )}
      {form.payment_status === 'paid' && <ReceivedFields form={form} set={set} />}
      <label className="field"><span>Notes (internal)</span><input value={form.notes} onChange={set('notes')} /></label>
    </ActionForm>
  );
}

/**
 * Bill a licence issued before licences were billed. A licence already marked
 * paid gets that payment recorded on the new bill, with its own receipt.
 */
function RaiseBillForm({ licence, onDone }: { licence: Licence; onDone: (r: { bill: { id: string; invoice_number: string; total_paise: number }; receipt: { receipt_number: string } | null; payment_error: string | null }) => void }) {
  const wasPaid = licence.payment_status === 'paid';
  const mapped = MODE_METHOD[String(licence.payment_mode ?? '').trim().toLowerCase()] ?? 'manual';
  const { form, set } = useForm({
    amount: Number(licence.amount_paise) > 0 ? String(Number(licence.amount_paise) / 100) : '',
    invoice_date: istDay(licence.issued_at),
    record: wasPaid ? 'yes' : 'no',
    payment_method: REF_REQUIRED.includes(mapped) && !licence.payment_reference ? 'manual' : mapped,
    payment_reference: licence.payment_reference ?? '',
    paid_on: licence.paid_on?.slice(0, 10) ?? todayIst(),
  });
  return (
    <ActionForm
      submitLabel="Raise bill"
      successMessage={null}
      onSubmit={async () => {
        const amount = Math.round(Number(form.amount || 0) * 100);
        if (!(amount >= 100)) throw new Error('Enter what this licence term costs (at least ₹1).');
        const r = await api<{ bill: { id: string; invoice_number: string; total_paise: number }; receipt: { receipt_number: string } | null; payment_error: string | null }>(
          `/admin/offline-mandirs/licences/${licence.id}/invoice`, {
            method: 'POST',
            body: {
              amount_paise: amount, invoice_date: form.invoice_date || undefined,
              record_payment: wasPaid && form.record === 'yes',
              ...(wasPaid && form.record === 'yes' ? {
                payment_method: form.payment_method, payment_reference: form.payment_reference.trim() || undefined, paid_on: form.paid_on || undefined,
              } : {}),
            },
          },
        );
        onDone(r.data);
      }}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        A GST tax invoice for <span className="mono">{licence.licence_id}</span> ({KIND_LABEL[licence.kind] ?? licence.kind},{' '}
        {day(licence.valid_from)} → {day(licence.valid_until)}, {licence.seats} users), in the same bill series as online mandirs.
        From then on this licence is paid when its bill is.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>Amount, GST included (₹)</span>
          <input type="number" min={1} step="0.01" value={form.amount} onChange={set('amount')} required data-testid="raise-bill-amount" />
        </label>
        <label className="field"><span>Bill date</span>
          <input type="date" value={form.invoice_date} onChange={set('invoice_date')} />
          <span className="hint">Defaults to the day the licence was issued.</span>
        </label>
      </div>
      {wasPaid && (
        <>
          <label className="field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.record === 'yes'} style={{ width: 'auto' }}
              onChange={(e) => set('record')({ target: { value: e.target.checked ? 'yes' : 'no' } })} />
            <span style={{ margin: 0 }}>
              This licence is marked paid{licence.paid_on ? ` on ${day(licence.paid_on)}` : ''} — record that payment on the bill (it gets a receipt number)
            </span>
          </label>
          {form.record === 'yes' && <ReceivedFields form={form} set={set} />}
        </>
      )}
    </ActionForm>
  );
}

/**
 * Temple Admin forgot the PIN and has no licence to hand: they read us the
 * request code on their screen; this returns a one-time reset code (24 hours,
 * that request and this mandir only) to send back by WhatsApp.
 */
function PinResetForm({ mandir }: { mandir: Mandir }) {
  const [request, setRequest] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ reset_code: string; expires_at: string; request_code: string } | null>(null);
  const [copied, setCopied] = useState(false);
  if (result) {
    return (
      <div>
        <p className="muted" style={{ marginTop: 0 }}>
          Reset code for request <span className="mono">{result.request_code}</span> — valid until{' '}
          {new Date(result.expires_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}, once, on that computer only.
          Send it to the Temple Admin; they paste it under Forgot PIN → Ask Tasqbots for a code.
        </p>
        <textarea readOnly value={result.reset_code} rows={4} className="mono" style={{ width: '100%', fontSize: 12 }} onFocus={(e) => e.target.select()} />
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          <button className="btn primary" type="button" onClick={async () => { await navigator.clipboard.writeText(result.reset_code); setCopied(true); }}>
            {copied ? 'Copied ✓' : 'Copy reset code'}
          </button>
        </div>
      </div>
    );
  }
  return (
    <ActionForm
      submitLabel="Make reset code"
      successMessage={null}
      onSubmit={async () => {
        const r = await api<{ reset_code: string; expires_at: string; request_code: string }>(`/admin/offline-mandirs/${mandir.id}/pin-reset-code`, {
          method: 'POST', body: { request_code: request, note: note || undefined },
        });
        setResult(r.data);
      }}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Confirm you are speaking to the mandir&apos;s Temple Admin first (call back on {mandir.mobile ?? 'their registered number'}).
        Then enter the request code shown on their screen (Forgot PIN → Ask Tasqbots for a code).
      </p>
      <label className="field"><span>Request code</span>
        <input value={request} onChange={(e) => setRequest(e.target.value)} placeholder="RQ-XXXX-XXXX-XXXX" className="mono" required />
      </label>
      <label className="field"><span>Note (who asked, how you checked)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
    </ActionForm>
  );
}

/** An UNBILLED licence's payment flag (Free, or a correction). A billed one is paid on its bill. */
function PaymentForm({ licence, onDone }: { licence: Licence; onDone: () => void }) {
  const { form, set } = useForm({
    payment_status: licence.payment_status === 'unpaid' ? 'paid' : licence.payment_status,
    amount: String(Number(licence.amount_paise) / 100),
    payment_mode: licence.payment_mode ?? '', payment_reference: licence.payment_reference ?? '',
    paid_on: licence.paid_on?.slice(0, 10) ?? todayIst(),
  });
  return (
    <ActionForm
      submitLabel="Save payment"
      successMessage={null}
      onSubmit={async () => {
        await api(`/admin/offline-mandirs/licences/${licence.id}/payment`, {
          method: 'PATCH',
          body: clean({ ...form, amount_paise: String(Math.round(Number(form.amount || 0) * 100)) }),
        });
        onDone();
      }}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        This only changes the licence&apos;s own record — no receipt is issued. To give the mandir a tax invoice and a receipt, use <b>Raise bill</b> instead.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>Payment</span>
          <select value={form.payment_status} onChange={set('payment_status')}>
            <option value="paid">Paid</option><option value="unpaid">Not paid yet</option><option value="free">Free / no charge</option>
          </select>
        </label>
        <label className="field"><span>Amount (₹)</span><input type="number" min={0} step="0.01" value={form.amount} onChange={set('amount')} /></label>
        <label className="field"><span>Mode</span>
          <select value={form.payment_mode} onChange={set('payment_mode')}>
            <option value="">—</option>{['UPI', 'Bank transfer', 'Cheque', 'Cash', 'Other'].map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="field"><span>Paid on</span><input type="date" value={form.paid_on} onChange={set('paid_on')} /></label>
      </div>
      <label className="field"><span>Reference (UTR / cheque no.)</span><input value={form.payment_reference} onChange={set('payment_reference')} /></label>
    </ActionForm>
  );
}

/** The Payment cell of a licence row: its bill when billed, else its own flag. */
function LicencePayment({ l }: { l: Licence }) {
  if (l.bill_id) {
    const balance = Number(l.bill_total_paise ?? 0) - Number(l.bill_paid_paise ?? 0);
    return (
      <>
        <Badge value={l.bill_status ?? 'unpaid'} />
        <div className="muted" style={{ fontSize: 11 }}>
          bill <span className="mono">{l.bill_number}</span>
          {l.bill_status && OPEN.includes(l.bill_status) && balance > 0 ? ` · ${formatPaise(balance)} due` : ''}
          {l.bill_status === 'paid' && l.paid_on ? ` · ${day(l.paid_on)}` : ''}
        </div>
      </>
    );
  }
  return (
    <>
      <span className={`badge ${PAY_TONE[l.payment_status]}`}>{l.payment_status === 'unpaid' ? 'not paid' : l.payment_status}</span>
      {l.paid_on && <div className="muted" style={{ fontSize: 11 }}>{day(l.paid_on)}{l.payment_mode ? ` · ${l.payment_mode}` : ''}{l.payment_reference ? ` · ${l.payment_reference}` : ''}</div>}
      {Number(l.amount_paise) > 0 && <div className="muted" style={{ fontSize: 11 }} data-testid={`unbilled-${l.licence_id}`}>no bill yet</div>}
    </>
  );
}

export function OfflineMandirDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [m, setM] = useState<Mandir | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [issuing, setIssuing] = useState<'new' | 'renewal' | 'trial' | 'replacement' | null>(null);
  const [issued, setIssued] = useState<IssueResult | null>(null);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState<Licence | null>(null);
  const [billingLicence, setBillingLicence] = useState<Licence | null>(null);
  const [resetting, setResetting] = useState(false);
  /** Bumped when a bill is raised outside the Billing tab, so its list reloads. */
  const [billsVersion, setBillsVersion] = useState(0);
  const toast = useToast();
  const canManage = useCan('mandirs.manage');
  const canBill = useCan('billing.manage');
  const canPin = useCan('offline.pin_reset');

  const load = useCallback(() => {
    api<Mandir>(`/admin/offline-mandirs/${id}`).then((r) => { setM(r.data); setError(null); }).catch(setError);
  }, [id]);
  useEffect(load, [load]);

  async function showFile(l: Licence) {
    try {
      const r = await api<{ file_name: string; text: string; block: string }>(`/admin/offline-mandirs/licences/${l.id}/file`);
      setIssued({ block: r.data.block, file_name: r.data.file_name, text: r.data.text });
    } catch (e) { setError(e); }
  }
  const openDoc = (path: string) => openReceipt(path).catch(setError);

  if (!m) return <div><ErrorBox error={error} /><p className="muted">Loading…</p></div>;
  const s = m.subscription;
  const hasLicence = s.licence_count > 0;
  const current = [...m.licences].sort((a, b) => +new Date(b.valid_until) - +new Date(a.valid_until))[0] ?? null;
  const term = current ? { start: istDay(current.valid_from), end: istDay(current.valid_until) } : null;
  const unbilled = m.licences.filter((l) => !l.bill_id && Number(l.amount_paise) > 0);
  const editForm = (
    <EditMandir mandir={m} onDone={() => { setEditing(false); load(); toast.show('Saved.'); }} />
  );

  return (
    <div>
      <PageHeader
        crumbs={[{ to: m.tenant_id ? '/mandirs' : '/mandirs?deployment=offline', label: 'Manage Mandir' }]}
        title={m.name}
        badges={<>
          <span className="mono muted">{m.reference}</span>
          <DeploymentPill value={m.tenant_id ? 'both' : 'offline'} />
          {m.status !== 'active' && <span className="badge">{m.status}</span>}
          {m.is_demo && <span className="badge demo">demo</span>}
        </>}
        subtitle={m.tenant_id
          ? <>The JainERP Offline side of <Link to={`/mandirs/${m.tenant_id}`}>{m.tenant_name ?? 'its online mandir'}</Link> — licences, bills and receipts.</>
          : 'JainERP Offline — runs on one computer with no internet. Licences, bills and receipts.'}
        actions={<>
          {m.tenant_id && <Link className="btn" to={`/mandirs/${m.tenant_id}`}>Online mandir →</Link>}
          {canBill && <button className="btn" data-testid="toggle-demo" onClick={async () => {
            if (!m.is_demo && !window.confirm(`Mark "${m.name}" as a demo / test mandir? It will be left out of revenue and counts.`)) return;
            try {
              await api(`/admin/offline-mandirs/${m.id}/demo`, { method: 'PATCH', body: { is_demo: !m.is_demo } });
              load();
              toast.show(m.is_demo ? 'Counted as a customer again.' : 'Marked as demo — left out of revenue and counts.');
            } catch (e) { setError(e); }
          }}>{m.is_demo ? 'Count as a customer' : 'Mark as demo / test'}</button>}
        </>}
      />
      <ErrorBox error={error} />

      <div className="tabs">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)} data-testid={`tab-${t}`}>
            {TAB_LABEL[t]}
            {t === 'billing' && unbilled.length > 0 && <span className="badge red" style={{ marginLeft: 6 }} title="Licences with an amount and no bill">{unbilled.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="card">
            <h2>Subscription</h2>
            <dl className="kv">
              <dt>Licence</dt><dd><LicenceBadge state={s.state} days={s.days_remaining} /> {s.current_licence_id && <span className="mono muted">{s.current_licence_id}</span>}</dd>
              <dt>Valid until</dt><dd>{day(s.valid_until)}</dd>
              <dt>Licensed since</dt><dd>{day(s.first_licensed_at)}</dd>
              <dt>Paid so far</dt><dd data-testid="offline-paid">{rupees(s.total_paid_paise)}</dd>
              <dt>Due</dt><dd data-testid="offline-due">{Number(s.total_unpaid_paise) > 0 ? <b style={{ color: '#b91c1c' }}>{rupees(s.total_unpaid_paise)}</b> : '—'}</dd>
              <dt>Licences issued</dt><dd>{s.licence_count}</dd>
              <dt>Bills</dt>
              <dd>
                {s.bill_count ?? 0}{' '}
                <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => setTab('billing')}>Open Billing →</button>
              </dd>
            </dl>
            <div className="actions" style={{ justifyContent: 'flex-start' }}>
              {canBill && !hasLicence && <button className="btn primary" disabled={m.status === 'closed'} onClick={() => setIssuing('new')}>Issue licence</button>}
              {canBill && !hasLicence && <button className="btn" disabled={m.status === 'closed'} onClick={() => setIssuing('trial')}>Issue trial</button>}
              {canBill && hasLicence && <button className="btn primary" disabled={m.status === 'closed'} onClick={() => setIssuing('renewal')}>Renew</button>}
              {canPin && hasLicence && (
                <button className="btn" onClick={() => setResetting(true)} title="Temple Admin forgot the PIN and has no licence to hand">Temple Admin forgot PIN?</button>
              )}
              {canBill && hasLicence && (s.state === 'active' || s.state === 'expiring') && (
                <button className="btn" onClick={() => setIssuing('replacement')} title="Same expiry — for a lost licence file or a corrected name">Re-issue</button>
              )}
            </div>
          </div>

          <div className="card">
            <h2>Licences &amp; payments</h2>
            {canBill && unbilled.length > 0 && (
              <p className="muted" style={{ marginTop: -6 }} data-testid="unbilled-note">
                {unbilled.length === 1 ? 'One licence has' : `${unbilled.length} licences have`} an amount but no GST bill —
                use <b>Raise bill</b> to give the mandir a tax invoice and a receipt for it.
              </p>
            )}
            <table className="data">
              <thead><tr><th>Licence</th><th>Type</th><th>Period</th><th>Amount</th><th>Payment</th><th>Issued</th><th></th></tr></thead>
              <tbody>
                {m.licences.map((l) => (
                  <tr key={l.id} data-testid={`licence-${l.licence_id}`}>
                    <td className="mono">{l.licence_id}{l.renews_licence_id && <div className="muted" style={{ fontSize: 11 }}>renews {l.renews_licence_id}</div>}</td>
                    <td>{KIND_LABEL[l.kind] ?? l.kind}</td>
                    <td>{day(l.valid_from)} → {day(l.valid_until)}<div className="muted" style={{ fontSize: 11 }}>{l.days} days · {l.seats} users</div></td>
                    <td>{rupees(l.amount_paise)}</td>
                    <td><LicencePayment l={l} /></td>
                    <td>{day(l.issued_at)}<div className="muted" style={{ fontSize: 11 }}>{l.issued_by_name ?? ''}</div></td>
                    <td>
                      <div className="toolbar" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {canBill && <button className="btn sm" onClick={() => showFile(l)}>Licence</button>}
                        {l.bill_id && (
                          <button className="btn sm" data-testid={`licence-invoice-${l.licence_id}`}
                            onClick={() => openDoc(`/admin/invoices/${l.bill_id}/receipt?channel=download`)}>Invoice</button>
                        )}
                        {canBill && l.bill_id && l.bill_status && OPEN.includes(l.bill_status) && (
                          <button className="btn sm primary" onClick={() => setTab('billing')}>Record payment →</button>
                        )}
                        {canBill && !l.bill_id && (
                          <button className={`btn sm${Number(l.amount_paise) > 0 ? ' primary' : ''}`} data-testid={`raise-bill-${l.licence_id}`}
                            onClick={() => setBillingLicence(l)}>Raise bill</button>
                        )}
                        {canBill && !l.bill_id && <button className="btn sm" onClick={() => setPaying(l)}>Payment</button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {m.licences.length === 0 && <tr><td colSpan={7} className="muted">No licence issued yet.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Mandir</h2>
            <dl className="kv">
              <dt>Status</dt><dd><span className={`badge ${m.status === 'active' ? 'green' : ''}`}>{m.status}</span></dd>
              <dt>Contact</dt><dd>{m.contact_name ?? '—'} {m.mobile ?? ''} {m.email ?? ''}</dd>
              <dt>Address</dt><dd>{[m.address, m.city, m.state, m.pincode].filter(Boolean).join(', ') || '—'}</dd>
              <dt>Sampradaya</dt><dd>{m.sect ?? '—'}</dd>
              <dt>Onboarded</dt><dd>{day(m.created_at)}</dd>
              <dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{m.notes ?? '—'}</dd>
            </dl>
            <div className="actions" style={{ justifyContent: 'flex-start' }}>
              {canManage && <button className="btn" onClick={() => setEditing(true)}>Edit details</button>}
            </div>
          </div>
        </>
      )}

      {tab === 'billing' && (
        <>
          {unbilled.length > 0 && (
            <div className="card" data-testid="unbilled-card">
              <h2>Licences not billed yet</h2>
              <p className="muted" style={{ marginTop: -6 }}>
                Issued before licences were billed, or their bill was voided. Raise a bill to give the mandir a GST tax invoice
                — a licence already marked paid gets its payment recorded on the bill, with a receipt.
              </p>
              <table className="data">
                <thead><tr><th>Licence</th><th>Period</th><th>Amount</th><th>Payment</th><th></th></tr></thead>
                <tbody>
                  {unbilled.map((l) => (
                    <tr key={l.id}>
                      <td className="mono">{l.licence_id}<div className="muted" style={{ fontSize: 11 }}>{KIND_LABEL[l.kind] ?? l.kind}</div></td>
                      <td>{day(l.valid_from)} → {day(l.valid_until)}</td>
                      <td>{rupees(l.amount_paise)}</td>
                      <td><LicencePayment l={l} /></td>
                      <td style={{ textAlign: 'right' }}>
                        {canBill && <button className="btn sm primary" data-testid={`billing-raise-${l.licence_id}`} onClick={() => setBillingLicence(l)}>Raise bill</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="card">
            <h2 style={{ marginBottom: 4 }}>Summary</h2>
            <dl className="kv">
              <dt>Received</dt><dd>{rupees(s.total_paid_paise)}</dd>
              <dt>Due</dt><dd>{Number(s.total_unpaid_paise) > 0 ? <b style={{ color: '#b91c1c' }}>{rupees(s.total_unpaid_paise)}</b> : 'nil'}</dd>
              <dt>Current term</dt><dd>{term ? `${day(term.start)} → ${day(term.end)}` : '—'}</dd>
            </dl>
            <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
              Issuing or renewing a licence with an amount raises its bill here. Use <b>New bill</b> for anything else —
              installation, training, data migration, an annual maintenance charge.
            </p>
          </div>
          <InvoicesCard
            listPath={`/admin/offline-mandirs/${m.id}/invoices`}
            customer={{ offlineMandirId: m.id, term }}
            customerName={m.name}
            reloadKey={billsVersion}
            onChanged={(msg) => { toast.show(msg); load(); }}
          />
        </>
      )}

      {tab === 'history' && <OfflineHistory mandirId={m.id} reloadKey={billsVersion} />}

      {issuing && (
        <Modal title={issuing === 'renewal' ? 'Renew licence' : issuing === 'replacement' ? 'Re-issue licence' : issuing === 'trial' ? 'Issue trial licence' : 'Issue licence'} onClose={() => setIssuing(null)} wide>
          <IssueForm mandir={m} kind={issuing} onIssued={(r) => { setIssuing(null); setIssued(r); setBillsVersion((v) => v + 1); load(); }} />
        </Modal>
      )}
      {issued && (
        <Modal title="Licence" onClose={() => setIssued(null)} wide confirmDiscard={false}>
          <IssuedBill result={issued} onError={setError} />
          <LicenceBlock block={issued.block} fileName={issued.file_name} text={issued.text} />
        </Modal>
      )}
      {paying && (
        <Modal title={`Payment — ${paying.licence_id}`} onClose={() => setPaying(null)}>
          <PaymentForm licence={paying} onDone={() => { setPaying(null); load(); }} />
        </Modal>
      )}
      {billingLicence && (
        <Modal title={`Raise bill — ${billingLicence.licence_id}`} onClose={() => setBillingLicence(null)} wide>
          <RaiseBillForm licence={billingLicence} onDone={(r) => {
            setBillingLicence(null);
            setBillsVersion((v) => v + 1);
            load();
            toast.show(r.payment_error
              ? `Bill ${r.bill.invoice_number} raised, but its payment was not recorded: ${r.payment_error} Record it on the Billing tab.`
              : `Bill ${r.bill.invoice_number} raised for ${formatPaise(r.bill.total_paise)}${r.receipt ? ` · receipt ${r.receipt.receipt_number}` : ''}.`,
              r.payment_error ? 'bad' : 'ok');
          }} />
        </Modal>
      )}
      {resetting && (
        <Modal title="Temple Admin PIN reset code" onClose={() => setResetting(false)} wide confirmDiscard={false}>
          <PinResetForm mandir={m} />
        </Modal>
      )}
      {toast.node}
      {editing && <Modal title="Edit offline mandir" onClose={() => setEditing(false)} wide>{editForm}</Modal>}
    </div>
  );
}

interface OfflineHistoryData {
  summary: {
    customer_since: string | null; licence_count: number; paid_paise: number; outstanding_paise: number;
    bills: number; paid_bills: number; open_bills: number; voided_paise: number; unbilled_licences: number; last_paid_at: string | null;
  };
  licences: Licence[];
  invoices: {
    id: string; invoice_number: string; invoice_date: string | null; period_start: string; period_end: string; status: string;
    total_paise: number; amount_paid_paise: number; balance_paise: number; payment_method: string | null; payment_ref: string | null;
    licence_id: string | null; download_count: number; last_downloaded_at: string | null;
    payments: { id: string; receipt_number: string | null; amount_paise: number; payment_method: string; payment_ref: string | null; paid_at: string; voided_at: string | null }[];
  }[];
  downloads: { id: string; created_at: string; invoice_number: string; total_paise: number; actor_type: string; actor_name: string | null; channel: string; ip: string | null }[];
  activity: { id: string; action: string; payload: Record<string, unknown>; created_at: string; actor_name: string | null }[];
}

const ACTION_LABEL: Record<string, string> = {
  'offline_mandir.create': 'Onboarded', 'offline_mandir.update': 'Details changed',
  'offline_mandir.demo.on': 'Marked demo', 'offline_mandir.demo.off': 'Counted as customer',
  'offline_mandir.pin_reset_code': 'PIN reset code made',
  'offline_licence.new': 'Licence issued', 'offline_licence.renewal': 'Licence renewed', 'offline_licence.trial': 'Trial issued',
  'offline_licence.replacement': 'Licence re-issued', 'offline_licence.payment': 'Licence payment changed', 'offline_licence.download': 'Licence file opened',
  'invoice.create': 'Bill raised', 'invoice.create.offline_licence': 'Bill raised for a licence', 'invoice.edit': 'Bill edited',
  'invoice.mark_paid': 'Payment — bill settled', 'invoice.part_payment': 'Part payment', 'invoice.payment_void': 'Payment cancelled',
  'invoice.void': 'Bill voided',
};

function activityDetail(p: Record<string, unknown>): string {
  const bits: string[] = [];
  const s = (k: string) => (p[k] === undefined || p[k] === null || p[k] === '' ? null : String(p[k]));
  if (s('licence_id')) bits.push(String(p.licence_id));
  if (s('invoice_number')) bits.push(String(p.invoice_number));
  if (s('receipt_number')) bits.push(`receipt ${p.receipt_number}`);
  const money = p.amount_paise ?? p.total_paise ?? p.to_total;
  if (money !== undefined && money !== null) bits.push(formatPaise(Number(money)));
  if (s('valid_until')) bits.push(`until ${day(String(p.valid_until))}`);
  if (s('reason')) bits.push(`“${p.reason}”`);
  return bits.join(' · ') || '—';
}

/** Subscription & Receipts — the offline mandir's whole commercial history. */
function OfflineHistory({ mandirId, reloadKey }: { mandirId: string; reloadKey: number }) {
  const [h, setH] = useState<OfflineHistoryData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    api<OfflineHistoryData>(`/admin/offline-mandirs/${mandirId}/billing-history`).then((r) => setH(r.data)).catch(setError);
  }, [mandirId]);
  useEffect(load, [load, reloadKey]);
  const open = async (path: string) => {
    setError(null);
    try { await openReceipt(path); load(); } catch (e) { setError(e); }
  };

  if (!h) return <div><ErrorBox error={error} /><p className="muted">Loading history…</p></div>;
  const t = h.summary;
  return (
    <div>
      <ErrorBox error={error} />
      <div className="card">
        <h2>Summary</h2>
        <dl className="kv" data-testid="offline-history-summary">
          <dt>Customer since</dt><dd>{formatDate(t.customer_since)}</dd>
          <dt>Licence terms</dt><dd>{t.licence_count}</dd>
          <dt>Lifetime received</dt><dd>{formatPaise(t.paid_paise)} ({t.paid_bills} bill{t.paid_bills === 1 ? '' : 's'} fully paid)</dd>
          <dt>Outstanding</dt><dd>{formatPaise(t.outstanding_paise)} ({t.open_bills} open bill{t.open_bills === 1 ? '' : 's'})</dd>
          <dt>Written off (void)</dt><dd>{formatPaise(t.voided_paise)}</dd>
          <dt>Last payment</dt><dd>{t.last_paid_at ? formatDate(t.last_paid_at) : '—'}</dd>
          {t.unbilled_licences > 0 && (<><dt>Not billed</dt><dd><b>{t.unbilled_licences}</b> licence{t.unbilled_licences === 1 ? '' : 's'} with an amount and no bill</dd></>)}
        </dl>
      </div>

      <div className="card">
        <h2>Licence terms</h2>
        <table className="data">
          <thead><tr><th>Licence</th><th>Type</th><th>Period</th><th>Users</th><th>Amount</th><th>Payment</th></tr></thead>
          <tbody>
            {[...h.licences].sort((a, b) => +new Date(a.valid_from) - +new Date(b.valid_from)).map((l) => (
              <tr key={l.id}>
                <td className="mono">{l.licence_id}</td>
                <td>{KIND_LABEL[l.kind] ?? l.kind}</td>
                <td>{day(l.valid_from)} → {day(l.valid_until)}</td>
                <td>{l.seats}</td>
                <td>{rupees(l.amount_paise)}</td>
                <td><LicencePayment l={l} /></td>
              </tr>
            ))}
            {h.licences.length === 0 && <tr><td colSpan={6} className="muted">No licence issued yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Purchase history &amp; receipts</h2>
        <table className="data" data-testid="offline-purchase-table">
          <thead><tr><th>Bill #</th><th>For</th><th>Total</th><th>Received</th><th>Status</th><th>Paid via</th><th>Documents</th></tr></thead>
          <tbody>
            {h.invoices.map((inv) => {
              const live = inv.payments.filter((p) => !p.voided_at);
              return (
                <tr key={inv.id}>
                  <td className="mono">{inv.invoice_number}<div className="muted small">{formatDate(inv.invoice_date)}</div></td>
                  <td>{inv.licence_id ? <span className="mono">{inv.licence_id}</span> : 'Other charges'}<div className="muted small">{formatDate(inv.period_start)} → {formatDate(inv.period_end)}</div></td>
                  <td>{formatPaise(inv.total_paise)}</td>
                  <td>
                    {inv.amount_paid_paise ? formatPaise(inv.amount_paid_paise) : '—'}
                    {inv.balance_paise > 0 && inv.status !== 'void' && inv.amount_paid_paise > 0 && <div className="muted small">{formatPaise(inv.balance_paise)} due</div>}
                  </td>
                  <td><Badge value={inv.status} /></td>
                  <td>
                    {live.length > 1 ? `${live.length} payments` : inv.payment_method
                      ? <>{PAYMENT_METHOD_LABEL[inv.payment_method] ?? inv.payment_method}<div className="muted small mono">{inv.payment_ref ?? ''}</div></>
                      : '—'}
                  </td>
                  <td>
                    <button className="btn sm" data-testid={`history-invoice-${inv.invoice_number}`} onClick={() => open(`/admin/invoices/${inv.id}/receipt?channel=download`)}>Invoice</button>
                    {live.map((p) => (
                      <button key={p.id} className="btn sm" style={{ marginLeft: 4 }} title={`${formatPaise(p.amount_paise)} on ${formatDate(p.paid_at)}`}
                        onClick={() => open(`/admin/invoices/${inv.id}/payment-receipt?payment_id=${p.id}&channel=download`)}>
                        {p.receipt_number ?? 'Receipt'}
                      </button>
                    ))}
                    <div className="muted" style={{ fontSize: 11 }}>
                      {inv.download_count > 0 ? `${inv.download_count} download${inv.download_count === 1 ? '' : 's'} · last ${formatDate(inv.last_downloaded_at)}` : 'never downloaded'}
                    </div>
                  </td>
                </tr>
              );
            })}
            {h.invoices.length === 0 && <tr><td colSpan={7} className="muted">No bills raised yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Downloaded receipts history</h2>
        <p className="muted">Every time this mandir&apos;s invoice or receipt was opened, printed or downloaded.</p>
        <table className="data">
          <thead><tr><th>When</th><th>Bill #</th><th>Amount</th><th>Who</th><th>How</th><th>IP</th></tr></thead>
          <tbody>
            {h.downloads.map((d) => (
              <tr key={d.id}>
                <td>{formatDate(d.created_at)}</td>
                <td className="mono">{d.invoice_number}</td>
                <td>{formatPaise(Number(d.total_paise))}</td>
                <td>{d.actor_name ?? (d.actor_type === 'super_admin' ? 'JainERP team' : d.actor_type)}</td>
                <td>{d.channel}</td>
                <td className="mono">{d.ip ?? '—'}</td>
              </tr>
            ))}
            {h.downloads.length === 0 && <tr><td colSpan={6} className="muted">No invoice or receipt has been opened yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Activity trail</h2>
        <p className="muted">Licences, bills, payments and changes to this mandir — who did what, and when.</p>
        <table className="data" data-testid="offline-activity">
          <thead><tr><th>When</th><th>What</th><th>Detail</th><th>By</th></tr></thead>
          <tbody>
            {h.activity.map((a) => (
              <tr key={a.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(a.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                <td>{ACTION_LABEL[a.action] ?? a.action}</td>
                <td className="muted">{activityDetail(a.payload ?? {})}</td>
                <td>{a.actor_name ?? '—'}</td>
              </tr>
            ))}
            {h.activity.length === 0 && <tr><td colSpan={4} className="muted">Nothing recorded.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditMandir({ mandir, onDone }: { mandir: Mandir; onDone: () => void }) {
  const { form, set } = useForm(Object.fromEntries(
    ['name', 'contact_name', 'mobile', 'email', 'address', 'city', 'state', 'pincode', 'sect', 'notes', 'status']
      .map((k) => [k, String((mandir as unknown as Record<string, unknown>)[k] ?? '')]),
  ));
  return (
    <ActionForm submitLabel="Save" successMessage={null}
      onSubmit={async () => { await api(`/admin/offline-mandirs/${mandir.id}`, { method: 'PATCH', body: clean(form) }); onDone(); }}>
      {form.name !== mandir.name && (
        <p className="muted" style={{ marginTop: 0 }}>A new name reaches the mandir's app with the next licence — use <b>Re-issue</b> after saving.</p>
      )}
      <MandirFields form={form} set={set} />
      <label className="field"><span>Status</span>
        <select value={form.status} onChange={set('status')}>
          <option value="active">Active</option><option value="paused">Paused</option><option value="closed">Closed (no more licences)</option>
        </select>
      </label>
    </ActionForm>
  );
}
