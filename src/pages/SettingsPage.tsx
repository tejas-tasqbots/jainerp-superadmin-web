import { useCallback, useEffect, useState } from 'react';
import { api, publicApi, loadSession, type ApiMeta } from '../api/client';
import { PhoneInput } from '../components/PhoneInput';
import type { AdminUser, AuditEvent } from '../api/types';
import { ActionForm, ErrorBox, Modal, Pagination } from '../components/ui';
import { useCan, useMe } from '../auth/permissions';
import { RecoveryCodes } from '../components/recovery';

/** Mobiles are stored/shown as full E.164 (+91…, +971…, …). */
const display10 = (m: string | null | undefined) => m ?? '';

type Tab = 'users' | 'roles' | 'audit' | 'account';

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('users');
  return (
    <div>
      <h1>Settings</h1>
      <p className="muted">Who can use this console and what each role may do, the audit trail of what they did, and your own account.</p>
      <div className="tabs">
        <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Team</button>
        <button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>Roles &amp; permissions</button>
        <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>Audit trail</button>
        <button className={tab === 'account' ? 'active' : ''} onClick={() => setTab('account')}>My account</button>
      </div>
      {tab === 'users' && <UsersTab />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'account' && <AccountTab />}
    </div>
  );
}

interface RoleDef { key: AdminUser['role']; label: string; summary: string; permissions: string[] }
interface RolesCatalogue { roles: RoleDef[]; permissions: Array<{ key: string; description: string }> }

/** The role table the server enforces, fetched once per page. */
function useRoles() {
  const [cat, setCat] = useState<RolesCatalogue | null>(null);
  useEffect(() => { api<RolesCatalogue>('/admin/roles').then((r) => setCat(r.data)).catch(() => setCat(null)); }, []);
  return cat;
}

