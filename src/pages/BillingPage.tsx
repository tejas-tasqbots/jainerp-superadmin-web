import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, RefreshCw } from 'lucide-react';
import { api, formatDate, formatPaise, openReceipt, type ApiMeta } from '../api/client';
import { ActionForm, ErrorBox, Pagination, useToast } from '../components/ui';
import { EmptyRow, PageHeader } from '../components/PageHeader';
import { useCan } from '../auth/permissions';

/**
 * Billing — the platform's receivables (superadmin-api billing/billing-desk.ts),
 * laid out the way Chargebee / Zoho Billing / Stripe open their billing area:
 *
 *   Overview      collected this month and this financial year, outstanding,
 *                 overdue, and the aging table — how old is what we are owed
 *   Invoices      every invoice across mandirs; filter, search, export CSV
 *   Renewals due  subscriptions ending soon (or ended) with no renewal invoice
 *                 yet — raise it here, one by one, on purpose
 *   Bill numbers  the one invoice series (migration 102): prefix, digits and
 *                 the next number — GST Rule 46, at most 16 characters
 *   Bank details  Tasqbots' account (migration 103), printed on every bill
 *                 with money still owed — Super admin only to change
 *
 * Customers only: demo mandirs (migration 094) are left out.
 */

interface Summary {
  invoiced_month_paise: number; collected_month_paise: number; collected_fy_paise: number; fy_start: string | null;
  outstanding_paise: number; open_invoices: number; overdue_paise: number; overdue_invoices: number;
  aging: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
  renewals_due_30d: number; renewals_due_30d_paise: number;
}
interface InvoiceRow {
  id: string; invoice_number: string; tenant_id: string | null; mandir_name: string | null; plan_name: string | null; billing_cycle: string | null;
  period_start: string; period_end: string; status: string; total_paise: number; amount_paid_paise: number; balance_paise: number;
  issued_on: string; due_on: string; days_overdue: number; due_assumed: boolean;
}
interface RenewalRow {
  subscription_id: string; tenant_id: string; mandir_name: string; plan_display: string; billing_cycle: string; status: string;
  current_period_end: string; days_left: number; amount_paise: number; custom_price: boolean; outstanding_paise: number;
  /** Next term's agreed charges (migration 102): the bill total, GST included. */
  agreed_lines_total_paise?: number | null;
  agreed_lines?: { description: string; total_paise: number }[] | null;
}
interface Series { prefix: string; pad: number; fy: string; next_number: number; next_invoice_number: string }
interface Bank {
  account_name: string | null; bank_name: string | null; account_number: string | null; ifsc: string | null;
  branch: string | null; account_type: 'current' | 'savings' | null; upi_id: string | null; note: string | null;
  updated_at: string | null; updated_by_name: string | null;
}

type Tab = 'overview' | 'invoices' | 'renewals' | 'numbers' | 'bank';
const TABS: Array<[Tab, string]> = [['overview', 'Overview'], ['invoices', 'Invoices'], ['renewals', 'Renewals due'], ['numbers', 'Bill numbers'], ['bank', 'Bank details']];

export function BillingPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const loadSummary = useCallback(() => {
    api<Summary>('/admin/billing/summary').then((r) => setSummary(r.data)).catch(setError);
  }, []);
  useEffect(loadSummary, [loadSummary]);
  const go = (t: Tab, extra: Record<string, string> = {}) => setParams({ tab: t, ...extra }, { replace: true });

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle="What mandirs have been invoiced, what they have paid, what is overdue, and which subscriptions to renew next."
        actions={<button className="btn" onClick={loadSummary}><RefreshCw size={14} /> Refresh</button>}
      />
      <ErrorBox error={error} />
      <div className="seg" role="tablist" aria-label="Billing">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => go(k)}>
            {label}
            {k === 'invoices' && summary ? <span className="count">{summary.overdue_invoices ? `${summary.overdue_invoices} overdue` : summary.open_invoices}</span> : null}
            {k === 'renewals' && summary ? <span className="count">{summary.renewals_due_30d}</span> : null}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        {tab === 'overview' && <Overview s={summary} go={go} />}
        {tab === 'invoices' && <Invoices />}
        {tab === 'renewals' && <Renewals onChanged={loadSummary} />}
        {tab === 'numbers' && <BillNumbers />}
        {tab === 'bank' && <BankDetails />}
      </div>
    </div>
  );
}

