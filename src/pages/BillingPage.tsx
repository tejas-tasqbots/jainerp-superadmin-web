import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, RefreshCw } from 'lucide-react';
import { api, formatDate, formatPaise, openReceipt, type ApiMeta } from '../api/client';
import { ErrorBox, Pagination, useToast } from '../components/ui';
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
}

type Tab = 'overview' | 'invoices' | 'renewals';
const TABS: Array<[Tab, string]> = [['overview', 'Overview'], ['invoices', 'Invoices'], ['renewals', 'Renewals due']];

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
    if (!window.confirm(`Raise the renewal invoice for ${r.mandir_name}: ${formatPaise(r.amount_paise)} + GST for the next ${r.billing_cycle === 'yearly' ? 'year' : 'month'}?`)) return;
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
          <thead><tr><th>Mandir</th><th>Plan</th><th>Period ends</th><th className="num">Renewal (before GST)</th><th className="num">Already owed</th><th></th></tr></thead>
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
                <td className="num">{formatPaise(r.amount_paise)}</td>
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
