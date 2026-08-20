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

// Escopo de restore automatizado (ver docs/product/RPG_MANAGER_FINAL_STATUS.md, seção F-015;
// BATCH20 — pedido de finalização absoluta, reclassificou F-015 de DONE para IN_PROGRESS até
// o restore cobrir todo domínio persistente relevante, não só o export):
// Worlds, Vault entities (+ especializados), Creature Stat Templates, Journal, world_entity_links,
// Library (rpgs/publications/game_systems), Groups/GroupMembers, Campaigns/CampaignMembers/
// Sessions/Attendance, Sheet Templates/Character Sheets, Wiki (pastas/tags/aliases), Relations,
// Cartografia, External Resources, Timeline/Calendar, Adventures estruturadas, VTT (estado ao
// vivo sempre restaurado inativo — nunca "revive" uma sessão), Social (friendships/blocks/
// invites — só quando quem restaura é uma das partes reais) e Social Library Interest.
// Files/Handouts: metadata restaurada junto com os bytes reais via o BUNDLE separado
// (GET/POST /api/v1/files/backup — ver src/server/routes/files.ts, BATCH21/Seção 8 do pedido
// de finalização) — nunca embutido no JSON principal (bytes não cabem no armazenamento do job
// de preview/confirm em D1). Revision History e Notifications continuam cobertas pelo EXPORT
// (fonte arquival completa) mas NUNCA são reinjetadas como estado operacional pelo restore —
// fechamento semântico formal, Seção 24 do pedido de finalização:
//
// - Revision History (entity_revisions) -> categoria ARCHIVAL_HISTORY: repor o histórico
//   remapeando resource_id produziria uma linha do tempo FALSA (uma revisão antiga carimbada
//   num recurso que acabou de nascer no ambiente novo). Toda entidade/World/página restaurada
//   já ganha sua própria revisão CREATE honesta a partir do dia da restauração; o histórico do
//   ambiente original permanece só dentro do arquivo de backup (puramente arquival).
// - Notifications -> categoria EPHEMERAL_USER_ACTIVITY: o payload de toda notificação referencia
//   IDs do ambiente original que o restore sempre substitui — recriá-la geraria uma notificação
//   quebrada (link para um recurso que não existe sob o novo ID). Notificação é atividade
//   efêmera do usuário, não estado de domínio, e nunca é recriada pelo restore.
export interface BackupRestoreWarning {
  domain: string; oldId: string; message: string;
  // Categoria explícita do achado (Seção 6 do pedido de finalização) — quando ausente, o
  // achado é um SKIP simples (campo/relação descartada, resto do registro é restaurado).
  // ARCHIVAL_HISTORY/EPHEMERAL_USER_ACTIVITY (Seção 24): domínio inteiro é intencionalmente
  // nunca restaurado operacionalmente, por decisão semântica documentada acima — não uma lacuna.
  category?: 'SKIP' | 'CONFLICT' | 'EXTERNAL_DEPENDENCY' | 'MISSING_ASSET' | 'ARCHIVAL_HISTORY' | 'EPHEMERAL_USER_ACTIVITY';
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
  sheetTemplates: number;
  characterSheets: number;
  wikiFolders: number;
  wikiEntityMetadata: number;
  worldTags: number;
  wikiEntityTags: number;
  wikiEntityAliases: number;
  entityRelations: number;
  worldMaps: number;
  mapPins: number;
  externalResources: number;
  worldEras: number;
  worldCalendars: number;
  eventTemporalDetails: number;
  adventureScenes: number;
  adventureEncounters: number;
  adventureSceneEntities: number;
  adventureHandouts: number;
  vttScenes: number;
  vttTokens: number;
  vttFogCells: number;
  vttCombatants: number;
  friendRequests: number;
  friendships: number;
  userBlocks: number;
  socialInvites: number;
  rpgSocialInterests: number;
}
