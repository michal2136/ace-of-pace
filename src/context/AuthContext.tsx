import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const API = 'http://localhost:8000';

// ── Avatar options ─────────────────────────────────────────────────────────────
export const AVATAR_OPTIONS = [
  { id: 'cheetah', emoji: '🐆', label: 'Gepard' },
  { id: 'fox', emoji: '🦊', label: 'Lis' },
  { id: 'bear', emoji: '🐻', label: 'Niedźwiedź' },
  { id: 'wolf', emoji: '🐺', label: 'Wilk' },
  { id: 'eagle', emoji: '🦅', label: 'Orzeł' },
  { id: 'lion', emoji: '🦁', label: 'Lew' },
] as const;

export type AvatarId = typeof AVATAR_OPTIONS[number]['id'];

export interface UserProfile {
  user_id: number;
  email: string;
  google_id: string;
  strava_linked: boolean;
  strava_athlete_id: number | null;
  // Server-side profile fields (v2)
  display_name: string | null;
  avatar_url: string | null;
  fitness_level: string | null;
  training_goal: string | null;
  // Local-only enrichment
  avatarId?: AvatarId;
  onboarding_done?: boolean;
}

interface AuthContextValue {
  user: UserProfile | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  login: (userId: number, email: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  updateProfile: (patch: Pick<UserProfile, 'display_name' | 'avatarId' | 'onboarding_done' | 'fitness_level' | 'training_goal'>) => Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const LOCAL_PROFILE_KEY = (id: number) => `sl_profile_${id}`;

function loadLocalProfile(userId: number): Partial<UserProfile> {
  try {
    const raw = localStorage.getItem(LOCAL_PROFILE_KEY(userId));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveLocalProfile(userId: number, patch: Partial<UserProfile>) {
  try {
    const existing = loadLocalProfile(userId);
    localStorage.setItem(LOCAL_PROFILE_KEY(userId), JSON.stringify({ ...existing, ...patch }));
  } catch { }
}

// ─────────────────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async (userId: number): Promise<UserProfile | null> => {
    try {
      const res = await fetch(`${API}/api/auth/me?user_id=${userId}`);
      if (!res.ok) return null;
      const remote = await res.json();
      // Merge local-only enrichment (avatarId, custom onboarding override)
      const local = loadLocalProfile(userId);
      // onboarding_done: true if server has display_name OR local flag is set
      const onboarding_done = !!remote.display_name || !!local.onboarding_done;
      return { ...remote, ...local, onboarding_done };
    } catch {
      return null;
    }
  }, []);

  // Restore session on mount
  useEffect(() => {
    const storedId = localStorage.getItem('sl_user_id');
    if (!storedId) {
      setIsLoading(false);
      return;
    }
    fetchMe(parseInt(storedId, 10)).then((profile) => {
      setUser(profile);
      setIsLoading(false);
    });
  }, [fetchMe]);

  const login = useCallback(async (userId: number, email: string) => {
    localStorage.setItem('sl_user_id', String(userId));
    localStorage.setItem('sl_user_email', email);
    const profile = await fetchMe(userId);
    setUser(profile ?? {
      user_id: userId, email, google_id: '',
      strava_linked: false, strava_athlete_id: null,
      display_name: null, avatar_url: null, fitness_level: null, training_goal: null,
      onboarding_done: false,
    });
  }, [fetchMe]);

  const logout = useCallback(() => {
    localStorage.removeItem('sl_user_id');
    localStorage.removeItem('sl_user_email');
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!user) return;
    const profile = await fetchMe(user.user_id);
    if (profile) setUser(profile);
  }, [user, fetchMe]);

  /** Persist profile to server (PATCH) + locally (avatarId) */
  const updateProfile = useCallback(async (
    patch: Pick<UserProfile, 'display_name' | 'avatarId' | 'onboarding_done' | 'fitness_level' | 'training_goal'>
  ) => {
    setUser(prev => {
      if (!prev) return prev;
      // Save avatarId locally (not in DB)
      if (patch.avatarId !== undefined) saveLocalProfile(prev.user_id, { avatarId: patch.avatarId });
      if (patch.onboarding_done !== undefined) saveLocalProfile(prev.user_id, { onboarding_done: patch.onboarding_done });
      return { ...prev, ...patch };
    });

    // Sync server-side fields
    const userId = parseInt(localStorage.getItem('sl_user_id') ?? '0', 10);
    if (!userId) return;
    try {
      await fetch(`${API}/api/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          display_name: patch.display_name ?? undefined,
          fitness_level: patch.fitness_level ?? undefined,
          training_goal: patch.training_goal ?? undefined,
        }),
      });
    } catch (e) {
      console.warn('Nie udało się zapisać profilu na serwerze', e);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, isLoggedIn: !!user, login, logout, refreshUser, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};
