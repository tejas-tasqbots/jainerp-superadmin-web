import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

/**
 * What the signed-in admin may do — read from GET /admin/me, which takes it
 * from the role table the SERVER enforces (superadmin-api auth/permissions.ts).
 *
 * The console only uses this to hide or disable what would be refused anyway;
 * the server is the authority. Re-read when the session changes, so a role a
 * Super admin just changed shows on the next page.
 */
export type Permission =
  | 'mandirs.onboard' | 'mandirs.manage' | 'billing.manage' | 'reviews.manage' | 'content.manage'
  | 'enquiries.manage' | 'devotees.manage' | 'offline.pin_reset' | 'team.manage' | 'platform.manage';

export interface Me {
  id: string;
  name: string | null;
  email: string | null;
  role: 'superadmin' | 'operations' | 'support' | 'compliance' | 'content' | 'billing' | 'viewer';
  role_label: string;
  permissions: Permission[];
}

const MeContext = createContext<Me | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    if (!session) { setMe(null); return; }
    let live = true;
    api<Me>('/admin/me').then((r) => { if (live) setMe(r.data); }).catch(() => undefined);
    return () => { live = false; };
  }, [session]);
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export const useMe = () => useContext(MeContext);

/**
 * True when the admin holds the permission. While /admin/me is still loading
 * this is false, so a button that needs a permission never flashes on for a
 * Viewer — it appears a moment later for those who may use it.
 */
export function useCan(p: Permission): boolean {
  const me = useMe();
  if (!me) return false;
  return me.role === 'superadmin' || me.permissions.includes(p);
}

/** Renders children only for admins holding the permission. */
export function Can({ perm, children, fallback = null }: { perm: Permission; children: ReactNode; fallback?: ReactNode }) {
  return <>{useCan(perm) ? children : fallback}</>;
}
