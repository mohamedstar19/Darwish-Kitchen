import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getAuth, setAuth, type Auth } from './api';
import { backupNow, clearBackupMeta, getBackupMeta } from './backup';

const AUTO_BACKUP_EVERY = 24 * 60 * 60 * 1000;

type AuthContextValue = {
  auth: Auth | null;
  email?: string;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads the saved login (e.g. after the server rejected it). */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type SessionResponse = { token: string; user: { id: string; email: string } };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setState] = useState<Auth | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => setState(await getAuth()), []);

  useEffect(() => {
    refresh().finally(() => setReady(true));
  }, [refresh]);

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

  const start = useCallback(async (path: string, email: string, password: string) => {
    const res = await api<SessionResponse>(path, { json: { email: email.trim(), password }, auth: false });
    const next = { token: res.token, email: res.user.email, userId: res.user.id };
    const previous = await getAuth();
    // A different account on this phone must never auto-backup over its own data.
    if (previous?.userId !== next.userId) await clearBackupMeta();
    await setAuth(next);
    setState(next);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      auth,
      email: auth?.email,
      ready,
      signIn: (email, password) => start('/api/auth/login', email, password),
      signUp: (email, password) => start('/api/auth/signup', email, password),
      signOut: async () => {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
        await setAuth(null);
        await clearBackupMeta();
        setState(null);
      },
      refresh,
    }),
    [auth, ready, start, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
