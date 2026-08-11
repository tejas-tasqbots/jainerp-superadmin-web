import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, formatDate, formatPaise, openReceipt } from '../api/client';
import { PhoneInput } from '../components/PhoneInput';
import type { BillingHistory, Invoice, License, LifecycleEvent, TenantDetail } from '../api/types';
import { ActionForm, Badge, ErrorBox, Modal } from '../components/ui';
import { ModulePicker } from '../components/ModulePicker';

const PLANS = ['starter', 'standard', 'premium', 'enterprise'];
const TIERS = ['pooled', 'dedicated'];
type Tab = 'overview' | 'billing' | 'history' | 'users' | 'people' | 'licenses';

const MANDIR_ROLES = ['temple_admin', 'cashier', 'accountant', 'priest', 'volunteer', 'viewer', 'bhojanshala_cashier'];
interface MandirUser {
  id: string; user_id: string; roles: string[]; is_active: boolean; joined_at: string;
  name: string | null; mobile: string; email: string | null;
}

export function TenantDetailPage() {
  const { id = '' } = useParams();
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<TenantDetail>(`/admin/tenants/${id}`).then((r) => setTenant(r.data)).catch(setError);
  }, [id]);
  useEffect(load, [load]);

  if (!tenant) return <div><ErrorBox error={error} />Loading…</div>;

  return (
    <div>
      <h1>
        {tenant.name} <Badge value={tenant.status} />
      </h1>
      <p className="muted mono">{tenant.slug} · {tenant.tenancy_tier.replace(/_/g, ' ')} · plan: {tenant.plan}</p>
      <ErrorBox error={error} />
      {notice && <div className="success-box" data-testid="notice">{notice}</div>}

      <div className="tabs">
        {(['overview', 'billing', 'history', 'users', 'people', 'licenses'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'people' ? 'Trustees & Requirements' : t === 'users' ? 'Mandir Users' : t === 'history' ? 'Subscription & Receipts' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab tenant={tenant} onChanged={(msg) => { setNotice(msg); load(); }} />}
      {tab === 'billing' && <BillingTab tenant={tenant} onChanged={(msg) => { setNotice(msg); load(); }} />}
      {tab === 'history' && <HistoryTab tenant={tenant} />}
      {tab === 'users' && <UsersTab tenant={tenant} onNotice={setNotice} />}
      {tab === 'people' && <PeopleTab tenant={tenant} onChanged={(msg) => { setNotice(msg); load(); }} />}
      {tab === 'licenses' && <LicensesTab tenant={tenant} onChanged={(msg) => { setNotice(msg); }} />}
    </div>
  );
}

// ---------------- Overview ----------------
function OverviewTab({ tenant, onChanged }: { tenant: TenantDetail; onChanged: (msg: string) => void }) {
  const navigate = useNavigate();
  const [modal, setModal] = useState<
    'plan' | 'tier' | 'suspend' | 'cancel' | 'deactivate' | 'custom-plan' | 'modules' | null
  >(null);
  const [error, setError] = useState<unknown>(null);

  async function action(fn: () => Promise<unknown>, msg: string) {
    setError(null);
    try {
      await fn();
      onChanged(msg);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div>
      <ErrorBox error={error} />
      <div className="card">
        <h2>Profile</h2>
        <dl className="kv">
          <dt>Type</dt><dd>{tenant.temple_type}</dd>
          <dt>Address</dt><dd>{[tenant.profile.address.line1, tenant.profile.address.city, tenant.profile.address.state, tenant.profile.address.pincode].filter(Boolean).join(', ') || '—'}</dd>
          <dt>Contact</dt><dd>{tenant.profile.contact.name ?? '—'} {tenant.profile.contact.mobile ?? ''}</dd>
          <dt>GSTIN / PAN</dt><dd>{tenant.profile.gstin ?? '—'} / {tenant.profile.pan ?? '—'}</dd>
          <dt>80G / 12A</dt><dd>{tenant.profile.registration_80g ?? '—'} / {tenant.profile.registration_12a ?? '—'}</dd>
          <dt>Custom domain</dt><dd>{tenant.custom_domain ?? '—'}</dd>
          <dt>Global Ledger sync</dt><dd>{tenant.global_sync_enabled ? 'enabled (mirrored)' : 'off (on-demand fetch)'}</dd>
          <dt>DB cluster</dt><dd className="mono">{tenant.db_cluster_ref}</dd>
          <dt>Onboarded</dt><dd>{formatDate(tenant.created_at)}</dd>
        </dl>
      </div>

      {/* ---- Visibility & access (migration 029) ---------------------------
          Three independent switches. Any one of them blocks staff login;
          devotee visibility is separate and never affects login. */}
      <div className="card" data-testid="access-card">
        <h2>Visibility &amp; access</h2>
        <p className="muted">
          Staff can sign in only when <b>all</b> of Status, Active and Not-deleted allow it.
          Devotee visibility is independent — a live mandir can be hidden from the devotee app.
        </p>
        <dl className="kv">
          <dt>Staff login</dt>
          <dd data-testid="access-enabled">
            {tenant.access_enabled
              ? <span className="badge green">allowed</span>
              : <span className="badge red">blocked{tenant.access_block_reason ? ` · ${tenant.access_block_reason.replace(/_/g, ' ')}` : ''}</span>}
          </dd>
          <dt>Devotee app</dt>
          <dd data-testid="devotee-visible-state">
            {tenant.devotee_visible
              ? (tenant.access_enabled
                  ? <span className="badge green">listed in the directory</span>
                  : <span className="badge">visible flag on, but the mandir is blocked</span>)
              : <span className="badge">hidden from devotees</span>}
          </dd>
          {!tenant.access_enabled && (
            <>
              <dt>Staff will see</dt>
              <dd data-testid="block-message">{tenant.effective_block_message}</dd>
            </>
          )}
        </dl>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button
            className="btn"
            data-testid="toggle-visibility"
            onClick={() =>
              action(
                () => api(`/admin/tenants/${tenant.id}/visibility`, {
                  method: 'PATCH',
                  body: { devotee_visible: !tenant.devotee_visible },
                }),
                tenant.devotee_visible
                  ? 'Hidden from devotees — the mandir no longer appears in the devotee app'
                  : 'Visible to devotees — the mandir now appears in the devotee app',
              )
            }
          >
            {tenant.devotee_visible ? 'Hide from devotees' : 'Show to devotees'}
          </button>
          {tenant.is_active ? (
            <button className="btn" data-testid="deactivate" onClick={() => setModal('deactivate')}>
              Deactivate (block logins)
            </button>
          ) : (
            <button
              className="btn"
              data-testid="activate"
              onClick={() =>
                action(
                  () => api(`/admin/tenants/${tenant.id}/activation`, { method: 'PATCH', body: { is_active: true } }),
                  'Mandir activated — staff can sign in again',
                )
              }
            >
              Activate
            </button>
          )}
          {tenant.is_deleted && (
            <button
              className="btn"
              data-testid="restore"
              onClick={() =>
                action(() => api(`/admin/tenants/${tenant.id}/restore`, { method: 'PATCH', body: {} }), 'Mandir restored')
              }
            >
              Restore deleted mandir
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Actions</h2>
        <div className="toolbar">
          {tenant.status === 'active' && !tenant.is_deleted && (
            <button className="btn" onClick={() => setModal('suspend')}>Suspend</button>
          )}
          {tenant.status === 'suspended' && (
            <button
              className="btn"
              onClick={() => action(() => api(`/admin/tenants/${tenant.id}/reactivate`, { method: 'PATCH', body: {} }), 'Mandir reactivated')}
            >
              Reactivate
            </button>
          )}
          <button className="btn" data-testid="custom-plan-btn" onClick={() => setModal('custom-plan')}>
            {tenant.custom_plan ? 'Edit custom plan' : 'Set custom plan'}
          </button>
          <button className="btn" data-testid="modules-btn" onClick={() => setModal('modules')}>
            Modules…
          </button>
          {/* Verifying locks the mandir's bank/80G/PAN details: after this they
              can only change via a reviewed request (migration 028). */}
          <button
            className="btn"
            onClick={() =>
              action(
                () => api(`/admin/tenants/${tenant.id}/verify-sensitive`, {
                  method: 'PATCH',
                  body: { verified: !tenant.sensitive_verified_at },
                }),
                tenant.sensitive_verified_at
                  ? 'Bank & tax details unlocked — the mandir can edit them again'
                  : 'Bank & tax details verified and locked',
              )
            }
          >
            {tenant.sensitive_verified_at ? 'Unlock bank & tax details' : 'Verify bank & tax details'}
          </button>
          <button className="btn" onClick={() => setModal('plan')}>Change plan</button>
          <button className="btn" onClick={() => setModal('tier')}>Change tenancy tier</button>
          <button
            className="btn"
            onClick={() =>
              action(
                () => api(`/admin/tenants/${tenant.id}`, { method: 'PATCH', body: { global_sync_enabled: !tenant.global_sync_enabled } }),
                `Global sync ${tenant.global_sync_enabled ? 'disabled' : 'enabled'}`,
              )
            }
          >
            {tenant.global_sync_enabled ? 'Disable' : 'Enable'} global sync
          </button>
          <div className="grow" />
          {!tenant.is_deleted && (
            <button className="btn danger" data-testid="delete-tenant" onClick={() => setModal('cancel')}>
              Delete mandir…
            </button>
          )}
        </div>
      </div>

      {modal === 'suspend' && (
        <Modal title="Suspend mandir" onClose={() => setModal(null)}>
          <SuspendForm tenantId={tenant.id} onDone={() => { setModal(null); onChanged('Mandir suspended'); }} />
        </Modal>
      )}
      {modal === 'deactivate' && (
        <Modal title="Deactivate mandir (block all staff logins)" onClose={() => setModal(null)}>
          <DeactivateForm tenantId={tenant.id} onDone={() => { setModal(null); onChanged('Mandir deactivated — staff can no longer sign in'); }} />
        </Modal>
      )}
      {modal === 'modules' && (
        <Modal title="Modules for this mandir" onClose={() => setModal(null)}>
          <ModulesForm tenantId={tenant.id} onDone={(msg) => { setModal(null); onChanged(msg); }} />
        </Modal>
      )}
      {modal === 'custom-plan' && (
        <Modal title="Custom plan for this mandir" onClose={() => setModal(null)}>
          <CustomPlanForm tenant={tenant} onDone={(msg) => { setModal(null); onChanged(msg); }} />
        </Modal>
      )}
      {modal === 'plan' && (
        <Modal title="Change plan" onClose={() => setModal(null)}>
          <PlanForm tenantId={tenant.id} current={tenant.plan} onDone={() => { setModal(null); onChanged('Plan updated'); }} />
        </Modal>
      )}
      {modal === 'tier' && (
        <Modal title="Change tenancy tier (managed migration)" onClose={() => setModal(null)}>
          <TierForm tenantId={tenant.id} current={tenant.tenancy_tier} onDone={() => { setModal(null); onChanged('Tier migration scheduled'); }} />
        </Modal>
      )}
      {modal === 'cancel' && (
        <Modal title="Delete mandir (soft delete — reversible)" onClose={() => setModal(null)}>
          <CancelForm tenant={tenant} onDone={() => { setModal(null); navigate('/mandirs'); }} />
        </Modal>
      )}
    </div>
  );
}

function SuspendForm({ tenantId, onDone }: { tenantId: string; onDone: () => void }) {
  const [reason, setReason] = useState('non_payment');
  return (
    <ActionForm submitLabel="Suspend" onDone={onDone}
      onSubmit={async () => { await api(`/admin/tenants/${tenantId}/suspend`, { method: 'PATCH', body: { reason } }); }}>
      <label className="field"><span>Reason</span>
        <select value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="non_payment">non payment</option>
          <option value="abuse">abuse</option>
          <option value="requested">requested by temple</option>
        </select>
      </label>
    </ActionForm>
  );
}

/** Master on/off switch. Blocks every staff login until re-activated. */
function DeactivateForm({ tenantId, onDone }: { tenantId: string; onDone: () => void }) {
  const [reason, setReason] = useState('deactivated');
  const [message, setMessage] = useState('');
  return (
    <ActionForm submitLabel="Deactivate" onDone={onDone}
      onSubmit={async () => {
        await api(`/admin/tenants/${tenantId}/activation`, {
          method: 'PATCH',
          body: { is_active: false, reason, block_message: message || undefined },
        });
      }}>
      <p className="muted">
        Staff of this mandir will not be able to sign in. They see the message below —
        leave it blank to use the platform default, which tells them to contact their
        temple admin or <code>contact@jainerp.org</code>.
      </p>
      <label className="field"><span>Reason</span>
        <select name="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="deactivated">deactivated</option>
          <option value="non_payment">non payment</option>
          <option value="abuse">abuse</option>
          <option value="requested">requested by temple</option>
          <option value="other">other</option>
        </select>
      </label>
      <label className="field"><span>Message shown to staff (optional)</span>
        <input name="block_message" value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder="Renewal pending — please contact contact@jainerp.org" />
      </label>
    </ActionForm>
  );
}

/**
 * Per-tenant plan override: bespoke price/limits on top of the assigned plan
 * without creating a one-off row in the plans master. Blank = inherit.
 */
function CustomPlanForm({ tenant, onDone }: { tenant: TenantDetail; onDone: (msg: string) => void }) {
  const eff = tenant.effective_plan;
  const cp = tenant.custom_plan ?? {};
  const [form, setForm] = useState({
    label: tenant.custom_plan_label ?? '',
    price_monthly: cp.price_monthly_paise != null ? String(cp.price_monthly_paise / 100) : '',
    price_yearly: cp.price_yearly_paise != null ? String(cp.price_yearly_paise / 100) : '',
    max_users: cp.max_users != null ? String(cp.max_users) : '',
    max_devices: cp.max_devices != null ? String(cp.max_devices) : '',
    max_receipts_per_month: cp.max_receipts_per_month != null ? String(cp.max_receipts_per_month) : '',
    max_sms_per_month: cp.max_sms_per_month != null ? String(cp.max_sms_per_month) : '',
    max_storage_mb: cp.max_storage_mb != null ? String(cp.max_storage_mb) : '',
    note: tenant.custom_plan_note ?? '',
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });
  /** Blank fields are omitted so they keep inheriting from the assigned plan. */
  const num = (v: string, mult = 1) => (v.trim() === '' ? undefined : Math.round(Number(v) * mult));
  const [error, setError] = useState<unknown>(null);

  return (
    <div>
      <ErrorBox error={error} />
      <p className="muted">
        On top of plan <b>{tenant.plan}</b>. Leave a field blank to keep the plan's own value.
        {eff?.is_custom && ` Currently overriding: ${eff.overridden_fields.join(', ')}.`}
      </p>
      <ActionForm submitLabel="Save custom plan" onDone={() => onDone('Custom plan saved')}
        onSubmit={async () => {
          await api(`/admin/tenants/${tenant.id}/custom-plan`, {
            method: 'PUT',
            body: {
              label: form.label || undefined,
              price_monthly_paise: num(form.price_monthly, 100),
              price_yearly_paise: num(form.price_yearly, 100),
              max_users: num(form.max_users),
              max_devices: num(form.max_devices),
              max_receipts_per_month: num(form.max_receipts_per_month),
              max_sms_per_month: num(form.max_sms_per_month),
              max_storage_mb: num(form.max_storage_mb),
              note: form.note || undefined,
            },
          });
        }}>
        <label className="field"><span>Label (shown instead of the plan name)</span>
          <input name="custom_label" value={form.label} onChange={set('label')} placeholder="e.g. Trust Special" />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field"><span>Price / month (₹)</span>
            <input name="cp_price_monthly" type="number" value={form.price_monthly} onChange={set('price_monthly')}
              placeholder={eff ? String(eff.price_monthly_paise / 100) : ''} />
          </label>
          <label className="field"><span>Price / year (₹)</span>
            <input name="cp_price_yearly" type="number" value={form.price_yearly} onChange={set('price_yearly')}
              placeholder={eff ? String(eff.price_yearly_paise / 100) : ''} />
          </label>
          <label className="field"><span>Max users</span>
            <input name="cp_max_users" type="number" value={form.max_users} onChange={set('max_users')} placeholder={String(eff?.max_users ?? '')} />
          </label>
          <label className="field"><span>Max devices</span>
            <input type="number" value={form.max_devices} onChange={set('max_devices')} placeholder={String(eff?.max_devices ?? '')} />
          </label>
          <label className="field"><span>Receipts / month</span>
            <input type="number" value={form.max_receipts_per_month} onChange={set('max_receipts_per_month')} placeholder={String(eff?.max_receipts_per_month ?? '')} />
          </label>
          <label className="field"><span>SMS / month</span>
            <input type="number" value={form.max_sms_per_month} onChange={set('max_sms_per_month')} placeholder={String(eff?.max_sms_per_month ?? '')} />
          </label>
          <label className="field"><span>Storage (MB)</span>
            <input type="number" value={form.max_storage_mb} onChange={set('max_storage_mb')} placeholder={String(eff?.max_storage_mb ?? '')} />
          </label>
        </div>
        <label className="field"><span>Note (why this deal)</span>
          <input value={form.note} onChange={set('note')} placeholder="Approved by trustee meeting 12-Jul" />
        </label>
      </ActionForm>
      {tenant.custom_plan && (
        <button
          className="btn danger sm"
          style={{ marginTop: 10 }}
          data-testid="clear-custom-plan"
          onClick={async () => {
            setError(null);
            try {
              await api(`/admin/tenants/${tenant.id}/custom-plan`, { method: 'DELETE' });
              onDone('Custom plan removed — back to the standard plan');
            } catch (e) { setError(e); }
          }}
        >
          Remove custom plan
        </button>
      )}
    </div>
  );
}

function PlanForm({ tenantId, current, onDone }: { tenantId: string; current: string; onDone: () => void }) {
  const [plan, setPlan] = useState(current);
  const [effective, setEffective] = useState('next_cycle');
  return (
    <ActionForm submitLabel="Change plan" onDone={onDone}
      onSubmit={async () => { await api(`/admin/tenants/${tenantId}/plan`, { method: 'PATCH', body: { plan, effective } }); }}>
      <label className="field"><span>Plan</span>
        <select value={plan} onChange={(e) => setPlan(e.target.value)}>{PLANS.map((p) => <option key={p}>{p}</option>)}</select>
      </label>
      <label className="field"><span>Effective</span>
        <select value={effective} onChange={(e) => setEffective(e.target.value)}>
          <option value="next_cycle">next cycle</option>
          <option value="immediate">immediate</option>
        </select>
      </label>
    </ActionForm>
  );
}

function TierForm({ tenantId, current, onDone }: { tenantId: string; current: string; onDone: () => void }) {
  const [tier, setTier] = useState(current);
  return (
    <ActionForm submitLabel="Schedule migration" onDone={onDone}
      onSubmit={async () => { await api(`/admin/tenants/${tenantId}/tenancy-tier`, { method: 'PATCH', body: { tier } }); }}>
      <p className="muted">Big mandirs get a dedicated database; small mandirs share the pooled cluster (isolated schema, keyed by tenant).</p>
      <label className="field"><span>Tier</span>
        <select value={tier} onChange={(e) => setTier(e.target.value)}>
          {TIERS.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
      </label>
    </ActionForm>
  );
}

/**
 * Soft delete: nothing is destroyed. The mandir's schema, donations and receipts
 * are all retained — it simply drops out of every listing, all staff logins are
 * blocked, and devotees stop seeing it. Reversible from the Restore button.
 */
function CancelForm({ tenant, onDone }: { tenant: TenantDetail; onDone: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  return (
    <ActionForm submitLabel="Delete mandir" onDone={onDone}
      onSubmit={async () => {
        await api(`/admin/tenants/${tenant.id}`, {
          method: 'DELETE',
          body: { confirm_slug: confirm, reason: reason || undefined },
        });
      }}>
      <p>
        This is a <b>soft delete</b> — all data is kept and it can be restored later.
        Staff will not be able to sign in and devotees will no longer see this mandir.
      </p>
      <p>Type the slug <code className="mono">{tenant.slug}</code> to confirm.</p>
      <label className="field"><span>Slug</span><input name="confirm_slug" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
      <label className="field"><span>Reason (optional)</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    </ActionForm>
  );
}

// ---------------- Billing ----------------
function BillingTab({ tenant, onChanged }: { tenant: TenantDetail; onChanged: (msg: string) => void }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [mandateLink, setMandateLink] = useState<string | null>(null);
  /** Invoice being re-priced — only ever an unpaid one. */
  const [repricing, setRepricing] = useState<Invoice | null>(null);

  const load = useCallback(() => {
    api<Invoice[]>(`/admin/tenants/${tenant.id}/invoices`).then((r) => setInvoices(r.data)).catch(setError);
  }, [tenant.id]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try { await fn(); } catch (e) { setError(e); }
  }

  return (
    <div>
      <ErrorBox error={error} />
      <div className="card">
        <h2>Subscription</h2>
        {tenant.subscription ? (
          <dl className="kv">
            <dt>Status</dt><dd><Badge value={tenant.subscription.status} /></dd>
            <dt>Cycle</dt><dd>{tenant.subscription.billing_cycle}</dd>
            <dt>Current period</dt>
            <dd>{formatDate(tenant.subscription.current_period_start)} → {formatDate(tenant.subscription.current_period_end)}</dd>
            <dt>Auto-debit</dt><dd data-testid="auto-debit">{tenant.subscription.auto_debit}</dd>
            <dt>Pending dues</dt><dd>{formatPaise(tenant.pending_amount_paise)}</dd>
          </dl>
        ) : (
          <p className="muted">No subscription.</p>
        )}
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button
            className="btn"
            onClick={() => run(async () => {
              const { data } = await api<{ authorization_link: string }>(`/admin/tenants/${tenant.id}/auto-debit`, {
                method: 'POST',
                body: { method: 'upi_autopay', max_amount_paise: 250000 },
              });
              setMandateLink(data.authorization_link);
              onChanged('Auto-debit mandate created — share the authorization link with the temple');
            })}
          >
            Set up auto-debit (UPI AutoPay)
          </button>
          <button
            className="btn"
            onClick={() => run(async () => {
              await api(`/admin/tenants/${tenant.id}/auto-debit`, { method: 'DELETE' });
              onChanged('Auto-debit mandate revoked');
            })}
          >
            Revoke auto-debit
          </button>
        </div>
        {mandateLink && (
          <p data-testid="mandate-link">Authorization link: <a href={mandateLink} target="_blank" rel="noreferrer" className="mono">{mandateLink}</a></p>
        )}
      </div>

      <div className="card">
        <h2>Invoices</h2>
        {linkUrl && (
          <div className="success-box" data-testid="payment-link">
            Payment link: <a href={linkUrl} target="_blank" rel="noreferrer">{linkUrl}</a>
          </div>
        )}
        <table className="data">
          <thead>
            <tr>
              <th>Invoice #</th><th>Period</th><th>Subtotal</th><th>Discount</th><th>GST</th><th>Total</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td className="mono">{inv.invoiceNumber}</td>
                <td>{formatDate(inv.periodStart)} → {formatDate(inv.periodEnd)}</td>
                <td>{formatPaise(inv.subtotalPaise)}</td>
                <td>{inv.discountPaise ? `− ${formatPaise(inv.discountPaise)}` : <span className="muted">—</span>}</td>
                <td>{formatPaise(inv.gstAmountPaise)}</td>
                <td>{formatPaise(inv.totalPaise)}</td>
                <td>
                  <Badge value={inv.status} />
                  {inv.receiptNumber && (
                    <div className="muted mono" style={{ fontSize: 11 }}>{inv.receiptNumber}</div>
                  )}
                </td>
                <td>
                  {inv.status === 'unpaid' && (
                    <>
                      {/* Change the amount agreed with this mandir while it is
                          still unpaid. Refused once paid — a paid tax invoice is
                          corrected by void + reissue, not by an UPDATE. */}
                      <button className="btn sm" data-testid={`reprice-${inv.invoiceNumber}`} onClick={() => setRepricing(inv)}>
                        Re-price
                      </button>{' '}
                      <button className="btn sm" onClick={() => run(async () => {
                        const { data } = await api<{ short_url: string }>(`/admin/tenants/${tenant.id}/payment-link`, {
                          method: 'POST',
                          body: { invoice_id: inv.id, channel: ['sms', 'whatsapp'] },
                        });
                        setLinkUrl(data.short_url);
                      })}>
                        Payment link
                      </button>{' '}
                      <button className="btn sm" onClick={() => run(async () => {
                        await api(`/admin/invoices/${inv.id}/mark-paid`, { method: 'POST', body: { note: 'manual (NEFT)' } });
                        load();
                        onChanged('Invoice marked paid');
                      })}>
                        Mark paid
                      </button>{' '}
                      <button className="btn sm danger" onClick={() => run(async () => {
                        await api(`/admin/invoices/${inv.id}/void`, { method: 'POST', body: { reason: 'voided from console' } });
                        load();
                        onChanged('Invoice voided');
                      })}>
                        Void
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {invoices.length === 0 && <tr><td colSpan={8} className="muted">No invoices.</td></tr>}
          </tbody>
        </table>
        {/* A link already created for an invoice is kept on the row, so support
            can resend the exact link that was sent rather than minting a new
            one each time and leaving two live links for one invoice. */}
        {invoices.some((i) => i.paymentLinkUrl) && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Existing payment links:{' '}
            {invoices.filter((i) => i.paymentLinkUrl).map((i) => (
              <span key={i.id} style={{ marginRight: 12 }}>
                {i.invoiceNumber}: <a href={i.paymentLinkUrl!} target="_blank" rel="noreferrer">{i.paymentLinkUrl}</a>
              </span>
            ))}
          </div>
        )}
      </div>

      {repricing && (
        <Modal title={`Re-price ${repricing.invoiceNumber}`} onClose={() => setRepricing(null)}>
          <RepriceInvoiceForm
            invoice={repricing}
            onDone={() => { setRepricing(null); setLinkUrl(null); load(); onChanged('Invoice re-priced'); }}
          />
        </Modal>
      )}
    </div>
  );
}

/**
 * Re-price an unpaid invoice: the "we agreed a different amount with this
 * mandir and they have not paid yet" case. Amounts are entered in rupees and
 * converted here — the API only accepts paise.
 */
function RepriceInvoiceForm({ invoice, onDone }: { invoice: Invoice; onDone: () => void }) {
  const [f, setF] = useState({
    subtotal: String(invoice.subtotalPaise / 100),
    discount: String((invoice.discountPaise ?? 0) / 100),
    charges: String((invoice.additionalChargesPaise ?? 0) / 100),
    discount_note: invoice.discountNote ?? '',
    note: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <ActionForm
      submitLabel="Save price"
      onDone={onDone}
      onSubmit={async () => {
        await api(`/admin/invoices/${invoice.id}`, {
          method: 'PATCH',
          body: {
            subtotal_paise: Math.round(Number(f.subtotal || 0) * 100),
            discount_paise: Math.round(Number(f.discount || 0) * 100),
            additional_charges_paise: Math.round(Number(f.charges || 0) * 100),
            discount_note: f.discount_note || undefined,
            note: f.note || undefined,
          },
        });
      }}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        GST is recalculated on the net (subtotal − discount + charges). Any payment link already sent quotes the
        old figure, so it is cleared — create a new one afterwards.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>Subtotal (₹)</span><input type="number" value={f.subtotal} onChange={set('subtotal')} /></label>
        <label className="field"><span>Discount (₹)</span><input type="number" value={f.discount} onChange={set('discount')} /></label>
        <label className="field"><span>Additional charges (₹)</span><input type="number" value={f.charges} onChange={set('charges')} /></label>
        <label className="field"><span>Discount label (on the invoice)</span><input value={f.discount_note} onChange={set('discount_note')} /></label>
      </div>
      <label className="field"><span>Internal note</span><input value={f.note} onChange={set('note')} /></label>
    </ActionForm>
  );
}

// ---------------- Subscription & Receipts history ----------------
/**
 * The temple's whole commercial relationship with JainERP on one screen:
 * what it pays today, every plan upgrade/downgrade, every invoice and how it
 * was settled, every receipt anyone pulled, and lifetime totals.
 */
function HistoryTab({ tenant }: { tenant: TenantDetail }) {
  const [h, setH] = useState<BillingHistory | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleEvent[]>([]);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    api<BillingHistory>(`/admin/tenants/${tenant.id}/billing-history`).then((r) => setH(r.data)).catch(setError);
    api<LifecycleEvent[]>(`/admin/tenants/${tenant.id}/lifecycle-history`).then((r) => setLifecycle(r.data)).catch(() => setLifecycle([]));
  }, [tenant.id]);
  useEffect(load, [load]);

  if (!h) return <div><ErrorBox error={error} />Loading history…</div>;
  const eff = h.effective_plan;

  return (
    <div>
      <ErrorBox error={error} />

      <div className="card">
        <h2>Summary</h2>
        <dl className="kv">
          <dt>Customer since</dt><dd>{formatDate(h.tenant.customer_since)}</dd>
          <dt>Current plan</dt>
          <dd data-testid="effective-plan">
            {eff ? eff.display_name : '—'}
            {eff?.is_custom && <span className="badge" style={{ marginLeft: 6 }}>custom</span>}
          </dd>
          <dt>Lifetime paid</dt><dd data-testid="lifetime-paid">{formatPaise(h.totals.paid_paise)} ({h.totals.paid_count} invoice{h.totals.paid_count === 1 ? '' : 's'})</dd>
          <dt>Outstanding</dt><dd>{formatPaise(h.totals.outstanding_paise)} ({h.totals.unpaid_count} unpaid)</dd>
          <dt>Written off (void)</dt><dd>{formatPaise(h.totals.voided_paise)}</dd>
          <dt>Last payment</dt><dd>{h.totals.last_paid_at ? formatDate(h.totals.last_paid_at) : '—'}</dd>
        </dl>
      </div>

      <div className="card">
        <h2>Subscriptions</h2>
        <table className="data">
          <thead><tr><th>Plan</th><th>Cycle</th><th>Status</th><th>Current period</th><th>Pending change</th><th>Started</th></tr></thead>
          <tbody>
            {h.subscriptions.map((s) => (
              <tr key={s.id}>
                <td>{s.plan_display ?? s.plan}</td>
                <td>{s.billing_cycle}</td>
                <td><Badge value={s.status} /></td>
                <td>{formatDate(s.current_period_start)} → {formatDate(s.current_period_end)}</td>
                <td>{s.pending_plan ? `${s.pending_plan} (${s.pending_billing_cycle ?? s.billing_cycle}) from ${formatDate(s.pending_effective_at)}` : '—'}</td>
                <td>{formatDate(s.created_at)}</td>
              </tr>
            ))}
            {h.subscriptions.length === 0 && <tr><td colSpan={6} className="muted">No subscription yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Upgrade / downgrade history</h2>
        <table className="data" data-testid="plan-change-table">
          <thead><tr><th>When</th><th>What changed</th><th>From → To</th><th>Effective</th><th>Credit</th><th>Invoice</th><th>By</th></tr></thead>
          <tbody>
            {h.plan_changes.map((c) => (
              <tr key={c.id}>
                <td>{formatDate(c.created_at)}</td>
                <td>{c.change_type.replace(/_/g, ' ')}</td>
                <td className="mono">{c.from_value} → {c.to_value}</td>
                <td>{c.effective === 'immediate' ? 'immediate' : `next cycle (${formatDate(c.effective_at)})`}</td>
                <td>{c.proration_credit_paise ? formatPaise(c.proration_credit_paise) : '—'}</td>
                <td className="mono">{c.invoice_number ?? '—'}</td>
                <td>{c.changed_by_name ?? c.changed_by_email ?? '—'}</td>
              </tr>
            ))}
            {h.plan_changes.length === 0 && <tr><td colSpan={7} className="muted">No plan changes recorded.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Purchase history &amp; receipts</h2>
        <table className="data" data-testid="purchase-table">
          <thead>
            <tr><th>Invoice #</th><th>Plan</th><th>Period</th><th>Total</th><th>Status</th><th>Paid via</th><th>Reference</th><th>Receipt</th></tr>
          </thead>
          <tbody>
            {h.invoices.map((inv) => (
              <tr key={inv.id}>
                <td className="mono">{inv.invoice_number}</td>
                <td>{inv.plan_name ?? '—'}{inv.billing_cycle ? ` · ${inv.billing_cycle}` : ''}</td>
                <td>{formatDate(inv.period_start)} → {formatDate(inv.period_end)}</td>
                <td>{formatPaise(inv.total_paise)}</td>
                <td><Badge value={inv.status} /></td>
                <td>{inv.payment_method ? inv.payment_method.replace(/_/g, ' ') : '—'}</td>
                <td className="mono">{inv.payment_ref ?? inv.razorpay_payment_id ?? '—'}</td>
                <td>
                  <button
                    className="btn sm"
                    data-testid={`receipt-${inv.invoice_number}`}
                    onClick={async () => {
                      setError(null);
                      try {
                        await openReceipt(`/admin/invoices/${inv.id}/receipt?channel=download`);
                        load(); // refresh the download counters
                      } catch (e) { setError(e); }
                    }}
                  >
                    Open receipt
                  </button>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {inv.download_count > 0
                      ? `${inv.download_count} download${inv.download_count === 1 ? '' : 's'} · last ${formatDate(inv.last_downloaded_at)}`
                      : 'never downloaded'}
                  </div>
                </td>
              </tr>
            ))}
            {h.invoices.length === 0 && <tr><td colSpan={8} className="muted">No invoices raised yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Downloaded receipts history</h2>
        <p className="muted">Every time this mandir's receipt was opened, printed or downloaded — by the temple or by us.</p>
        <table className="data" data-testid="downloads-table">
          <thead><tr><th>When</th><th>Invoice #</th><th>Amount</th><th>By</th><th>Who</th><th>How</th><th>IP</th></tr></thead>
          <tbody>
            {h.receipt_downloads.map((d) => (
              <tr key={d.id}>
                <td>{formatDate(d.created_at)}</td>
                <td className="mono">{d.invoice_number}</td>
                <td>{formatPaise(d.total_paise)}</td>
                <td>{d.actor_type === 'super_admin' ? 'JainERP team' : d.actor_type === 'temple' ? 'Mandir' : 'System'}</td>
                <td>{d.actor_name ?? '—'}</td>
                <td>{d.channel}</td>
                <td className="mono">{d.ip ?? '—'}</td>
              </tr>
            ))}
            {h.receipt_downloads.length === 0 && <tr><td colSpan={7} className="muted">No receipt has been downloaded yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Lifecycle trail</h2>
        <p className="muted">Suspend, activate, visibility, delete and restore actions on this mandir.</p>
        <table className="data" data-testid="lifecycle-table">
          <thead><tr><th>When</th><th>Action</th><th>Detail</th><th>By</th></tr></thead>
          <tbody>
            {lifecycle.map((e) => (
              <tr key={e.id}>
                <td>{formatDate(e.created_at)}</td>
                <td className="mono">{e.action}</td>
                <td className="muted">{summarisePayload(e.payload)}</td>
                <td>{e.actor_name ?? e.actor_email ?? '—'}</td>
              </tr>
            ))}
            {lifecycle.length === 0 && <tr><td colSpan={4} className="muted">Nothing recorded.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function summarisePayload(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!entries.length) return '—';
  return entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ');
}

// ---------------- Mandir portal users ----------------
function UsersTab({ tenant, onNotice }: { tenant: TenantDetail; onNotice: (msg: string) => void }) {
  const [users, setUsers] = useState<MandirUser[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<MandirUser | null>(null);

  const load = useCallback(() => {
    api<MandirUser[]>(`/admin/tenants/${tenant.id}/users`).then((r) => setUsers(r.data)).catch(setError);
  }, [tenant.id]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, msg: string) {
    setError(null);
    try { await fn(); load(); onNotice(msg); } catch (e) { setError(e); }
  }

  return (
    <div>
      <ErrorBox error={error} />
      <div className="card">
        <div className="toolbar">
          <h2 style={{ margin: 0 }}>Mandir portal users</h2>
          <div className="grow" />
          <button className="btn primary sm" onClick={() => setShowAdd(true)}>+ Add user</button>
        </div>
        <p className="muted">Staff who sign into this mandir's admin portal. Roles control what they can do (temple_admin has full access).</p>
        <table className="data">
          <thead><tr><th>Name</th><th>Mobile</th><th>Roles</th><th>Active</th><th>Joined</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name ?? <span className="muted">—</span>}</td>
                <td className="mono">{u.mobile}</td>
                <td>{u.roles.join(', ')}</td>
                <td><Badge value={u.is_active} /></td>
                <td>{formatDate(u.joined_at)}</td>
                <td>
                  <button className="btn sm" onClick={() => setEditing(u)}>Edit</button>{' '}
                  <button className="btn sm" onClick={() => run(
                    () => api(`/admin/tenants/${tenant.id}/users/${u.id}`, { method: 'PATCH', body: { is_active: !u.is_active } }),
                    u.is_active ? 'User deactivated' : 'User activated',
                  )}>{u.is_active ? 'Deactivate' : 'Activate'}</button>{' '}
                  <button className="btn sm danger" onClick={() => {
                    if (confirm(`Remove ${u.name ?? u.mobile} from this mandir? They lose portal access.`)) {
                      run(() => api(`/admin/tenants/${tenant.id}/users/${u.id}`, { method: 'DELETE' }), 'User removed');
                    }
                  }}>Remove</button>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={6} className="muted">No portal users yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <Modal title="Add mandir user" onClose={() => setShowAdd(false)}>
          <MandirUserForm tenantId={tenant.id} onDone={() => { setShowAdd(false); load(); onNotice('Mandir user added'); }} />
        </Modal>
      )}
      {editing && (
        <Modal title={`Edit ${editing.name ?? editing.mobile}`} onClose={() => setEditing(null)}>
          <MandirUserForm tenantId={tenant.id} user={editing} onDone={() => { setEditing(null); load(); onNotice('Mandir user updated'); }} />
        </Modal>
      )}
    </div>
  );
}

function MandirUserForm({ tenantId, user, onDone }: { tenantId: string; user?: MandirUser; onDone: () => void }) {
  const [form, setForm] = useState({
    mobile: user?.mobile ?? '',
    name: user?.name ?? '',
    email: user?.email ?? '',
    roles: user?.roles ?? ['cashier'],
  });
  function toggleRole(r: string) {
    setForm((f) => ({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] }));
  }
  return (
    <ActionForm submitLabel={user ? 'Save' : 'Add user'} onDone={onDone}
      onSubmit={async () => {
        if (user) {
          await api(`/admin/tenants/${tenantId}/users/${user.id}`, {
            method: 'PATCH',
            body: { roles: form.roles, name: form.name || undefined, email: form.email || undefined },
          });
        } else {
          await api(`/admin/tenants/${tenantId}/users`, {
            method: 'POST',
            body: { mobile: form.mobile, name: form.name || undefined, email: form.email || undefined, roles: form.roles },
          });
        }
      }}>
      {!user && (
        <label className="field"><span>Mobile *</span>
          <PhoneInput name="mandir_user_mobile" value={form.mobile} onChange={(v) => setForm({ ...form, mobile: v })} required />
        </label>
      )}
      <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label className="field"><span>Email</span><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
      <div className="field">
        <span>Roles</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
          {MANDIR_ROLES.map((r) => (
            <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 'normal' }}>
              <input type="checkbox" checked={form.roles.includes(r)} onChange={() => toggleRole(r)} /> {r}
            </label>
          ))}
        </div>
      </div>
    </ActionForm>
  );
}

// ---------------- Trustees & Requirements ----------------
function PeopleTab({ tenant, onChanged }: { tenant: TenantDetail; onChanged: (msg: string) => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(fn: () => Promise<unknown>, msg: string) {
    setError(null);
    try { await fn(); onChanged(msg); } catch (e) { setError(e); }
  }

  return (
    <div>
      <ErrorBox error={error} />
      <div className="card">
        <div className="toolbar">
          <h2 style={{ margin: 0 }}>Trustees</h2>
          <div className="grow" />
          <button className="btn primary sm" onClick={() => setShowAdd(true)}>+ Add trustee</button>
        </div>
        <table className="data">
          <thead><tr><th>Name</th><th>Designation</th><th>Mobile</th><th>Since</th><th></th></tr></thead>
          <tbody>
            {tenant.profile.trustees.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.designation ?? '—'}</td>
                <td>{t.mobile ?? '—'}</td>
                <td>{t.sinceYear ?? '—'}</td>
                <td>
                  <button className="btn sm danger" onClick={() => run(
                    () => api(`/admin/tenants/${tenant.id}/trustees/${t.id}`, { method: 'DELETE' }),
                    'Trustee removed',
                  )}>Remove</button>
                </td>
              </tr>
            ))}
            {tenant.profile.trustees.length === 0 && <tr><td colSpan={5} className="muted">No trustees recorded.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Requirements raised by the mandir</h2>
        <table className="data">
          <thead><tr><th>Requirement</th><th>Status</th><th>Raised</th><th></th></tr></thead>
          <tbody>
            {tenant.profile.requirements.map((r) => (
              <tr key={r.id}>
                <td>{r.text}</td>
                <td><Badge value={r.status} /></td>
                <td>{formatDate(r.createdAt)}</td>
                <td>
                  {r.status !== 'done' && (
                    <button className="btn sm" onClick={() => run(
                      () => api(`/admin/tenants/${tenant.id}/requirements/${r.id}`, { method: 'PATCH', body: { status: 'done' } }),
                      'Requirement marked done',
                    )}>Mark done</button>
                  )}
                </td>
              </tr>
            ))}
            {tenant.profile.requirements.length === 0 && <tr><td colSpan={4} className="muted">No open requirements.</td></tr>}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <Modal title="Add trustee" onClose={() => setShowAdd(false)}>
          <TrusteeForm tenantId={tenant.id} onDone={() => { setShowAdd(false); onChanged('Trustee added'); }} />
        </Modal>
      )}
    </div>
  );
}

function TrusteeForm({ tenantId, onDone }: { tenantId: string; onDone: () => void }) {
  const [form, setForm] = useState({ name: '', designation: '', mobile: '' });
  return (
    <ActionForm submitLabel="Add" onDone={onDone}
      onSubmit={async () => {
        await api(`/admin/tenants/${tenantId}/trustees`, {
          method: 'POST',
          body: { name: form.name, designation: form.designation || undefined, mobile: form.mobile || undefined },
        });
      }}>
      <label className="field"><span>Name</span><input name="trustee_name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
      <label className="field"><span>Designation</span><input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></label>
      <label className="field"><span>Mobile</span><input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></label>
    </ActionForm>
  );
}

// ---------------- Licenses ----------------
function LicensesTab({ tenant, onChanged }: { tenant: TenantDetail; onChanged: (msg: string) => void }) {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [showIssue, setShowIssue] = useState(false);

  const load = useCallback(() => {
    api<License[]>(`/admin/tenants/${tenant.id}/licenses`).then((r) => setLicenses(r.data)).catch(setError);
  }, [tenant.id]);
  useEffect(load, [load]);

  return (
    <div>
      <ErrorBox error={error} />
      <div className="card">
        <div className="toolbar">
          <h2 style={{ margin: 0 }}>Offline desktop licenses</h2>
          <div className="grow" />
          <button className="btn primary sm" onClick={() => setShowIssue(true)}>+ Issue license</button>
        </div>
        <table className="data">
          <thead><tr><th>Key</th><th>Edition</th><th>Devices</th><th>Valid until</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {licenses.map((l) => (
              <tr key={l.id}>
                <td className="mono">{l.keyString}</td>
                <td>{l.edition}</td>
                <td>{l.deviceLimit}</td>
                <td>{formatDate(l.validUntil)}</td>
                <td><Badge value={l.status} /></td>
                <td>
                  {l.status === 'active' && (
                    <button className="btn sm danger" onClick={async () => {
                      try {
                        await api(`/admin/licenses/${l.keyString}/revoke`, { method: 'PATCH', body: { reason: 'revoked from console' } });
                        load();
                        onChanged('License revoked');
                      } catch (e) { setError(e); }
                    }}>Revoke</button>
                  )}
                </td>
              </tr>
            ))}
            {licenses.length === 0 && <tr><td colSpan={6} className="muted">No licenses issued.</td></tr>}
          </tbody>
        </table>
      </div>

      {showIssue && (
        <Modal title="Issue offline license" onClose={() => setShowIssue(false)}>
          <IssueLicenseForm tenantId={tenant.id} onDone={() => { setShowIssue(false); load(); onChanged('License issued'); }} />
        </Modal>
      )}
    </div>
  );
}

function IssueLicenseForm({ tenantId, onDone }: { tenantId: string; onDone: () => void }) {
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const [seats, setSeats] = useState(1);
  const [expires, setExpires] = useState(nextYear.toISOString().slice(0, 10));
  return (
    <ActionForm submitLabel="Issue" onDone={onDone}
      onSubmit={async () => {
        await api(`/admin/tenants/${tenantId}/licenses`, { method: 'POST', body: { seats, expires_at: expires } });
      }}>
      <label className="field"><span>Device seats</span><input type="number" min={1} value={seats} onChange={(e) => setSeats(Number(e.target.value))} /></label>
      <label className="field"><span>Expires</span><input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
    </ActionForm>
  );
}

/**
 * Grant or revoke this mandir's optional modules — the upsell path.
 *
 * Sends the whole list rather than a diff: "these are the modules this trust
 * has" is unambiguous, where add/remove invites two consoles racing to a state
 * neither operator intended. Core modules are never sent; the server refuses
 * them with 400 CORE_MODULE.
 */
function ModulesForm({ tenantId, onDone }: { tenantId: string; onDone: (msg: string) => void }) {
  const [current, setCurrent] = useState<string[] | null>(null);
  const [templeType, setTempleType] = useState<string | undefined>(undefined);
  const [planModules, setPlanModules] = useState<string[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    api<{ tenant_modules: string[]; plan_modules: string[]; temple_type: string }>(
      `/admin/tenants/${tenantId}/modules`,
    )
      .then((r) => {
        setCurrent(r.data.tenant_modules ?? []);
        setPlanModules(r.data.plan_modules ?? []);
        setTempleType(r.data.temple_type);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load modules'));
  }, [tenantId]);

  if (err) return <ErrorBox error={err} />;
  if (!current) return <p className="muted">Loading…</p>;

  return (
    <ActionForm
      submitLabel="Save modules"
      onDone={() => onDone('Modules updated')}
      onSubmit={async () => {
        await api(`/admin/tenants/${tenantId}/modules`, { method: 'PUT', body: { modules: current } });
      }}
    >
      {planModules.length > 0 && (
        <p className="muted" style={{ fontSize: 12 }}>
          The plan already includes {planModules.join(', ')} for every mandir on it.
          Those stay on regardless of what is ticked here — change the plan to alter them.
        </p>
      )}
      <ModulePicker value={current} onChange={setCurrent} templeType={templeType} />
      <p className="muted" style={{ fontSize: 12 }}>
        Takes effect at the mandir within about 30 seconds — each API caches the
        tenant briefly, and there is no cross-process invalidation to shortcut it.
      </p>
    </ActionForm>
  );
}
