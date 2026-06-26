import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { publicApi } from '../api/client';
import { ErrorBox } from '../components/ui';

/**
 * Where a super-admin created by another admin completes their account: they
 * paste the one-time set-password token (or arrive with ?token=… in the URL),
 * choose a password, then sign in normally and enrol MFA on first login.
 */
export function SetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError(new Error('Password must be at least 10 characters'));
      return;
    }
    if (password !== confirm) {
      setError(new Error('Passwords do not match'));
      return;
    }
    setBusy(true);
    try {
      await publicApi('/admin/auth/set-password', {
        method: 'POST',
        body: { token: token.trim(), new_password: password },
      });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14, background: '#0D1B2E',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 12px', boxShadow: '0 4px 16px rgba(0,0,0,0.18)'
          }}>
            <span style={{ color: '#fff', fontSize: 28, fontWeight: 800 }}>J</span>
          </div>
          <h1 style={{ margin: 0 }}>Jain<em>ERP</em></h1>
          <p className="muted" style={{ marginTop: 4 }}>Set your password</p>
        </div>

        {done ? (
          <div>
            <div className="success-box">Password set. You can now sign in.</div>
            <button className="btn primary" style={{ width: '100%', marginTop: 12 }} onClick={() => navigate('/login')}>
              Go to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <ErrorBox error={error} />
            <label className="field">
              <span>Set-password token</span>
              <input value={token} onChange={(e) => setToken(e.target.value)} required autoFocus={!token} />
            </label>
            <label className="field">
              <span>New password (min 10 chars)</span>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus={!!token}
              />
            </label>
            <label className="field">
              <span>Confirm password</span>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 14 }}>
              <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
              Show password
            </label>
            <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Setting…' : 'Set password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
