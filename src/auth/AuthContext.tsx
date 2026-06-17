import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadSession, publicApi, saveSession, type Session } from '../api/client';

interface LoginStep1Result {
  mfa_token: string;
  mfa_required: boolean;
  totp_enrolled: boolean;
}

interface MfaSetupResult {
  otpauth_uri: string;
  qr_png_base64: string;
  recovery_codes: string[];
}

interface AuthContextValue {
  session: Session | null;
  login(identifier: string, password: string): Promise<LoginStep1Result>;
  mfaSetup(mfaToken: string): Promise<MfaSetupResult>;
  mfaVerify(mfaToken: string, type: 'totp' | 'recovery', code: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession());

  useEffect(() => {
    const sync = () => setSession(loadSession());
    window.addEventListener('session-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('session-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const value: AuthContextValue = {
    session,
    async login(identifier, password) {
      const { data } = await publicApi<LoginStep1Result>('/admin/auth/login', {
        method: 'POST',
        body: { identifier, password },
      });
      return data;
    },
    async mfaSetup(mfaToken) {
      const { data } = await publicApi<MfaSetupResult>('/admin/auth/mfa/setup', {
        method: 'POST',
        body: { mfa_token: mfaToken },
      });
      return data;
    },
    async mfaVerify(mfaToken, type, code) {
      const { data } = await publicApi<Session & { recovery_codes_remaining: number }>(
        '/admin/auth/mfa/verify',
        { method: 'POST', body: { mfa_token: mfaToken, type, code } },
      );
      saveSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        user: data.user,
      });
    },
    async logout() {
      const current = loadSession();
      if (current) {
        await publicApi('/admin/auth/logout', {
          method: 'POST',
          body: { refresh_token: current.refresh_token },
        }).catch(() => undefined);
      }
      saveSession(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
