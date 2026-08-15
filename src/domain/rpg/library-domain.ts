// LIB-002: normalização do domínio da Biblioteca. Lógica pura (sem D1/Workers),
// compartilhada entre create/edit manual (src/server/routes/rpgs.ts) e import CSV
// (src/server/routes/transfer.ts) — ver docs/library/LIBRARY_ARCHITECTURE.md.

export const DEFAULT_PUBLICATION_TYPE = 'CORE_RULEBOOK';

// Mesmo normalizador usado para dedup de título no import (transfer.ts) — reexportado
// daqui para as duas camadas de escrita (manual e import) usarem exatamente a mesma
// regra ao popular `game_systems.normalized_name`.
export const normalizeLibraryName = (value: string): string =>
  value.trim().normalize('NFKC').replace(/\s+/gu, ' ').toLocaleLowerCase('pt-BR');
