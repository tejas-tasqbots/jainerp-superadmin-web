import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, formatDate, formatPaise } from '../api/client';
import type { Invoice, License, TenantDetail } from '../api/types';
import { ActionForm, Badge, ErrorBox, Modal } from '../components/ui';

const PLANS = ['starter', 'standard', 'premium', 'enterprise'];
const TIERS = ['pooled', 'dedicated'];
type Tab = 'overview' | 'billing' | 'users' | 'people' | 'licenses';

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
        {(['overview', 'billing', 'users', 'people', 'licenses'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'people' ? 'Trustees & Requirements' : t === 'users' ? 'Mandir Users' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab tenant={tenant} onChanged={(msg) => { setNotice(msg); load(); }} />}
      {tab === 'billing' && <BillingTab tenant={tenant} onChanged={(msg) => { setNotice(msg); load(); }} />}
      {tab === 'users' && <UsersTab tenant={tenant} onNotice={setNotice} />}
      {tab === 'people' && <PeopleTab tenant={tenant} onChanged={(msg) => { setNotice(msg); load(); }} />}
      {tab === 'licenses' && <LicensesTab tenant={tenant} onChanged={(msg) => { setNotice(msg); }} />}
    </div>
  );
}

// ---------------- Overview ----------------
function OverviewTab({ tenant, onChanged }: { tenant: TenantDetail; onChanged: (msg: string) => void }) {
  const navigate = useNavigate();
  const [modal, setModal] = useState<'plan' | 'tier' | 'suspend' | 'cancel' | null>(null);
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

      <div className="card">
        <h2>Actions</h2>
        <div className="toolbar">
          {tenant.status === 'active' && (
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
          <button className="btn danger" onClick={() => setModal('cancel')}>Cancel tenant…</button>
        </div>
      </div>

      {modal === 'suspend' && (
        <Modal title="Suspend mandir" onClose={() => setModal(null)}>
          <SuspendForm tenantId={tenant.id} onDone={() => { setModal(null); onChanged('Mandir suspended'); }} />
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
        <Modal title="Cancel tenant (soft delete)" onClose={() => setModal(null)}>
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

function CancelForm({ tenant, onDone }: { tenant: TenantDetail; onDone: () => void }) {
  const [confirm, setConfirm] = useState('');
  return (
    <ActionForm submitLabel="Cancel tenant" onDone={onDone}
      onSubmit={async () => { await api(`/admin/tenants/${tenant.id}`, { method: 'DELETE', body: { confirm_slug: confirm } }); }}>
      <p>Type the slug <code className="mono">{tenant.slug}</code> to confirm cancellation.</p>
      <label className="field"><span>Slug</span><input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
    </ActionForm>
  );
}

// ---------------- Billing ----------------
function BillingTab({ tenant, onChanged }: { tenant: TenantDetail; onChanged: (msg: string) => void }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [mandateLink, setMandateLink] = useState<string | null>(null);

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
              <th>Invoice #</th><th>Period</th><th>Subtotal</th><th>GST</th><th>Total</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td className="mono">{inv.invoiceNumber}</td>
                <td>{formatDate(inv.periodStart)} → {formatDate(inv.periodEnd)}</td>
                <td>{formatPaise(inv.subtotalPaise)}</td>
                <td>{formatPaise(inv.gstAmountPaise)}</td>
                <td>{formatPaise(inv.totalPaise)}</td>
                <td><Badge value={inv.status} /></td>
                <td>
                  {inv.status === 'unpaid' && (
                    <>
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
            {invoices.length === 0 && <tr><td colSpan={7} className="muted">No invoices.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
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
    mobile: user?.mobile?.replace('+91', '') ?? '',
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
        <label className="field"><span>Mobile (10-digit) *</span>
          <input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value.replace(/\D/g, '') })} inputMode="numeric" maxLength={10} placeholder="9876543210" required />
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
