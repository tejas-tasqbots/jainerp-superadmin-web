import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDate, formatPaise } from '../api/client';
import type { DashboardStats, PendingSubscriptionRow, SuspectedDemo } from '../api/types';
import { ErrorBox, Modal, useToast } from '../components/ui';
import { EmptyRow, PageHeader } from '../components/PageHeader';
import { useCan } from '../auth/permissions';

/**
 * The console's home: revenue first, then the mandirs behind it, then growth.
 *
 * Every figure is CUSTOMERS ONLY (superadmin-api stats.service.ts, migration
 * 094): Tasqbots' demo / test mandirs are left out and counted on their own
 * line, and the mandirs that merely LOOK like demos are offered for a person
 * to confirm — the console never decides that by itself. Each card links to
 * the list behind its number, the way Stripe / Chargebee dashboards do.
 */
const plural = (n: number, word: string) => `${n.toLocaleString('en-IN')} ${word}${n === 1 ? '' : 's'}`;

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [pending, setPending] = useState<PendingSubscriptionRow[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [reviewing, setReviewing] = useState(false);
  const [attention, setAttention] = useState<number | null>(null);
  const canMark = useCan('billing.manage');

  const load = useCallback(() => {
    api<DashboardStats>('/admin/stats').then((r) => setStats(r.data)).catch(setError);
    api<PendingSubscriptionRow[]>('/admin/stats/pending-subscriptions?limit=10').then((r) => setPending(r.data)).catch(setError);
    // The same query the list runs, so the number and the list cannot disagree.
    api<unknown[]>('/admin/mandir-directory?view=attention&limit=1').then((r) => setAttention(r.meta?.total ?? 0)).catch(() => setAttention(null));
  }, []);
  useEffect(load, [load]);

  const s = stats;
  const dir = s?.directory;
  const off = s?.offline;
  const customers = dir ? dir.online + dir.offline + dir.both : s?.temples.total ?? 0;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={<>Paying customers only{dir?.demo ? <> — <Link to="/mandirs?demo=demo">{dir.demo} demo / test mandir{dir.demo === 1 ? '' : 's'}</Link> left out</> : null}.</>}
        actions={<button className="btn" onClick={load}>Refresh</button>}
      />
      <ErrorBox error={error} />

      {!!dir?.suspected_demo && (
        <div className="notice" data-testid="suspected-demo-notice">
          <span><b>{dir.suspected_demo}</b> mandir{dir.suspected_demo === 1 ? ' looks' : 's look'} like a demo or test (name, slug or the Tasqbots test number) and {dir.suspected_demo === 1 ? 'is' : 'are'} still counted as revenue.</span>
          {canMark && <button className="btn sm" onClick={() => setReviewing(true)}>Review</button>}
        </div>
      )}

      {!s ? <p className="muted">Loading…</p> : (
        <>
          <div className="section-title">Revenue</div>
          <div className="stat-grid">
            <div className="stat primary">
              <div className="label">MRR · online</div>
              <div className="value" data-testid="stat-mrr">{formatPaise(s.subscriptions.mrr_paise)}</div>
              <div className="sub">{plural(s.subscriptions.paying_tenants ?? 0, 'paying mandir')} · at the price each one pays</div>
            </div>
            <div className="stat primary">
              <div className="label">ARR · total</div>
              <div className="value" data-testid="stat-arr">{formatPaise(s.total_arr_paise ?? s.subscriptions.arr_paise)}</div>
              <div className="sub">Online {formatPaise(s.subscriptions.arr_paise)} · Offline {formatPaise(off?.arr_paise ?? 0)}</div>
            </div>
            <div className="stat">
              <div className="label">Owed · online</div>
              <div className="value" data-testid="stat-pending">{formatPaise(s.subscriptions.pending_amount_paise)}</div>
              <div className="sub">{plural(s.subscriptions.pending_invoices, 'invoice')} · {plural(s.subscriptions.past_due_tenants, 'mandir')}</div>
              <Link className="stat-link" to="/mandirs?dues=true&sort=dues">View mandirs →</Link>
            </div>
            <div className="stat">
              <div className="label">Owed · offline licences</div>
              <div className="value">{formatPaise(off?.unpaid_paise ?? 0)}</div>
              <div className="sub">{plural(off?.unpaid_mandirs ?? 0, 'mandir')} · {off?.paying_mandirs ?? 0} on a paid licence</div>
              <Link className="stat-link" to="/mandirs?deployment=offline&dues=true">View mandirs →</Link>
            </div>
          </div>

          <div className="section-title">Mandirs</div>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Customers</div>
              <div className="value" data-testid="stat-temples">{customers}</div>
              <div className="sub">{dir ? `${dir.online} online · ${dir.offline} offline · ${dir.both} both` : `${s.temples.active} active`}</div>
              <Link className="stat-link" to="/mandirs">Manage Mandir →</Link>
            </div>
            <div className="stat">
              <div className="label">Staff can sign in</div>
              <div className="value" data-testid="stat-usable">{s.temples.usable ?? s.temples.active}</div>
              <div className="sub">{s.temples.suspended ?? 0} suspended · {s.temples.deactivated ?? 0} deactivated · {s.temples.provisioning} provisioning</div>
              <Link className="stat-link" to="/mandirs?view=blocked">Blocked →</Link>
            </div>
            <div className="stat">
              <div className="label">In the devotee app</div>
              <div className="value" data-testid="stat-devotee-visible">{s.temples.devotee_visible ?? 0}</div>
              <div className="sub">{s.temples.devotee_hidden ?? 0} hidden · {s.temples.custom_plan ?? 0} on custom plans</div>
              <Link className="stat-link" to="/mandirs?devotee=hidden">Hidden →</Link>
            </div>
            <div className="stat">
              <div className="label">Needs attention</div>
              <div className="value" data-testid="stat-attention">{attention ?? '—'}</div>
              <div className="sub">money owed, blocked, or a licence ending</div>
              <Link className="stat-link" to="/mandirs?view=attention">Open list →</Link>
            </div>
          </div>

          <div className="section-title">Growth & devotees</div>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">New this month</div>
              <div className="value">+{s.growth.signups_this_month}</div>
              <div className="sub">{s.growth.churned_this_month} cancelled this month</div>
            </div>
            <div className="stat">
              <div className="label">Devotees</div>
              <div className="value">{s.devotees.total.toLocaleString('en-IN')}</div>
              <div className="sub">{s.devotees.verified.toLocaleString('en-IN')} verified</div>
              <Link className="stat-link" to="/devotees">Manage Devotees →</Link>
            </div>
            <div className="stat">
              <div className="label">Deleted</div>
              <div className="value">{s.temples.deleted ?? 0}</div>
              <div className="sub">kept with their books, restorable</div>
              <Link className="stat-link" to="/mandirs?view=deleted">Recycle bin →</Link>
            </div>
          </div>

          <div className="card" style={{ marginTop: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Largest dues · online</h2>
              <Link to="/mandirs?dues=true&sort=dues" className="btn sm">All mandirs owing</Link>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Mandir</th><th>Plan</th><th className="num">Unpaid invoices</th><th className="num">Owed</th><th>Oldest due</th></tr>
                </thead>
                <tbody>
                  {pending.map((r) => (
                    <tr key={r.tenant_id}>
                      <td><Link to={`/mandirs/${r.tenant_id}`}>{r.tenant_name}</Link></td>
                      <td>{r.plan}</td>
                      <td className="num">{r.overdue_invoices}</td>
                      <td className="num"><b>{formatPaise(r.pending_amount_paise)}</b></td>
                      <td>{formatDate(r.oldest_due_date)}</td>
                    </tr>
                  ))}
                  {pending.length === 0 && <EmptyRow colSpan={5} title="Nothing owed.">Every customer is paid up.</EmptyRow>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {reviewing && <SuspectedDemos onClose={() => setReviewing(false)} onChanged={load} />}
    </div>
  );
}

/** Confirm, one by one, which look-alike mandirs really are demos. */
function SuspectedDemos({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<SuspectedDemo[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const load = useCallback(() => {
    api<SuspectedDemo[]>('/admin/stats/suspected-demos').then((r) => setRows(r.data)).catch(setError);
  }, []);
  useEffect(load, [load]);

  async function mark(r: SuspectedDemo) {
    try {
      await api(`/admin/tenants/${r.id}/demo`, { method: 'PATCH', body: { is_demo: true, note: 'confirmed from the dashboard review' } });
      toast.show(`${r.name} marked as demo.`);
      load();
      onChanged();
    } catch (e) { setError(e); }
  }

  return (
    <Modal title="Possible demo / test mandirs" onClose={onClose} wide confirmDiscard={false}>
      <p className="muted" style={{ marginTop: 0 }}>
        Suggested from the name, the slug, or the Tasqbots test number. Only mark the ones you know are not real customers —
        a demo mandir is left out of MRR, ARR, dues and counts. Nothing changes for the mandir itself, and it can be undone from its page.
      </p>
      <ErrorBox error={error} />
      <table className="data">
        <thead><tr><th>Mandir</th><th>Admin mobile</th><th>Onboarded</th><th></th></tr></thead>
        <tbody>
          {(rows ?? []).map((r) => (
            <tr key={r.id}>
              <td><Link to={`/mandirs/${r.id}`} target="_blank">{r.name}</Link><div className="sub mono">{r.slug}</div></td>
              <td className="mono">{r.mobile ?? '—'}</td>
              <td>{formatDate(r.created_at)}</td>
              <td style={{ textAlign: 'right' }}><button className="btn sm" onClick={() => mark(r)}>Mark as demo</button></td>
            </tr>
          ))}
          {rows && rows.length === 0 && <EmptyRow colSpan={4} title="Nothing left to review." />}
        </tbody>
      </table>
      {toast.node}
    </Modal>
  );
}
