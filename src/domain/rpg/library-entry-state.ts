// LIB-006: estado de uma User Library Entry em relação a uma Publication, do
// ponto de vista do usuário atual — ver docs/library/LIBRARY_ARCHIVE.md.
// Lógica pura (sem D1/Workers) usada tanto para decidir a resposta de
// CREATE/import (ALREADY_IN_LIBRARY vs ARCHIVED_IN_LIBRARY) quanto para
// enriquecer resultados de busca (search-external) com o estado da biblioteca
// do próprio usuário.
export type LibraryEntryState = 'NOT_IN_LIBRARY' | 'ACTIVE_IN_LIBRARY' | 'ARCHIVED_IN_LIBRARY';

// `archivedAt` vem direto da coluna `rpgs.archived_at` (TEXT nullable, ISO
// timestamp quando arquivado, NULL quando ativo) — nunca inferido de outro
// campo. `null`/`undefined` de entrada (nenhuma entry encontrada) classifica
// como NOT_IN_LIBRARY.
export function classifyLibraryEntryState(entry: { archivedAt: string | null } | null | undefined): LibraryEntryState {
  if (!entry) return 'NOT_IN_LIBRARY';
  return entry.archivedAt ? 'ARCHIVED_IN_LIBRARY' : 'ACTIVE_IN_LIBRARY';
}
