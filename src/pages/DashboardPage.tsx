import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDate, formatPaise } from '../api/client';
import type { DashboardStats, PendingSubscriptionRow } from '../api/types';
import { ErrorBox } from '../components/ui';

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [pending, setPending] = useState<PendingSubscriptionRow[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<DashboardStats>('/admin/stats')
      .then((r) => setStats(r.data))
      .catch(setError);
    api<PendingSubscriptionRow[]>('/admin/stats/pending-subscriptions?limit=10')
      .then((r) => setPending(r.data))
      .catch(setError);
  }, []);

  return (
    <div>
      <h1>Dashboard</h1>
      <ErrorBox error={error} />
      {stats && (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Temples</div>
              <div className="value" data-testid="stat-temples">{stats.temples.total}</div>
              <div className="sub">
                {stats.temples.active} active · {stats.temples.inactive} inactive ·{' '}
                {stats.temples.provisioning} provisioning
              </div>
            </div>
            <div className="stat">
              <div className="label">MRR / ARR</div>
              <div className="value">{formatPaise(stats.subscriptions.mrr_paise)}</div>
              <div className="sub">ARR {formatPaise(stats.subscriptions.arr_paise)}</div>
            </div>
            <div className="stat">
              <div className="label">Pending subscription dues</div>
              <div className="value" data-testid="stat-pending">{formatPaise(stats.subscriptions.pending_amount_paise)}</div>
              <div className="sub">
                {stats.subscriptions.pending_invoices} invoices · {stats.subscriptions.past_due_tenants} temples
              </div>
            </div>
            <div className="stat">
              <div className="label">This month</div>
              <div className="value">+{stats.growth.signups_this_month}</div>
              <div className="sub">{stats.growth.churned_this_month} churned</div>
            </div>
            <div className="stat">
              <div className="label">Devotees</div>
              <div className="value">{stats.devotees.total.toLocaleString('en-IN')}</div>
              <div className="sub">{stats.devotees.verified.toLocaleString('en-IN')} verified</div>
            </div>
          </div>

          <div className="card">
            <h2>Pending subscription amounts</h2>
            {pending.length === 0 ? (
              <p className="muted">No temples with outstanding dues. 🎉</p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Temple</th>
                    <th>Plan</th>
                    <th>Overdue invoices</th>
                    <th>Pending amount</th>
                    <th>Oldest due</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((r) => (
                    <tr key={r.tenant_id}>
                      <td>
                        <Link to={`/mandirs/${r.tenant_id}`}>{r.tenant_name}</Link>
                      </td>
                      <td>{r.plan}</td>
                      <td>{r.overdue_invoices}</td>
                      <td>{formatPaise(r.pending_amount_paise)}</td>
                      <td>{formatDate(r.oldest_due_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