const ago = (iso: string | null) => {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * The team: everyone who can sign in to this console, the way a Team page
 * reads in Stripe or Zoho — role, MFA, last sign-in, invite state — and the
 * actions a Super admin takes on them. A password is never shown on screen:
 * a reset (or a re-sent invite) is a one-time link the person opens.
 */
function UsersTab() {
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<{ who: string; token: string; kind: 'invite' | 'reset' } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const canManage = useCan('team.manage');
  const me = useMe();
  const roles = useRoles();
  const label = (r: string) => roles?.roles.find((x) => x.key === r)?.label ?? r;

  const load = useCallback(() => {
    api<AdminUser[]>('/admin/users').then((r) => setRows(r.data)).catch(setError);
  }, []);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, msg?: string) {
    setError(null); setNotice(null);
    try {
      const result = await fn();
      load();
      if (msg) setNotice(msg);
      return result;
    } catch (e) { setError(e); }
  }

  const sendLink = async (u: AdminUser) => {
    const r = (await run(() => api<{ set_password_token: string }>(`/admin/users/${u.id}/password-link`, { method: 'POST', body: {} }))) as { data: { set_password_token: string } } | undefined;
    if (r) setLink({ who: u.name ?? u.email ?? u.mobile, token: r.data.set_password_token, kind: u.invite_pending ? 'invite' : 'reset' });
  };
  const url = (token: string) => `${window.location.origin}/set-password?token=${token}`;
  const active = rows.filter((u) => u.is_active).length;

  return (
    <div>
      <ErrorBox error={error} />
      {notice && <div className="success-box" data-testid="users-notice">{notice}</div>}
      {link && (
        <div className="success-box" data-testid="set-password-link">
          {link.kind === 'invite' ? `Invite link for ${link.who}` : `Password reset link for ${link.who}`} — one use, valid 48 hours. Send it to them directly (WhatsApp or email); it lets them choose their own password.
          <br />
          <code style={{ wordBreak: 'break-all' }}>{url(link.token)}</code>
          <br />
          <button className="btn sm" type="button" style={{ marginTop: 6 }} onClick={() => navigator.clipboard?.writeText(url(link.token))}>Copy link</button>
        </div>
      )}
      <div className="toolbar">
        <span className="muted">{active} active of {rows.length} · two-step sign-in (MFA) is required for everyone</span>
        <div className="grow" />
        {canManage && <button className="btn primary" data-testid="invite-user" onClick={() => setShowCreate(true)}>+ Invite a team member</button>}
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Name</th><th>Role</th><th>Two-step sign-in</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} data-testid={`team-row-${u.email}`}>
                <td>
                  <strong>{u.name ?? '—'}</strong>{u.id === me?.id && <span className="badge blue" style={{ marginLeft: 6 }}>you</span>}
                  <div className="sub">{u.email}</div>
                  <div className="sub mono">{display10(u.mobile)}</div>
                </td>
                <td><span className={`badge ${u.role === 'superadmin' ? 'red' : u.role === 'viewer' ? '' : 'blue'}`}>{label(u.role)}</span></td>
                <td>{u.mfa_enrolled ? <span className="badge green">on</span> : <span className="badge">not set up yet</span>}</td>
                <td>{u.last_login_at ? ago(u.last_login_at) : u.invite_pending
                  ? <span className="muted">invited{u.invite_expires_at && new Date(u.invite_expires_at) < new Date() ? ' — link expired' : ''}</span>
                  : <span className="muted">never</span>}</td>
                <td>
                  {u.is_active ? <span className="badge green">active</span> : <span className="badge">deactivated</span>}
                  {u.locked_until && <div className="sub" style={{ color: 'var(--color-danger)' }}>locked after wrong attempts</div>}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canManage && (
                    <>
                      <button className="btn sm" type="button" disabled={u.id === me?.id} title={u.id === me?.id ? 'Another Super admin changes your role' : undefined} onClick={() => setEditing(u)}>Change role</button>{' '}
                      <button className="btn sm" type="button" onClick={() => sendLink(u)}>{u.invite_pending ? 'Re-send invite' : 'Reset password'}</button>{' '}
                      {u.mfa_enrolled && (
                        <><button className="btn sm" type="button" onClick={() => {
                          if (window.confirm(`Reset two-step sign-in for ${u.name ?? u.email}? They set it up again on their next sign-in.`)) {
                            void run(() => api(`/admin/users/${u.id}/reset-mfa`, { method: 'POST', body: {} }), `Two-step sign-in reset for ${u.email} — they set it up again on next sign-in.`);
                          }
                        }}>Reset MFA</button>{' '}</>
                      )}
                      {u.id !== me?.id && (
                        <button className={`btn sm${u.is_active ? ' danger' : ''}`} type="button" onClick={() => {
                          if (u.is_active && !window.confirm(`Deactivate ${u.name ?? u.email}? They are signed out everywhere at once and cannot sign in until reactivated.`)) return;
                          void run(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { is_active: !u.is_active } }),
                            u.is_active ? `${u.email} deactivated and signed out everywhere.` : `${u.email} reactivated.`);
                        }}>{u.is_active ? 'Deactivate' : 'Reactivate'}</button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <Modal title="Invite a team member" onClose={() => setShowCreate(false)}>
          <CreateUserForm roles={roles} onCreated={(token, who) => { setShowCreate(false); load(); setNotice(null); setLink({ who, token, kind: 'invite' }); }} />
        </Modal>
      )}
      {editing && (
        <Modal title={`Change role — ${editing.name ?? editing.email}`} onClose={() => setEditing(null)}>
          <ActionForm submitLabel="Save role" successMessage={null}
            onSubmit={async () => {
              const role = (document.querySelector('input[name=edit_role]:checked') as HTMLInputElement | null)?.value;
              if (!role || role === editing.role) { setEditing(null); return; }
              await api(`/admin/users/${editing.id}`, { method: 'PATCH', body: { role } });
              setEditing(null); load(); setNotice(`${editing.email} is now ${label(role)}. It applies straight away.`);
            }}>
            <RolePicker name="edit_role" roles={roles} initial={editing.role} />
          </ActionForm>
        </Modal>
      )}
    </div>
  );
}

/** Roles as choices with what each one means — never a bare dropdown of codes. */
function RolePicker({ name, roles, initial }: { name: string; roles: RolesCatalogue | null; initial: string }) {
  const [value, setValue] = useState(initial);
  if (!roles) return <p className="muted">Loading roles…</p>;
  return (
    <div className="role-cards" role="radiogroup">
      {roles.roles.map((r) => (
        <label key={r.key} className={`choice${value === r.key ? ' selected' : ''}`} style={{ display: 'block' }}>
          <input type="radio" name={name} value={r.key} checked={value === r.key} onChange={() => setValue(r.key)} style={{ display: 'none' }} />
          <div className="t">{r.label}</div>
          <div className="d">{r.summary}</div>
        </label>
      ))}
    </div>
  );
}

function CreateUserForm({ roles, onCreated }: { roles: RolesCatalogue | null; onCreated: (token: string, who: string) => void }) {
  const [form, setForm] = useState({ name: '', email: '', mobile: '' });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <ActionForm submitLabel="Create and get invite link"
      onSubmit={async () => {
        const role = (document.querySelector('input[name=user_role]:checked') as HTMLInputElement | null)?.value ?? 'viewer';
        const { data } = await api<{ set_password_token: string }>('/admin/users', { method: 'POST', body: { ...form, role } });
        onCreated(data.set_password_token, form.name || form.email);
      }}>
      <label className="field"><span>Name</span><input name="user_name" value={form.name} onChange={set('name')} required /></label>
      <label className="field"><span>Email</span><input name="user_email" type="email" value={form.email} onChange={set('email')} required /></label>
      <label className="field"><span>Mobile</span>
        <PhoneInput name="user_mobile" value={form.mobile} onChange={(v) => setForm((f) => ({ ...f, mobile: v }))} required />
      </label>
      <p className="muted" style={{ fontSize: 12, margin: '4px 0 8px' }}>Role — give the least that lets them do their job; it can be changed later.</p>
      <RolePicker name="user_role" roles={roles} initial="viewer" />
    </ActionForm>
  );
}

