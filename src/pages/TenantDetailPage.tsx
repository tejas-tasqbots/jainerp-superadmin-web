import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { useCan } from '../auth/permissions';
import { SubscriptionTerms } from '../components/SubscriptionTerms';
import { InvoicesCard } from '../components/InvoicesCard';
import { DeploymentPill } from './TenantsPage';
import { api, formatDate, formatPaise, openReceipt } from '../api/client';
import { PhoneInput } from '../components/PhoneInput';
import type { BillingHistory, Invoice, License, LifecycleEvent, TenantDetail } from '../api/types';
import { ActionForm, Badge, ErrorBox, Modal } from '../components/ui';
import { ModulePicker } from '../components/ModulePicker';
import { AccountingBasisCard } from './AccountingBasisCard';

const PLANS = ['starter', 'standard', 'premium', 'enterprise'];
const TIERS = ['pooled', 'dedicated'];
type Tab = 'overview' | 'billing' | 'history' | 'users' | 'devices' | 'people' | 'licenses';

const MANDIR_ROLES = ['temple_admin', 'cashier', 'accountant', 'priest', 'volunteer', 'viewer', 'bhojanshala_cashier'];
interface MandirUser {
  id: string; user_id: string; roles: string[]; is_active: boolean; joined_at: string;
  name: string | null; mobile: string; email: string | null;
  /** Gets the midnight WhatsApp summary; null for anyone who is not a temple admin. */
  daily_summary?: boolean | null;
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

  // The online desktop app signs in with the trust's mobile OTP, so a desktop
  // licence key is no longer issued to an online mandir, and JainERP Offline's
  // licence lives on its Offline Mandir page. The tab stays only while this
  // trust still holds an ACTIVE older key, so it can be revoked; otherwise an
  // online mandir showed a "Licenses" tab that had nothing to do with it.
  const [activeKeys, setActiveKeys] = useState(0);
  const loadKeys = useCallback(() => {
    api<License[]>(`/admin/tenants/${id}/licenses`)
      .then((r) => setActiveKeys(r.data.filter((l) => l.status === 'active').length))
      .catch(() => setActiveKeys(0));
  }, [id]);
  useEffect(loadKeys, [loadKeys]);
  const tabs: Tab[] = ['overview', 'billing', 'history', 'users', 'devices', 'people', ...(activeKeys > 0 ? ['licenses' as Tab] : [])];

  if (!tenant) return <div><ErrorBox error={error} /><p className="muted">Loading…</p></div>;

  return (
    <div>
      <PageHeader
        crumbs={[{ to: '/mandirs', label: 'Manage Mandir' }]}
        title={tenant.name}
        badges={<>
          <Badge value={tenant.is_deleted ? 'deleted' : tenant.status} />
          <DeploymentPill value={tenant.offline_mandir ? 'both' : 'online'} />
          {tenant.is_demo && <span className="badge demo">demo</span>}
        </>}
        subtitle={<span className="mono">{tenant.slug} · plan {tenant.plan} · {tenant.tenancy_tier === 'dedicated' ? 'dedicated database' : 'shared database'}</span>}
        actions={tenant.offline_mandir
          ? <Link className="btn" to={`/offline-mandirs/${tenant.offline_mandir.id}`}>Offline licence {tenant.offline_mandir.reference} →</Link>
          : undefined}
      />
      <ErrorBox error={error} />
      {notice && <div className="success-box" data-testid="notice">{notice}</div>}

      <div className="tabs">
        {tabs.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'people' ? 'Trustees & Requirements' : t === 'users' ? 'Mandir Users' : t === 'devices' ? 'Devices & Sessions' : t === 'history' ? 'Subscription & Receipts' : t === 'licenses' ? 'Desktop licence keys' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab tenant={tenant} onChanged={(msg) => { setNotice(msg); load(); }} />}
      {tab === 'billing' && <BillingTab tenant={tenant} onChanged={(msg) => { setNotice(msg); load(); }} />}
      {tab === 'history' && <HistoryTab tenant={tenant} />}
      {tab === 'users' && <UsersTab tenant={tenant} onNotice={setNotice} />}
      {tab === 'devices' && <SessionsTab tenant={tenant} onNotice={setNotice} />}
      {tab === 'people' && <PeopleTab tenant={tenant} onChanged={(msg) => { setNotice(msg); load(); }} />}
      {tab === 'licenses' && activeKeys > 0 && <LicensesTab tenant={tenant} onChanged={(msg) => { setNotice(msg); loadKeys(); }} />}
    </div>
  );
}

