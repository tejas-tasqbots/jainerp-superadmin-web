import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, formatDate, formatPaise } from '../api/client';
import { ActionForm, ErrorBox } from './ui';

/**
 * Bills to trusts as line items (superadmin-api migration 102).
 *
 * The way Zoho Books, Tally and Vyapar bill: any mix of charges on one bill —
 * subscription, website, hosting, domain, setup, anything else — each with
 * its description, SAC and GST rate; amounts entered WITH GST by default, so
 * "₹40,000" is what the trust pays; the bill number taken from the one series
 * (and editable); bill and due dates. The same lines editor sets what the
 * next renewal will contain ("next year everything together ₹14,000").
 *
 * The arithmetic mirrors billing/domain/invoice-lines.ts in the API, which is
 * what actually decides; this only shows the figures as they are typed.
 */

const ITEM_TYPES = [
  { key: 'subscription', label: 'Subscription', description: 'JainERP software subscription (SaaS)', sac: '998314' },
  { key: 'website', label: 'Website', description: 'Website design & development', sac: '998314' },
  { key: 'hosting', label: 'Hosting / maintenance', description: 'Website hosting & maintenance', sac: '998315' },
  { key: 'domain', label: 'Domain', description: 'Domain name registration / renewal', sac: '998315' },
  { key: 'setup', label: 'Setup / training', description: 'Setup, data migration & training', sac: '998313' },
  { key: 'other', label: 'Other', description: 'Other charges', sac: '998314' },
] as const;
const typeOf = (k: string) => ITEM_TYPES.find((t) => t.key === k) ?? ITEM_TYPES[ITEM_TYPES.length - 1];
const GST_RATES = ['18', '5', '0', '40'];

export interface LineRow {
  key: string;
  item_type: string;
  description: string;
  sac: string;
  /** Rupees as typed. */
  amount: string;
  gst_rate: string;
  period_start: string;
  period_end: string;
}

export interface ApiLine {
  item_type: string; description: string; sac: string | null; amount_paise: number; gst_rate: number;
  period_start?: string | null; period_end?: string | null;
  taxable_paise?: number; gst_paise?: number; total_paise?: number;
}

const rowKey = () => Math.random().toString(36).slice(2);
type Term = { start: string; end: string } | null;
const newLine = (type = 'subscription', term: Term = null): LineRow => ({
  key: rowKey(), item_type: type, description: typeOf(type).description, sac: typeOf(type).sac,
  amount: '', gst_rate: '18',
  // A subscription charge pays for a term: the current one unless changed.
  period_start: type === 'subscription' && term ? term.start : '', period_end: type === 'subscription' && term ? term.end : '',
});
const day = (v?: string | null) => (v ? String(v).slice(0, 10) : '');
/** A timestamp as its date in India (a period starting at IST midnight is the previous day in UTC). */
const istDay = (v?: string | null) => (v ? new Date(new Date(v).getTime() + 330 * 60_000).toISOString().slice(0, 10) : '');
const fromApi = (l: ApiLine): LineRow => ({
  key: rowKey(), item_type: l.item_type, description: l.description, sac: l.sac ?? '',
  amount: String(Number(l.amount_paise) / 100), gst_rate: String(Number(l.gst_rate)),
  period_start: day(l.period_start), period_end: day(l.period_end),
});
const toPaise = (rupees: string) => Math.round(Number(String(rupees).replace(/[₹,\s]/g, '')) * 100);
const toApi = (r: LineRow) => ({
  item_type: r.item_type, description: r.description.trim(), sac: r.sac.trim(),
  amount_paise: toPaise(r.amount || '0'), gst_rate: Number(r.gst_rate),
  ...(r.item_type === 'subscription' && r.period_start && r.period_end ? { period_start: r.period_start, period_end: r.period_end } : {}),
});

/** One line priced the way the API prices it. */
function priceRow(r: LineRow, includesGst: boolean) {
  const amount = toPaise(r.amount || '0');
  const rate = Number(r.gst_rate) || 0;
  if (!Number.isFinite(amount)) return { taxable: 0, gst: 0, total: 0 };
  if (includesGst) {
    const taxable = Math.round((amount * 100) / (100 + rate));
    return { taxable, gst: amount - taxable, total: amount };
  }
  const gst = Math.round((amount * rate) / 100);
  return { taxable: amount, gst, total: amount + gst };
}

