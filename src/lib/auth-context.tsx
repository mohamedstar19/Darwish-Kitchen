import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getAuth, setAuth, type Auth } from './api';
import { backupNow, clearBackupMeta, getBackupMeta } from './backup';

const AUTO_BACKUP_EVERY = 24 * 60 * 60 * 1000;

type AuthContextValue = {
  auth: Auth | null;
  phone?: string;
  ready: boolean;
  /** Sends a login code (WhatsApp) to the number. */
  sendCode: (phone: string) => Promise<{ expiresIn: number }>;
  /** Checks the code and signs in (creates the account the first time). */
  verifyCode: (phone: string, code: string) => Promise<Auth>;
  signOut: () => Promise<void>;
  /** Re-reads the saved login (e.g. after the server rejected it). */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type SessionResponse = { token: string; user: { id: string; phone: string; isAdmin?: boolean } };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setState] = useState<Auth | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => setState(await getAuth()), []);

  useEffect(() => {
    refresh().finally(() => setReady(true));
  }, [refresh]);

  // Admin rights can change on the server: re-check them when the app starts.
  const token = auth?.token;
  useEffect(() => {
    if (!token) return;
    api<{ user: { isAdmin?: boolean } }>('/api/me')
      .then(async ({ user }) => {
        const current = await getAuth();
        if (current && current.token === token && !!current.isAdmin !== !!user.isAdmin) {
          const next = { ...current, isAdmin: !!user.isAdmin };
          await setAuth(next);
          setState(next);
        }
      })
      .catch(() => refresh());
  }, [token, refresh]);

  // Quiet daily backup while signed in, once the user has backed up at least once.
  const userId = auth?.userId;
  useEffect(() => {
    if (!userId) return;
    getBackupMeta()
      .then((meta) => {
        if (meta.lastBackupAt && Date.now() - meta.lastBackupAt > AUTO_BACKUP_EVERY) return backupNow();
      })
      .catch(() => refresh());
  }, [userId, refresh]);

  const sendCode = useCallback(
    (phone: string) => api<{ expiresIn: number }>('/api/auth/otp/send', { json: { phone }, auth: false }),
    [],
  );

  const verifyCode = useCallback(async (phone: string, code: string) => {
    const res = await api<SessionResponse>('/api/auth/otp/verify', { json: { phone, code }, auth: false });
    const next = { token: res.token, phone: res.user.phone, userId: res.user.id, isAdmin: !!res.user.isAdmin };
    const previous = await getAuth();
    // A different account on this phone must never auto-backup over its own data.
    if (previous?.userId !== next.userId) await clearBackupMeta();
    await setAuth(next);
    setState(next);
    return next;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      auth,
      phone: auth?.phone,
      ready,
      sendCode,
      verifyCode,
      signOut: async () => {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
        await setAuth(null);
        await clearBackupMeta();
        setState(null);
      },
      refresh,
    }),
    [auth, ready, sendCode, verifyCode, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
