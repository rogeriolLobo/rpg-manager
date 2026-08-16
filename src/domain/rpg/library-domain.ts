// LIB-002: normalização do domínio da Biblioteca. Lógica pura (sem D1/Workers),
// compartilhada entre create/edit manual (src/server/routes/rpgs.ts) e import CSV
// (src/server/routes/transfer.ts) — ver docs/library/LIBRARY_ARCHITECTURE.md.

export const DEFAULT_PUBLICATION_TYPE = 'CORE_RULEBOOK';

// Mesmos valores do CHECK de `publications.publication_type` (migration 0016).
// LIB-004: usado para validar o publicationType opcional vindo do formulário
// (manual ou preview de busca externa) — nunca inferido automaticamente a
// partir de um resultado de provider (seção 21 do pedido).
export const PUBLICATION_TYPES = [
  'CORE_RULEBOOK', 'PLAYER_GUIDE', 'GM_GUIDE', 'SUPPLEMENT', 'SETTING',
  'ADVENTURE', 'ONE_SHOT', 'CAMPAIGN', 'BESTIARY', 'SCREEN', 'OTHER',
] as const;

// Mesmo normalizador usado para dedup de título no import (transfer.ts) — reexportado
// daqui para as duas camadas de escrita (manual e import) usarem exatamente a mesma
// regra ao popular `game_systems.normalized_name`.
export const normalizeLibraryName = (value: string): string =>
  value.trim().normalize('NFKC').replace(/\s+/gu, ' ').toLocaleLowerCase('pt-BR');