function Overview({ s, go }: { s: Summary | null; go: (t: Tab, extra?: Record<string, string>) => void }) {
  if (!s) return <p className="muted">Loading…</p>;
  const buckets: Array<[string, number, string]> = [
    ['Not yet due', s.aging.current, ''],
    ['1–30 days', s.aging.d1_30, 'overdue'],
    ['31–60 days', s.aging.d31_60, 'overdue'],
    ['61–90 days', s.aging.d61_90, 'overdue'],
    ['Over 90 days', s.aging.d90_plus, 'overdue'],
  ];
  const max = Math.max(1, ...buckets.map(([, v]) => v));
  const fy = s.fy_start ? `FY ${s.fy_start.slice(0, 4)}-${String(Number(s.fy_start.slice(0, 4)) + 1).slice(2)}` : 'this FY';
  return (
    <>
      <div className="stat-grid">
        <div className="stat primary">
          <div className="label">Collected · this month</div>
          <div className="value" data-testid="collected-month">{formatPaise(s.collected_month_paise)}</div>
          <div className="sub">{formatPaise(s.invoiced_month_paise)} invoiced this month</div>
        </div>
        <div className="stat primary">
          <div className="label">Collected · {fy}</div>
          <div className="value">{formatPaise(s.collected_fy_paise)}</div>
          <div className="sub">since {formatDate(s.fy_start)}</div>
        </div>
        <div className="stat">
          <div className="label">Outstanding</div>
          <div className="value" data-testid="outstanding">{formatPaise(s.outstanding_paise)}</div>
          <div className="sub">{s.open_invoices} open invoice{s.open_invoices === 1 ? '' : 's'}</div>
          <a className="stat-link" href="#open" onClick={(e) => { e.preventDefault(); go('invoices', { status: 'open' }); }}>View →</a>
        </div>
        <div className="stat">
          <div className="label">Overdue</div>
          <div className="value" style={{ color: s.overdue_paise ? 'var(--color-danger)' : undefined }} data-testid="overdue">{formatPaise(s.overdue_paise)}</div>
          <div className="sub">{s.overdue_invoices === 1 ? '1 invoice past its due date' : `${s.overdue_invoices} invoices past their due date`}</div>
          <a className="stat-link" href="#overdue" onClick={(e) => { e.preventDefault(); go('invoices', { status: 'overdue' }); }}>Chase →</a>
        </div>
      </div>

      <div className="card">
        <h2>Aging — how long what we are owed has been due</h2>
        <div className="aging">
          {buckets.map(([label, v, tone]) => (
            <div key={label} className="aging-row">
              <span className="aging-label">{label}</span>
              <span className="aging-bar"><span className={`fill ${tone}`} style={{ width: `${(v / max) * 100}%` }} /></span>
              <span className="aging-amt">{formatPaise(v)}</span>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Due date is the one on the invoice; an invoice raised before due dates existed is due 15 days after its date.</p>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Renewals in the next 30 days</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>{s.renewals_due_30d} subscription{s.renewals_due_30d === 1 ? '' : 's'} · {formatPaise(s.renewals_due_30d_paise)} before GST, not yet invoiced</p>
          </div>
          <button className="btn primary" onClick={() => go('renewals')}>Review renewals</button>
        </div>
      </div>
    </>
  );
}

const STATUS_FILTERS: Array<[string, string]> = [['all', 'All'], ['open', 'Open'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void']];

function Invoices() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'all';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [meta, setMeta] = useState<(ApiMeta & { sum_total_paise?: number; sum_balance_paise?: number }) | null>(null);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();

  const qs = useCallback((extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ status, page: String(page), limit: '25', ...extra });
    if (params.get('q')) p.set('q', params.get('q')!);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return p;
  }, [status, page, params, from, to]);
  useEffect(() => {
    api<InvoiceRow[]>(`/admin/billing/invoices?${qs()}`).then((r) => { setRows(r.data); setMeta(r.meta as typeof meta); setError(null); }).catch(setError);
  }, [qs]);
  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(window.location.search);
      if (search.trim()) next.set('q', search.trim()); else next.delete('q');
      if (next.toString() !== new URLSearchParams(window.location.search).toString()) { setParams(next, { replace: true }); setPage(1); }
    }, 300);
    return () => clearTimeout(t);
  }, [search, setParams]);
  const setStatus = (s: string) => { const next = new URLSearchParams(window.location.search); next.set('status', s); setParams(next, { replace: true }); setPage(1); };

  /** CSV of every matching invoice — for the CA, or a spreadsheet. */
  async function exportCsv() {
    try {
      const r = await api<InvoiceRow[]>(`/admin/billing/invoices?${qs({ page: '1', limit: '500' })}`);
      const head = ['Invoice', 'Mandir', 'Issued', 'Due', 'Days overdue', 'Plan', 'Cycle', 'Period from', 'Period to', 'Status', 'Total (Rs)', 'Paid (Rs)', 'Balance (Rs)'];
      const rs = (p: number) => (p / 100).toFixed(2);
      const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [head, ...r.data.map((i) => [i.invoice_number, i.mandir_name, i.issued_on, i.due_on, i.days_overdue || '', i.plan_name, i.billing_cycle,
        i.period_start?.slice(0, 10), i.period_end?.slice(0, 10), i.status, rs(i.total_paise), rs(i.amount_paid_paise), rs(i.balance_paise)])];
      const blob = new Blob([lines.map((l) => l.map(cell).join(',')).join('\r\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `jainerp-invoices-${status}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.show(`Exported ${r.data.length} invoice${r.data.length === 1 ? '' : 's'}.`);
    } catch (e) { setError(e); }
  }

  return (
    <div>
      <ErrorBox error={error} />
      <div className="filter-bar">
        <div className="seg" role="tablist" aria-label="Status">
          {STATUS_FILTERS.map(([k, l]) => <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
        <input type="search" aria-label="Search invoices" placeholder="Mandir or invoice number…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>Issued
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} style={{ width: 150 }} />–
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} style={{ width: 150 }} />
        </label>
        <div className="grow" />
        <button className="btn" onClick={exportCsv} data-testid="export-csv"><Download size={14} /> Export CSV</button>
      </div>
      <div className="result-line">
        <span>{meta ? `${meta.total} invoice${meta.total === 1 ? '' : 's'} · ${formatPaise(meta.sum_total_paise ?? 0)} invoiced · ${formatPaise(meta.sum_balance_paise ?? 0)} still due` : 'Loading…'}</span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Invoice</th><th>Mandir</th><th>Issued</th><th>Due</th><th>Status</th><th className="num">Total</th><th className="num">Balance</th><th></th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} data-testid={`inv-${i.invoice_number}`}>
                <td className="mono">{i.invoice_number}<div className="sub">{i.plan_name ?? ''}{i.billing_cycle ? ` · ${i.billing_cycle}` : ''}</div></td>
                <td>{i.tenant_id ? <Link to={`/mandirs/${i.tenant_id}`}>{i.mandir_name}</Link> : i.mandir_name ?? '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatDate(i.issued_on)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {formatDate(i.due_on)}
                  {i.days_overdue > 0 && <div className="sub" style={{ color: 'var(--color-danger)', fontWeight: 600 }}>{i.days_overdue} day{i.days_overdue === 1 ? '' : 's'} overdue</div>}
                </td>
                <td><span className={`badge ${i.status}`}>{i.status.replace('_', ' ')}</span></td>
                <td className="num">{formatPaise(i.total_paise)}</td>
                <td className="num">{i.status === 'void' ? '—' : i.balance_paise > 0 ? <b>{formatPaise(i.balance_paise)}</b> : <span className="muted">nil</span>}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {i.status !== 'void' && <button className="btn sm" onClick={() => openReceipt(`/admin/invoices/${i.id}/receipt?channel=download`).catch(setError)}>Invoice</button>}
                </td>
              </tr>
            ))}
            {meta && rows.length === 0 && <EmptyRow colSpan={8} title={status === 'overdue' ? 'Nothing overdue.' : 'No invoices match.'} />}
          </tbody>
        </table>
      </div>
      {meta && <Pagination page={page} total={meta.total} limit={25} onPage={setPage} />}
      {toast.node}
    </div>
  );
}

