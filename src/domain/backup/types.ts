// F-015: Backup/Restore completo. Tipos puros do domínio de backup — nenhuma
// dependência de D1/Hono aqui (mesmo padrão de domain/content/revision.ts).
//
// SUPPORTED_SCHEMA_VERSION: a v1 do restore exige exatamente esta versão do
// export (ver GET /api/v1/export em transfer.ts). Um backup de uma versão
// anterior (ex.: v7, sem os domínios novos) precisa ser reexportado antes de
// poder ser restaurado — não há shim de compatibilidade retroativa nesta v1
// (decisão registrada, não omissão: um shim exigiria manter para sempre o
// mapeamento de todo schema antigo, custo real sem usuário afetado hoje).
export const SUPPORTED_BACKUP_SCHEMA_VERSION = 8;

// Escopo de restore automatizado da v1 (ver docs/product/RPG_MANAGER_FINAL_STATUS.md,
// seção F-015): Worlds, Vault entities (+ todos os campos especializados),
// Creature Stat Templates (dependência de Creature) e Journal (pastas+páginas).
// Groups/Campaigns/Library, Wiki (organização), Relations, Cartografia,
// External Resources, Timeline/Calendar e Revision History continuam
// cobertos pelo EXPORT (nenhum dado é perdido no backup), mas ainda não têm
// restore automatizado — documentado como limitação conhecida, não escondida.
export interface BackupRestoreWarning { domain: string; oldId: string; message: string }

export interface BackupRestorePreviewSummary {
  worlds: number;
  creatureStatTemplates: number;
  entities: number;
  journalFolders: number;
  journalPages: number;
}
