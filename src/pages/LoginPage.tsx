import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ErrorBox } from '../components/ui';

type Step =
  | { kind: 'password' }
  | { kind: 'enrol'; mfaToken: string }
  | { kind: 'enrol-show'; mfaToken: string; qr: string; uri: string; codes: string[] }
  | { kind: 'verify'; mfaToken: string };

export function LoginPage() {
  const { login, mfaSetup, mfaVerify } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function submitPassword(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const r = await login(identifier, password);
      setStep(r.totp_enrolled ? { kind: 'verify', mfaToken: r.mfa_token } : { kind: 'enrol', mfaToken: r.mfa_token });
    });
  }

  function startEnrol(mfaToken: string) {
    run(async () => {
      const r = await mfaSetup(mfaToken);
      setStep({ kind: 'enrol-show', mfaToken, qr: r.qr_png_base64, uri: r.otpauth_uri, codes: r.recovery_codes });
    });
  }

  function submitCode(e: FormEvent) {
    e.preventDefault();
    const mfaToken =
      step.kind === 'verify' || step.kind === 'enrol-show' ? step.mfaToken : null;
    if (!mfaToken) return;
    run(async () => {
      await mfaVerify(mfaToken, useRecovery ? 'recovery' : 'totp', code.trim());
      navigate('/');
    });
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
            <span style={{ color: '#fff', fontSize: 28, fontWeight: 800, fontFamily: "'Noto Sans', system-ui, sans-serif" }}>J</span>
          </div>
          <h1 style={{ margin: 0 }}>Jain<em>ERP</em></h1>
          <p className="muted" style={{ marginTop: 4 }}>Super Admin Console</p>
        </div>
        <ErrorBox error={error} />

        {step.kind === 'password' && (
          <form onSubmit={submitPassword}>
            <label className="field">
              <span>Email or mobile</span>
              <input
                name="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoFocus
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </form>
        )}

        {step.kind === 'enrol' && (
          <div>
            <p>
              First login: you must set up an authenticator app (TOTP) before you can access
              the console.
            </p>
            <button className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={() => startEnrol(step.mfaToken)}>
              {busy ? 'Generating…' : 'Set up MFA'}
            </button>
          </div>
        )}

        {step.kind === 'enrol-show' && (
          <div>
            <p>Scan in Google Authenticator / Authy, then enter the 6-digit code below.</p>
            <img className="qr" src={`data:image/png;base64,${step.qr}`} alt="TOTP QR code" />
            <details>
              <summary className="muted">Can't scan? Show secret URI</summary>
              <p className="mono" data-testid="otpauth-uri" style={{ wordBreak: 'break-all' }}>{step.uri}</p>
            </details>
            <p>
              <strong>Recovery codes</strong> — shown once, store safely:
            </p>
            <div className="recovery-codes" data-testid="recovery-codes">
              {step.codes.map((c) => (
                <code key={c}>{c}</code>
              ))}
            </div>
            <form onSubmit={submitCode}>
              <label className="field">
                <span>6-digit code from your app</span>
                <input name="code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
              </label>
              <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
                {busy ? 'Verifying…' : 'Verify & sign in'}
              </button>
            </form>
          </div>
        )}

        {step.kind === 'verify' && (
          <form onSubmit={submitCode}>
            <label className="field">
              <span>{useRecovery ? 'Recovery code' : '6-digit code from your authenticator app'}</span>
              <input name="code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
            </label>
            <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Verifying…' : 'Verify & sign in'}
            </button>
            <p style={{ textAlign: 'center', marginTop: 10 }}>
              <a
                href="#recovery"
                onClick={(e) => {
                  e.preventDefault();
                  setUseRecovery(!useRecovery);
                  setCode('');
                }}
              >
                {useRecovery ? 'Use authenticator code instead' : 'Lost device? Use a recovery code'}
              </a>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