function Renewals({ onChanged }: { onChanged: () => void }) {
  const [within, setWithin] = useState('30');
  const [rows, setRows] = useState<RenewalRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canBill = useCan('billing.manage');
  const toast = useToast();
  const load = useCallback(() => {
    api<RenewalRow[]>(`/admin/billing/renewals?within=${within}`).then((r) => { setRows(r.data); setError(null); }).catch(setError);
  }, [within]);
  useEffect(load, [load]);

  async function raise(r: RenewalRow) {
    const cycle = r.billing_cycle === 'yearly' ? 'year' : 'month';
    const what = r.agreed_lines_total_paise ? `${formatPaise(r.agreed_lines_total_paise)} incl. GST (the agreed charges)` : `${formatPaise(r.amount_paise)} + GST`;
    if (!window.confirm(`Raise the renewal invoice for ${r.mandir_name}: ${what} for the next ${cycle}?`)) return;
    setBusy(r.subscription_id);
    try {
      const res = await api<{ invoice_number: string }>(`/admin/subscriptions/${r.subscription_id}/renewal-invoice`, { method: 'POST', body: {} });
      toast.show(`${res.data.invoice_number} raised for ${r.mandir_name}. Send it from the mandir's Billing tab.`);
      load(); onChanged();
    } catch (e) { setError(e); } finally { setBusy(null); }
  }

  return (
    <div>
      <ErrorBox error={error} />
      <div className="filter-bar">
        <span className="muted" style={{ fontSize: 13 }}>Subscriptions whose period ends within</span>
        <select aria-label="Within" value={within} onChange={(e) => setWithin(e.target.value)}>
          <option value="7">7 days</option><option value="15">15 days</option><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option>
        </select>
        <span className="muted" style={{ fontSize: 13 }}>— or have already ended — with no renewal invoice yet. Mandirs on auto-debit renew by themselves and are not listed.</span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Mandir</th><th>Plan</th><th>Period ends</th><th className="num">Renewal</th><th className="num">Already owed</th><th></th></tr></thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.subscription_id} data-testid={`renewal-${r.mandir_name}`}>
                <td><Link to={`/mandirs/${r.tenant_id}`}><strong>{r.mandir_name}</strong></Link></td>
                <td>{r.plan_display}<div className="sub">{r.billing_cycle}{r.custom_price ? ' · custom price' : ''}</div></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {formatDate(r.current_period_end)}
                  <div className="sub" style={{ color: r.days_left < 0 ? 'var(--color-danger)' : r.days_left <= 7 ? '#b45309' : undefined, fontWeight: 600 }}>
                    {r.days_left < 0 ? `ended ${-r.days_left} day${r.days_left === -1 ? '' : 's'} ago` : r.days_left === 0 ? 'ends today' : `in ${r.days_left} day${r.days_left === 1 ? '' : 's'}`}
                  </div>
                </td>
                <td className="num">
                  {r.agreed_lines_total_paise
                    ? <>{formatPaise(r.agreed_lines_total_paise)} <span className="sub">incl. GST</span><div className="sub">{(r.agreed_lines ?? []).map((l) => l.description).join(' · ')}</div></>
                    : <>{formatPaise(r.amount_paise)} <span className="sub">+ GST</span></>}
                </td>
                <td className="num">{r.outstanding_paise > 0 ? <b style={{ color: 'var(--color-danger)' }}>{formatPaise(r.outstanding_paise)}</b> : <span className="muted">—</span>}</td>
                <td style={{ textAlign: 'right' }}>
                  {canBill && <button className="btn sm primary" disabled={busy === r.subscription_id} onClick={() => raise(r)}>{busy === r.subscription_id ? 'Raising…' : 'Raise renewal invoice'}</button>}
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && <EmptyRow colSpan={6} title="Nothing to renew in this window.">Every subscription ending in it is already invoiced or renews by auto-debit.</EmptyRow>}
          </tbody>
        </table>
      </div>
      {toast.node}
    </div>
  );
}

