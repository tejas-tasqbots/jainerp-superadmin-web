import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, formatPaise } from '../api/client';
import { ActionForm, ErrorBox, Modal } from './ui';
import { useCan } from '../auth/permissions';

/**
 * A mandir's subscription the way billing tools show it (Chargebee / Zoho):
 *
 *   This term     the period, what it was invoiced at, paid or not, and when
 *   Next renewal  the date and the price it will renew at — editable: "this
 *                 year they paid X, next year they pay Y" (migration 096)
 *   Terms         every term so far: price, paid, outstanding
 *
 * GET /admin/tenants/:id/billing-summary; PUT …/next-renewal-price.
 */
interface Term {
  id: string; invoice_number: string; period_start: string; period_end: string; plan_name: string | null; billing_cycle: string | null;
  subtotal_paise: number; total_paise: number; paid_paise: number; status: string; last_paid_at: string | null;
}
interface Summary {
  subscription: { id: string; status: string; plan: string | null; plan_display: string | null; billing_cycle: string; current_period_start: string | null; current_period_end: string | null; is_custom_price: boolean } | null;
  current_term: Term | null;
  next_renewal: { date: string | null; usual_price_paise: number; price_paise: number; agreed: boolean; ongoing: boolean; note: string | null; set_by: string | null; set_at: string | null; invoice: Term | null } | null;
  terms: Term[];
}

const termLabel = (t: { period_start: string; period_end: string }) => `${formatDate(t.period_start)} → ${formatDate(t.period_end)}`;
function PaidState({ t }: { t: Term }) {
  if (t.status === 'paid') return <span className="badge green">paid{t.last_paid_at ? ` ${formatDate(t.last_paid_at)}` : ''}</span>;
  if (t.paid_paise > 0) return <span className="badge partially_paid">part paid · {formatPaise(t.total_paise - t.paid_paise)} due</span>;
  return <span className="badge unpaid">not paid · {formatPaise(t.total_paise)} due</span>;
}

