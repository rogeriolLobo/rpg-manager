import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, patchJson } from '../api/client';
import { useAuth } from '../auth/auth-context';
import {
  applyTheme,
  normalizeTheme,
  observeSystemTheme,
  persistTheme,
  readStoredTheme,
  resolveTheme,
  systemPrefersDark,
  type ResolvedTheme,
  type ThemePreference,
} from './theme';

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  saving: boolean;
  setPreference: (preference: ThemePreference) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredTheme());
  const [systemIsDark, setSystemIsDark] = useState(() => systemPrefersDark());
  const [saving, setSaving] = useState(false);
  const preferenceVersion = useRef(0);

  useEffect(() => observeSystemTheme(window.matchMedia.bind(window), setSystemIsDark), []);
  useEffect(() => { applyTheme(preference, systemIsDark); }, [preference, systemIsDark]);

  useEffect(() => {
    if (!user) return;
    const requestVersion = preferenceVersion.current;
    let active = true;
    void api<{ theme: ThemePreference }>('/preferences')
      .then((result) => {
        if (!active || preferenceVersion.current !== requestVersion) return;
        const accountPreference = normalizeTheme(result.theme);
        persistTheme(accountPreference);
        setPreferenceState(accountPreference);
      })
      .catch(() => { /* A preferência visual local continua válida durante falhas transitórias. */ });
    return () => { active = false; };
  }, [user]);

  const setPreference = useCallback(async (nextPreference: ThemePreference) => {
    const previousPreference = preference;
    preferenceVersion.current += 1;
    persistTheme(nextPreference);
    setPreferenceState(nextPreference);
    if (!user) return;
    setSaving(true);
    try {
      await patchJson('/preferences', { theme: nextPreference });
    } catch (error) {
      persistTheme(previousPreference);
      setPreferenceState(previousPreference);
      throw error;
    } finally {
      setSaving(false);
    }
  }, [preference, user]);

  const value = useMemo<ThemeContextValue>(() => ({
    preference,
    resolvedTheme: resolveTheme(preference, systemIsDark),
    saving,
    setPreference,
  }), [preference, saving, setPreference, systemIsDark]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('ThemeProvider ausente');
  return value;
}
