import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, publicApi, loadSession, type ApiMeta } from '../api/client';
import type { AdminUser, AuditEvent } from '../api/types';
import { ActionForm, Badge, ErrorBox, Modal, Pagination } from '../components/ui';

type Tab = 'users' | 'audit' | 'account';

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('users');
  return (
    <div>
      <h1>Settings</h1>
      <div className="tabs">
        <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>User management</button>
        <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>Audit trail</button>
        <button className={tab === 'account' ? 'active' : ''} onClick={() => setTab('account')}>My account</button>
      </div>
      {tab === 'users' && <UsersTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'account' && <AccountTab />}
    </div>
  );
}

function UsersTab() {
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    api<AdminUser[]>('/admin/users').then((r) => setRows(r.data)).catch(setError);
  }, []);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, msg?: string) {
    setError(null);
    try {
      const result = await fn();
      load();
      if (msg) setNotice(msg);
      return result;
    } catch (e) { setError(e); }
  }

  return (
    <div>
      <ErrorBox error={error} />
      {notice && <div className="success-box" data-testid="users-notice">{notice}</div>}
      <div className="toolbar">
        <div className="grow" />
        <button className="btn primary" onClick={() => setShowCreate(true)}>+ Add super-admin user</button>
      </div>
      <table className="data">
        <thead><tr><th>Name</th><th>Email</th><th>Mobile</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td className="mono">{u.mobile}</td>
              <td>{u.role}</td>
              <td><Badge value={u.is_active ? 'active' : 'suspended'} /></td>
              <td>
                <button className="btn sm" onClick={() => run(
                  () => api(`/admin/users/${u.id}/reset-mfa`, { method: 'POST', body: {} }),
                  `MFA reset for ${u.email} — they will re-enrol on next login`,
                )}>Reset MFA</button>{' '}
                <button className="btn sm" onClick={async () => {
                  const r = (await run(() =>
                    api<{ temp_password: string }>(`/admin/users/${u.id}/reset-password`, { method: 'POST', body: {} }),
                  )) as { data: { temp_password: string } } | undefined;
                  if (r) setNotice(`Temp password for ${u.email}: ${r.data.temp_password} (deliver out-of-band)`);
                }}>Reset password</button>{' '}
                <button className="btn sm danger" onClick={() => run(
                  () => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { is_active: !u.is_active } }),
                  u.is_active ? 'User deactivated' : 'User reactivated',
                )}>{u.is_active ? 'Deactivate' : 'Reactivate'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showCreate && (
        <Modal title="Add super-admin user" onClose={() => setShowCreate(false)}>
          <CreateUserForm onCreated={(msg) => { setShowCreate(false); load(); setNotice(msg); }} />
        </Modal>
      )}
    </div>
  );
}

function CreateUserForm({ onCreated }: { onCreated: (msg: string) => void }) {
  const [form, setForm] = useState({ name: '', email: '', mobile: '', role: 'support' });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <ActionForm submitLabel="Create"
      onSubmit={async () => {
        const { data } = await api<{ set_password_token: string }>('/admin/users', { method: 'POST', body: form });
        onCreated(`User created. Set-password token (deliver out-of-band): ${data.set_password_token}`);
      }}>
      <label className="field"><span>Name</span><input name="user_name" value={form.name} onChange={set('name')} required /></label>
      <label className="field"><span>Email</span><input name="user_email" type="email" value={form.email} onChange={set('email')} required /></label>
      <label className="field"><span>Mobile (+91…)</span><input name="user_mobile" value={form.mobile} onChange={set('mobile')} required /></label>
      <label className="field"><span>Role</span>
        <select name="user_role" value={form.role} onChange={set('role')}>
          <option value="superadmin">superadmin</option>
          <option value="support">support</option>
          <option value="billing">billing</option>
        </select>
      </label>
    </ActionForm>
  );
}

function AuditTab() {
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), limit: '25' });
    if (action) params.set('action', action);
    api<AuditEvent[]>(`/admin/audit-events?${params}`)
      .then((r) => { setRows(r.data); setMeta(r.meta); })
      .catch(setError);
  }, [page, action]);

  return (
    <div>
      <ErrorBox error={error} />
      <div className="toolbar">
        <input placeholder="Filter by action (e.g. tenant.suspend)…" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
      </div>
      <table className="data">
        <thead><tr><th>When</th><th>Action</th><th>Tenant</th><th>Payload</th><th>IP</th></tr></thead>
        <tbody>
          {rows.map((ev) => (
            <tr key={ev.id}>
              <td>{new Date(ev.createdAt).toLocaleString('en-IN')}</td>
              <td className="mono">{ev.action}</td>
              <td className="mono">{ev.tenantId ? ev.tenantId.slice(0, 8) : '—'}</td>
              <td className="mono" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {JSON.stringify(ev.payload)}
              </td>
              <td className="mono">{ev.ip ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {meta && <Pagination page={page} total={meta.total} limit={25} onPage={setPage} />}
    </div>
  );
}

function AccountTab() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [totp, setTotp] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const session = loadSession();

  return (
    <div style={{ maxWidth: 480 }}>
      {notice && <div className="success-box">{notice}</div>}
      <div className="card">
        <h2>Change password</h2>
        <p className="muted">Changing your password signs you out of all devices.</p>
        <ActionForm submitLabel="Change password"
          onSubmit={async () => {
            await api('/admin/auth/password/change', {
              method: 'POST',
              body: { current_password: current, new_password: next },
            });
            setNotice('Password changed — sessions revoked, sign in again.');
            setCurrent(''); setNext('');
          }}>
          <label className="field"><span>Current password</span><input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
          <label className="field"><span>New password (min 10 chars)</span><input type="password" value={next} onChange={(e) => setNext(e.target.value)} required /></label>
        </ActionForm>
      </div>

      <div className="card">
        <h2>Regenerate recovery codes</h2>
        <p className="muted">Invalidates the old set. Requires a current TOTP code.</p>
        <ActionForm submitLabel="Regenerate"
          onSubmit={async () => {
            const { data } = await publicApi<{ recovery_codes: string[] }>(
              '/admin/auth/recovery-codes/regenerate',
              { method: 'POST', body: { totp }, token: session?.access_token },
            );
            setCodes(data.recovery_codes);
            setTotp('');
          }}>
          <label className="field"><span>TOTP code</span><input value={totp} onChange={(e) => setTotp(e.target.value)} required /></label>
        </ActionForm>
        {codes && (
          <div className="recovery-codes" data-testid="new-recovery-codes">
            {codes.map((c) => <code key={c}>{c}</code>)}
          </div>
        )}
      </div>
    </div>
  );
}
