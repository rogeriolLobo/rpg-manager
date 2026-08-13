import { describe, expect, it, vi } from 'vitest';
import {
  normalizeTheme,
  observeSystemTheme,
  persistTheme,
  readStoredTheme,
  resolveTheme,
  systemPrefersDark,
  THEME_STORAGE_KEY,
  type ThemeMediaQuery,
} from '../../src/client/theme/theme';

describe('tema visual', () => {
  it('normaliza LIGHT, DARK e SYSTEM e usa SYSTEM como fallback', () => {
    expect(normalizeTheme('LIGHT')).toBe('LIGHT');
    expect(normalizeTheme('DARK')).toBe('DARK');
    expect(normalizeTheme('SYSTEM')).toBe('SYSTEM');
    expect(normalizeTheme('sepia')).toBe('SYSTEM');
    expect(normalizeTheme(null)).toBe('SYSTEM');
  });

  it('resolve preferência explícita sem depender do sistema', () => {
    expect(resolveTheme('LIGHT', true)).toBe('light');
    expect(resolveTheme('DARK', false)).toBe('dark');
  });

  it('resolve SYSTEM para dark ou light conforme matchMedia', () => {
    expect(resolveTheme('SYSTEM', true)).toBe('dark');
    expect(resolveTheme('SYSTEM', false)).toBe('light');
    expect(systemPrefersDark(() => ({ matches: true }))).toBe(true);
    expect(systemPrefersDark(() => ({ matches: false }))).toBe(false);
  });

  it('lê, persiste e protege o fallback quando o storage falha', () => {
    expect(readStoredTheme({ getItem: () => 'DARK' })).toBe('DARK');
    expect(readStoredTheme({ getItem: () => 'inválido' })).toBe('SYSTEM');
    expect(readStoredTheme({ getItem: () => { throw new Error('bloqueado'); } })).toBe('SYSTEM');
    const setItem = vi.fn();
    expect(persistTheme('LIGHT', { setItem })).toBe(true);
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'LIGHT');
    expect(persistTheme('LIGHT', { setItem: () => { throw new Error('bloqueado'); } })).toBe(false);
  });

  it('acompanha mudanças do sistema e remove o listener', () => {
    let listener: (() => void) | undefined;
    const mediaQuery:ThemeMediaQuery = {
      matches:false,
      addEventListener:(_, nextListener) => { listener = nextListener; },
      removeEventListener:(_, nextListener) => { if (listener === nextListener) listener = undefined; },
    };
    const onChange = vi.fn();
    const stop = observeSystemTheme(() => mediaQuery, onChange);
    mediaQuery.matches = true;
    listener?.();
    expect(onChange).toHaveBeenCalledWith(true);
    stop();
    expect(listener).toBeUndefined();
  });
});