// ---------------- Overview ----------------
function OverviewTab({ tenant, onChanged }: { tenant: TenantDetail; onChanged: (msg: string) => void }) {
  const [modal, setModal] = useState<
    'plan' | 'tier' | 'suspend' | 'deactivate' | 'custom-plan' | 'modules' | null
  >(null);
  const [error, setError] = useState<unknown>(null);
  // Buttons follow the role (auth/permissions.tsx); the server enforces the same.
  const canManage = useCan('mandirs.manage');
  const canBill = useCan('billing.manage');
  const canReview = useCan('reviews.manage');
  const canPlatform = useCan('platform.manage');
  const canOnboard = useCan('mandirs.onboard');

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
          <dt>Counted as</dt>
          <dd data-testid="demo-state">
            {tenant.is_demo
              ? <span className="badge demo">demo / test — not in revenue or counts</span>
              : <span className="badge green">customer</span>}
          </dd>
          <dt>JainERP Offline</dt>
          <dd>
            {tenant.offline_mandir
              ? <Link to={`/offline-mandirs/${tenant.offline_mandir.id}`}>{tenant.offline_mandir.reference} — licence & payments</Link>
              : <span className="muted">not used</span>}
          </dd>
          {!tenant.access_enabled && (
            <>
              <dt>Staff will see</dt>
              <dd data-testid="block-message">{tenant.effective_block_message}</dd>
            </>
          )}
        </dl>
        {(canManage || canBill || canOnboard) && <div className="toolbar" style={{ marginTop: 12 }}>
          {canManage && <>
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
          </>}
          {canBill && <button
            className="btn"
            data-testid="toggle-demo"
            title="A demo / test mandir is left out of MRR, ARR, dues and counts. Nothing changes for the mandir itself."
            onClick={() => {
              if (!tenant.is_demo && !window.confirm(`Mark "${tenant.name}" as a demo / test mandir? It will be left out of MRR, ARR, dues and counts on the dashboard.`)) return;
              void action(
                () => api(`/admin/tenants/${tenant.id}/demo`, { method: 'PATCH', body: { is_demo: !tenant.is_demo } }),
                tenant.is_demo ? 'Counted as a customer again' : 'Marked as demo — left out of revenue and counts',
              );
            }}
          >
            {tenant.is_demo ? 'Count as a customer' : 'Mark as demo / test'}
          </button>}
          {canOnboard && !tenant.offline_mandir && !tenant.is_deleted && <AddOfflineButton tenant={tenant} onError={setError} />}
          {canManage && tenant.is_deleted && (
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
        </div>}
      </div>

      <AccountingBasisCard tenantId={tenant.id} />

      {(canManage || canBill || canReview || canPlatform) && <div className="card">
        <h2>Actions</h2>
        <div className="toolbar">
          {canManage && tenant.status === 'active' && !tenant.is_deleted && (
            <button className="btn" onClick={() => setModal('suspend')}>Suspend</button>
          )}
          {canManage && tenant.status === 'suspended' && (
            <button
              className="btn"
              onClick={() => action(() => api(`/admin/tenants/${tenant.id}/reactivate`, { method: 'PATCH', body: {} }), 'Mandir reactivated')}
            >
              Reactivate
            </button>
          )}
          {canBill && <button className="btn" data-testid="custom-plan-btn" onClick={() => setModal('custom-plan')}>
            {tenant.custom_plan ? 'Edit custom plan' : 'Set custom plan'}
          </button>}
          {canManage && <button className="btn" data-testid="modules-btn" onClick={() => setModal('modules')}>
            Modules…
          </button>}
          {/* Verifying locks the mandir's bank/80G/PAN details: after this they
              can only change via a reviewed request (migration 028). */}
          {canReview && <button
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
          </button>}
          {canBill && <button className="btn" onClick={() => setModal('plan')}>Change plan</button>}
          {canPlatform && <button className="btn" onClick={() => setModal('tier')}>Change tenancy tier</button>}
          {canManage && <button
            className="btn"
            onClick={() =>
              action(
                () => api(`/admin/tenants/${tenant.id}`, { method: 'PATCH', body: { global_sync_enabled: !tenant.global_sync_enabled } }),
                `Global sync ${tenant.global_sync_enabled ? 'disabled' : 'enabled'}`,
              )
            }
          >
            {tenant.global_sync_enabled ? 'Disable' : 'Enable'} global sync
          </button>}
          {/* No "Delete mandir" here, on purpose (removed 2026-09-29). A trust
              that stops paying is Suspended; one that must not sign in is
              Deactivated — both reversible and both keep its books, invoices
              and receipts reachable. Restore (above) remains for trusts that
              were deleted before this. */}
        </div>
      </div>}

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
    </div>
  );
}

/**
 * An online mandir that also wants JainERP Offline (a counter with no
 * internet): creates its offline record LINKED to this tenant — so the
 * directory shows one mandir, "Online + Offline" — and opens it to issue the
 * licence.
 */
function AddOfflineButton({ tenant, onError }: { tenant: TenantDetail; onError: (e: unknown) => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn" data-testid="add-offline" disabled={busy} onClick={async () => {
      if (!window.confirm(`Add JainERP Offline for "${tenant.name}"? This creates its offline record; you then issue the licence.`)) return;
      setBusy(true);
      try {
        const c = tenant.profile.contact as Record<string, string | null | undefined>;
        const a = tenant.profile.address as Record<string, string | null | undefined>;
        const mobile = c.mobile ? (c.mobile.startsWith('+') ? c.mobile : `+91${c.mobile.replace(/\D/g, '').slice(-10)}`) : undefined;
        const r = await api<{ id: string }>('/admin/offline-mandirs', {
          method: 'POST',
          body: Object.fromEntries(Object.entries({
            name: tenant.name, tenant_id: tenant.id, contact_name: c.name, mobile, email: c.email,
            address: [a.line1, a.line2].filter(Boolean).join(', '), city: a.city, state: a.state, pincode: a.pincode,
            sect: tenant.sect ?? undefined,
          }).filter(([, v]) => v)),
        });
        navigate(`/offline-mandirs/${r.data.id}`);
      } catch (e) { onError(e); setBusy(false); }
    }}>
      {busy ? 'Adding…' : 'Add JainERP Offline'}
    </button>
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

// ---------------- Billing ----------------
function BillingTab({ tenant, onChanged }: { tenant: TenantDetail; onChanged: (msg: string) => void }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [mandateLink, setMandateLink] = useState<string | null>(null);
  const canBill = useCan('billing.manage');

  async function run(fn: () => Promise<void>) {
    setError(null);
    try { await fn(); } catch (e) { setError(e); }
  }

  return (
    <div>
      <ErrorBox error={error} />
      <SubscriptionTerms key={`${tenant.pending_amount_paise}-${tenant.subscription?.current_period_end ?? ""}-${invoices.length}-${invoices.reduce((a, i) => a + Number(i.amountPaidPaise ?? 0), 0)}`} tenantId={tenant.id} onChanged={onChanged} />

      <div className="card">
        <h2>Auto-debit</h2>
        <p className="muted" style={{ marginTop: -6 }}>UPI AutoPay: {tenant.subscription?.auto_debit && tenant.subscription.auto_debit !== 'none' ? <b data-testid="auto-debit">{tenant.subscription.auto_debit}</b> : <span data-testid="auto-debit">none</span>} — a mandir on auto-debit renews by itself.</p>
        {canBill && <div className="toolbar" style={{ marginTop: 12 }}>
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
        </div>}
        {mandateLink && (
          <p data-testid="mandate-link">Authorization link: <a href={mandateLink} target="_blank" rel="noreferrer" className="mono">{mandateLink}</a></p>
        )}
      </div>

      <InvoicesCard
        listPath={`/admin/tenants/${tenant.id}/invoices`}
        customer={{ tenantId: tenant.id }}
        customerName={tenant.name}
        onChanged={onChanged}
        onLoaded={setInvoices}
      />
      {/* A mandir on both: its JainERP Offline licence is billed to the offline
          side (migration 104) — shown here too, so its whole account is on one tab. */}
      {tenant.offline_mandir && (
        <InvoicesCard
          title={`JainERP Offline bills — ${tenant.offline_mandir.reference}`}
          intro={<>Bills for this mandir&apos;s offline licence. Licences are issued and renewed on its{' '}
            <Link to={`/offline-mandirs/${tenant.offline_mandir.id}`}>offline page</Link>.</>}
          listPath={`/admin/offline-mandirs/${tenant.offline_mandir.id}/invoices`}
          customer={{ offlineMandirId: tenant.offline_mandir.id }}
          customerName={`${tenant.name} (offline)`}
          onChanged={onChanged}
        />
      )}
    </div>
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
          <dt>Lifetime received</dt><dd data-testid="lifetime-paid">{formatPaise(h.totals.paid_paise)} ({h.totals.paid_count} invoice{h.totals.paid_count === 1 ? '' : 's'} fully paid)</dd>
          <dt>Outstanding</dt>
          <dd>
            {formatPaise(h.totals.outstanding_paise)} ({h.totals.unpaid_count} open
            {h.totals.partially_paid_count ? `, ${h.totals.partially_paid_count} part-paid` : ''})
          </dd>
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
            <tr><th>Invoice #</th><th>Plan</th><th>Period</th><th>Total</th><th>Received</th><th>Status</th><th>Paid via</th><th>Receipts</th></tr>
          </thead>
          <tbody>
            {h.invoices.map((inv) => (
              <tr key={inv.id}>
                <td className="mono">{inv.invoice_number}</td>
                <td>{inv.plan_name ?? '—'}{inv.billing_cycle ? ` · ${inv.billing_cycle}` : ''}</td>
                <td>{formatDate(inv.period_start)} → {formatDate(inv.period_end)}</td>
                <td>{formatPaise(inv.total_paise)}</td>
                <td>
                  {inv.amount_paid_paise ? formatPaise(inv.amount_paid_paise) : '—'}
                  {Number(inv.balance_paise) > 0 && inv.status !== 'void' && Number(inv.amount_paid_paise) > 0 && (
                    <div className="muted small">{formatPaise(Number(inv.balance_paise))} due</div>
                  )}
                </td>
                <td><Badge value={inv.status} /></td>
                <td>
                  {(() => {
                    const live = (inv.payments ?? []).filter((p) => !p.voided_at);
                    if (live.length > 1) return `${live.length} payments`;
                    if (!inv.payment_method) return '—';
                    return (
                      <>
                        {inv.payment_method.replace(/_/g, ' ')}
                        <div className="muted small mono">{inv.payment_ref ?? inv.razorpay_payment_id ?? ''}</div>
                      </>
                    );
                  })()}
                </td>
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
                    Invoice
                  </button>
                  {(inv.payments ?? []).filter((p) => !p.voided_at).map((p) => (
                    <button
                      key={p.id}
                      className="btn sm"
                      style={{ marginLeft: 4 }}
                      title={`${formatPaise(p.amount_paise)} on ${formatDate(p.paid_at)}`}
                      onClick={async () => {
                        setError(null);
                        try {
                          await openReceipt(`/admin/invoices/${inv.id}/payment-receipt?payment_id=${p.id}&channel=download`);
                          load();
                        } catch (e) { setError(e); }
                      }}
                    >
                      {p.receipt_number ?? 'Receipt'}
                    </button>
                  ))}
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
  // The midnight summary's trust-wide switch — the same one as the temple's
  // Settings → Messages; null until loaded.
  const [summaryOn, setSummaryOn] = useState<boolean | null>(null);

  const load = useCallback(() => {
    api<MandirUser[]>(`/admin/tenants/${tenant.id}/users`).then((r) => setUsers(r.data)).catch(setError);
    api<{ enabled: boolean }>(`/admin/tenants/${tenant.id}/daily-summary`).then((r) => setSummaryOn(r.data.enabled)).catch(() => setSummaryOn(null));
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
        {summaryOn !== null && (
          <div className="toolbar" data-testid="daily-summary-trust" style={{ gap: 10, margin: '4px 0 10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={summaryOn} data-testid="daily-summary-trust-toggle" onChange={() => run(
                () => api(`/admin/tenants/${tenant.id}/daily-summary`, { method: 'PATCH', body: { enabled: !summaryOn } }),
                summaryOn ? 'Daily summary switched off for this mandir' : 'Daily summary switched on for this mandir',
              )} />
              <strong>Daily summary on WhatsApp at midnight</strong>
            </label>
            <span className="muted">
              {summaryOn
                ? 'On — each temple admin ticked under “Daily summary” gets the day’s money every night at 12.'
                : 'Off for the whole mandir — nobody gets it, whatever the ticks below say.'}
            </span>
          </div>
        )}
        <table className="data">
          <thead><tr><th>Name</th><th>Mobile</th><th>Roles</th><th>Active</th><th>Joined</th><th>Daily summary</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name ?? <span className="muted">—</span>}</td>
                <td className="mono">{u.mobile}</td>
                <td>{u.roles.join(', ')}</td>
                <td><Badge value={u.is_active} /></td>
                <td>{formatDate(u.joined_at)}</td>
                <td>
                  {u.daily_summary == null ? <span className="muted" title="Only temple admins get the daily summary">—</span> : (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: summaryOn === false || !u.is_active ? 0.55 : 1 }}
                      title={!u.is_active ? 'Deactivated users get nothing' : undefined}>
                      <input type="checkbox" checked={u.daily_summary} data-testid={`daily-summary-${u.id}`}
                        aria-label={`Send the daily summary to ${u.name ?? u.mobile}`}
                        onChange={() => run(
                          () => api(`/admin/tenants/${tenant.id}/users/${u.id}/daily-summary`, { method: 'PATCH', body: { receives: !u.daily_summary } }),
                          u.daily_summary ? `${u.name ?? u.mobile} will no longer get the daily summary` : `${u.name ?? u.mobile} will get the daily summary`,
                        )} />
                      {u.daily_summary ? 'On' : 'Off'}
                    </label>
                  )}
                </td>
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
            {users.length === 0 && <tr><td colSpan={7} className="muted">No portal users yet.</td></tr>}
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

// ---------------- Devices & Sessions ----------------
/**
 * Every device signed in at this trust — support's answer to "someone is in my
 * account" and to a phone that walked out with a volunteer. The temple admin
 * has the same list inside the mandir portal (/my-devices); this one exists so
 * support can act when the trust's own admin is the one locked out.
 *
 * Signing a device out is audited (tenant.session_revoked) — acting on a
 * trust's account from the console is never invisible.
 */
interface TenantSession {
  id: string; user_id: string; user_name: string | null; user_mobile: string; roles: string[] | null;
  device_name: string | null; platform: string | null;
  created_at: string; last_used_at: string | null; expires_at: string;
  created_ip: string | null; last_ip: string | null; user_agent: string | null;
}

const PLATFORM_LABEL: Record<string, string> = {
  web: 'Browser', android: 'Android app', ios: 'iPhone app', electron: 'Desktop app', desktop: 'Desktop app',
};

/** "Chrome on Windows" — what a browser session is called when it names itself nothing. */
function describeUserAgent(ua: string | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os;
}

function sessionWhen(iso: string | null): string {
  if (!iso) return 'not used yet';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.floor(mins / 60)} h ago`;
  return `${Math.floor(mins / 1440)} days ago`;
}

function SessionsTab({ tenant, onNotice }: { tenant: TenantDetail; onNotice: (msg: string) => void }) {
  const [sessions, setSessions] = useState<TenantSession[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<TenantSession[]>(`/admin/tenants/${tenant.id}/sessions`).then((r) => setSessions(r.data)).catch(setError);
  }, [tenant.id]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, msg: string) {
    setError(null);
    setBusy(true);
    try { await fn(); load(); onNotice(msg); } catch (e) { setError(e); } finally { setBusy(false); }
  }

  // Grouped by person, because the question support is asked is about a person
  // ("sign Ramesh out, he has left"), not about a token id.
  const byUser = new Map<string, TenantSession[]>();
  for (const s of sessions) {
    const list = byUser.get(s.user_id);
    if (list) list.push(s); else byUser.set(s.user_id, [s]);
  }

  return (
    <div>
      <ErrorBox error={error} />
      <div className="card">
        <div className="toolbar">
          <h2 style={{ margin: 0 }}>Signed-in devices</h2>
          <div className="grow" />
          <button className="btn sm" onClick={load} disabled={busy}>Refresh</button>
        </div>
        <p className="muted">
          Every live session at this mandir — web, mobile app and desktop app. A session stays live until it is signed
          out or expires. Signing one out is immediate and is written to this trust's audit log.
        </p>
        <table className="data" data-testid="tenant-sessions">
          <thead><tr><th>Person</th><th>Device</th><th>Where from</th><th>Last used</th><th>Signed in</th><th></th></tr></thead>
          <tbody>
            {[...byUser.values()].map((rows) => {
              const u = rows[0];
              return (
                <Fragment key={u.user_id}>
                  <tr className="group-row">
                    <td colSpan={5}>
                      <strong>{u.user_name ?? u.user_mobile}</strong>{' '}
                      <span className="muted mono">{u.user_mobile}</span>{' '}
                      <span className="muted">{(u.roles ?? []).join(', ') || 'no role at this mandir'} · {rows.length} device{rows.length === 1 ? '' : 's'}</span>
                    </td>
                    <td>
                      {rows.length > 1 && (
                        <button className="btn sm danger" disabled={busy} onClick={() => {
                          if (confirm(`Sign ${u.user_name ?? u.user_mobile} out of all ${rows.length} devices? They will have to sign in again.`)) {
                            run(async () => {
                              for (const s of rows) {
                                await api(`/admin/tenants/${tenant.id}/sessions/${s.id}`, { method: 'DELETE' });
                              }
                            }, `${u.user_name ?? u.user_mobile} was signed out everywhere`);
                          }
                        }}>Sign out everywhere</button>
                      )}
                    </td>
                  </tr>
                  {rows.map((s) => (
                    <tr key={s.id} data-testid="session-row">
                      <td />
                      <td>
                        {s.device_name ?? describeUserAgent(s.user_agent) ?? <span className="muted">Unknown device</span>}
                        <div className="muted">{PLATFORM_LABEL[s.platform ?? ''] ?? s.platform ?? '—'}</div>
                      </td>
                      <td className="mono">
                        {s.last_ip ?? s.created_ip ?? <span className="muted">—</span>}
                        {s.created_ip && s.last_ip && s.created_ip !== s.last_ip && (
                          <div className="muted">signed in from {s.created_ip}</div>
                        )}
                      </td>
                      <td>{sessionWhen(s.last_used_at ?? s.created_at)}</td>
                      <td>{formatDate(s.created_at)}</td>
                      <td>
                        <button className="btn sm danger" disabled={busy} onClick={() => {
                          if (confirm(`Sign "${s.device_name ?? 'this device'}" out? ${u.user_name ?? u.user_mobile} will have to sign in again on it.`)) {
                            run(() => api(`/admin/tenants/${tenant.id}/sessions/${s.id}`, { method: 'DELETE' }), 'Device signed out');
                          }
                        }}>Sign out</button>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            {sessions.length === 0 && <tr><td colSpan={6} className="muted">Nobody is signed in at this mandir right now.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
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

  const load = useCallback(() => {
    api<License[]>(`/admin/tenants/${tenant.id}/licenses`).then((r) => setLicenses(r.data)).catch(setError);
  }, [tenant.id]);
  useEffect(load, [load]);

  return (
    <div>
      <ErrorBox error={error} />
      <div className="card">
        <div className="toolbar">
          <h2 style={{ margin: 0 }}>Desktop licence keys</h2>
        </div>
        <p className="muted" style={{ margin: '0 0 10px' }}>
          Keys from before the desktop app signed in with the trust's mobile OTP. No new key is
          needed: revoke any still active once the trust signs in with OTP. JainERP Offline's
          licence is on its Offline Mandir page.
        </p>
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

    </div>
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