export function SubscriptionTerms({ tenantId, onChanged }: { tenantId: string; onChanged: (msg: string) => void }) {
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const canBill = useCan('billing.manage');
  const load = useCallback(() => {
    api<Summary>(`/admin/tenants/${tenantId}/billing-summary`).then((r) => setS(r.data)).catch(setError);
  }, [tenantId]);
  useEffect(load, [load]);

  if (!s) return <div className="card"><ErrorBox error={error} /><p className="muted">Loading subscription…</p></div>;
  if (!s.subscription) return <div className="card"><h2>Subscription</h2><p className="muted">No subscription.</p></div>;
  const sub = s.subscription;
  const nr = s.next_renewal!;
  const cycleWord = sub.billing_cycle === 'yearly' ? 'year' : 'month';
  const cur = s.current_term;
  const change = nr.agreed && nr.usual_price_paise ? Math.round(((nr.price_paise - nr.usual_price_paise) / nr.usual_price_paise) * 1000) / 10 : null;

  return (
    <div className="card" data-testid="subscription-terms">
      <ErrorBox error={error} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>Subscription</h2>
        <span className="muted" style={{ fontSize: 13 }}>
          {sub.plan_display ?? sub.plan} · {sub.billing_cycle}{sub.is_custom_price ? ' · custom price' : ''} · <span className={`badge ${sub.status}`}>{sub.status}</span>
        </span>
      </div>

      <div className="term-grid">
        <section className="term" data-testid="this-term">
          <div className="term-k">This {cycleWord}</div>
          <div className="term-period">{sub.current_period_start ? termLabel({ period_start: sub.current_period_start, period_end: sub.current_period_end ?? sub.current_period_start }) : '—'}</div>
          {cur ? (
            <>
              <div className="term-price">{formatPaise(cur.subtotal_paise)} <span className="muted">+ GST = {formatPaise(cur.total_paise)}</span></div>
              <div><PaidState t={cur} /></div>
              <div className="sub mono">{cur.invoice_number}</div>
            </>
          ) : <p className="muted" style={{ margin: '6px 0 0' }}>No invoice for this term (free plan, or raised outside the console).</p>}
        </section>

        <section className="term next" data-testid="next-renewal">
          <div className="term-k">Next renewal{nr.date ? ` · ${formatDate(nr.date)}` : ''}</div>
          {nr.invoice ? (
            <>
              <div className="term-price">{formatPaise(nr.invoice.subtotal_paise)} <span className="muted">+ GST = {formatPaise(nr.invoice.total_paise)}</span></div>
              <div><PaidState t={nr.invoice} /></div>
              <div className="sub">Already invoiced — {nr.invoice.invoice_number}. To change it, re-price that invoice below.</div>
            </>
          ) : (
            <>
              <div className="term-price" data-testid="next-price">{formatPaise(nr.price_paise)} <span className="muted">+ GST, per {cycleWord}</span></div>
              {nr.agreed ? (
                <div className="sub">
                  <b>Agreed price</b>{change !== null && change !== 0 ? ` (${change > 0 ? '+' : ''}${change}% on the usual ${formatPaise(nr.usual_price_paise)})` : ''}
                  {' · '}{nr.ongoing ? 'from this renewal onwards' : 'for this renewal only'}
                  {nr.note ? <> · “{nr.note}”</> : null}
                  {nr.set_by ? <> · set by {nr.set_by}{nr.set_at ? ` on ${formatDate(nr.set_at)}` : ''}</> : null}
                </div>
              ) : <div className="sub">The usual price for this plan{sub.is_custom_price ? ' (custom)' : ''}.</div>}
              {canBill && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button className="btn sm primary" data-testid="edit-next-price" onClick={() => setEditing(true)}>{nr.agreed ? 'Change next renewal price' : 'Set next renewal price'}</button>
                  {nr.agreed && (
                    <button className="btn sm" onClick={async () => {
                      try {
                        await api(`/admin/tenants/${tenantId}/next-renewal-price`, { method: 'PUT', body: { amount_paise: null } });
                        load(); onChanged('Next renewal back to the usual price.');
                      } catch (e) { setError(e); }
                    }}>Use the usual price</button>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {s.terms.length > 0 && (
        <>
          <h4 className="form-section" style={{ marginTop: 16 }}>Every term</h4>
          <div className="table-wrap">
            <table className="data nested" data-testid="terms-history">
              <thead><tr><th>Term</th><th>Plan</th><th className="num">Price</th><th className="num">With GST</th><th className="num">Paid</th><th>State</th></tr></thead>
              <tbody>
                {s.terms.map((t) => (
                  <tr key={t.id}>
                    <td>{termLabel(t)}<div className="sub mono">{t.invoice_number}</div></td>
                    <td>{t.plan_name ?? '—'}{t.billing_cycle ? ` · ${t.billing_cycle}` : ''}</td>
                    <td className="num">{formatPaise(t.subtotal_paise)}</td>
                    <td className="num">{formatPaise(t.total_paise)}</td>
                    <td className="num">{formatPaise(t.paid_paise)}</td>
                    <td><PaidState t={t} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && (
        <Modal title="Next renewal price" onClose={() => setEditing(false)}>
          <NextPriceForm
            tenantId={tenantId}
            cycleWord={cycleWord}
            date={nr.date}
            current={cur?.subtotal_paise ?? null}
            usual={nr.usual_price_paise}
            initial={nr.agreed ? { amount: nr.price_paise, ongoing: nr.ongoing, note: nr.note ?? '' } : null}
            onDone={(msg) => { setEditing(false); load(); onChanged(msg); }}
          />
        </Modal>
      )}
    </div>
  );
}

function NextPriceForm({ tenantId, cycleWord, date, current, usual, initial, onDone }: {
  tenantId: string; cycleWord: string; date: string | null; current: number | null; usual: number;
  initial: { amount: number; ongoing: boolean; note: string } | null; onDone: (msg: string) => void;
}) {
  const [rupees, setRupees] = useState(initial ? String(initial.amount / 100) : String(usual / 100));
  const [ongoing, setOngoing] = useState(initial?.ongoing ?? true);
  const [note, setNote] = useState(initial?.note ?? '');
  const paise = Math.round(Number(rupees) * 100);
  const base = current ?? usual;
  const pct = base && Number.isFinite(paise) ? Math.round(((paise - base) / base) * 1000) / 10 : null;
  return (
    <ActionForm submitLabel="Save next renewal price" successMessage={null}
      onSubmit={async () => {
        if (!Number.isFinite(paise) || paise < 0) throw new Error('Enter the price in rupees.');
        await api(`/admin/tenants/${tenantId}/next-renewal-price`, { method: 'PUT', body: { amount_paise: paise, ongoing, note } });
        onDone(`Next renewal${date ? ` on ${formatDate(date)}` : ''} set to ${formatPaise(paise)} + GST.`);
      }}>
      <p className="muted" style={{ marginTop: 0 }}>
        Used when the renewal{date ? ` on ${formatDate(date)}` : ''} is invoiced. Nothing already invoiced changes.
        {current != null && <> This {cycleWord} was invoiced at <b>{formatPaise(current)}</b>.</>} The usual price is {formatPaise(usual)}.
      </p>
      <label className="field"><span>Next {cycleWord}'s price (₹, before GST)</span>
        <input data-testid="next-price-input" type="number" min={0} step="1" value={rupees} onChange={(e) => setRupees(e.target.value)} />
        {pct !== null && pct !== 0 && <span className="hint">{pct > 0 ? '+' : ''}{pct}% on {current != null ? `this ${cycleWord}` : 'the usual price'} · {formatPaise(Math.round(paise * 1.18))} with 18% GST</span>}
      </label>
      <div className="role-cards" role="radiogroup" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <label className={`choice${ongoing ? ' selected' : ''}`} style={{ display: 'block' }}>
          <input type="radio" name="np-scope" checked={ongoing} onChange={() => setOngoing(true)} style={{ display: 'none' }} />
          <div className="t">From this renewal onwards</div><div className="d">The mandir's price for every {cycleWord} after, until changed.</div>
        </label>
        <label className={`choice${!ongoing ? ' selected' : ''}`} style={{ display: 'block' }}>
          <input type="radio" name="np-scope" checked={!ongoing} onChange={() => setOngoing(false)} style={{ display: 'none' }} />
          <div className="t">This renewal only</div><div className="d">A one-off (a discount, a catch-up); the usual price returns after.</div>
        </label>
      </div>
      <label className="field"><span>Note (why — shown on this screen and in the audit trail)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Agreed 10% increase with the trustees, 12 Oct" maxLength={500} />
      </label>
    </ActionForm>
  );
}