/**
 * The invoice number series. Every bill — raised here, on renewal, at sign-up
 * or by a trust upgrading itself — takes the next number from it, so it stays
 * one unbroken run per financial year, as GST Rule 46 asks. {FY} in the
 * prefix becomes the year (2026-27) and the run starts again each April.
 */
function BillNumbers() {
  const [s, setS] = useState<Series | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [f, setF] = useState({ prefix: '', pad: '5', next: '' });
  const canBill = useCan('billing.manage');
  const toast = useToast();
  const load = useCallback(() => {
    api<Series>('/admin/billing/series').then((r) => {
      setS(r.data); setError(null);
      setF({ prefix: r.data.prefix, pad: String(r.data.pad), next: String(r.data.next_number) });
    }).catch(setError);
  }, []);
  useEffect(load, [load]);
  if (!s) return <div><ErrorBox error={error} /><p className="muted">Loading…</p></div>;

  const fy = s.fy;
  const pad = Math.max(1, Math.min(8, Number(f.pad) || 1));
  const next = Number(f.next) || 0;
  const sample = `${f.prefix.replace('{FY}', fy)}${String(next).padStart(pad, '0')}`;
  const tooLong = sample.length > 16;
  return (
    <div className="card" style={{ maxWidth: 720 }} data-testid="bill-numbers">
      <ErrorBox error={error} />
      <h2>Bill numbers</h2>
      <p className="muted" style={{ marginTop: -6 }}>
        The next bill will be <b className="mono" data-testid="next-number">{s.next_invoice_number}</b>. Every bill takes the next number from this
        one series, whoever raises it. A number can also be typed on a single bill, or changed when editing it.
      </p>
      {canBill ? (
        <ActionForm draft={false} successMessage={null} submitLabel="Save numbering"
          onSubmit={async () => {
            if (tooLong) throw new Error('A bill number can be at most 16 characters (GST Rule 46).');
            const { data } = await api<Series>('/admin/billing/series', { method: 'PUT', body: { prefix: f.prefix, pad, next_number: next } });
            setS(data);
            toast.show(`Saved — the next bill will be ${data.next_invoice_number}.`);
          }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
            <label className="field"><span>Prefix</span>
              <input value={f.prefix} maxLength={14} onChange={(e) => setF({ ...f, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9/{}-]/gi, '') })} data-testid="series-prefix" />
              <span className="hint">Letters, digits, / and -. <span className="mono">{'{FY}'}</span> becomes {fy}.</span>
            </label>
            <label className="field"><span>Digits</span>
              <input type="number" min={1} max={8} value={f.pad} onChange={(e) => setF({ ...f, pad: e.target.value })} />
            </label>
            <label className="field"><span>Next number ({fy})</span>
              <input type="number" min={1} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} data-testid="series-next" />
            </label>
          </div>
          <p className={tooLong ? '' : 'muted'} style={{ margin: '4px 0 10px', color: tooLong ? 'var(--color-danger)' : undefined }}>
            Next bill: <b className="mono">{sample}</b> · {sample.length}/16 characters
            {next < s.next_number ? ' · going back is refused if that number is already used' : ''}
          </p>
        </ActionForm>
      ) : <p className="muted">Only billing staff can change the numbering.</p>}
      {toast.node}
    </div>
  );
}

