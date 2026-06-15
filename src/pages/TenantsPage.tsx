import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatPaise, type ApiMeta } from '../api/client';
import type { TenantRow } from '../api/types';
import { ActionForm, Badge, ErrorBox, Modal, Pagination } from '../components/ui';

const PLANS = ['starter', 'standard', 'premium', 'enterprise'];
const TIERS = ['pooled', 'dedicated_schema', 'dedicated_database'];

export function TenantsPage() {
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: '25' });
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (plan) params.set('plan', plan);
    api<TenantRow[]>(`/admin/tenants?${params}`)
      .then((r) => {
        setRows(r.data);
        setMeta(r.meta);
      })
      .catch(setError);
  }, [page, q, status, plan]);

  useEffect(load, [load]);

  return (
    <div>
      <h1>Manage Mandir</h1>
      <ErrorBox error={error} />
      <div className="toolbar">
        <input placeholder="Search name or slug…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {['active', 'suspended', 'provisioning', 'cancelled'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={plan} onChange={(e) => { setPlan(e.target.value); setPage(1); }}>
          <option value="">All plans</option>
          {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="grow" />
        <button className="btn primary" onClick={() => setShowCreate(true)}>+ Onboard Mandir</button>
      </div>

      <table className="data">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Plan</th>
            <th>Tier</th>
            <th>Global sync</th>
            <th>Pending dues</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>
                <Link to={`/mandirs/${t.id}`}>{t.name}</Link>
                <div className="muted mono">{t.slug}</div>
              </td>
              <td><Badge value={t.status} /></td>
              <td>{t.plan}</td>
              <td>{t.tenancy_tier.replace(/_/g, ' ')}</td>
              <td>{t.global_sync_enabled ? 'on' : 'off'}</td>
              <td>{t.pending_amount_paise ? formatPaise(t.pending_amount_paise) : '—'}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={6} className="muted">No mandirs found.</td></tr>
          )}
        </tbody>
      </table>
      {meta && <Pagination page={page} total={meta.total} limit={25} onPage={setPage} />}

      {showCreate && <CreateTenantModal onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  );
}

function CreateTenantModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '',
    plan: 'standard',
    billing_cycle: 'monthly',
    tenancy_tier: 'pooled',
    admin_name: '',
    admin_mobile: '',
    city: '',
    state: '',
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <Modal title="Onboard new mandir" onClose={onClose}>
      <ActionForm
        submitLabel="Create"
        onDone={() => { onCreated(); onClose(); }}
        onSubmit={async () => {
          await api('/admin/tenants', {
            method: 'POST',
            body: {
              name: form.name,
              plan: form.plan,
              billing_cycle: form.billing_cycle,
              tenancy_tier: form.tenancy_tier,
              admin_contact: { name: form.admin_name, mobile: form.admin_mobile },
              address: { city: form.city, state: form.state },
            },
          });
        }}
      >
        <label className="field"><span>Mandir name</span><input name="name" value={form.name} onChange={set('name')} required /></label>
        <label className="field"><span>Plan</span>
          <select name="plan" value={form.plan} onChange={set('plan')}>{PLANS.map((p) => <option key={p}>{p}</option>)}</select>
        </label>
        <label className="field"><span>Billing cycle</span>
          <select name="billing_cycle" value={form.billing_cycle} onChange={set('billing_cycle')}>
            <option value="monthly">monthly</option>
            <option value="yearly">yearly</option>
          </select>
        </label>
        <label className="field"><span>Tenancy tier (big mandir → dedicated database)</span>
          <select name="tenancy_tier" value={form.tenancy_tier} onChange={set('tenancy_tier')}>
            {TIERS.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <label className="field"><span>Admin contact name</span><input name="admin_name" value={form.admin_name} onChange={set('admin_name')} required /></label>
        <label className="field"><span>Admin mobile (+91…)</span><input name="admin_mobile" value={form.admin_mobile} onChange={set('admin_mobile')} required /></label>
        <label className="field"><span>City</span><input name="city" value={form.city} onChange={set('city')} /></label>
        <label className="field"><span>State</span><input name="state" value={form.state} onChange={set('state')} /></label>
      </ActionForm>
    </Modal>
  );
}
