// F-015: Backup/Restore completo. Tipos puros do domínio de backup — nenhuma
// dependência de D1/Hono aqui (mesmo padrão de domain/content/revision.ts).
//
// SUPPORTED_SCHEMA_VERSION: a v1 do restore exige exatamente esta versão do
// export (ver GET /api/v1/export em transfer.ts). Um backup de uma versão
// anterior (ex.: v8, sem os domínios do BATCH19) precisa ser reexportado antes
// de poder ser restaurado — não há shim de compatibilidade retroativa nesta v1
// (decisão registrada, não omissão: um shim exigiria manter para sempre o
// mapeamento de todo schema antigo, custo real sem usuário afetado hoje).
export const SUPPORTED_BACKUP_SCHEMA_VERSION = 9;

// Escopo de restore automatizado (ver docs/product/RPG_MANAGER_FINAL_STATUS.md, seção F-015):
// Worlds, Vault entities (+ todos os campos especializados), Creature Stat Templates, Journal
// (pastas+páginas), world_entity_links (F-022), Library (rpgs/publications/game_systems, via a
// mesma camada canônica do create manual — library-writes.ts), Groups/GroupMembers, Campaigns/
// CampaignMembers/Sessions/Attendance (BATCH20 — reclassificado de export-only para restaurado,
// ver comentário no topo de backup-restore.ts).
// Wiki (organização), Relations, Cartografia, External Resources, Timeline/Calendar, Revision
// History, Social (F-016/018/019), Sheets (F-020/021), Adventures estruturadas (F-025),
// Files/Handouts metadata (F-028) e VTT (F-029/030/031/032) continuam cobertos pelo EXPORT
// (nenhum dado é perdido no backup), mas ainda não têm restore automatizado — documentado como
// limitação conhecida, não escondida.
export interface BackupRestoreWarning {
  domain: string; oldId: string; message: string;
  // Categoria explícita do achado (Seção 6 do pedido de finalização) — quando ausente, o
  // achado é um SKIP simples (campo/relação descartada, resto do registro é restaurado).
  category?: 'SKIP' | 'CONFLICT' | 'EXTERNAL_DEPENDENCY' | 'MISSING_ASSET';
}

export interface BackupRestorePreviewSummary {
  worlds: number;
  creatureStatTemplates: number;
  entities: number;
  journalFolders: number;
  journalPages: number;
  worldEntityLinks: number;
  library: number;
  groups: number;
  groupMembers: number;
  campaigns: number;
  campaignMembers: number;
  campaignSessions: number;
}
