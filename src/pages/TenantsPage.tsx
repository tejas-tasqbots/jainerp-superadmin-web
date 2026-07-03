import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatPaise, type ApiMeta } from '../api/client';
import type { TenantRow } from '../api/types';
import { ActionForm, Badge, ErrorBox, Modal, Pagination } from '../components/ui';

const PLANS = ['starter', 'standard', 'premium', 'enterprise'];
const TIERS = ['pooled', 'dedicated'];

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

const TEMPLE_TYPES = ['jain', 'hindu', 'sikh', 'buddhist', 'gurudwara', 'church'];
/** Send only filled-in optional fields so the API keeps them null otherwise. */
function pick<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v != null)) as Partial<T>;
}

function CreateTenantModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    // mandir
    name: '', temple_type: 'jain', plan: 'standard', billing_cycle: 'monthly', tenancy_tier: 'pooled',
    // admin (signs into devmandir.com)
    admin_name: '', admin_mobile: '', admin_email: '',
    // address
    line1: '', line2: '', state: '', city: '', pincode: '',
    // public mandir contact (receipts + directory)
    mandir_mobile: '', mandir_email: '', website: '',
    // legal / tax
    gstin: '', pan: '', tan: '', reg_80g_number: '', reg_12a_number: '', reg_12ab_number: '',
    // bank / UPI
    upi_id: '', bank_account_name: '', bank_account_no: '', bank_ifsc: '', bank_name: '',
    // directory listing
    global_sync_enabled: false,
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  // States + cities from the bundled India geo lookup.
  const [states, setStates] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  useEffect(() => {
    api<string[]>('/admin/geo/states').then((r) => setStates(r.data)).catch(() => setStates([]));
  }, []);
  useEffect(() => {
    if (!form.state) { setCities([]); return; }
    api<string[]>(`/admin/geo/states/${encodeURIComponent(form.state)}/cities`)
      .then((r) => setCities(r.data))
      .catch(() => setCities([]));
  }, [form.state]);

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
              temple_type: form.temple_type,
              plan: form.plan,
              billing_cycle: form.billing_cycle,
              tenancy_tier: form.tenancy_tier,
              admin_contact: pick({ name: form.admin_name, mobile: form.admin_mobile, email: form.admin_email }),
              address: pick({ line1: form.line1, line2: form.line2, state: form.state, city: form.city, pincode: form.pincode }),
              global_sync_enabled: form.global_sync_enabled,
              ...pick({
                mandir_mobile: form.mandir_mobile, mandir_email: form.mandir_email, website: form.website,
                gstin: form.gstin, pan: form.pan, tan: form.tan,
                reg_80g_number: form.reg_80g_number, reg_12a_number: form.reg_12a_number, reg_12ab_number: form.reg_12ab_number,
                upi_id: form.upi_id, bank_account_name: form.bank_account_name, bank_account_no: form.bank_account_no,
                bank_ifsc: form.bank_ifsc, bank_name: form.bank_name,
              }),
            },
          });
        }}
      >
        <h4 className="form-section">Mandir & plan</h4>
        <label className="field"><span>Mandir name *</span><input name="name" value={form.name} onChange={set('name')} required /></label>
        <label className="field"><span>Temple type</span>
          <select name="temple_type" value={form.temple_type} onChange={set('temple_type')}>{TEMPLE_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        </label>
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

        <h4 className="form-section">Admin contact (signs into devmandir.com)</h4>
        <label className="field"><span>Admin name *</span><input name="admin_name" value={form.admin_name} onChange={set('admin_name')} required /></label>
        <label className="field"><span>Admin mobile (10-digit) *</span>
          <input name="admin_mobile" value={form.admin_mobile} onChange={set('admin_mobile')} inputMode="numeric" maxLength={10} placeholder="9876543210" required />
        </label>
        <label className="field"><span>Admin email</span><input name="admin_email" type="email" value={form.admin_email} onChange={set('admin_email')} /></label>

        <h4 className="form-section">Address</h4>
        <label className="field"><span>Address line 1</span><input name="line1" value={form.line1} onChange={set('line1')} /></label>
        <label className="field"><span>Address line 2</span><input name="line2" value={form.line2} onChange={set('line2')} /></label>
        <label className="field"><span>State</span>
          <select name="state" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value, city: '' })}>
            <option value="">Select state…</option>
            {states.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="field"><span>City</span>
          <select name="city" value={form.city} autoComplete="off" disabled={!form.state} onChange={set('city')}>
            <option value="">{form.state ? 'Select city…' : 'Pick a state first'}</option>
            {(form.city && !cities.includes(form.city) ? [form.city, ...cities] : cities).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="field"><span>Pincode</span><input name="pincode" value={form.pincode} onChange={set('pincode')} inputMode="numeric" maxLength={6} placeholder="411001" /></label>

        <h4 className="form-section">Mandir contact (shown on receipts & directory)</h4>
        <label className="field"><span>Mandir phone (10-digit)</span>
          <input name="mandir_mobile" value={form.mandir_mobile} onChange={set('mandir_mobile')} inputMode="numeric" maxLength={10} placeholder="defaults to admin mobile" />
        </label>
        <label className="field"><span>Mandir email</span><input name="mandir_email" type="email" value={form.mandir_email} onChange={set('mandir_email')} /></label>
        <label className="field"><span>Website</span><input name="website" value={form.website} onChange={set('website')} placeholder="https://…" /></label>

        <h4 className="form-section">Legal & tax (for 80G receipts)</h4>
        <label className="field"><span>GSTIN</span><input name="gstin" value={form.gstin} onChange={set('gstin')} maxLength={15} placeholder="15 chars" /></label>
        <label className="field"><span>PAN</span><input name="pan" value={form.pan} onChange={set('pan')} maxLength={10} placeholder="AAAAA9999A" /></label>
        <label className="field"><span>TAN</span><input name="tan" value={form.tan} onChange={set('tan')} /></label>
        <label className="field"><span>80G reg. number</span><input name="reg_80g_number" value={form.reg_80g_number} onChange={set('reg_80g_number')} /></label>
        <label className="field"><span>12A reg. number</span><input name="reg_12a_number" value={form.reg_12a_number} onChange={set('reg_12a_number')} /></label>
        <label className="field"><span>12AB reg. number</span><input name="reg_12ab_number" value={form.reg_12ab_number} onChange={set('reg_12ab_number')} /></label>

        <h4 className="form-section">Bank & UPI (receipt payment details)</h4>
        <label className="field"><span>UPI ID</span><input name="upi_id" value={form.upi_id} onChange={set('upi_id')} placeholder="mandir@upi" /></label>
        <label className="field"><span>Bank account name</span><input name="bank_account_name" value={form.bank_account_name} onChange={set('bank_account_name')} /></label>
        <label className="field"><span>Bank account no.</span><input name="bank_account_no" value={form.bank_account_no} onChange={set('bank_account_no')} /></label>
        <label className="field"><span>IFSC</span><input name="bank_ifsc" value={form.bank_ifsc} onChange={set('bank_ifsc')} /></label>
        <label className="field"><span>Bank name</span><input name="bank_name" value={form.bank_name} onChange={set('bank_name')} /></label>

        <h4 className="form-section">Directory</h4>
        <label className="field-check">
          <input type="checkbox" checked={form.global_sync_enabled} onChange={(e) => setForm({ ...form, global_sync_enabled: e.target.checked })} />
          <span>List on the public devotee/maharaj directory (global sync)</span>
        </label>
      </ActionForm>
    </Modal>
  );
}
