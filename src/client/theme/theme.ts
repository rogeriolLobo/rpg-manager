export const THEME_STORAGE_KEY = 'rpg-manager-theme';
export const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

export const THEME_PREFERENCES = ['LIGHT', 'DARK', 'SYSTEM'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeMediaQuery {
  matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}
export function normalizeTheme(value: unknown): ThemePreference {
  return typeof value === 'string' && THEME_PREFERENCES.includes(value as ThemePreference)
    ? value as ThemePreference
    : 'SYSTEM';
}

export function resolveTheme(preference: ThemePreference, systemIsDark: boolean): ResolvedTheme {
  if (preference === 'DARK') return 'dark';
  if (preference === 'LIGHT') return 'light';
  return systemIsDark ? 'dark' : 'light';
}

export function readStoredTheme(storage: Pick<Storage, 'getItem'> = window.localStorage): ThemePreference {
  try {
    return normalizeTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'SYSTEM';
  }
}

export function persistTheme(
  preference: ThemePreference,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): boolean {
  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

export function systemPrefersDark(
  matchMedia: (query: string) => Pick<MediaQueryList, 'matches'> = window.matchMedia.bind(window),
): boolean {
  return matchMedia(SYSTEM_THEME_QUERY).matches;
}

export function observeSystemTheme(
  matchMedia: (query: string) => ThemeMediaQuery,
  onChange: (systemIsDark: boolean) => void,
): () => void {
  const mediaQuery = matchMedia(SYSTEM_THEME_QUERY);
  const handleChange = () => onChange(mediaQuery.matches);
  mediaQuery.addEventListener('change', handleChange);
  return () => mediaQuery.removeEventListener('change', handleChange);
}

export function applyTheme(preference: ThemePreference, systemIsDark: boolean): ResolvedTheme {
  const resolved = resolveTheme(preference, systemIsDark);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? '#160d0f' : '#f6efe3');
  return resolved;
}
