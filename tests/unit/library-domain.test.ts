import { describe, expect, it } from 'vitest';
import { DEFAULT_PUBLICATION_TYPE, normalizeLibraryName } from '../../src/domain/rpg/library-domain';

describe('normalização de domínio da Biblioteca (LIB-002)', () => {
  it('normaliza título/nome de forma estável para uso como índice de apoio', () => {
    expect(normalizeLibraryName('  Chamado de Cthulhu  ')).toBe('chamado de cthulhu');
    expect(normalizeLibraryName('Blue Rose')).toBe('blue rose');
    expect(normalizeLibraryName('Alien   RPG')).toBe('alien rpg');
  });

  it('é estável para o mesmo valor (idempotente)', () => {
    const value = normalizeLibraryName('Ryuutama');
    expect(normalizeLibraryName(value)).toBe(value);
  });

  it('usa CORE_RULEBOOK como fallback seguro para dado legado sem classificação', () => {
    expect(DEFAULT_PUBLICATION_TYPE).toBe('CORE_RULEBOOK');
  });
});