/**
 * Where trusts pay Tasqbots. Printed under "Pay by bank transfer / UPI" on every
 * bill — the console's, the trust's own copy and the sign-up invoice — while
 * money is still owed on it; never on a paid or void bill. Only a Super admin
 * may change it (the account on a bill is where every trust's money goes), and
 * each change is audited with what it replaced.
 */
function BankDetails() {
  const [b, setB] = useState<Bank | null>(null);
  const [error, setError] = useState<unknown>(null);
  const empty = { account_name: '', bank_name: '', account_number: '', ifsc: '', branch: '', account_type: 'current', upi_id: '', note: '' };
  const [f, setF] = useState(empty);
  const canSet = useCan('platform.manage');
  const toast = useToast();
  const fill = (d: Bank) => setF({
    account_name: d.account_name ?? '', bank_name: d.bank_name ?? '', account_number: d.account_number ?? '',
    ifsc: d.ifsc ?? '', branch: d.branch ?? '', account_type: d.account_type ?? 'current', upi_id: d.upi_id ?? '', note: d.note ?? '',
  });
  const load = useCallback(() => {
    api<Bank>('/admin/billing/bank-details').then((r) => { setB(r.data); fill(r.data); setError(null); }).catch(setError);
  }, []);
  useEffect(load, [load]);
  if (!b) return <div><ErrorBox error={error} /><p className="muted">Loading…</p></div>;

  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const isSet = !!(b.account_number || b.upi_id);
  const current: Array<[string, string | null]> = [
    ['Account holder', b.account_name], ['Bank', b.bank_name], ['Account number', b.account_number], ['IFSC', b.ifsc],
    ['Branch', b.branch], ['Account type', b.account_type], ['UPI ID', b.upi_id], ['Note', b.note],
  ];
  return (
    <div className="card" style={{ maxWidth: 760 }} data-testid="bank-details">
      <ErrorBox error={error} />
      <h2>Bank details</h2>
      <p className="muted" style={{ marginTop: -6 }}>
        Printed on every bill with money still owed (the bill in this console, the trust&apos;s own copy and the sign-up
        invoice) under <b>Pay by bank transfer / UPI</b>, with the invoice number to quote. Paid and void bills do not
        show it. {isSet
          ? <>Last changed {b.updated_at ? formatDate(b.updated_at) : ''}{b.updated_by_name ? ` by ${b.updated_by_name}` : ''}.</>
          : <b data-testid="bank-not-set">Not set yet: bills print no bank details.</b>}
      </p>
      {canSet ? (
        <ActionForm draft={false} successMessage={null} submitLabel="Save bank details"
          onSubmit={async () => {
            const { data } = await api<Bank>('/admin/billing/bank-details', { method: 'PUT', body: f });
            setB(data); fill(data);
            toast.show(data.account_number || data.upi_id ? 'Saved. Unpaid bills now show these bank details.' : 'Cleared. Bills print no bank details.');
          }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="field"><span>Account holder&apos;s name</span>
              <input value={f.account_name} maxLength={150} onChange={set('account_name')} placeholder="Tasqbots Technologies Pvt. Ltd." data-testid="bank-account-name" />
            </label>
            <label className="field"><span>Bank</span>
              <input value={f.bank_name} maxLength={150} onChange={set('bank_name')} data-testid="bank-name" />
            </label>
            <label className="field"><span>Account number</span>
              <input value={f.account_number} maxLength={24} inputMode="numeric" autoComplete="off" onChange={set('account_number')} data-testid="bank-account-number" />
            </label>
            <label className="field"><span>IFSC</span>
              <input value={f.ifsc} maxLength={11} autoComplete="off" onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} data-testid="bank-ifsc" />
              <span className="hint">11 characters: 4 letters, 0, then 6 letters or digits.</span>
            </label>
            <label className="field"><span>Branch</span>
              <input value={f.branch} maxLength={150} onChange={set('branch')} data-testid="bank-branch" />
            </label>
            <label className="field"><span>Account type</span>
              <select value={f.account_type} onChange={set('account_type')} data-testid="bank-account-type">
                <option value="current">Current</option>
                <option value="savings">Savings</option>
              </select>
            </label>
            <label className="field"><span>UPI ID (optional)</span>
              <input value={f.upi_id} maxLength={100} autoComplete="off" onChange={set('upi_id')} data-testid="bank-upi" />
            </label>
            <label className="field"><span>Note on the bill (optional)</span>
              <input value={f.note} maxLength={300} onChange={set('note')} data-testid="bank-note" />
            </label>
          </div>
          <p className="muted" style={{ margin: '4px 0 10px' }}>
            Leave every field empty and save to take the bank details off the bills.
          </p>
        </ActionForm>
      ) : <p className="muted">Only a Super admin can change where trusts pay.</p>}
      {isSet && (
        <dl style={{ marginTop: 12 }} data-testid="bank-current">
          {current.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 12 }}><dt className="muted" style={{ minWidth: 140 }}>{k}</dt><dd className="mono" style={{ margin: 0 }}>{v}</dd></div>
          ))}
        </dl>
      )}
      {toast.node}
    </div>
  );
}