/** The lines table, the GST switch and the running totals. */
export function LinesEditor({ rows, onChange, includesGst, onIncludesGstChange, term = null, periods = true }: {
  rows: LineRow[]; onChange: (rows: LineRow[]) => void; includesGst: boolean; onIncludesGstChange: (v: boolean) => void;
  /** The subscription's current term, for a new subscription line. */
  term?: Term;
  /** False where the period is decided elsewhere (the next renewal). */
  periods?: boolean;
}) {
  const set = (key: string, patch: Partial<LineRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const totals = rows.reduce((t, r) => {
    const p = priceRow(r, includesGst);
    return { taxable: t.taxable + p.taxable, gst: t.gst + p.gst, total: t.total + p.total };
  }, { taxable: 0, gst: 0, total: 0 });

  return (
    <div data-testid="lines-editor">
      <div className="role-cards" role="radiogroup">
        <label className={`choice${includesGst ? ' selected' : ''}`} style={{ display: 'block' }}>
          <input type="radio" name="gst-mode" checked={includesGst} onChange={() => onIncludesGstChange(true)} style={{ display: 'none' }} data-testid="gst-inclusive" />
          <div className="t">Prices include GST</div><div className="d">₹40,000 means the trust pays ₹40,000.</div>
        </label>
        <label className={`choice${!includesGst ? ' selected' : ''}`} style={{ display: 'block' }}>
          <input type="radio" name="gst-mode" checked={!includesGst} onChange={() => onIncludesGstChange(false)} style={{ display: 'none' }} data-testid="gst-exclusive" />
          <div className="t">GST added on top</div><div className="d">₹40,000 + 18% GST = ₹47,200.</div>
        </label>
      </div>

      <div className="table-wrap">
        <table className="data nested">
          <thead>
            <tr><th style={{ width: 150 }}>Charge</th><th>Description on the bill</th><th style={{ width: 90 }}>SAC</th><th style={{ width: 120 }} className="num">Amount (₹)</th><th style={{ width: 80 }}>GST</th><th className="num" style={{ width: 120 }}>{includesGst ? 'Taxable + GST' : 'With GST'}</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = priceRow(r, includesGst);
              const period = periods && r.item_type === 'subscription';
              return (
                <Fragment key={r.key}>
                <tr data-testid="bill-line" style={period ? { borderBottom: 'none' } : undefined}>
                  <td>
                    <select value={r.item_type} aria-label="Charge type" style={{ minWidth: 130 }} onChange={(e) => {
                      const prev = typeOf(r.item_type);
                      const next = typeOf(e.target.value);
                      // Swap the default wording, never words someone typed.
                      set(r.key, {
                        item_type: next.key,
                        description: !r.description || r.description === prev.description ? next.description : r.description,
                        sac: !r.sac || r.sac === prev.sac ? next.sac : r.sac,
                        ...(next.key === 'subscription' && periods && term && !r.period_start && !r.period_end ? { period_start: term.start, period_end: term.end } : {}),
                      });
                    }}>
                      {ITEM_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <input value={r.description} maxLength={300} aria-label="Description" onChange={(e) => set(r.key, { description: e.target.value })} style={{ width: '100%', minWidth: 180 }} />
                  </td>
                  <td><input value={r.sac} maxLength={8} inputMode="numeric" aria-label="SAC" onChange={(e) => set(r.key, { sac: e.target.value.replace(/\D/g, '') })} style={{ width: 80 }} /></td>
                  <td className="num"><input value={r.amount} inputMode="decimal" aria-label="Amount" data-testid="line-amount" onChange={(e) => set(r.key, { amount: e.target.value })} style={{ width: 110, textAlign: 'right' }} placeholder="0" /></td>
                  <td>
                    <select value={r.gst_rate} aria-label="GST rate" style={{ minWidth: 72 }} onChange={(e) => set(r.key, { gst_rate: e.target.value })}>
                      {[...new Set([...GST_RATES, r.gst_rate])].map((g) => <option key={g} value={g}>{g}%</option>)}
                    </select>
                  </td>
                  <td className="num small">{formatPaise(p.taxable)} + {formatPaise(p.gst)}<div><b>{formatPaise(p.total)}</b></div></td>
                  <td>{rows.length > 1 && <button type="button" className="btn sm" aria-label="Remove line" onClick={() => onChange(rows.filter((x) => x.key !== r.key))}>✕</button>}</td>
                </tr>
                {period && (
                  <tr className="subrow">
                    <td />
                    <td colSpan={6} style={{ paddingTop: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }} className="small muted">
                        Period
                        <input type="date" value={r.period_start} aria-label="Period from" style={{ width: 'auto' }} onChange={(e) => set(r.key, { period_start: e.target.value })} />
                        to
                        <input type="date" value={r.period_end} aria-label="Period to" style={{ width: 'auto' }} onChange={(e) => set(r.key, { period_end: e.target.value })} />
                        <span>With a period this is that term's bill; leave it blank for a charge that pays for no term.</span>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ITEM_TYPES.map((t) => (
            <button key={t.key} type="button" className="btn sm" data-testid={`add-${t.key}`} disabled={rows.length >= 30}
              onClick={() => onChange([...rows, newLine(t.key, periods ? term : null)])}>+ {t.label}</button>
          ))}
        </div>
        <dl className="kv" style={{ margin: 0, minWidth: 220 }} data-testid="bill-totals">
          <dt>Taxable value</dt><dd>{formatPaise(totals.taxable)}</dd>
          <dt>GST</dt><dd>{formatPaise(totals.gst)}</dd>
          <dt><b>Total</b></dt><dd><b data-testid="bill-total">{formatPaise(totals.total)}</b></dd>
        </dl>
      </div>
    </div>
  );
}

interface EditView {
  id: string; invoice_number: string; invoice_date: string; due_date: string | null; status: string;
  price_includes_gst: boolean; note: string | null; total_paise: number; amount_paid_paise: number;
  edit_count: number; legacy: boolean; lines: ApiLine[];
}

/**
 * Raise a new bill for a trust, or edit one (`invoiceId`). The customer is an
 * online mandir (`tenantId`) or a JainERP Offline one (`offlineMandirId`,
 * migration 104), whose current licence term (`defaultTerm`) pre-fills a
 * subscription line's dates the way an online mandir's period does.
 */
export function BillEditor({ tenantId, offlineMandirId, defaultTerm, invoiceId, onDone }: {
  tenantId?: string; offlineMandirId?: string; defaultTerm?: Term; invoiceId?: string; onDone: (msg: string) => void;
}) {
  const editing = !!invoiceId;
  // An offline mandir's current licence term pre-fills the subscription line.
  const [rows, setRows] = useState<LineRow[]>(() => {
    const first = newLine('subscription');
    return [!invoiceId && offlineMandirId && defaultTerm ? { ...first, period_start: defaultTerm.start, period_end: defaultTerm.end } : first];
  });
  const [includesGst, setIncludesGst] = useState(true);
  const [number, setNumber] = useState('');
  const [nextNumber, setNextNumber] = useState<string | null>(null);
  // Today in India, whatever the PC's zone.
  const [invoiceDate, setInvoiceDate] = useState(() => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [view, setView] = useState<EditView | null>(null);
  const [term, setTerm] = useState<Term>(defaultTerm ?? null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (editing) {
      api<EditView>(`/admin/invoices/${invoiceId}/edit`).then(({ data }) => {
        setView(data);
        setRows(data.lines.map(fromApi));
        setIncludesGst(data.price_includes_gst);
        setNumber(data.invoice_number);
        setInvoiceDate(day(data.invoice_date));
        setDueDate(day(data.due_date));
        setNote(data.note ?? '');
      }).catch(setError);
    } else {
      api<{ next_invoice_number: string }>('/admin/billing/series').then(({ data }) => setNextNumber(data.next_invoice_number)).catch(() => setNextNumber(null));
      if (offlineMandirId) return; // its term came in with the first line
      api<{ subscription: { current_period_start: string | null; current_period_end: string | null } | null }>(`/admin/tenants/${tenantId}/billing-summary`)
        .then(({ data }) => {
          const sub = data.subscription;
          if (!sub?.current_period_start || !sub.current_period_end) return;
          const t = { start: istDay(sub.current_period_start), end: istDay(sub.current_period_end) };
          setTerm(t);
          setRows((rs) => rs.map((r) => (r.item_type === 'subscription' && !r.period_start && !r.period_end ? { ...r, period_start: t.start, period_end: t.end } : r)));
        })
        .catch(() => setTerm(null));
    }
  }, [editing, invoiceId, tenantId, offlineMandirId]);

  const total = useMemo(() => rows.reduce((s, r) => s + priceRow(r, includesGst).total, 0), [rows, includesGst]);
  const received = view?.amount_paid_paise ?? 0;

  if (editing && !view) return <div><ErrorBox error={error} /><p className="muted">Loading the bill…</p></div>;

  return (
    <ActionForm
      draft={false}
      successMessage={null}
      submitLabel={editing ? 'Save changes' : `Raise bill for ${formatPaise(total)}`}
      onSubmit={async () => {
        if (rows.some((r) => !r.amount || !Number.isFinite(toPaise(r.amount)) || toPaise(r.amount) < 0)) throw new Error('Enter an amount on every line (0 is allowed).');
        if (total < 100) throw new Error('The bill must be for at least ₹1.');
        if (editing && received > 0 && !reason.trim()) throw new Error(`${formatPaise(received)} has been received on this bill — say why it is being changed.`);
        if (editing && total < received) throw new Error(`${formatPaise(received)} has already been received — the bill cannot total less than that.`);
        const body = {
          lines: rows.map(toApi), price_includes_gst: includesGst,
          invoice_date: invoiceDate || undefined, due_date: dueDate || undefined,
          note: note.trim() || (editing ? '' : undefined),
          ...(number.trim() ? { invoice_number: number.trim() } : {}),
          ...(editing ? { reason: reason.trim() || undefined } : {}),
        };
        const { data } = editing
          ? await api<{ invoice_number: string; total_paise: number }>(`/admin/invoices/${invoiceId}`, { method: 'PUT', body })
          : await api<{ invoice_number: string; total_paise: number }>(
            offlineMandirId ? `/admin/offline-mandirs/${offlineMandirId}/invoices` : `/admin/tenants/${tenantId}/invoices`,
            { method: 'POST', body },
          );
        onDone(editing
          ? `${data.invoice_number} saved — ${formatPaise(Number(data.total_paise))}.`
          : `Bill ${data.invoice_number} raised for ${formatPaise(Number(data.total_paise))}. Record the payment when it arrives.`);
      }}
    >
      <ErrorBox error={error} />
      {editing && view?.legacy && (
        <p className="muted" style={{ marginTop: 0 }}>This bill was raised before line items: its one charge is shown before GST, exactly as it was billed.</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <label className="field"><span>Bill number</span>
          <input value={number} onChange={(e) => setNumber(e.target.value.toUpperCase().replace(/[^A-Z0-9/-]/g, ''))} maxLength={16}
            placeholder={nextNumber ? `${nextNumber} (next)` : 'Next in the series'} data-testid="bill-number" />
          {!editing && <span className="hint">Leave blank for the next number in the series.</span>}
        </label>
        <label className="field"><span>Bill date</span>
          <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} data-testid="bill-date" />
        </label>
        <label className="field"><span>Due date</span>
          <input type="date" value={dueDate} min={invoiceDate} onChange={(e) => setDueDate(e.target.value)} />
          {!dueDate && <span className="hint">Blank: 15 days after the bill date.</span>}
        </label>
      </div>

      <LinesEditor rows={rows} onChange={setRows} includesGst={includesGst} onIncludesGstChange={setIncludesGst} term={term} />

      <label className="field" style={{ marginTop: 10 }}><span>Note (internal)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </label>
      {editing && (
        <label className="field"><span>Why is it changing?{received > 0 ? ' *' : ''}</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-testid="bill-reason"
            placeholder={received > 0 ? `Required — ${formatPaise(received)} already received` : 'Optional'} />
          <span className="hint">
            The bill as it was is kept in its history.{received > 0 ? ` It can never total less than the ${formatPaise(received)} already received.` : ''}
            {' '}If it is already in a filed GST return, a credit/debit note is the right correction.
          </span>
        </label>
      )}
    </ActionForm>
  );
}

/** What the next renewal bill will contain (PUT /admin/tenants/:id/renewal-lines). */
export function RenewalLinesForm({ tenantId, date, cycleWord, initial, onDone }: {
  tenantId: string; date: string | null; cycleWord: string;
  initial: { lines: ApiLine[]; includes_gst: boolean; ongoing: boolean; note: string | null } | null;
  onDone: (msg: string) => void;
}) {
  const [rows, setRows] = useState<LineRow[]>(initial?.lines?.length
    ? initial.lines.map(fromApi)
    : [{ ...newLine('subscription'), description: `Annual subscription` }]);
  const [includesGst, setIncludesGst] = useState(initial?.includes_gst ?? true);
  const [ongoing, setOngoing] = useState(initial?.ongoing ?? true);
  const [note, setNote] = useState(initial?.note ?? '');
  const total = rows.reduce((s, r) => s + priceRow(r, includesGst).total, 0);
  return (
    <ActionForm draft={false} successMessage={null} submitLabel={`Save — next renewal ${formatPaise(total)}`}
      onSubmit={async () => {
        if (total < 100) throw new Error('Enter the amount for the next term.');
        await api(`/admin/tenants/${tenantId}/renewal-lines`, {
          method: 'PUT', body: { lines: rows.map((r) => toApi({ ...r, period_start: '', period_end: '' })), price_includes_gst: includesGst, ongoing, note: note.trim() || undefined },
        });
        onDone(`Next renewal${date ? ` on ${formatDate(date)}` : ''}: ${formatPaise(total)}${includesGst ? ' incl. GST' : ' with GST'}${ongoing ? ', from then on' : ', that term only'}.`);
      }}>
      <p className="muted" style={{ marginTop: 0 }}>
        Used when the renewal{date ? ` on ${formatDate(date)}` : ''} is raised. Nothing already billed changes. The subscription line pays for the
        new {cycleWord}; add website hosting, domain or anything else that renews with it — or put everything in one line.
      </p>
      <LinesEditor rows={rows} onChange={setRows} includesGst={includesGst} onIncludesGstChange={setIncludesGst} periods={false} />
      <div className="role-cards" role="radiogroup" style={{ marginTop: 10 }}>
        <label className={`choice${ongoing ? ' selected' : ''}`} style={{ display: 'block' }}>
          <input type="radio" name="rl-scope" checked={ongoing} onChange={() => setOngoing(true)} style={{ display: 'none' }} />
          <div className="t">From this renewal onwards</div><div className="d">Every {cycleWord} after, until changed.</div>
        </label>
        <label className={`choice${!ongoing ? ' selected' : ''}`} style={{ display: 'block' }}>
          <input type="radio" name="rl-scope" checked={!ongoing} onChange={() => setOngoing(false)} style={{ display: 'none' }} />
          <div className="t">This renewal only</div><div className="d">The usual price returns after.</div>
        </label>
      </div>
      <label className="field"><span>Note (why — shown here and in the audit trail)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Agreed with the trustees: everything together from next year" />
      </label>
    </ActionForm>
  );
}

/** Every edit of a bill: what it was before, who changed it, why. */
export function BillHistory({ invoiceId }: { invoiceId: string }) {
  const [rows, setRows] = useState<{ revision_no: number; before: EditView; reason: string | null; created_at: string; changed_by_name: string | null }[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { api<typeof rows>(`/admin/invoices/${invoiceId}/revisions`).then((r) => setRows(r.data)).catch(setError); }, [invoiceId]);
  if (!rows) return <div><ErrorBox error={error} /><p className="muted">Loading…</p></div>;
  if (!rows.length) return <p className="muted">Never edited.</p>;
  return (
    <table className="data nested" data-testid="bill-history">
      <thead><tr><th>Edit</th><th>When / who</th><th>Before</th><th>Why</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.revision_no}>
            <td>#{r.revision_no}</td>
            <td>{formatDate(r.created_at)}<div className="small muted">{r.changed_by_name ?? '—'}</div></td>
            <td className="small">
              <span className="mono">{r.before.invoice_number}</span> · {formatPaise(Number(r.before.total_paise))}{r.before.price_includes_gst ? ' incl. GST' : ''}
              <div className="muted">{(r.before.lines ?? []).map((l) => `${l.description} ${formatPaise(Number(l.amount_paise))}`).join(' · ')}</div>
            </td>
            <td className="small">{r.reason ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
