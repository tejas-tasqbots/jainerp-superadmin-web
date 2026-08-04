import { useCallback, useEffect, useState } from 'react';
import { api, formatPaise } from '../api/client';
import { ActionForm, ErrorBox, Modal } from '../components/ui';

interface Plan {
  id: string;
  name: string;
  display_name: string;
  price_monthly_paise: number;
  price_yearly_paise: number;
  max_users: number;
  max_devices: number;
  max_receipts_per_month: number;
  max_sms_per_month: number;
  max_storage_mb: number;
  features?: Record<string, unknown>;
  is_active: boolean;
  sort_order: number;
  /** Live temples on this plan (soft-deleted excluded) — set by the API. */
  tenant_count: number;
  /** How many of those additionally carry a per-tenant custom override. */
  custom_override_count: number;
}

/** Limit columns store -1 to mean "no cap" — never show the sentinel raw. */
function limit(n: number | null | undefined): string {
  if (n == null) return '—';
  return n < 0 ? 'Unlimited' : String(n);
}

export function PlansPage() {
  const [rows, setRows] = useState<Plan[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);

  const load = useCallback(() => {
    api<Plan[]>('/admin/plans').then((r) => setRows(r.data)).catch(setError);
  }, []);
  useEffect(load, [load]);

  return (
    <div>
      <h1>Subscription Plans</h1>
      <ErrorBox error={error} />
      <div className="toolbar">
        <p className="muted" style={{ margin: 0 }}>
          Define the plans mandirs can subscribe to. Prices are what temples pay; limits gate their usage.
          A single mandir can be given bespoke pricing without a new plan — see <b>Set custom plan</b> on its detail page.
        </p>
        <div className="grow" />
        <button className="btn primary" onClick={() => setShowCreate(true)}>+ New Plan</button>
      </div>

      <table className="data">
        <thead>
          <tr><th>Plan</th><th>Monthly</th><th>Yearly</th><th>Users</th><th>Receipts/mo</th><th>SMS/mo</th><th>Mandirs</th><th>Active</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.display_name}</strong><br /><span className="muted mono">{p.name}</span></td>
              {/* formatPaise already prefixes ₹ — adding another gave "₹₹999". */}
              <td>{p.price_monthly_paise > 0 ? formatPaise(p.price_monthly_paise) : 'Free'}</td>
              <td>{p.price_yearly_paise > 0 ? formatPaise(p.price_yearly_paise) : 'Free'}</td>
              <td>{limit(p.max_users)}</td>
              <td>{limit(p.max_receipts_per_month)}</td>
              <td>{limit(p.max_sms_per_month)}</td>
              <td data-testid={`plan-usage-${p.name}`}>
                {p.tenant_count}
                {p.custom_override_count > 0 && (
                  <div className="muted" style={{ fontSize: 11 }}>{p.custom_override_count} custom</div>
                )}
              </td>
              <td>{p.is_active ? <span className="badge green">Active</span> : <span className="badge">Archived</span>}</td>
              <td>
                <button className="btn sm" onClick={() => setEditing(p)}>Edit</button>{' '}
                {/* A plan in use can only be archived — deleting it would orphan
                    the FK from tenants/subscriptions and break billing history. */}
                <button
                  className="btn sm danger"
                  data-testid={`delete-plan-${p.name}`}
                  disabled={p.tenant_count > 0}
                  title={p.tenant_count > 0 ? 'In use — archive it instead (uncheck Active)' : 'Delete this unused plan'}
                  onClick={async () => {
                    if (!confirm(`Delete plan "${p.display_name}"? This cannot be undone.`)) return;
                    try { await api(`/admin/plans/${p.id}`, { method: 'DELETE' }); load(); }
                    catch (e) { setError(e); }
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={9} className="muted">No plans defined yet.</td></tr>}
        </tbody>
      </table>

      {showCreate && (
        <Modal title="New plan" onClose={() => setShowCreate(false)}>
          <PlanForm onDone={() => { setShowCreate(false); load(); }} />
        </Modal>
      )}
      {editing && (
        <Modal title={`Edit ${editing.display_name}`} onClose={() => setEditing(null)}>
          <PlanForm plan={editing} onDone={() => { setEditing(null); load(); }} />
        </Modal>
      )}
    </div>
  );
}

function PlanForm({ plan, onDone }: { plan?: Plan; onDone: () => void }) {
  const [form, setForm] = useState({
    name: plan?.name ?? '',
    display_name: plan?.display_name ?? '',
    price_monthly: plan ? String(plan.price_monthly_paise / 100) : '',
    price_yearly: plan ? String(plan.price_yearly_paise / 100) : '',
    max_users: String(plan?.max_users ?? 2),
    max_devices: String(plan?.max_devices ?? 1),
    max_receipts_per_month: String(plan?.max_receipts_per_month ?? 100),
    max_sms_per_month: String(plan?.max_sms_per_month ?? 50),
    max_storage_mb: String(plan?.max_storage_mb ?? 500),
    sort_order: String(plan?.sort_order ?? 0),
    is_active: plan?.is_active ?? true,
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: k === 'is_active' ? e.target.checked : e.target.value });

  return (
    <ActionForm
      submitLabel={plan ? 'Save' : 'Create'}
      onDone={onDone}
      onSubmit={async () => {
        const body = {
          name: form.name,
          display_name: form.display_name,
          price_monthly_paise: Math.round(Number(form.price_monthly || 0) * 100),
          price_yearly_paise: Math.round(Number(form.price_yearly || 0) * 100),
          max_users: Number(form.max_users),
          max_devices: Number(form.max_devices),
          max_receipts_per_month: Number(form.max_receipts_per_month),
          max_sms_per_month: Number(form.max_sms_per_month),
          max_storage_mb: Number(form.max_storage_mb),
          sort_order: Number(form.sort_order),
          ...(plan && { is_active: form.is_active }),
        };
        if (plan) await api(`/admin/plans/${plan.id}`, { method: 'PATCH', body });
        else await api('/admin/plans', { method: 'POST', body });
      }}
    >
      {!plan && (
        <label className="field"><span>Key (lowercase, e.g. "standard")</span><input value={form.name} onChange={set('name')} required /></label>
      )}
      <label className="field"><span>Display name</span><input value={form.display_name} onChange={set('display_name')} required /></label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>Price / month (₹)</span><input type="number" value={form.price_monthly} onChange={set('price_monthly')} /></label>
        <label className="field"><span>Price / year (₹)</span><input type="number" value={form.price_yearly} onChange={set('price_yearly')} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>Max users</span><input type="number" value={form.max_users} onChange={set('max_users')} /></label>
        <label className="field"><span>Max devices</span><input type="number" value={form.max_devices} onChange={set('max_devices')} /></label>
        <label className="field"><span>Receipts / month</span><input type="number" value={form.max_receipts_per_month} onChange={set('max_receipts_per_month')} /></label>
        <label className="field"><span>SMS / month</span><input type="number" value={form.max_sms_per_month} onChange={set('max_sms_per_month')} /></label>
        <label className="field"><span>Storage (MB)</span><input type="number" value={form.max_storage_mb} onChange={set('max_storage_mb')} /></label>
        <label className="field"><span>Sort order</span><input type="number" value={form.sort_order} onChange={set('sort_order')} /></label>
      </div>
      {plan && (
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={form.is_active} onChange={set('is_active')} /> <span>Active</span>
        </label>
      )}
    </ActionForm>
  );
}
