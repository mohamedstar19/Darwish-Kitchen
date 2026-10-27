import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { backupNow, getBackupMeta } from './backup';
import { KEYS, writeJson } from './kv';
import { backupEnabled, supabase } from './supabase';

const AUTO_BACKUP_EVERY = 24 * 60 * 60 * 1000;

type AuthContextValue = {
  enabled: boolean;
  session: Session | null;
  email?: string;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /** Returns true when the account still needs email confirmation. */
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!backupEnabled);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // Quiet daily backup while signed in.
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    getBackupMeta()
      .then((meta) => {
        if (meta.lastBackupAt && Date.now() - meta.lastBackupAt > AUTO_BACKUP_EVERY) return backupNow();
      })
      .catch(() => {});
  }, [userId]);

  const value = useMemo<AuthContextValue>(
    () => ({
      enabled: backupEnabled,
      session,
      email: session?.user.email,
      ready,
      signIn: async (email, password) => {
        const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      },
      signUp: async (email, password) => {
        const { data, error } = await supabase!.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        return !data.session;
      },
      signOut: async () => {
        await supabase?.auth.signOut();
        // Forget the last backup time so another account on this phone never auto-backs up over its data.
        await writeJson(KEYS.backupMeta, {});
      },
    }),
    [session, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
