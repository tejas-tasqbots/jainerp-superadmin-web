import { Plus } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useCan } from '../auth/permissions';
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
  // ---- public catalogue + provisioning (migration 038) ----
  description: string | null;
  /** Storage tier a purchase provisions. Enterprise = dedicated. */
  tenancy_tier: 'pooled' | 'dedicated';
  /** Published on jainerp.org + the self-serve registration plan picker. */
  is_public: boolean;
  /** Quote-only: raises a custom request instead of taking payment. */
  is_custom: boolean;
  highlight: boolean;
  badge: string | null;
  /** Per-plan GST override; null = the platform default (18%). */
  gst_rate: number | null;
  trial_days: number;
  highlights: string[];
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
  const canBill = useCan('billing.manage');
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
      <PageHeader
        title="Plans"
        subtitle={<>The plans mandirs subscribe to — prices are what they pay, limits gate their usage. <b>Published</b> plans appear on jainerp.org and in self-serve registration at these exact prices; no deploy is needed to change them. One mandir's own price is set on its page (Set custom plan, or the next renewal price).</>}
        actions={canBill && <button className="btn primary" data-testid="new-plan" onClick={() => setShowCreate(true)}><Plus size={15} /> New plan</button>}
      />
      <ErrorBox error={error} />

      <table className="data">
        <thead>
          <tr><th>Plan</th><th>Monthly</th><th>Yearly</th><th>Database</th><th>Users</th><th>Receipts/mo</th><th>Mandirs</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.display_name}</strong><br /><span className="muted mono">{p.name}</span></td>
              {/* formatPaise already prefixes ₹ — adding another gave "₹₹999". */}
              <td>{p.price_monthly_paise > 0 ? formatPaise(p.price_monthly_paise) : 'Free'}</td>
              <td>{p.price_yearly_paise > 0 ? formatPaise(p.price_yearly_paise) : 'Free'}</td>
              <td>
                {p.tenancy_tier === 'dedicated'
                  ? <span className="badge">Dedicated</span>
                  : <span className="muted">Pooled</span>}
              </td>
              <td>{limit(p.max_users)}</td>
              <td>{limit(p.max_receipts_per_month)}</td>
              <td data-testid={`plan-usage-${p.name}`}>
                {p.tenant_count}
                {p.custom_override_count > 0 && (
                  <div className="muted" style={{ fontSize: 11 }}>{p.custom_override_count} custom</div>
                )}
              </td>
              <td>
                {p.is_active ? <span className="badge green">Active</span> : <span className="badge">Archived</span>}
                {p.is_public && <div><span className="badge blue" data-testid={`plan-public-${p.name}`}>Published</span></div>}
                {p.is_custom && <div><span className="badge">Quote only</span></div>}
              </td>
              <td>{canBill && <>
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
              </>}</td>
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
    description: plan?.description ?? '',
    tenancy_tier: plan?.tenancy_tier ?? 'pooled',
    is_public: plan?.is_public ?? false,
    is_custom: plan?.is_custom ?? false,
    highlight: plan?.highlight ?? false,
    badge: plan?.badge ?? '',
    // Blank means "no override" — the platform's 18% applies.
    gst_rate: plan?.gst_rate == null ? '' : String(plan.gst_rate),
    trial_days: String(plan?.trial_days ?? 0),
    highlights: (plan?.highlights ?? []).join('\n'),
    modules: (((plan?.features as { modules?: string[] } | undefined)?.modules) ?? []).join(', '),
  });
  const BOOLS = ['is_active', 'is_public', 'is_custom', 'highlight'] as const;
  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm({
        ...form,
        [k]: (BOOLS as readonly string[]).includes(k)
          ? (e.target as HTMLInputElement).checked
          : e.target.value,
      });

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
          description: form.description || undefined,
          tenancy_tier: form.tenancy_tier as 'pooled' | 'dedicated',
          is_public: form.is_public,
          is_custom: form.is_custom,
          highlight: form.highlight,
          badge: form.badge || undefined,
          // '' clears the override back to the platform rate; 0 is a real
          // (zero-rated) choice, so they must not collapse to the same value.
          gst_rate: form.gst_rate === '' ? null : Number(form.gst_rate),
          trial_days: Number(form.trial_days || 0),
          highlights: form.highlights.split('\n').map((h) => h.trim()).filter(Boolean),
          // features.modules is what actually grants a module to every tenant
          // on this plan — resolveModules() unions it with per-tenant grants.
          features: {
            ...(plan?.features ?? {}),
            modules: form.modules.split(',').map((m) => m.trim()).filter(Boolean),
          },
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
      <label className="field"><span>Description (shown on the public plan card)</span>
        <textarea rows={2} value={form.description} onChange={set('description')} />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>Database tier</span>
          <select value={form.tenancy_tier} onChange={set('tenancy_tier')}>
            <option value="pooled">Pooled (shared database)</option>
            <option value="dedicated">Dedicated (own database)</option>
          </select>
        </label>
        <label className="field"><span>GST % (blank = platform default 18%)</span>
          <input type="number" step="0.01" value={form.gst_rate} onChange={set('gst_rate')} />
        </label>
        <label className="field"><span>Badge (e.g. "Most popular")</span>
          <input value={form.badge} onChange={set('badge')} />
        </label>
        <label className="field"><span>Trial days</span>
          <input type="number" value={form.trial_days} onChange={set('trial_days')} />
        </label>
      </div>

      <label className="field">
        <span>Modules included (comma-separated keys, e.g. dharamshala, gaushala)</span>
        <input value={form.modules} onChange={set('modules')} />
      </label>
      <p className="muted" style={{ fontSize: 11, marginTop: -6 }}>
        Core modules (donations, donors, accounting, reports, settings, users, expenses, registers, masters,
        dashboard) are always granted and must not be listed. Leave blank for a plan with no optional modules.
      </p>

      <label className="field"><span>Selling points (one per line)</span>
        <textarea rows={4} value={form.highlights} onChange={set('highlights')} />
      </label>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={form.is_public} onChange={set('is_public')} data-testid="plan-is-public" />
          <span>Publish (show on the website + registration)</span>
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={form.highlight} onChange={set('highlight')} /> <span>Highlight</span>
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={form.is_custom} onChange={set('is_custom')} />
          <span>Quote only (no online payment)</span>
        </label>
        {plan && (
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={form.is_active} onChange={set('is_active')} /> <span>Active</span>
          </label>
        )}
      </div>
    </ActionForm>
  );
}
