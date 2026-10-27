import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Profile } from '../types';
import { useDataGeneration } from './data-reload';
import { deleteStoredImage } from './images';
import { KEYS, readJson, writeJson } from './kv';

type ProfileContextValue = {
  profile: Profile;
  ready: boolean;
  updateProfile: (changes: Partial<Omit<Profile, 'updatedAt'>>) => Promise<void>;
};

const EMPTY: Profile = { name: '', updatedAt: 0 };
const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [ready, setReady] = useState(false);
  const generation = useDataGeneration();

  useEffect(() => {
    readJson<Profile>(KEYS.profile)
      .then((p) => setProfile(p ? { ...EMPTY, ...p } : EMPTY))
      .finally(() => setReady(true));
  }, [generation]);

  const updateProfile = useCallback(
    async (changes: Partial<Omit<Profile, 'updatedAt'>>) => {
      const next = { ...profile, ...changes, updatedAt: Date.now() };
      await writeJson(KEYS.profile, next);
      setProfile(next);
      if ('avatar' in changes && changes.avatar !== profile.avatar) deleteStoredImage(profile.avatar);
    },
    [profile],
  );

  const value = useMemo(() => ({ profile, ready, updateProfile }), [profile, ready, updateProfile]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider');
  return ctx;
}