/** Who may do what — the same table the server enforces, read from it. */
function RolesTab() {
  const cat = useRoles();
  if (!cat) return <p className="muted">Loading…</p>;
  return (
    <div>
      <p className="muted" style={{ maxWidth: 760 }}>
        Every role can <b>see</b> every page. What differs is what each may <b>change</b>. Anything not listed here — moving a
        mandir between databases, deleting records — is Super admin only, and so is anything new until it is given a permission.
      </p>
      <div className="table-wrap">
        <table className="data perm-matrix">
          <thead>
            <tr><th>Permission</th>{cat.roles.map((r) => <th key={r.key} className="role-col">{r.label}</th>)}</tr>
          </thead>
          <tbody>
            {cat.permissions.map((p) => (
              <tr key={p.key}>
                <td>{p.description}<div className="sub mono">{p.key}</div></td>
                {cat.roles.map((r) => (r.permissions.includes(p.key)
                  ? <td key={r.key} className="yes" aria-label="allowed">✓</td>
                  : <td key={r.key} className="no" aria-label="not allowed">—</td>))}
              </tr>
            ))}
            <tr>
              <td>View every page, list and report</td>
              {cat.roles.map((r) => <td key={r.key} className="yes">✓</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="stat-grid" style={{ marginTop: 16 }}>
        {cat.roles.map((r) => (
          <div key={r.key} className="stat"><div className="label">{r.label}</div><div className="sub" style={{ marginTop: 6, fontSize: 13 }}>{r.summary}</div></div>
        ))}
      </div>
    </div>
  );
}

/** The audit trail — who did what, when, from where. */
function AuditTab() {
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [team, setTeam] = useState<AdminUser[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => { api<AdminUser[]>('/admin/users').then((r) => setTeam(r.data)).catch(() => setTeam([])); }, []);
  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), limit: '25' });
    if (action) params.set('action', action);
    if (actor) params.set('actor', actor);
    api<AuditEvent[]>(`/admin/audit-events?${params}`)
      .then((r) => { setRows(r.data); setMeta(r.meta); })
      .catch(setError);
  }, [page, action, actor]);
  const who = (id: string | null) => (id ? team.find((u) => u.id === id)?.name ?? team.find((u) => u.id === id)?.email ?? `${id.slice(0, 8)}…` : 'system');

  return (
    <div>
      <ErrorBox error={error} />
      <div className="toolbar">
        <input placeholder="Filter by action (e.g. tenant.suspend)…" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
        <select aria-label="Who" value={actor} onChange={(e) => { setActor(e.target.value); setPage(1); }}>
          <option value="">Anyone</option>
          {team.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}
        </select>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Mandir</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>
            {rows.map((ev) => (
              <tr key={ev.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(ev.createdAt).toLocaleString('en-IN')}</td>
                <td>{who(ev.actorUserId)}</td>
                <td className="mono">{ev.action}</td>
                <td className="mono">{ev.tenantId ? ev.tenantId.slice(0, 8) : '—'}</td>
                <td className="mono" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={JSON.stringify(ev.payload)}>
                  {JSON.stringify(ev.payload)}
                </td>
                <td className="mono">{ev.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
      <ProfileCard onSaved={() => setNotice('Profile updated.')} />
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
          <div data-testid="new-recovery-codes">
            <RecoveryCodes codes={codes} accountLabel={session?.user.email ?? session?.user.mobile} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Self-service profile editor: name / email / 10-digit mobile (#6). */
function ProfileCard({ onSaved }: { onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', mobile: '' });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<{ name: string | null; email: string | null; mobile: string }>('/admin/me')
      .then((r) => {
        setForm({
          name: r.data.name ?? '',
          email: r.data.email ?? '',
          mobile: r.data.mobile || '',
        });
        setLoaded(true);
      })
      .catch(setError);
  }, []);

  if (!loaded) return <div className="card"><ErrorBox error={error} /><p className="muted">Loading profile…</p></div>;

  return (
    <div className="card">
      <h2>My profile</h2>
      <p className="muted">Update your own name, email and mobile.</p>
      <ActionForm submitLabel="Save profile"
        onSubmit={async () => {
          await api('/admin/me', { method: 'PATCH', body: form });
          onSaved();
        }}>
        <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        <label className="field"><span>Mobile</span>
          <PhoneInput name="my_mobile" value={form.mobile} onChange={(v) => setForm((f) => ({ ...f, mobile: v }))} required />
        </label>
      </ActionForm>
    </div>
  );
}
