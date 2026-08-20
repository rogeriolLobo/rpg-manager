// F-015: Backup/Restore completo — motor de restore com preview (dry-run) +
// confirm, mesmo padrão de import_jobs (preview/confirm com TTL) já usado
// pelo import de CSV em transfer.ts, mas numa tabela dedicada
// (`backup_restore_jobs`, migration 0026 — ver o porquê nesse arquivo).
//
// Decisão de arquitetura (documentada, não escondida — ver
// docs/product/RPG_MANAGER_FINAL_STATUS.md, seção F-015):
//
// 1) Restore SEMPRE cria registros NOVOS (IDs gerados no servidor), nunca
//    sobrescreve uma linha existente por ID. Isso elimina de raiz o vetor de
//    IDOR mais óbvio (um JSON manipulado tentando sobrescrever/assumir uma
//    linha de outro dono) e o risco de destruir dado real silenciosamente —
//    "detectar conflito" na prática é "nunca há conflito possível", porque
//    nada é sobrescrito. `owner_user_id`/`user_id` do usuário autenticado é
//    SEMPRE o valor gravado — o que vier no JSON enviado é sempre ignorado
//    para esse campo.
// 2) Escopo do restore automatizado (BATCH20 — F-015 reclassificado de DONE para IN_PROGRESS
//    até cobrir todo domínio persistente relevante, ver pedido de finalização): Worlds,
//    Creature Stat Templates, Vault entities (+ todos os campos especializados), Journal
//    (pastas e páginas), world_entity_links, Library (rpgs/publications/game_systems — sempre
//    via a mesma camada canônica de library-writes.ts), Groups/GroupMembers, Campaigns/
//    CampaignMembers/Sessions/Attendance. Wiki (organização), Relations, Cartografia, External
//    Resources, Timeline/Calendar, Revision History, Social, Sheets, Adventures estruturadas,
//    Files/Handouts (metadata) e VTT continuam cobertos pelo EXPORT — nada é perdido no backup
//    — mas ainda não têm restore automatizado. Ver FULL_ROADMAP.md.
// 3) Toda linha reconstruída é revalidada pelo MESMO schema Zod usado pelo
//    create normal (vaultEntityInputSchema/worldInputSchema/
//    journalPageInputSchema/creatureStatTemplateInputSchema) — nunca se
//    confia no shape do JSON enviado além do que esses schemas aceitam.
// 4) Referências cruzadas (World de uma entidade, pai de Location, pasta de
//    página, template de ficha de criatura) só são preservadas quando o
//    alvo também está sendo restaurado NA MESMA operação — uma referência
//    que aponta para algo fora do escopo do restore é removida (nunca causa
//    erro fatal), com um aviso explícito no preview.
import { Hono } from 'hono';
import { z } from 'zod';
import {
  adventureEncounterInputSchema, adventureHandoutInputSchema, adventureSceneEntityInputSchema, adventureSceneInputSchema,
  campaignInputSchema, characterSheetInputSchema, creatureStatTemplateInputSchema, entityRelationInputSchema, eventTemporalInputSchema, externalResourceInputSchema, journalFolderInputSchema, journalPageInputSchema,
  mapPinInputSchema, memberInputSchema, playGroupInputSchema, playGroupMemberCreateSchema, rpgInputSchema, sessionInputSchema, sheetTemplateInputSchema, wikiEntityOrganizationSchema, worldCalendarInputSchema, worldEraInputSchema, worldMapInputSchema, worldTagInputSchema,
  vaultEntityInputSchema, worldInputSchema,
  vttCombatantInputSchema, vttFogCellInputSchema, vttSceneInputSchema, vttTokenInputSchema,
  type AdventureEncounterInput, type AdventureHandoutInput, type AdventureSceneInput,
  type CampaignInput, type CreatureStatTemplateInput, type EntityRelationInput, type EventTemporalInput, type JournalPageInput, type RpgInput, type SheetTemplateInput, type VaultEntityInput, type VttCombatantInput, type VttFogCellInput, type VttSceneInput, type VttTokenInput, type WorldCalendarInput, type WorldEraInput, type WorldInput,
} from '../../shared/validation/schemas';
import { createWorldSlug } from '../../domain/content/validation';
import { normalizeEditorialLabel } from '../../domain/content/wiki';
import { SUPPORTED_BACKUP_SCHEMA_VERSION, type BackupRestoreWarning } from '../../domain/backup/types';
import { validateSheet } from '../../domain/sheets';
import { ApiError, cleanNullable, nowIso, readJson } from '../http';
import { hashSecret } from '../security/crypto';
import { recordRevisionStatement } from '../content/revisions';
import { specializedStatements } from './vault';
import { buildCreateLibraryEntryStatements } from './library-writes';
import { normalizeLabel } from './relations';
import { normalizeName } from './timeline';
import type { AppVariables, Env } from '../types';

export const backupRestoreRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Sem export type próprio em schemas.ts para estes três (Cartografia/External Resources) —
// inferidos aqui localmente a partir do mesmo schema Zod, nunca duplicados à mão.
type ExternalResourceInput = z.infer<typeof externalResourceInputSchema>;
type WorldMapInput = z.infer<typeof worldMapInputSchema>;
type MapPinInput = z.infer<typeof mapPinInputSchema>;

const previewSchema = z.strictObject({ backup: z.string().min(1).max(3_000_000) });
const confirmSchema = z.strictObject({ jobId: z.string().uuid() });

// ---- Acesso defensivo a campos de linhas cruas (o JSON enviado nunca é confiado além
// do que essas funções extraem — tipos errados viram valor vazio/nulo, nunca lançam). ----
type RawRow = Record<string, unknown>;
const str = (row: RawRow, key: string): string => (typeof row[key] === 'string' ? row[key] as string : '');
const strOrNull = (row: RawRow, key: string): string | null => { const v = row[key]; return typeof v === 'string' && v !== '' ? v : null; };
const num = (row: RawRow, key: string): number | null => (typeof row[key] === 'number' ? row[key] as number : null);
function rowsOf(data: RawRow, key: string): RawRow[] { return Array.isArray(data[key]) ? data[key] as RawRow[] : []; }
function byField(rows: RawRow[], field: string): Map<string, RawRow> { const map = new Map<string, RawRow>(); for (const row of rows) map.set(str(row, field), row); return map; }

interface WorldPlanItem { oldId: string; oldDefaultRpgId: string | null; input: WorldInput }
interface TemplatePlanItem { oldId: string; oldWorldId: string; input: CreatureStatTemplateInput }
interface EntityPlanItem { oldId: string; oldWorldId: string | null; oldParentEntityId: string | null; oldTemplateId: string | null; input: VaultEntityInput }
interface JournalFolderPlanItem { oldId: string; oldWorldId: string; oldParentFolderId: string | null; input: { name: string; parentFolderId: string | null } }
interface JournalPagePlanItem { oldId: string; oldWorldId: string; oldFolderId: string | null; input: JournalPageInput }
// F-022 (BATCH19): world_entity_links — extensão mais simples possível do escopo de restore
// v1: liga dois IDs já restaurados na MESMA operação (World + entidade), sem INSERT próprio de
// domínio nem parsing adicional. Adventures/Sheets/VTT/Social continuam export-only nesta v1
// (mesma fronteira já documentada para Groups/Campaigns desde o BATCH6 original — ver
// src/domain/backup/types.ts).
interface WorldEntityLinkPlanItem { oldWorldId: string; oldEntityId: string }
// BATCH20 (Seção 3/4 do pedido de finalização): Library/Groups/Campaigns — o restore v1
// deliberadamente deixava esses domínios export-only (ver histórico do comentário no topo do
// arquivo). Reclassificado: agora fazem parte do restore automatizado, na ordem de dependência
// Library -> Groups/GroupMembers -> Campaigns -> CampaignMembers -> Sessions/Attendance.
interface LibraryPlanItem { oldId: string; oldPlayGroupId: string | null; oldGameSystemId: string | null; input: RpgInput }
interface GroupPlanItem { oldId: string; input: { name: string; notes: string } }
interface GroupMemberPlanItem { oldId: string; oldGroupId: string; oldUserId: string | null; input: { playerName: string; notes: string; active: boolean; isGameMaster: boolean } }
interface CampaignPlanItem { oldId: string; oldRpgId: string; oldPlayGroupId: string | null; oldAdventureEntityId: string | null; input: CampaignInput }
interface CampaignMemberPlanItem {
  oldId: string; oldCampaignId: string; oldGroupMemberId: string | null; oldUserId: string | null;
  input: { playerName: string; characterName: string; notes: string; active: boolean; isGameMaster: boolean; characterEntityId: string | null };
}
interface CampaignSessionPlanItem {
  oldId: string; oldCampaignId: string; sessionNumber: number; oldAttendeeMemberIds: string[];
  input: { title: string; playedAt: string; summary: string; gmNotes: string; nextHooks: string };
}
// F-020/F-021/F-023: Sheet Templates + Character Sheets — mesmo padrão dos demais domínios
// (worldId/gameSystemId resolvidos por oldId contra os maps construídos NA MESMA operação).
interface SheetTemplatePlanItem { oldId: string; oldWorldId: string | null; oldGameSystemId: string | null; input: SheetTemplateInput }
interface CharacterSheetPlanItem { oldEntityId: string; oldTemplateId: string; values: Record<string, string | number | boolean> }
// Wiki (organização)/Relations — mesmo padrão: oldId cru viaja no plano, resolvido contra os
// maps já construídos NA MESMA operação no confirm; alvo fora de escopo -> SKIP, nunca erro fatal.
interface WikiFolderPlanItem { oldId: string; oldWorldId: string; oldParentFolderId: string | null; name: string }
interface WikiEntityMetadataPlanItem { oldEntityId: string; oldFolderId: string | null; sortOrder: number }
interface WorldTagPlanItem { oldId: string; oldWorldId: string; name: string }
interface WikiEntityTagPlanItem { oldEntityId: string; oldTagId: string }
interface WikiEntityAliasPlanItem { oldEntityId: string; alias: string }
interface EntityRelationPlanItem { oldId: string; oldWorldId: string; oldSourceEntityId: string; oldTargetEntityId: string; input: EntityRelationInput }
// Cartografia (F-002) / External Resources (F-003) / Timeline-Calendar (F-... world_eras etc.).
interface WorldMapPlanItem { oldId: string; oldWorldId: string; input: WorldMapInput }
interface MapPinPlanItem { oldId: string; oldMapId: string; oldEntityId: string | null; input: MapPinInput }
interface ExternalResourcePlanItem { oldId: string; oldWorldId: string; input: ExternalResourceInput }
interface WorldEraPlanItem { oldId: string; oldWorldId: string; input: WorldEraInput }
interface WorldCalendarPlanItem { oldWorldId: string; input: WorldCalendarInput }
interface EventTemporalPlanItem { oldEntityId: string; oldEraId: string | null; hasCalendarDate: boolean; input: EventTemporalInput }
// Adventures estruturadas (F-025): Scene -> Encounter/SceneEntity; Handout (adventure_entity_id
// + scene_id opcional + external_resource_id opcional).
interface AdventureScenePlanItem { oldId: string; oldAdventureEntityId: string; input: AdventureSceneInput }
interface AdventureEncounterPlanItem { oldId: string; oldSceneId: string; input: AdventureEncounterInput }
interface AdventureSceneEntityPlanItem { oldSceneId: string; oldEntityId: string; role: string }
interface AdventureHandoutPlanItem { oldId: string; oldAdventureEntityId: string; oldSceneId: string | null; oldExternalResourceId: string | null; input: AdventureHandoutInput }
// VTT (F-029/F-030/F-032) — precisa de Campaigns restauradas (campaignIdMap, construído perto
// do fim do confirm). Estado ao vivo (is_active, combat_active/combat_round, is_current_turn)
// NUNCA é restaurado como "retomado" — toda cena/combate volta sempre inativo (mesmo valor
// default do create normal), evitando as UNIQUE INDEX de "só 1 ativo por campanha/turno" e a
// semântica confusa de "reviver" uma sessão ao vivo a partir de um backup.
interface VttScenePlanItem { oldId: string; oldCampaignId: string; oldMapId: string | null; input: VttSceneInput }
interface VttTokenPlanItem { oldId: string; oldSceneId: string; oldEntityId: string | null; input: VttTokenInput }
interface VttFogCellPlanItem { oldSceneId: string; input: VttFogCellInput }
interface VttCombatantPlanItem { oldId: string; oldSceneId: string; oldTokenId: string | null; input: VttCombatantInput }
interface RestorePlan {
  worlds: WorldPlanItem[]; creatureStatTemplates: TemplatePlanItem[]; entities: EntityPlanItem[];
  journalFolders: JournalFolderPlanItem[]; journalPages: JournalPagePlanItem[]; worldEntityLinks: WorldEntityLinkPlanItem[];
  library: LibraryPlanItem[]; groups: GroupPlanItem[]; groupMembers: GroupMemberPlanItem[];
  campaigns: CampaignPlanItem[]; campaignMembers: CampaignMemberPlanItem[]; campaignSessions: CampaignSessionPlanItem[];
  sheetTemplates: SheetTemplatePlanItem[]; characterSheets: CharacterSheetPlanItem[];
  wikiFolders: WikiFolderPlanItem[]; wikiEntityMetadata: WikiEntityMetadataPlanItem[]; worldTags: WorldTagPlanItem[];
  wikiEntityTags: WikiEntityTagPlanItem[]; wikiEntityAliases: WikiEntityAliasPlanItem[]; entityRelations: EntityRelationPlanItem[];
  worldMaps: WorldMapPlanItem[]; mapPins: MapPinPlanItem[]; externalResources: ExternalResourcePlanItem[];
  worldEras: WorldEraPlanItem[]; worldCalendars: WorldCalendarPlanItem[]; eventTemporalDetails: EventTemporalPlanItem[];
  adventureScenes: AdventureScenePlanItem[]; adventureEncounters: AdventureEncounterPlanItem[];
  adventureSceneEntities: AdventureSceneEntityPlanItem[]; adventureHandouts: AdventureHandoutPlanItem[];
  vttScenes: VttScenePlanItem[]; vttTokens: VttTokenPlanItem[]; vttFogCells: VttFogCellPlanItem[]; vttCombatants: VttCombatantPlanItem[];
  warnings: BackupRestoreWarning[];
}
const restorePlanSchema = z.strictObject({
  worlds: z.array(z.strictObject({ oldId: z.string(), oldDefaultRpgId: z.string().nullable(), input: worldInputSchema })),
  creatureStatTemplates: z.array(z.strictObject({ oldId: z.string(), oldWorldId: z.string(), input: creatureStatTemplateInputSchema })),
  entities: z.array(z.strictObject({ oldId: z.string(), oldWorldId: z.string().nullable(), oldParentEntityId: z.string().nullable(), oldTemplateId: z.string().nullable(), input: vaultEntityInputSchema })),
  journalFolders: z.array(z.strictObject({ oldId: z.string(), oldWorldId: z.string(), oldParentFolderId: z.string().nullable(), input: journalFolderInputSchema })),
  journalPages: z.array(z.strictObject({ oldId: z.string(), oldWorldId: z.string(), oldFolderId: z.string().nullable(), input: journalPageInputSchema })),
  worldEntityLinks: z.array(z.strictObject({ oldWorldId: z.string(), oldEntityId: z.string() })),
  library: z.array(z.strictObject({ oldId: z.string(), oldPlayGroupId: z.string().nullable(), oldGameSystemId: z.string().nullable(), input: rpgInputSchema })),
  groups: z.array(z.strictObject({ oldId: z.string(), input: playGroupInputSchema })),
  groupMembers: z.array(z.strictObject({ oldId: z.string(), oldGroupId: z.string(), oldUserId: z.string().nullable(), input: playGroupMemberCreateSchema.omit({ userId: true }) })),
  campaigns: z.array(z.strictObject({ oldId: z.string(), oldRpgId: z.string(), oldPlayGroupId: z.string().nullable(), oldAdventureEntityId: z.string().nullable(), input: campaignInputSchema })),
  // isGameMaster não faz parte do memberInputSchema (a API normal nunca deixa o jogador se
  // autodeclarar GM — só o convite social aceito, ver social.ts) mas é um dado real persistido
  // em campaign_members que o restore precisa preservar; por isso estendido aqui.
  campaignMembers: z.array(z.strictObject({ oldId: z.string(), oldCampaignId: z.string(), oldGroupMemberId: z.string().nullable(), oldUserId: z.string().nullable(), input: memberInputSchema.extend({ isGameMaster: z.boolean() }) })),
  campaignSessions: z.array(z.strictObject({ oldId: z.string(), oldCampaignId: z.string(), sessionNumber: z.number().int().positive(), oldAttendeeMemberIds: z.array(z.string()), input: sessionInputSchema.omit({ attendeeMemberIds: true }) })),
  sheetTemplates: z.array(z.strictObject({ oldId: z.string(), oldWorldId: z.string().nullable(), oldGameSystemId: z.string().nullable(), input: sheetTemplateInputSchema })),
  characterSheets: z.array(z.strictObject({ oldEntityId: z.string(), oldTemplateId: z.string(), values: characterSheetInputSchema.shape.values })),
  wikiFolders: z.array(z.strictObject({ oldId: z.string(), oldWorldId: z.string(), oldParentFolderId: z.string().nullable(), name: journalFolderInputSchema.shape.name })),
  wikiEntityMetadata: z.array(z.strictObject({ oldEntityId: z.string(), oldFolderId: z.string().nullable(), sortOrder: z.number().int() })),
  worldTags: z.array(z.strictObject({ oldId: z.string(), oldWorldId: z.string(), name: worldTagInputSchema.shape.name })),
  wikiEntityTags: z.array(z.strictObject({ oldEntityId: z.string(), oldTagId: z.string() })),
  wikiEntityAliases: z.array(z.strictObject({ oldEntityId: z.string(), alias: wikiEntityOrganizationSchema.shape.aliases.element })),
  entityRelations: z.array(z.strictObject({ oldId: z.string(), oldWorldId: z.string(), oldSourceEntityId: z.string(), oldTargetEntityId: z.string(), input: entityRelationInputSchema })),
  worldMaps: z.array(z.strictObject({ oldId: z.string(), oldWorldId: z.string(), input: worldMapInputSchema })),
  mapPins: z.array(z.strictObject({ oldId: z.string(), oldMapId: z.string(), oldEntityId: z.string().nullable(), input: mapPinInputSchema })),
  externalResources: z.array(z.strictObject({ oldId: z.string(), oldWorldId: z.string(), input: externalResourceInputSchema })),
  worldEras: z.array(z.strictObject({ oldId: z.string(), oldWorldId: z.string(), input: worldEraInputSchema })),
  worldCalendars: z.array(z.strictObject({ oldWorldId: z.string(), input: worldCalendarInputSchema })),
  eventTemporalDetails: z.array(z.strictObject({ oldEntityId: z.string(), oldEraId: z.string().nullable(), hasCalendarDate: z.boolean(), input: eventTemporalInputSchema })),
  adventureScenes: z.array(z.strictObject({ oldId: z.string(), oldAdventureEntityId: z.string(), input: adventureSceneInputSchema })),
  adventureEncounters: z.array(z.strictObject({ oldId: z.string(), oldSceneId: z.string(), input: adventureEncounterInputSchema })),
  adventureSceneEntities: z.array(z.strictObject({ oldSceneId: z.string(), oldEntityId: z.string(), role: adventureSceneEntityInputSchema.shape.role })),
  adventureHandouts: z.array(z.strictObject({ oldId: z.string(), oldAdventureEntityId: z.string(), oldSceneId: z.string().nullable(), oldExternalResourceId: z.string().nullable(), input: adventureHandoutInputSchema })),
  vttScenes: z.array(z.strictObject({ oldId: z.string(), oldCampaignId: z.string(), oldMapId: z.string().nullable(), input: vttSceneInputSchema })),
  vttTokens: z.array(z.strictObject({ oldId: z.string(), oldSceneId: z.string(), oldEntityId: z.string().nullable(), input: vttTokenInputSchema })),
  vttFogCells: z.array(z.strictObject({ oldSceneId: z.string(), input: vttFogCellInputSchema })),
  vttCombatants: z.array(z.strictObject({ oldId: z.string(), oldSceneId: z.string(), oldTokenId: z.string().nullable(), input: vttCombatantInputSchema })),
  warnings: z.array(z.strictObject({ domain: z.string(), oldId: z.string(), message: z.string(), category: z.enum(['SKIP', 'CONFLICT', 'EXTERNAL_DEPENDENCY', 'MISSING_ASSET']).optional() })),
});

async function buildRestorePlan(env: Env, userId: string, root: RawRow): Promise<RestorePlan> {
  const data = (root.data ?? {}) as RawRow;
  const warnings: BackupRestoreWarning[] = [];

  // ---- Worlds ----
  const rawWorlds = rowsOf(data, 'worlds');
  if (rawWorlds.length > 200) throw new ApiError(422, 'BACKUP_TOO_LARGE', 'Este backup tem mais Worlds do que a v1 do restore suporta (200 por operação).');
  const rpgTitleByOldId = new Map(rowsOf(data, 'rpgs').map((row) => [str(row, 'id'), str(row, 'title')]));
  const currentRpgs = await env.DB.prepare('SELECT id,title FROM rpgs WHERE user_id=?').bind(userId).all<{ id: string; title: string }>();
  const rpgIdByTitle = new Map(currentRpgs.results.map((row) => [row.title.trim().toLowerCase(), row.id]));
  const worldOldIds = new Set(rawWorlds.map((row) => str(row, 'id')));
  const worlds: WorldPlanItem[] = [];
  for (const row of rawWorlds) {
    const oldId = str(row, 'id');
    const oldDefaultRpgId = strOrNull(row, 'default_rpg_id');
    const rpgTitle = oldDefaultRpgId ? rpgTitleByOldId.get(oldDefaultRpgId) : null;
    const resolvedRpgId = rpgTitle ? rpgIdByTitle.get(rpgTitle.trim().toLowerCase()) ?? null : null;
    if (oldDefaultRpgId && !resolvedRpgId) warnings.push({ domain: 'worlds', oldId, message: 'RPG padrão original não foi encontrado na Biblioteca atual — World será restaurado sem RPG padrão.' });
    const candidate = { name: str(row, 'name'), description: str(row, 'description'), defaultRpgId: resolvedRpgId, visibility: str(row, 'visibility') || 'PRIVATE' };
    const parsed = worldInputSchema.safeParse(candidate);
    if (!parsed.success) { warnings.push({ domain: 'worlds', oldId, message: 'World com dados inválidos após validação — não será restaurado.' }); continue; }
    // oldDefaultRpgId (bruto) viaja junto para o confirm poder preferir o RPG restaurado NESTA
    // MESMA operação (via rpgIdMap) sobre o match por título feito acima (que só enxerga RPGs
    // já existentes antes do restore começar — ver comentário em POST /import/backup/confirm).
    worlds.push({ oldId, oldDefaultRpgId, input: parsed.data });
  }

  // ---- Creature Stat Templates (precisa vir antes das entidades: creature.statBlock depende) ----
  const rawTemplates = rowsOf(data, 'creatureStatTemplates');
  const creatureStatTemplates: TemplatePlanItem[] = [];
  for (const row of rawTemplates) {
    const oldId = str(row, 'id'); const oldWorldId = str(row, 'world_id');
    if (!worldOldIds.has(oldWorldId)) { warnings.push({ domain: 'creatureStatTemplates', oldId, message: 'World original não pôde ser restaurado — modelo de ficha não será restaurado.' }); continue; }
    let fields: unknown;
    try { fields = JSON.parse(str(row, 'field_definitions') || '[]'); } catch { warnings.push({ domain: 'creatureStatTemplates', oldId, message: 'Definição de campos corrompida — modelo não será restaurado.' }); continue; }
    const parsed = creatureStatTemplateInputSchema.safeParse({ name: str(row, 'name'), description: str(row, 'description'), fields });
    if (!parsed.success) { warnings.push({ domain: 'creatureStatTemplates', oldId, message: 'Modelo de ficha com dados inválidos após validação — não será restaurado.' }); continue; }
    creatureStatTemplates.push({ oldId, oldWorldId, input: parsed.data });
  }
  const templateOldIds = new Set(creatureStatTemplates.map((item) => item.oldId));

  // ---- Vault entities ----
  const rawEntities = rowsOf(data, 'entities');
  if (rawEntities.length > 1000) throw new ApiError(422, 'BACKUP_TOO_LARGE', 'Este backup tem mais entidades do Vault do que a v1 do restore suporta (1000 por operação).');
  const entityOldIds = new Set(rawEntities.map((row) => str(row, 'id')));
  const adventureByEntity = byField(rowsOf(data, 'adventureDetails'), 'entity_id');
  const loreByEntity = byField(rowsOf(data, 'loreDetails'), 'entity_id');
  const characterByEntity = byField(rowsOf(data, 'characterDetails'), 'entity_id');
  const npcByEntity = byField(rowsOf(data, 'npcDetails'), 'entity_id');
  const creatureByEntity = byField(rowsOf(data, 'creatureDetails'), 'entity_id');
  const statBlockByEntity = byField(rowsOf(data, 'creatureStatBlocks'), 'entity_id');
  const factionByEntity = byField(rowsOf(data, 'factionDetails'), 'entity_id');
  const itemByEntity = byField(rowsOf(data, 'itemDetails'), 'entity_id');

  const distinctPlayerIds = [...new Set([...characterByEntity.values()].map((row) => strOrNull(row, 'player_user_id')).filter((id): id is string => Boolean(id)))];
  let validPlayerIds = new Set<string>();
  if (distinctPlayerIds.length) {
    const rows = await env.DB.prepare(`SELECT id FROM users WHERE id IN (${distinctPlayerIds.map(() => '?').join(',')}) AND disabled_at IS NULL AND deleted_at IS NULL`).bind(...distinctPlayerIds).all<{ id: string }>();
    validPlayerIds = new Set(rows.results.map((row) => row.id));
  }

  const entities: EntityPlanItem[] = [];
  for (const row of rawEntities) {
    const oldId = str(row, 'id');
    const entityType = str(row, 'entity_type');
    const oldWorldId = strOrNull(row, 'world_id');
    if (oldWorldId && !worldOldIds.has(oldWorldId)) warnings.push({ domain: 'entities', oldId, message: 'World original não pôde ser restaurado — entidade será restaurada sem World.' });
    const oldParentEntityId = strOrNull(row, 'parent_entity_id');
    if (oldParentEntityId && !entityOldIds.has(oldParentEntityId)) warnings.push({ domain: 'entities', oldId, message: 'Local pai original não está neste backup — relação de hierarquia não será restaurada.' });

    let adventure = null;
    if (entityType === 'ADVENTURE') { const d = adventureByEntity.get(oldId); if (d) adventure = { adventureType: str(d, 'adventure_type'), recommendedSessions: num(d, 'recommended_sessions'), notes: str(d, 'notes'), premise: str(d, 'premise'), hooks: str(d, 'hooks'), keyScenes: str(d, 'key_scenes'), rewards: str(d, 'rewards') }; }
    let lore = null; const loreRow = loreByEntity.get(oldId); if (loreRow) lore = { loreType: str(loreRow, 'lore_type'), canonStatus: str(loreRow, 'canon_status'), source: str(loreRow, 'source') };
    let character = null; const characterRow = characterByEntity.get(oldId);
    if (characterRow) {
      const playerId = strOrNull(characterRow, 'player_user_id'); const resolvedPlayerId = playerId && validPlayerIds.has(playerId) ? playerId : null;
      if (playerId && !resolvedPlayerId) warnings.push({ domain: 'entities', oldId, message: 'Conta de jogador vinculada não existe mais — restaurado sem jogador vinculado.' });
      character = { playerUserId: resolvedPlayerId, pronouns: str(characterRow, 'pronouns'), concept: str(characterRow, 'concept'), status: str(characterRow, 'status'), notes: str(characterRow, 'notes') };
    }
    let npc = null; const npcRow = npcByEntity.get(oldId); if (npcRow) npc = { role: str(npcRow, 'role'), occupation: str(npcRow, 'occupation'), motivation: str(npcRow, 'motivation'), publicNotes: str(npcRow, 'public_notes'), gmNotes: str(npcRow, 'gm_notes') };
    let creature = null; let oldTemplateId: string | null = null;
    const creatureRow = creatureByEntity.get(oldId);
    if (creatureRow) {
      let statBlock = null;
      const statBlockRow = statBlockByEntity.get(oldId);
      if (statBlockRow) {
        oldTemplateId = str(statBlockRow, 'template_id');
        if (templateOldIds.has(oldTemplateId)) { let values: unknown = {}; try { values = JSON.parse(str(statBlockRow, 'values_json') || '{}'); } catch { /* valores inválidos viram vazio */ } statBlock = { templateId: oldTemplateId, values }; }
        else { warnings.push({ domain: 'entities', oldId, message: 'Modelo de ficha de criatura não foi restaurado — ficha da criatura não será restaurada (demais dados continuam).' }); oldTemplateId = null; }
      }
      creature = { classification: str(creatureRow, 'classification'), habitat: str(creatureRow, 'habitat'), behavior: str(creatureRow, 'behavior'), dangerNotes: str(creatureRow, 'danger_notes'), statBlock };
    }
    let faction = null; const factionRow = factionByEntity.get(oldId); if (factionRow) faction = { purpose: str(factionRow, 'purpose'), scope: str(factionRow, 'scope'), status: str(factionRow, 'status'), publicDescription: str(factionRow, 'public_description'), gmNotes: str(factionRow, 'gm_notes') };
    let item = null; const itemRow = itemByEntity.get(oldId); if (itemRow) item = { itemType: str(itemRow, 'item_type'), rarity: str(itemRow, 'rarity'), publicDescription: str(itemRow, 'public_description'), gmNotes: str(itemRow, 'gm_notes') };

    const resolvedOldWorldId = oldWorldId && worldOldIds.has(oldWorldId) ? oldWorldId : null;
    const resolvedOldParentEntityId = oldParentEntityId && entityOldIds.has(oldParentEntityId) ? oldParentEntityId : null;
    const candidate = { entityType, name: str(row, 'name'), summary: str(row, 'summary'), description: str(row, 'description'), visibility: str(row, 'visibility') || 'PRIVATE', worldId: null, groupId: null, parentEntityId: null, adventure, lore, character, npc, creature, faction, item };
    const parsed = vaultEntityInputSchema.safeParse(candidate);
    if (!parsed.success) { warnings.push({ domain: 'entities', oldId, message: 'Entidade com dados inválidos após validação — não será restaurada.' }); continue; }
    entities.push({ oldId, oldWorldId: resolvedOldWorldId, oldParentEntityId: resolvedOldParentEntityId, oldTemplateId, input: parsed.data });
  }

  // ---- Journal ----
  const rawFolders = rowsOf(data, 'journalFolders');
  const folderOldIds = new Set(rawFolders.map((row) => str(row, 'id')));
  const journalFolders: JournalFolderPlanItem[] = [];
  for (const row of rawFolders) {
    const oldId = str(row, 'id'); const oldWorldId = str(row, 'world_id');
    if (!worldOldIds.has(oldWorldId)) { warnings.push({ domain: 'journalFolders', oldId, message: 'World original não pôde ser restaurado — pasta do Diário não será restaurada.' }); continue; }
    const oldParentFolderId = strOrNull(row, 'parent_folder_id');
    const parsed = journalFolderInputSchema.safeParse({ name: str(row, 'name'), parentFolderId: null });
    if (!parsed.success) { warnings.push({ domain: 'journalFolders', oldId, message: 'Pasta com dados inválidos após validação — não será restaurada.' }); continue; }
    journalFolders.push({ oldId, oldWorldId, oldParentFolderId: oldParentFolderId && folderOldIds.has(oldParentFolderId) ? oldParentFolderId : null, input: parsed.data });
  }
  const rawPages = rowsOf(data, 'journalPages');
  if (rawPages.length > 1000) throw new ApiError(422, 'BACKUP_TOO_LARGE', 'Este backup tem mais páginas de Diário do que a v1 do restore suporta (1000 por operação).');
  const journalPages: JournalPagePlanItem[] = [];
  for (const row of rawPages) {
    const oldId = str(row, 'id'); const oldWorldId = str(row, 'world_id');
    if (!worldOldIds.has(oldWorldId)) { warnings.push({ domain: 'journalPages', oldId, message: 'World original não pôde ser restaurado — página do Diário não será restaurada.' }); continue; }
    const oldFolderId = strOrNull(row, 'folder_id');
    const parsed = journalPageInputSchema.safeParse({ title: str(row, 'title'), content: str(row, 'content'), folderId: null });
    if (!parsed.success) { warnings.push({ domain: 'journalPages', oldId, message: 'Página com dados inválidos após validação — não será restaurada.' }); continue; }
    journalPages.push({ oldId, oldWorldId, oldFolderId: oldFolderId && folderOldIds.has(oldFolderId) ? oldFolderId : null, input: parsed.data });
  }

  // ---- world_entity_links (F-022) — só restaura o vínculo se AMBOS World e entidade também
  // estiverem sendo restaurados nesta mesma operação (mesma invariante de origem: o LINK só
  // existe quando entidade e World têm o mesmo dono — ver POST /vault/:id/links). ----
  const rawWorldEntityLinks = rowsOf(data, 'worldEntityLinks');
  const worldEntityLinks: WorldEntityLinkPlanItem[] = [];
  for (const row of rawWorldEntityLinks) {
    const oldWorldId = str(row, 'world_id'); const oldEntityId = str(row, 'entity_id');
    if (!worldOldIds.has(oldWorldId) || !entityOldIds.has(oldEntityId)) { warnings.push({ domain: 'worldEntityLinks', oldId: `${oldWorldId}:${oldEntityId}`, message: 'World ou entidade original não pôde ser restaurado — vínculo entre Worlds não será restaurado.' }); continue; }
    worldEntityLinks.push({ oldWorldId, oldEntityId });
  }

  // ---- Sheet Templates (F-020/F-021/F-023) — worldId/gameSystemId só preservados quando o
  // alvo também está sendo restaurado NA MESMA operação (mesma invariante do arquivo). ----
  const rawSheetTemplates = rowsOf(data, 'sheetTemplates');
  if (rawSheetTemplates.length > 300) throw new ApiError(422, 'BACKUP_TOO_LARGE', 'Este backup tem mais Modelos de Ficha do que a v1 do restore suporta (300 por operação).');
  const sheetTemplates: SheetTemplatePlanItem[] = [];
  for (const row of rawSheetTemplates) {
    const oldId = str(row, 'id');
    const oldWorldId = strOrNull(row, 'world_id');
    if (oldWorldId && !worldOldIds.has(oldWorldId)) warnings.push({ domain: 'sheetTemplates', oldId, message: 'World original não pôde ser restaurado — modelo será restaurado sem World.', category: 'SKIP' });
    const oldGameSystemId = strOrNull(row, 'game_system_id');
    let fields: unknown; let pdfMapping: unknown;
    try { fields = JSON.parse(str(row, 'field_definitions') || '[]'); } catch { warnings.push({ domain: 'sheetTemplates', oldId, message: 'Definição de campos corrompida — modelo não será restaurado.', category: 'SKIP' }); continue; }
    try { pdfMapping = JSON.parse(str(row, 'pdf_mapping_json') || '{}'); } catch { pdfMapping = {}; }
    const candidate = { name: str(row, 'name'), description: str(row, 'description'), worldId: null, gameSystemId: null, fields, pdfUrl: strOrNull(row, 'pdf_url'), pdfMapping };
    const parsed = sheetTemplateInputSchema.safeParse(candidate);
    if (!parsed.success) { warnings.push({ domain: 'sheetTemplates', oldId, message: 'Modelo de ficha com dados inválidos após validação — não será restaurado.', category: 'SKIP' }); continue; }
    sheetTemplates.push({ oldId, oldWorldId: oldWorldId && worldOldIds.has(oldWorldId) ? oldWorldId : null, oldGameSystemId, input: parsed.data });
  }
  const sheetTemplateOldIds = new Set(sheetTemplates.map((item) => item.oldId));

  // ---- Character Sheets — depende de uma entidade E de um modelo restaurados nesta mesma
  // operação; sem os dois, a ficha inteira é descartada (a linha vive PK=entity_id). ----
  const rawCharacterSheets = rowsOf(data, 'characterSheets');
  const characterSheets: CharacterSheetPlanItem[] = [];
  for (const row of rawCharacterSheets) {
    const oldEntityId = str(row, 'entity_id'); const oldTemplateId = str(row, 'template_id');
    if (!entityOldIds.has(oldEntityId)) { warnings.push({ domain: 'characterSheets', oldId: oldEntityId, message: 'Entidade original não pôde ser restaurada — ficha não será restaurada.', category: 'SKIP' }); continue; }
    if (!sheetTemplateOldIds.has(oldTemplateId)) { warnings.push({ domain: 'characterSheets', oldId: oldEntityId, message: 'Modelo de ficha original não pôde ser restaurado — ficha não será restaurada.', category: 'SKIP' }); continue; }
    let values: unknown;
    try { values = JSON.parse(str(row, 'values_json') || '{}'); } catch { warnings.push({ domain: 'characterSheets', oldId: oldEntityId, message: 'Valores da ficha corrompidos — ficha não será restaurada.', category: 'SKIP' }); continue; }
    const parsed = characterSheetInputSchema.shape.values.safeParse(values);
    if (!parsed.success) { warnings.push({ domain: 'characterSheets', oldId: oldEntityId, message: 'Valores da ficha com dados inválidos após validação — ficha não será restaurada.', category: 'SKIP' }); continue; }
    characterSheets.push({ oldEntityId, oldTemplateId, values: parsed.data });
  }

  // ---- Wiki (organização): pastas (2 passagens para parent_folder_id, mesmo padrão de
  // Journal), metadata por entidade (pasta+ordenação), tags de World e aliases por entidade. ----
  const rawWikiFolders = rowsOf(data, 'wikiFolders');
  const wikiFolders: WikiFolderPlanItem[] = [];
  const wikiFolderOldIds = new Set(rawWikiFolders.map((row) => str(row, 'id')));
  for (const row of rawWikiFolders) {
    const oldId = str(row, 'id'); const oldWorldId = str(row, 'world_id');
    if (!worldOldIds.has(oldWorldId)) { warnings.push({ domain: 'wikiFolders', oldId, message: 'World original não pôde ser restaurado — pasta da Wiki não será restaurada.', category: 'SKIP' }); continue; }
    const name = str(row, 'name');
    if (!name.trim() || name.length > 120) { warnings.push({ domain: 'wikiFolders', oldId, message: 'Pasta com dados inválidos após validação — não será restaurada.', category: 'SKIP' }); continue; }
    const oldParentFolderId = strOrNull(row, 'parent_folder_id');
    wikiFolders.push({ oldId, oldWorldId, oldParentFolderId: oldParentFolderId && wikiFolderOldIds.has(oldParentFolderId) ? oldParentFolderId : null, name });
  }
  const restorableWikiFolderOldIds = new Set(wikiFolders.map((item) => item.oldId));

  const wikiEntityMetadata: WikiEntityMetadataPlanItem[] = [];
  for (const row of rowsOf(data, 'wikiEntityMetadata')) {
    const oldEntityId = str(row, 'entity_id');
    if (!entityOldIds.has(oldEntityId)) continue;
    const oldFolderId = strOrNull(row, 'folder_id');
    wikiEntityMetadata.push({ oldEntityId, oldFolderId: oldFolderId && restorableWikiFolderOldIds.has(oldFolderId) ? oldFolderId : null, sortOrder: num(row, 'sort_order') ?? 0 });
  }

  const rawWorldTags = rowsOf(data, 'worldTags');
  const worldTags: WorldTagPlanItem[] = [];
  for (const row of rawWorldTags) {
    const oldId = str(row, 'id'); const oldWorldId = str(row, 'world_id');
    if (!worldOldIds.has(oldWorldId)) { warnings.push({ domain: 'worldTags', oldId, message: 'World original não pôde ser restaurado — tag não será restaurada.', category: 'SKIP' }); continue; }
    const name = str(row, 'name');
    if (!name.trim() || name.length > 60) { warnings.push({ domain: 'worldTags', oldId, message: 'Tag com dados inválidos após validação — não será restaurada.', category: 'SKIP' }); continue; }
    worldTags.push({ oldId, oldWorldId, name });
  }
  const restorableWorldTagOldIds = new Set(worldTags.map((item) => item.oldId));

  const wikiEntityTags: WikiEntityTagPlanItem[] = [];
  for (const row of rowsOf(data, 'wikiEntityTags')) {
    const oldEntityId = str(row, 'entity_id'); const oldTagId = str(row, 'tag_id');
    if (!entityOldIds.has(oldEntityId) || !restorableWorldTagOldIds.has(oldTagId)) continue;
    wikiEntityTags.push({ oldEntityId, oldTagId });
  }

  const wikiEntityAliases: WikiEntityAliasPlanItem[] = [];
  for (const row of rowsOf(data, 'wikiEntityAliases')) {
    const oldEntityId = str(row, 'entity_id');
    if (!entityOldIds.has(oldEntityId)) continue;
    const alias = str(row, 'alias');
    if (!alias.trim() || alias.length > 160) continue;
    wikiEntityAliases.push({ oldEntityId, alias });
  }

  // ---- Relations (F-... entity_relations) — precisa de World + as duas entidades (source e
  // target) restauradas nesta mesma operação. ----
  const rawRelations = rowsOf(data, 'entityRelations');
  if (rawRelations.length > 3000) throw new ApiError(422, 'BACKUP_TOO_LARGE', 'Este backup tem mais Relações do que a v1 do restore suporta (3000 por operação).');
  const entityRelations: EntityRelationPlanItem[] = [];
  for (const row of rawRelations) {
    const oldId = str(row, 'id'); const oldWorldId = str(row, 'world_id');
    const oldSourceEntityId = str(row, 'source_entity_id'); const oldTargetEntityId = str(row, 'target_entity_id');
    if (!worldOldIds.has(oldWorldId)) { warnings.push({ domain: 'entityRelations', oldId, message: 'World original não pôde ser restaurado — relação não será restaurada.', category: 'SKIP' }); continue; }
    if (!entityOldIds.has(oldSourceEntityId) || !entityOldIds.has(oldTargetEntityId)) { warnings.push({ domain: 'entityRelations', oldId, message: 'Uma das entidades da relação não pôde ser restaurada — relação não será restaurada.', category: 'SKIP' }); continue; }
    const candidate = { sourceEntityId: oldSourceEntityId, targetEntityId: oldTargetEntityId, relationType: str(row, 'relation_type'), label: str(row, 'label'), description: str(row, 'description'), direction: str(row, 'direction'), visibility: str(row, 'visibility') || 'PRIVATE', strength: num(row, 'strength') };
    const parsed = entityRelationInputSchema.safeParse(candidate);
    if (!parsed.success) { warnings.push({ domain: 'entityRelations', oldId, message: 'Relação com dados inválidos após validação — não será restaurada.', category: 'SKIP' }); continue; }
    entityRelations.push({ oldId, oldWorldId, oldSourceEntityId, oldTargetEntityId, input: parsed.data });
  }

  // ---- Cartografia (F-002): mapas (imagem sempre URL externa, mesma política de coverUrl) +
  // pins (entityId opcional). ----
  const rawWorldMaps = rowsOf(data, 'worldMaps');
  const worldMaps: WorldMapPlanItem[] = [];
  for (const row of rawWorldMaps) {
    const oldId = str(row, 'id'); const oldWorldId = str(row, 'world_id');
    if (!worldOldIds.has(oldWorldId)) { warnings.push({ domain: 'worldMaps', oldId, message: 'World original não pôde ser restaurado — mapa não será restaurado.', category: 'SKIP' }); continue; }
    const parsed = worldMapInputSchema.safeParse({ title: str(row, 'title'), imageUrl: str(row, 'image_url'), notes: str(row, 'notes') });
    if (!parsed.success) { warnings.push({ domain: 'worldMaps', oldId, message: 'Mapa com dados inválidos após validação — não será restaurado.', category: 'SKIP' }); continue; }
    worldMaps.push({ oldId, oldWorldId, input: parsed.data });
  }
  const worldMapOldIds = new Set(worldMaps.map((item) => item.oldId));

  const rawMapPins = rowsOf(data, 'mapPins');
  const mapPins: MapPinPlanItem[] = [];
  for (const row of rawMapPins) {
    const oldId = str(row, 'id'); const oldMapId = str(row, 'map_id');
    if (!worldMapOldIds.has(oldMapId)) { warnings.push({ domain: 'mapPins', oldId, message: 'Mapa original não pôde ser restaurado — pin não será restaurado.', category: 'SKIP' }); continue; }
    const oldEntityId = strOrNull(row, 'entity_id');
    if (oldEntityId && !entityOldIds.has(oldEntityId)) warnings.push({ domain: 'mapPins', oldId, message: 'Entidade original não está neste backup — pin será restaurado sem entidade vinculada.', category: 'SKIP' });
    const parsed = mapPinInputSchema.safeParse({ label: str(row, 'label'), notes: str(row, 'notes'), x: num(row, 'x'), y: num(row, 'y'), entityId: null });
    if (!parsed.success) { warnings.push({ domain: 'mapPins', oldId, message: 'Pin com dados inválidos após validação — não será restaurado.', category: 'SKIP' }); continue; }
    mapPins.push({ oldId, oldMapId, oldEntityId: oldEntityId && entityOldIds.has(oldEntityId) ? oldEntityId : null, input: parsed.data });
  }

  // ---- External Resources (F-003) ----
  const rawExternalResources = rowsOf(data, 'externalResources');
  const externalResources: ExternalResourcePlanItem[] = [];
  for (const row of rawExternalResources) {
    const oldId = str(row, 'id'); const oldWorldId = str(row, 'world_id');
    if (!worldOldIds.has(oldWorldId)) { warnings.push({ domain: 'externalResources', oldId, message: 'World original não pôde ser restaurado — recurso externo não será restaurado.', category: 'SKIP' }); continue; }
    const parsed = externalResourceInputSchema.safeParse({ title: str(row, 'title'), url: str(row, 'url'), description: str(row, 'description'), resourceType: str(row, 'resource_type') });
    if (!parsed.success) { warnings.push({ domain: 'externalResources', oldId, message: 'Recurso externo com dados inválidos após validação — não será restaurado.', category: 'SKIP' }); continue; }
    externalResources.push({ oldId, oldWorldId, input: parsed.data });
  }
  const externalResourceOldIds = new Set(externalResources.map((item) => item.oldId));

  // ---- Timeline/Calendar: Eras -> Calendar (1 por World) -> Event temporal details (Events). ----
  const rawEras = rowsOf(data, 'worldEras');
  const worldEras: WorldEraPlanItem[] = [];
  for (const row of rawEras) {
    const oldId = str(row, 'id'); const oldWorldId = str(row, 'world_id');
    if (!worldOldIds.has(oldWorldId)) { warnings.push({ domain: 'worldEras', oldId, message: 'World original não pôde ser restaurado — era não será restaurada.', category: 'SKIP' }); continue; }
    if (strOrNull(row, 'archived_at')) continue; // arquivadas não fazem parte do escopo v1 do restore (mesma linha de raciocínio de rpgs.archived_at — export preserva, restore v1 só o ativo)
    const parsed = worldEraInputSchema.safeParse({ name: str(row, 'name'), description: str(row, 'description'), sortOrder: num(row, 'sort_order') ?? 0 });
    if (!parsed.success) { warnings.push({ domain: 'worldEras', oldId, message: 'Era com dados inválidos após validação — não será restaurada.', category: 'SKIP' }); continue; }
    worldEras.push({ oldId, oldWorldId, input: parsed.data });
  }
  const worldEraOldIds = new Set(worldEras.map((item) => item.oldId));

  const rawCalendars = rowsOf(data, 'worldCalendars');
  const worldCalendars: WorldCalendarPlanItem[] = [];
  for (const row of rawCalendars) {
    const oldWorldId = str(row, 'world_id');
    if (!worldOldIds.has(oldWorldId)) continue;
    let months: unknown; let weekdays: unknown; let cycles: unknown; let holidays: unknown;
    try { months = JSON.parse(str(row, 'months_json') || '[]'); weekdays = JSON.parse(str(row, 'weekdays_json') || '[]'); cycles = JSON.parse(str(row, 'cycles_json') || '[]'); holidays = JSON.parse(str(row, 'holidays_json') || '[]'); }
    catch { warnings.push({ domain: 'worldCalendars', oldId: oldWorldId, message: 'Calendário corrompido — não será restaurado.', category: 'SKIP' }); continue; }
    const parsed = worldCalendarInputSchema.safeParse({ name: str(row, 'name'), months, weekdays, cycles, holidays });
    if (!parsed.success) { warnings.push({ domain: 'worldCalendars', oldId: oldWorldId, message: 'Calendário com dados inválidos após validação — não será restaurado.', category: 'SKIP' }); continue; }
    worldCalendars.push({ oldWorldId, input: parsed.data });
  }
  const worldCalendarOldWorldIds = new Set(worldCalendars.map((item) => item.oldWorldId));

  const eventTemporalDetails: EventTemporalPlanItem[] = [];
  for (const row of rowsOf(data, 'eventTemporalDetails')) {
    const oldEntityId = str(row, 'entity_id');
    if (!entityOldIds.has(oldEntityId)) continue;
    const oldEraId = strOrNull(row, 'era_id');
    if (oldEraId && !worldEraOldIds.has(oldEraId)) warnings.push({ domain: 'eventTemporalDetails', oldId: oldEntityId, message: 'Era original não está neste backup — evento será restaurado sem era.', category: 'SKIP' });
    const oldCalendarId = strOrNull(row, 'calendar_id');
    let hasCalendarDate = Boolean(oldCalendarId) && num(row, 'calendar_year') !== null && num(row, 'calendar_month_index') !== null && num(row, 'calendar_day') !== null;
    if (hasCalendarDate) {
      const oldWorldId = entities.find((entity) => entity.oldId === oldEntityId)?.oldWorldId;
      if (!oldWorldId || !worldCalendarOldWorldIds.has(oldWorldId)) { warnings.push({ domain: 'eventTemporalDetails', oldId: oldEntityId, message: 'Calendário original não pôde ser restaurado — evento será restaurado sem data de calendário.', category: 'SKIP' }); hasCalendarDate = false; }
    }
    const candidate = {
      historicalDate: str(row, 'historical_date'), sortKey: num(row, 'sort_key'), eraId: null, precision: str(row, 'precision') || 'UNKNOWN',
      calendarDate: hasCalendarDate ? { year: num(row, 'calendar_year')!, monthIndex: num(row, 'calendar_month_index')!, day: num(row, 'calendar_day')! } : null,
      displayText: str(row, 'display_text'),
    };
    const parsed = eventTemporalInputSchema.safeParse(candidate);
    if (!parsed.success) { warnings.push({ domain: 'eventTemporalDetails', oldId: oldEntityId, message: 'Evento com data histórica inválida após validação — data não será restaurada.', category: 'SKIP' }); continue; }
    eventTemporalDetails.push({ oldEntityId, oldEraId: oldEraId && worldEraOldIds.has(oldEraId) ? oldEraId : null, hasCalendarDate, input: parsed.data });
  }

  // ---- Adventures estruturadas (F-025): Scene -> Encounter/SceneEntity; Handout. ----
  const rawScenes = rowsOf(data, 'adventureScenes');
  const adventureScenes: AdventureScenePlanItem[] = [];
  for (const row of rawScenes) {
    const oldId = str(row, 'id'); const oldAdventureEntityId = str(row, 'adventure_entity_id');
    if (!entityOldIds.has(oldAdventureEntityId)) { warnings.push({ domain: 'adventureScenes', oldId, message: 'Adventure original não pôde ser restaurada — cena não será restaurada.', category: 'SKIP' }); continue; }
    const parsed = adventureSceneInputSchema.safeParse({ act: str(row, 'act'), title: str(row, 'title'), summary: str(row, 'summary'), readAloud: str(row, 'read_aloud'), gmNotes: str(row, 'gm_notes'), completed: Boolean(strOrNull(row, 'completed_at')), sortOrder: num(row, 'sort_order') ?? 0 });
    if (!parsed.success) { warnings.push({ domain: 'adventureScenes', oldId, message: 'Cena com dados inválidos após validação — não será restaurada.', category: 'SKIP' }); continue; }
    adventureScenes.push({ oldId, oldAdventureEntityId, input: parsed.data });
  }
  const adventureSceneOldIds = new Set(adventureScenes.map((item) => item.oldId));

  const rawEncounters = rowsOf(data, 'adventureEncounters');
  const adventureEncounters: AdventureEncounterPlanItem[] = [];
  for (const row of rawEncounters) {
    const oldId = str(row, 'id'); const oldSceneId = str(row, 'scene_id');
    if (!adventureSceneOldIds.has(oldSceneId)) { warnings.push({ domain: 'adventureEncounters', oldId, message: 'Cena original não pôde ser restaurada — encontro não será restaurado.', category: 'SKIP' }); continue; }
    const parsed = adventureEncounterInputSchema.safeParse({ name: str(row, 'name'), difficulty: str(row, 'difficulty'), description: str(row, 'description'), gmNotes: str(row, 'gm_notes'), sortOrder: num(row, 'sort_order') ?? 0 });
    if (!parsed.success) { warnings.push({ domain: 'adventureEncounters', oldId, message: 'Encontro com dados inválidos após validação — não será restaurado.', category: 'SKIP' }); continue; }
    adventureEncounters.push({ oldId, oldSceneId, input: parsed.data });
  }

  const adventureSceneEntities: AdventureSceneEntityPlanItem[] = [];
  for (const row of rowsOf(data, 'adventureSceneEntities')) {
    const oldSceneId = str(row, 'scene_id'); const oldEntityId = str(row, 'entity_id');
    if (!adventureSceneOldIds.has(oldSceneId) || !entityOldIds.has(oldEntityId)) continue;
    adventureSceneEntities.push({ oldSceneId, oldEntityId, role: str(row, 'role') });
  }

  const rawHandouts = rowsOf(data, 'adventureHandouts');
  const adventureHandouts: AdventureHandoutPlanItem[] = [];
  for (const row of rawHandouts) {
    const oldId = str(row, 'id'); const oldAdventureEntityId = str(row, 'adventure_entity_id');
    if (!entityOldIds.has(oldAdventureEntityId)) { warnings.push({ domain: 'adventureHandouts', oldId, message: 'Adventure original não pôde ser restaurada — handout não será restaurado.', category: 'SKIP' }); continue; }
    const oldSceneId = strOrNull(row, 'scene_id');
    if (oldSceneId && !adventureSceneOldIds.has(oldSceneId)) warnings.push({ domain: 'adventureHandouts', oldId, message: 'Cena original não está neste backup — handout será restaurado sem cena vinculada.', category: 'SKIP' });
    const oldExternalResourceId = strOrNull(row, 'external_resource_id');
    if (oldExternalResourceId && !externalResourceOldIds.has(oldExternalResourceId)) warnings.push({ domain: 'adventureHandouts', oldId, message: 'Recurso externo original não está neste backup — handout será restaurado sem recurso vinculado.', category: 'SKIP' });
    const parsed = adventureHandoutInputSchema.safeParse({ title: str(row, 'title'), content: str(row, 'content'), sceneId: null, externalResourceId: null, revealed: Boolean(strOrNull(row, 'revealed_at')), sortOrder: num(row, 'sort_order') ?? 0 });
    if (!parsed.success) { warnings.push({ domain: 'adventureHandouts', oldId, message: 'Handout com dados inválidos após validação — não será restaurado.', category: 'SKIP' }); continue; }
    adventureHandouts.push({ oldId, oldAdventureEntityId, oldSceneId: oldSceneId && adventureSceneOldIds.has(oldSceneId) ? oldSceneId : null, oldExternalResourceId: oldExternalResourceId && externalResourceOldIds.has(oldExternalResourceId) ? oldExternalResourceId : null, input: parsed.data });
  }

  // ---- Groups (precisa vir antes de Library/Campaigns: ambos podem referenciar um Group) ----
  const rawGroups = rowsOf(data, 'groups');
  if (rawGroups.length > 200) throw new ApiError(422, 'BACKUP_TOO_LARGE', 'Este backup tem mais Grupos do que a v1 do restore suporta (200 por operação).');
  const groups: GroupPlanItem[] = [];
  for (const row of rawGroups) {
    const oldId = str(row, 'id');
    const parsed = playGroupInputSchema.safeParse({ name: str(row, 'name'), notes: str(row, 'notes') });
    if (!parsed.success) { warnings.push({ domain: 'groups', oldId, message: 'Grupo com dados inválidos após validação — não será restaurado.', category: 'SKIP' }); continue; }
    groups.push({ oldId, input: parsed.data });
  }
  const groupOldIds = new Set(groups.map((item) => item.oldId));

  // ---- Group Members — user_id é uma conta REAL de outra pessoa (ou da própria conta
  // restaurando). Nunca inventa conta: só preserva o vínculo se ela ainda existir; caso
  // contrário marca EXTERNAL_DEPENDENCY e restaura o membro sem vínculo de conta (nunca
  // reassocia com outra pessoa). ----
  const rawGroupMembers = rowsOf(data, 'groupMembers');
  if (rawGroupMembers.length > 2000) throw new ApiError(422, 'BACKUP_TOO_LARGE', 'Este backup tem mais membros de Grupo do que a v1 do restore suporta (2000 por operação).');
  const distinctGroupMemberUserIds = [...new Set(rawGroupMembers.map((row) => strOrNull(row, 'user_id')).filter((id): id is string => Boolean(id)))];
  let validGroupMemberUserIds = new Set<string>();
  if (distinctGroupMemberUserIds.length) {
    const rows = await env.DB.prepare(`SELECT id FROM users WHERE id IN (${distinctGroupMemberUserIds.map(() => '?').join(',')}) AND disabled_at IS NULL AND deleted_at IS NULL`).bind(...distinctGroupMemberUserIds).all<{ id: string }>();
    validGroupMemberUserIds = new Set(rows.results.map((row) => row.id));
  }
  const groupMembers: GroupMemberPlanItem[] = [];
  for (const row of rawGroupMembers) {
    const oldId = str(row, 'id'); const oldGroupId = str(row, 'group_id');
    if (!groupOldIds.has(oldGroupId)) { warnings.push({ domain: 'groupMembers', oldId, message: 'Grupo original não pôde ser restaurado — membro não será restaurado.', category: 'SKIP' }); continue; }
    const rawUserId = strOrNull(row, 'user_id');
    const resolvedUserId = rawUserId && validGroupMemberUserIds.has(rawUserId) ? rawUserId : null;
    if (rawUserId && !resolvedUserId) warnings.push({ domain: 'groupMembers', oldId, message: 'Conta vinculada não existe mais — membro será restaurado sem vínculo de conta.', category: 'EXTERNAL_DEPENDENCY' });
    const parsed = playGroupMemberCreateSchema.safeParse({ playerName: str(row, 'player_name'), userId: null, notes: str(row, 'notes'), active: num(row, 'active') === 1, isGameMaster: num(row, 'is_game_master') === 1 });
    if (!parsed.success) { warnings.push({ domain: 'groupMembers', oldId, message: 'Membro do grupo com dados inválidos após validação — não será restaurado.', category: 'SKIP' }); continue; }
    groupMembers.push({ oldId, oldGroupId, oldUserId: resolvedUserId, input: { playerName: parsed.data.playerName, notes: parsed.data.notes, active: parsed.data.active, isGameMaster: parsed.data.isGameMaster } });
  }
  const groupMemberOldIds = new Set(groupMembers.map((item) => item.oldId));

  // ---- Library (rpgs + publications) — SEMPRE via buildCreateLibraryEntryStatements (mesma
  // camada canônica do cadastro manual/import CSV — nunca um caminho paralelo, ver
  // library-writes.ts). Campos editoriais (subtítulo/editora/ano/idioma/tipo/autores/
  // provenance) vêm de `publications`; o resto vem direto de `rpgs` (LIB-002: título/capa/ISBN
  // continuam também gravados na própria linha de rpgs). ----
  const rawRpgs = rowsOf(data, 'rpgs');
  if (rawRpgs.length > 500) throw new ApiError(422, 'BACKUP_TOO_LARGE', 'Este backup tem mais RPGs na Biblioteca do que a v1 do restore suporta (500 por operação).');
  const publicationById = byField(rowsOf(data, 'publications'), 'id');
  const [categoryRows, subgenreRows] = await env.DB.batch([env.DB.prepare('SELECT id FROM categories'), env.DB.prepare('SELECT id FROM subgenres')]);
  const validCategoryIds = new Set((categoryRows.results as Array<{ id: string }>).map((row) => row.id));
  const validSubgenreIds = new Set((subgenreRows.results as Array<{ id: string }>).map((row) => row.id));
  const METADATA_SOURCES = new Set(['MANUAL', 'OPEN_LIBRARY', 'URL_IMPORT']);
  const library: LibraryPlanItem[] = [];
  for (const row of rawRpgs) {
    const oldId = str(row, 'id');
    const categoryId = strOrNull(row, 'category_id');
    if (categoryId && !validCategoryIds.has(categoryId)) warnings.push({ domain: 'library', oldId, message: 'Categoria original não existe mais — RPG será restaurado sem categoria.', category: 'SKIP' });
    const subgenreId = strOrNull(row, 'subgenre_id');
    if (subgenreId && !validSubgenreIds.has(subgenreId)) warnings.push({ domain: 'library', oldId, message: 'Subgênero original não existe mais — RPG será restaurado sem subgênero.', category: 'SKIP' });
    const oldPlayGroupId = strOrNull(row, 'play_group_id');
    if (oldPlayGroupId && !groupOldIds.has(oldPlayGroupId)) warnings.push({ domain: 'library', oldId, message: 'Grupo original não está neste backup — RPG será restaurado sem grupo vinculado.', category: 'SKIP' });
    const publicationId = strOrNull(row, 'publication_id');
    const publication = publicationId ? publicationById.get(publicationId) : undefined;
    const rawMetadataSource = publication ? str(publication, 'metadata_source') : '';
    const metadataSourceOk = METADATA_SOURCES.has(rawMetadataSource);
    if (rawMetadataSource && !metadataSourceOk) warnings.push({ domain: 'library', oldId, message: 'Fonte de metadata original não é mais suportada — RPG restaurado como cadastro manual.', category: 'SKIP' });
    const candidate = {
      title: str(row, 'title'), categoryId: categoryId && validCategoryIds.has(categoryId) ? categoryId : null,
      subgenreId: subgenreId && validSubgenreIds.has(subgenreId) ? subgenreId : null, readingStatus: str(row, 'reading_status') || 'NOT_STARTED',
      hasPlayed: num(row, 'has_played') === 1, wantsToPlay: num(row, 'wants_to_play') === 1, priority: str(row, 'priority') || 'NONE',
      playGroupNotes: str(row, 'play_group_notes'), playGroupId: null, plannedPlayDate: strOrNull(row, 'planned_play_date'),
      tableStatus: str(row, 'table_status') || 'IDEA', gameMaster: str(row, 'game_master'), notes: str(row, 'notes'),
      coverUrl: strOrNull(row, 'cover_url'), isbn: strOrNull(row, 'isbn'), coverSourceUrl: strOrNull(row, 'cover_source_url'), coverSourceNote: strOrNull(row, 'cover_source_note'),
      subtitle: publication ? str(publication, 'subtitle') : undefined, publisher: publication ? str(publication, 'publisher') : undefined,
      publicationYear: publication ? num(publication, 'publication_year') : undefined, language: publication ? str(publication, 'language') : undefined,
      publicationType: publication ? (str(publication, 'publication_type') || undefined) : undefined, authors: publication ? str(publication, 'authors') : undefined,
      metadataSource: metadataSourceOk ? rawMetadataSource : undefined,
      metadataSourceId: metadataSourceOk ? strOrNull(publication!, 'metadata_source_id') ?? undefined : undefined,
      metadataSourceUrl: metadataSourceOk ? strOrNull(publication!, 'metadata_source_url') ?? undefined : undefined,
      metadataFetchedAt: metadataSourceOk ? strOrNull(publication!, 'metadata_fetched_at') ?? undefined : undefined,
    };
    let parsed = rpgInputSchema.safeParse(candidate);
    if (!parsed.success) {
      const degraded = { ...candidate, coverUrl: null, isbn: null, coverSourceUrl: null, coverSourceNote: null };
      const retry = rpgInputSchema.safeParse(degraded);
      if (retry.success) { warnings.push({ domain: 'library', oldId, message: 'Capa/ISBN originais não passaram na validação atual — RPG restaurado sem esses dados.', category: 'SKIP' }); parsed = retry; }
    }
    if (!parsed.success) { warnings.push({ domain: 'library', oldId, message: 'RPG com dados inválidos após validação — não será restaurado.', category: 'SKIP' }); continue; }
    library.push({ oldId, oldPlayGroupId: oldPlayGroupId && groupOldIds.has(oldPlayGroupId) ? oldPlayGroupId : null, oldGameSystemId: publication ? strOrNull(publication, 'game_system_id') : null, input: parsed.data });
  }
  const libraryOldIds = new Set(library.map((item) => item.oldId));

  // ---- Campaigns — precisa de um RPG restaurado nesta mesma operação (rpg_id NOT NULL na FK);
  // sem isso a campanha inteira é descartada (não há valor válido para gravar). ----
  const rawCampaigns = rowsOf(data, 'campaigns');
  if (rawCampaigns.length > 300) throw new ApiError(422, 'BACKUP_TOO_LARGE', 'Este backup tem mais Campanhas do que a v1 do restore suporta (300 por operação).');
  const campaigns: CampaignPlanItem[] = [];
  for (const row of rawCampaigns) {
    const oldId = str(row, 'id');
    const oldRpgId = str(row, 'rpg_id');
    if (!libraryOldIds.has(oldRpgId)) { warnings.push({ domain: 'campaigns', oldId, message: 'RPG original não pôde ser restaurado — campanha não será restaurada.', category: 'SKIP' }); continue; }
    const oldPlayGroupId = strOrNull(row, 'play_group_id');
    if (oldPlayGroupId && !groupOldIds.has(oldPlayGroupId)) warnings.push({ domain: 'campaigns', oldId, message: 'Grupo original não está neste backup — campanha será restaurada sem grupo vinculado.', category: 'SKIP' });
    const oldAdventureEntityId = strOrNull(row, 'adventure_entity_id');
    if (oldAdventureEntityId && !entityOldIds.has(oldAdventureEntityId)) warnings.push({ domain: 'campaigns', oldId, message: 'Adventure original não está neste backup — campanha será restaurada sem Adventure vinculada.', category: 'SKIP' });
    const candidate = {
      rpgId: oldRpgId, name: str(row, 'name'), status: str(row, 'status') || 'PLANNING', sessionMode: str(row, 'session_mode') || 'CAMPAIGN',
      gameMaster: str(row, 'game_master'), playGroupId: null, adventureEntityId: null,
      sessionZeroDate: strOrNull(row, 'session_zero_date'), firstSessionDate: strOrNull(row, 'first_session_date'),
      frequency: strOrNull(row, 'frequency'), nextSessionDate: strOrNull(row, 'next_session_date'),
      sessionGoal: num(row, 'session_goal'), legacyMembersText: str(row, 'legacy_members_text'), legacyCharactersText: str(row, 'legacy_characters_text'), notes: str(row, 'notes'),
    };
    const parsed = campaignInputSchema.safeParse(candidate);
    if (!parsed.success) { warnings.push({ domain: 'campaigns', oldId, message: 'Campanha com dados inválidos após validação — não será restaurada.', category: 'SKIP' }); continue; }
    campaigns.push({
      oldId, oldRpgId, oldPlayGroupId: oldPlayGroupId && groupOldIds.has(oldPlayGroupId) ? oldPlayGroupId : null,
      oldAdventureEntityId: oldAdventureEntityId && entityOldIds.has(oldAdventureEntityId) ? oldAdventureEntityId : null, input: parsed.data,
    });
  }
  const campaignOldIds = new Set(campaigns.map((item) => item.oldId));

  // ---- Campaign Members — mesma regra de "nunca recriar outra pessoa" do Group Member. ----
  const rawCampaignMembers = rowsOf(data, 'members');
  if (rawCampaignMembers.length > 3000) throw new ApiError(422, 'BACKUP_TOO_LARGE', 'Este backup tem mais membros de Campanha do que a v1 do restore suporta (3000 por operação).');
  const distinctCampaignMemberUserIds = [...new Set(rawCampaignMembers.map((row) => strOrNull(row, 'user_id')).filter((id): id is string => Boolean(id)))];
  let validCampaignMemberUserIds = new Set<string>();
  if (distinctCampaignMemberUserIds.length) {
    const rows = await env.DB.prepare(`SELECT id FROM users WHERE id IN (${distinctCampaignMemberUserIds.map(() => '?').join(',')}) AND disabled_at IS NULL AND deleted_at IS NULL`).bind(...distinctCampaignMemberUserIds).all<{ id: string }>();
    validCampaignMemberUserIds = new Set(rows.results.map((row) => row.id));
  }
  const campaignMembers: CampaignMemberPlanItem[] = [];
  for (const row of rawCampaignMembers) {
    const oldId = str(row, 'id'); const oldCampaignId = str(row, 'campaign_id');
    if (!campaignOldIds.has(oldCampaignId)) { warnings.push({ domain: 'campaignMembers', oldId, message: 'Campanha original não pôde ser restaurada — membro não será restaurado.', category: 'SKIP' }); continue; }
    const oldGroupMemberId = strOrNull(row, 'group_member_id');
    if (oldGroupMemberId && !groupMemberOldIds.has(oldGroupMemberId)) warnings.push({ domain: 'campaignMembers', oldId, message: 'Membro de Grupo original não está neste backup — vínculo não será restaurado.', category: 'SKIP' });
    const oldCharacterEntityId = strOrNull(row, 'character_entity_id');
    if (oldCharacterEntityId && !entityOldIds.has(oldCharacterEntityId)) warnings.push({ domain: 'campaignMembers', oldId, message: 'Personagem original não está neste backup — vínculo não será restaurado.', category: 'SKIP' });
    const rawUserId = strOrNull(row, 'user_id');
    const resolvedUserId = rawUserId && validCampaignMemberUserIds.has(rawUserId) ? rawUserId : null;
    if (rawUserId && !resolvedUserId) warnings.push({ domain: 'campaignMembers', oldId, message: 'Conta vinculada não existe mais — membro será restaurado sem vínculo de conta.', category: 'EXTERNAL_DEPENDENCY' });
    const parsed = memberInputSchema.safeParse({ playerName: str(row, 'player_name'), characterName: str(row, 'character_name'), notes: str(row, 'notes'), active: num(row, 'active') === 1, characterEntityId: null });
    if (!parsed.success) { warnings.push({ domain: 'campaignMembers', oldId, message: 'Membro da campanha com dados inválidos após validação — não será restaurado.', category: 'SKIP' }); continue; }
    campaignMembers.push({
      oldId, oldCampaignId, oldGroupMemberId: oldGroupMemberId && groupMemberOldIds.has(oldGroupMemberId) ? oldGroupMemberId : null, oldUserId: resolvedUserId,
      input: { playerName: parsed.data.playerName, characterName: parsed.data.characterName, notes: parsed.data.notes, active: parsed.data.active, isGameMaster: num(row, 'is_game_master') === 1, characterEntityId: oldCharacterEntityId && entityOldIds.has(oldCharacterEntityId) ? oldCharacterEntityId : null },
    });
  }
  const campaignMemberOldIds = new Set(campaignMembers.map((item) => item.oldId));

  // ---- Campaign Sessions + Attendance ----
  const rawSessions = rowsOf(data, 'sessions');
  if (rawSessions.length > 2000) throw new ApiError(422, 'BACKUP_TOO_LARGE', 'Este backup tem mais Sessões do que a v1 do restore suporta (2000 por operação).');
  const attendanceBySession = new Map<string, string[]>();
  for (const row of rowsOf(data, 'attendance')) {
    const sessionId = str(row, 'session_id'); const memberId = str(row, 'campaign_member_id');
    attendanceBySession.set(sessionId, [...(attendanceBySession.get(sessionId) ?? []), memberId]);
  }
  const campaignSessions: CampaignSessionPlanItem[] = [];
  for (const row of rawSessions) {
    const oldId = str(row, 'id'); const oldCampaignId = str(row, 'campaign_id');
    if (!campaignOldIds.has(oldCampaignId)) { warnings.push({ domain: 'campaignSessions', oldId, message: 'Campanha original não pôde ser restaurada — sessão não será restaurada.', category: 'SKIP' }); continue; }
    const sessionNumber = num(row, 'session_number');
    const candidate = { title: str(row, 'title'), playedAt: str(row, 'played_at'), summary: str(row, 'summary'), gmNotes: str(row, 'gm_notes'), nextHooks: str(row, 'next_hooks'), attendeeMemberIds: [] };
    const parsed = sessionInputSchema.safeParse(candidate);
    if (!parsed.success || !sessionNumber) { warnings.push({ domain: 'campaignSessions', oldId, message: 'Sessão com dados inválidos após validação — não será restaurada.', category: 'SKIP' }); continue; }
    const oldAttendeeIds = (attendanceBySession.get(oldId) ?? []).filter((memberId) => {
      const ok = campaignMemberOldIds.has(memberId);
      if (!ok) warnings.push({ domain: 'campaignSessions', oldId, message: 'Um participante original não está neste backup — presença não será restaurada para ele.', category: 'SKIP' });
      return ok;
    });
    campaignSessions.push({ oldId, oldCampaignId, sessionNumber, oldAttendeeMemberIds: oldAttendeeIds, input: { title: parsed.data.title, playedAt: parsed.data.playedAt, summary: parsed.data.summary, gmNotes: parsed.data.gmNotes, nextHooks: parsed.data.nextHooks } });
  }

  // ---- VTT (F-029/F-030/F-032) — precisa de Campaigns restauradas nesta mesma operação. ----
  const rawVttScenes = rowsOf(data, 'vttScenes');
  const vttScenes: VttScenePlanItem[] = [];
  for (const row of rawVttScenes) {
    const oldId = str(row, 'id'); const oldCampaignId = str(row, 'campaign_id');
    if (!campaignOldIds.has(oldCampaignId)) { warnings.push({ domain: 'vttScenes', oldId, message: 'Campanha original não pôde ser restaurada — cena de VTT não será restaurada.', category: 'SKIP' }); continue; }
    const oldMapId = strOrNull(row, 'map_id');
    if (oldMapId && !worldMapOldIds.has(oldMapId)) warnings.push({ domain: 'vttScenes', oldId, message: 'Mapa original não está neste backup — cena de VTT será restaurada sem mapa vinculado.', category: 'SKIP' });
    const imageUrl = str(row, 'image_url');
    const resolvedMapId = oldMapId && worldMapOldIds.has(oldMapId) ? oldMapId : null;
    if (!resolvedMapId && !imageUrl) { warnings.push({ domain: 'vttScenes', oldId, message: 'Cena de VTT sem mapa nem imagem restauráveis — não será restaurada.', category: 'SKIP' }); continue; }
    const parsed = vttSceneInputSchema.safeParse({ title: str(row, 'title'), mapId: null, imageUrl, notes: str(row, 'notes'), fogEnabled: num(row, 'fog_enabled') === 1, gridCols: num(row, 'grid_cols') ?? 20, gridRows: num(row, 'grid_rows') ?? 20 });
    if (!parsed.success) { warnings.push({ domain: 'vttScenes', oldId, message: 'Cena de VTT com dados inválidos após validação — não será restaurada.', category: 'SKIP' }); continue; }
    vttScenes.push({ oldId, oldCampaignId, oldMapId: resolvedMapId, input: parsed.data });
  }
  const vttSceneOldIds = new Set(vttScenes.map((item) => item.oldId));

  const rawVttTokens = rowsOf(data, 'vttTokens');
  const vttTokens: VttTokenPlanItem[] = [];
  for (const row of rawVttTokens) {
    const oldId = str(row, 'id'); const oldSceneId = str(row, 'scene_id');
    if (!vttSceneOldIds.has(oldSceneId)) { warnings.push({ domain: 'vttTokens', oldId, message: 'Cena de VTT original não pôde ser restaurada — token não será restaurado.', category: 'SKIP' }); continue; }
    const oldEntityId = strOrNull(row, 'entity_id');
    if (oldEntityId && !entityOldIds.has(oldEntityId)) warnings.push({ domain: 'vttTokens', oldId, message: 'Entidade original não está neste backup — token será restaurado sem entidade vinculada.', category: 'SKIP' });
    const parsed = vttTokenInputSchema.safeParse({ label: str(row, 'label'), entityId: null, x: num(row, 'x'), y: num(row, 'y'), visibleToPlayers: num(row, 'visible_to_players') === 1 });
    if (!parsed.success) { warnings.push({ domain: 'vttTokens', oldId, message: 'Token com dados inválidos após validação — não será restaurado.', category: 'SKIP' }); continue; }
    vttTokens.push({ oldId, oldSceneId, oldEntityId: oldEntityId && entityOldIds.has(oldEntityId) ? oldEntityId : null, input: parsed.data });
  }
  const vttTokenOldIds = new Set(vttTokens.map((item) => item.oldId));

  const vttFogCells: VttFogCellPlanItem[] = [];
  for (const row of rowsOf(data, 'vttFogCells')) {
    const oldSceneId = str(row, 'scene_id');
    if (!vttSceneOldIds.has(oldSceneId)) continue;
    const parsed = vttFogCellInputSchema.safeParse({ col: num(row, 'col'), row: num(row, 'row') });
    if (!parsed.success) continue;
    vttFogCells.push({ oldSceneId, input: parsed.data });
  }

  const vttCombatants: VttCombatantPlanItem[] = [];
  for (const row of rowsOf(data, 'vttCombatants')) {
    const oldId = str(row, 'id'); const oldSceneId = str(row, 'scene_id');
    if (!vttSceneOldIds.has(oldSceneId)) { warnings.push({ domain: 'vttCombatants', oldId, message: 'Cena de VTT original não pôde ser restaurada — combatente não será restaurado.', category: 'SKIP' }); continue; }
    const oldTokenId = strOrNull(row, 'token_id');
    if (oldTokenId && !vttTokenOldIds.has(oldTokenId)) warnings.push({ domain: 'vttCombatants', oldId, message: 'Token original não está neste backup — combatente será restaurado sem token vinculado.', category: 'SKIP' });
    const parsed = vttCombatantInputSchema.safeParse({ tokenId: null, name: str(row, 'name'), initiative: num(row, 'initiative') ?? 0, hpCurrent: num(row, 'hp_current'), hpMax: num(row, 'hp_max'), notes: str(row, 'notes'), visibleToPlayers: num(row, 'visible_to_players') === 1 });
    if (!parsed.success) { warnings.push({ domain: 'vttCombatants', oldId, message: 'Combatente com dados inválidos após validação — não será restaurado.', category: 'SKIP' }); continue; }
    vttCombatants.push({ oldId, oldSceneId, oldTokenId: oldTokenId && vttTokenOldIds.has(oldTokenId) ? oldTokenId : null, input: parsed.data });
  }

  return {
    worlds, creatureStatTemplates, entities, journalFolders, journalPages, worldEntityLinks,
    library, groups, groupMembers, campaigns, campaignMembers, campaignSessions,
    sheetTemplates, characterSheets,
    wikiFolders, wikiEntityMetadata, worldTags, wikiEntityTags, wikiEntityAliases, entityRelations,
    worldMaps, mapPins, externalResources, worldEras, worldCalendars, eventTemporalDetails,
    adventureScenes, adventureEncounters, adventureSceneEntities, adventureHandouts,
    vttScenes, vttTokens, vttFogCells, vttCombatants,
    warnings,
  };
}

backupRestoreRoutes.post('/import/backup/preview', async (c) => {
  const { backup } = await readJson(c, previewSchema);
  let root: unknown;
  try { root = JSON.parse(backup); } catch { throw new ApiError(422, 'INVALID_BACKUP_FILE', 'O arquivo enviado não é um JSON válido.'); }
  const rootRow = root as RawRow;
  if (rootRow.schemaVersion !== SUPPORTED_BACKUP_SCHEMA_VERSION) {
    throw new ApiError(422, 'UNSUPPORTED_BACKUP_VERSION', `Este backup usa o formato v${String(rootRow.schemaVersion ?? 'desconhecido')}. Esta versão do RPG Manager só restaura backups v${SUPPORTED_BACKUP_SCHEMA_VERSION} — gere um novo backup em Configurações → Exportar e tente novamente.`);
  }
  const user = c.get('user');
  const plan = await buildRestorePlan(c.env, user.id, rootRow);
  const rowCount = plan.worlds.length + plan.creatureStatTemplates.length + plan.entities.length + plan.journalFolders.length + plan.journalPages.length + plan.worldEntityLinks.length
    + plan.library.length + plan.groups.length + plan.groupMembers.length + plan.campaigns.length + plan.campaignMembers.length + plan.campaignSessions.length
    + plan.sheetTemplates.length + plan.characterSheets.length
    + plan.wikiFolders.length + plan.wikiEntityMetadata.length + plan.worldTags.length + plan.wikiEntityTags.length + plan.wikiEntityAliases.length + plan.entityRelations.length
    + plan.worldMaps.length + plan.mapPins.length + plan.externalResources.length + plan.worldEras.length + plan.worldCalendars.length + plan.eventTemporalDetails.length
    + plan.adventureScenes.length + plan.adventureEncounters.length + plan.adventureSceneEntities.length + plan.adventureHandouts.length
    + plan.vttScenes.length + plan.vttTokens.length + plan.vttFogCells.length + plan.vttCombatants.length;
  const payload = JSON.stringify(plan);
  const payloadHash = await hashSecret(`FULL_BACKUP:${payload}`, c.env.PASSWORD_PEPPER);
  const existing = await c.env.DB.prepare('SELECT id FROM backup_restore_jobs WHERE user_id=? AND payload_hash=? AND confirmed_at IS NULL AND expires_at>?').bind(user.id, payloadHash, nowIso()).first<{ id: string }>();
  const jobId = existing?.id ?? crypto.randomUUID();
  if (!existing) {
    await c.env.DB.prepare('INSERT INTO backup_restore_jobs (id,user_id,payload_hash,normalized_payload,schema_version,row_count,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(jobId, user.id, payloadHash, payload, SUPPORTED_BACKUP_SCHEMA_VERSION, rowCount, new Date(Date.now() + 30 * 60_000).toISOString(), nowIso()).run();
  }
  return c.json({
    jobId,
    summary: {
      worlds: plan.worlds.length, creatureStatTemplates: plan.creatureStatTemplates.length, entities: plan.entities.length, journalFolders: plan.journalFolders.length, journalPages: plan.journalPages.length, worldEntityLinks: plan.worldEntityLinks.length,
      library: plan.library.length, groups: plan.groups.length, groupMembers: plan.groupMembers.length, campaigns: plan.campaigns.length, campaignMembers: plan.campaignMembers.length, campaignSessions: plan.campaignSessions.length,
      sheetTemplates: plan.sheetTemplates.length, characterSheets: plan.characterSheets.length,
      wikiFolders: plan.wikiFolders.length, wikiEntityMetadata: plan.wikiEntityMetadata.length, worldTags: plan.worldTags.length, wikiEntityTags: plan.wikiEntityTags.length, wikiEntityAliases: plan.wikiEntityAliases.length, entityRelations: plan.entityRelations.length,
      worldMaps: plan.worldMaps.length, mapPins: plan.mapPins.length, externalResources: plan.externalResources.length, worldEras: plan.worldEras.length, worldCalendars: plan.worldCalendars.length, eventTemporalDetails: plan.eventTemporalDetails.length,
      adventureScenes: plan.adventureScenes.length, adventureEncounters: plan.adventureEncounters.length, adventureSceneEntities: plan.adventureSceneEntities.length, adventureHandouts: plan.adventureHandouts.length,
      vttScenes: plan.vttScenes.length, vttTokens: plan.vttTokens.length, vttFogCells: plan.vttFogCells.length, vttCombatants: plan.vttCombatants.length,
    },
    warnings: plan.warnings,
    canConfirm: rowCount > 0,
  });
});

backupRestoreRoutes.post('/import/backup/confirm', async (c) => {
  const { jobId } = await readJson(c, confirmSchema);
  const user = c.get('user');
  const job = await c.env.DB.prepare('SELECT normalized_payload FROM backup_restore_jobs WHERE id=? AND user_id=? AND confirmed_at IS NULL AND expires_at>?').bind(jobId, user.id, nowIso()).first<{ normalized_payload: string }>();
  if (!job) throw new ApiError(404, 'BACKUP_JOB_NOT_FOUND', 'Prévia expirada ou já confirmada. Gere uma nova prévia.');
  const plan = restorePlanSchema.parse(JSON.parse(job.normalized_payload));
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  // Achados que só podem ser decididos AO VIVO no confirm (nunca no preview) — ex.: a mesma
  // Publication já estar na biblioteca do usuário por outro caminho entre a prévia e a
  // confirmação. Somam-se aos warnings do preview no relatório final da UI.
  const confirmWarnings: BackupRestoreWarning[] = [];

  // ---- Groups — claim de nome único ao vivo (mesmo padrão do slug de Worlds abaixo). ----
  const existingGroupNameRows = await c.env.DB.prepare('SELECT name FROM play_groups WHERE user_id=?').bind(user.id).all<{ name: string }>();
  const claimedGroupNames = new Set(existingGroupNameRows.results.map((row) => row.name));
  function claimGroupName(name: string): string {
    if (!claimedGroupNames.has(name)) { claimedGroupNames.add(name); return name; }
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${name.slice(0, Math.max(1, 120 - String(suffix).length - 3))} (${suffix})`;
      if (!claimedGroupNames.has(candidate)) { claimedGroupNames.add(candidate); return candidate; }
    }
  }
  const groupIdMap = new Map<string, string>();
  for (const item of plan.groups) {
    const newId = crypto.randomUUID();
    statements.push(c.env.DB.prepare('INSERT INTO play_groups (id,user_id,name,notes,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind(newId, user.id, claimGroupName(item.input.name), item.input.notes, now, now));
    groupIdMap.set(item.oldId, newId);
  }

  // ---- Group Members — nome único por grupo + no máx. 1 GM por grupo (mesmas UNIQUE INDEX da
  // tabela — resolvidas aqui em memória para nunca derrubar o batch inteiro no meio). ----
  const groupMemberIdMap = new Map<string, string>();
  const groupMemberNamesByGroup = new Map<string, Set<string>>();
  const groupsWithGameMaster = new Set<string>();
  const usedGroupUserPairs = new Set<string>();
  for (const item of plan.groupMembers) {
    const newGroupId = groupIdMap.get(item.oldGroupId); if (!newGroupId) continue;
    const newId = crypto.randomUUID();
    const takenNames = groupMemberNamesByGroup.get(newGroupId) ?? new Set<string>();
    let playerName = item.input.playerName;
    if (takenNames.has(playerName)) { for (let suffix = 2; takenNames.has(playerName); suffix += 1) playerName = `${item.input.playerName.slice(0, 90)} (${suffix})`; }
    takenNames.add(playerName); groupMemberNamesByGroup.set(newGroupId, takenNames);
    let isGameMaster = item.input.isGameMaster;
    if (isGameMaster && groupsWithGameMaster.has(newGroupId)) isGameMaster = false;
    if (isGameMaster) groupsWithGameMaster.add(newGroupId);
    let memberUserId = item.oldUserId;
    if (memberUserId) { const pairKey = `${newGroupId}:${memberUserId}`; if (usedGroupUserPairs.has(pairKey)) memberUserId = null; else usedGroupUserPairs.add(pairKey); }
    statements.push(c.env.DB.prepare('INSERT INTO play_group_members (id,group_id,player_name,user_id,notes,active,is_game_master,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(newId, newGroupId, playerName, memberUserId, item.input.notes, Number(item.input.active), Number(isGameMaster), now, now));
    groupMemberIdMap.set(item.oldId, newId);
  }

  // ---- Library (rpgs/publications/game_systems) — SEMPRE via buildCreateLibraryEntryStatements
  // (mesma camada canônica do cadastro manual/import CSV). Título único ao vivo, mesmo padrão do
  // slug de Worlds. Precisa vir ANTES de Worlds nesta função: um World pode referenciar um RPG
  // restaurado NESTA MESMA operação como defaultRpgId (ver abaixo). ----
  const existingTitleRows = await c.env.DB.prepare('SELECT title FROM rpgs WHERE user_id=?').bind(user.id).all<{ title: string }>();
  const claimedTitles = new Set(existingTitleRows.results.map((row) => row.title));
  function claimTitle(title: string): string {
    if (!claimedTitles.has(title)) { claimedTitles.add(title); return title; }
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${title.slice(0, Math.max(1, 160 - String(suffix).length - 3))} (${suffix})`;
      if (!claimedTitles.has(candidate)) { claimedTitles.add(candidate); return candidate; }
    }
  }
  const rpgIdMap = new Map<string, string>();
  // Sheet Templates podem apontar para o Game System de uma Publication restaurada nesta mesma
  // operação (F-023) — mapeado aqui (oldGameSystemId -> newGameSystemId, criado OU reaproveitado
  // por identidade de ISBN, tanto faz — é a mesma identidade do lado de fora).
  const gameSystemIdMap = new Map<string, string>();
  for (const item of plan.library) {
    const newEntryId = crypto.randomUUID();
    const resolvedPlayGroupId = item.oldPlayGroupId ? groupIdMap.get(item.oldPlayGroupId) ?? null : null;
    const title = claimTitle(item.input.title);
    try {
      const { statements: createStatements, ids } = await buildCreateLibraryEntryStatements(c.env.DB, { entryId: newEntryId, userId: user.id, input: { ...item.input, title, playGroupId: resolvedPlayGroupId }, now });
      statements.push(...createStatements);
      rpgIdMap.set(item.oldId, newEntryId);
      if (item.oldGameSystemId) gameSystemIdMap.set(item.oldGameSystemId, ids.gameSystemId);
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'ALREADY_IN_LIBRARY' || error.code === 'ARCHIVED_IN_LIBRARY')) {
        confirmWarnings.push({ domain: 'library', oldId: item.oldId, message: 'Este título (mesmo ISBN) já está na sua biblioteca — não foi duplicado.', category: 'CONFLICT' });
      } else throw error;
    }
  }

  // ---- Worlds — slug único calculado em memória (nada ainda commitado neste batch). ----
  const existingSlugRows = await c.env.DB.prepare('SELECT slug FROM worlds WHERE owner_user_id=?').bind(user.id).all<{ slug: string }>();
  const claimedSlugs = new Set(existingSlugRows.results.map((row) => row.slug));
  function claimSlug(name: string): string {
    const base = createWorldSlug(name); let suffix = 0;
    for (;;) { const candidate = suffix ? `${base.slice(0, Math.max(1, 76 - String(suffix).length))}-${suffix + 1}` : base; if (!claimedSlugs.has(candidate)) { claimedSlugs.add(candidate); return candidate; } suffix += 1; }
  }
  // Revalida defaultRpgId ao vivo (pode ter mudado desde a prévia) — nunca deixa uma referência
  // morta ir para o INSERT (violaria a FK e derrubaria o batch inteiro).
  const distinctDefaultRpgIds = [...new Set(plan.worlds.map((item) => item.input.defaultRpgId).filter((id): id is string => Boolean(id)))];
  let validRpgIds = new Set<string>();
  if (distinctDefaultRpgIds.length) {
    const rows = await c.env.DB.prepare(`SELECT id FROM rpgs WHERE user_id=? AND id IN (${distinctDefaultRpgIds.map(() => '?').join(',')})`).bind(user.id, ...distinctDefaultRpgIds).all<{ id: string }>();
    validRpgIds = new Set(rows.results.map((row) => row.id));
  }
  const worldIdMap = new Map<string, string>();
  for (const item of plan.worlds) {
    const newId = crypto.randomUUID(); const slug = claimSlug(item.input.name);
    // Prioridade: RPG restaurado NESTA MESMA operação (rpgIdMap, referência exata por ID) sobre
    // o match por título feito no preview (que só enxerga RPGs já existentes antes do restore).
    const sameOperationRpgId = item.oldDefaultRpgId ? rpgIdMap.get(item.oldDefaultRpgId) : undefined;
    const defaultRpgId = sameOperationRpgId ?? (item.input.defaultRpgId && validRpgIds.has(item.input.defaultRpgId) ? item.input.defaultRpgId : null);
    statements.push(c.env.DB.prepare(`INSERT INTO worlds (id,owner_user_id,name,slug,description,default_rpg_id,visibility,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'ACTIVE',?,?)`)
      .bind(newId, user.id, item.input.name, slug, item.input.description, defaultRpgId, item.input.visibility, now, now));
    statements.push(c.env.DB.prepare("INSERT INTO world_members (world_id,user_id,role,created_at) VALUES (?,?,'OWNER',?)").bind(newId, user.id, now));
    statements.push(recordRevisionStatement(c.env.DB, { resourceType: 'WORLD', resourceId: newId, ownerUserId: user.id, actorUserId: user.id, action: 'CREATE', snapshot: item.input, now }));
    worldIdMap.set(item.oldId, newId);
  }

  // ---- Creature Stat Templates ----
  const templateIdMap = new Map<string, string>();
  for (const item of plan.creatureStatTemplates) {
    const newWorldId = worldIdMap.get(item.oldWorldId); if (!newWorldId) continue;
    const newId = crypto.randomUUID();
    statements.push(c.env.DB.prepare('INSERT INTO creature_stat_templates (id,owner_user_id,world_id,name,description,field_definitions,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(newId, user.id, newWorldId, item.input.name, item.input.description, JSON.stringify(item.input.fields), now, now));
    templateIdMap.set(item.oldId, newId);
  }

  // ---- Vault entities (INSERT sem parent_entity_id — resolvido em uma 2ª passagem abaixo) ----
  const entityIdMap = new Map<string, string>();
  const parentPending: Array<{ newId: string; oldParentEntityId: string }> = [];
  for (const item of plan.entities) {
    const newId = crypto.randomUUID();
    const input = { ...item.input, worldId: item.oldWorldId ? worldIdMap.get(item.oldWorldId) ?? null : null, parentEntityId: null };
    if (input.creature?.statBlock) {
      const newTemplateId = item.oldTemplateId ? templateIdMap.get(item.oldTemplateId) : undefined;
      input.creature = newTemplateId ? { ...input.creature, statBlock: { ...input.creature.statBlock, templateId: newTemplateId } } : { ...input.creature, statBlock: null };
    }
    statements.push(c.env.DB.prepare(`INSERT INTO vault_entities (id,owner_user_id,world_id,group_id,parent_entity_id,entity_type,name,summary,description,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(newId, user.id, input.worldId, null, null, input.entityType, input.name, input.summary, input.description, input.visibility, now, now));
    if (input.adventure) statements.push(c.env.DB.prepare('INSERT INTO adventure_details (entity_id,adventure_type,recommended_sessions,notes,premise,hooks,key_scenes,rewards) VALUES (?,?,?,?,?,?,?,?)')
      .bind(newId, input.adventure.adventureType, input.adventure.recommendedSessions, input.adventure.notes, input.adventure.premise, input.adventure.hooks, input.adventure.keyScenes, input.adventure.rewards));
    if (input.entityType === 'LORE') { const lore = input.lore ?? { loreType: 'CUSTOM' as const, canonStatus: 'DRAFT' as const, source: '' }; statements.push(c.env.DB.prepare('INSERT INTO lore_details (entity_id,lore_type,canon_status,source) VALUES (?,?,?,?)').bind(newId, lore.loreType, lore.canonStatus, lore.source)); }
    statements.push(...specializedStatements(c, input, newId));
    statements.push(recordRevisionStatement(c.env.DB, { resourceType: 'VAULT_ENTITY', resourceId: newId, ownerUserId: user.id, actorUserId: user.id, action: 'CREATE', snapshot: input, now }));
    entityIdMap.set(item.oldId, newId);
    if (item.oldParentEntityId) parentPending.push({ newId, oldParentEntityId: item.oldParentEntityId });
  }
  for (const pending of parentPending) {
    const newParentId = entityIdMap.get(pending.oldParentEntityId);
    if (newParentId) statements.push(c.env.DB.prepare('UPDATE vault_entities SET parent_entity_id=? WHERE id=? AND owner_user_id=?').bind(newParentId, pending.newId, user.id));
  }

  // ---- world_entity_links (F-022) — depende de worldIdMap E entityIdMap já preenchidos acima. ----
  let worldEntityLinksCreated = 0;
  for (const item of plan.worldEntityLinks) {
    const newWorldId = worldIdMap.get(item.oldWorldId); const newEntityId = entityIdMap.get(item.oldEntityId);
    if (!newWorldId || !newEntityId) continue;
    statements.push(c.env.DB.prepare('INSERT OR IGNORE INTO world_entity_links (world_id,entity_id,created_at) VALUES (?,?,?)').bind(newWorldId, newEntityId, now));
    worldEntityLinksCreated += 1;
  }

  // ---- Sheet Templates — sempre criado na versão 1 (mesma regra do create normal); worldId/
  // gameSystemId resolvidos contra worldIdMap/gameSystemIdMap (Library, construído acima). ----
  const sheetTemplateIdMap = new Map<string, string>();
  for (const item of plan.sheetTemplates) {
    const newId = crypto.randomUUID();
    const resolvedWorldId = item.oldWorldId ? worldIdMap.get(item.oldWorldId) ?? null : null;
    const resolvedGameSystemId = item.oldGameSystemId ? gameSystemIdMap.get(item.oldGameSystemId) ?? null : null;
    statements.push(c.env.DB.prepare('INSERT INTO sheet_templates (id,owner_user_id,world_id,game_system_id,name,description,version,field_definitions,pdf_url,pdf_mapping_json,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?,?,?,?)')
      .bind(newId, user.id, resolvedWorldId, resolvedGameSystemId, item.input.name, item.input.description, JSON.stringify(item.input.fields), item.input.pdfUrl, JSON.stringify(item.input.pdfMapping), now, now));
    sheetTemplateIdMap.set(item.oldId, newId);
  }

  // ---- Character Sheets — revalidada contra o modelo JÁ restaurado (validateSheet, mesma
  // função pura usada por PUT /sheets/entities/:id), nunca confia cegamente no values_json
  // exportado. Sem entidade/modelo restaurados, a ficha é descartada (já filtrado no plano). ----
  let characterSheetsCreated = 0;
  for (const item of plan.characterSheets) {
    const newEntityId = entityIdMap.get(item.oldEntityId); const newTemplateId = sheetTemplateIdMap.get(item.oldTemplateId);
    if (!newEntityId || !newTemplateId) continue;
    const templateInput = plan.sheetTemplates.find((template) => template.oldId === item.oldTemplateId)!.input;
    const result = validateSheet({ id: newTemplateId, name: templateInput.name, version: 1, fields: templateInput.fields }, item.values);
    if (!result.valid) { confirmWarnings.push({ domain: 'characterSheets', oldId: item.oldEntityId, message: 'Valores da ficha não correspondem mais ao modelo restaurado — ficha não foi restaurada.', category: 'SKIP' }); continue; }
    statements.push(c.env.DB.prepare('INSERT INTO character_sheets (entity_id,template_id,template_version,values_json,created_at,updated_at) VALUES (?,?,1,?,?,?)')
      .bind(newEntityId, newTemplateId, JSON.stringify(item.values), now, now));
    characterSheetsCreated += 1;
  }

  // ---- Wiki (organização) — cada World/entidade restaurado nesta operação é sempre NOVO,
  // então as UNIQUE INDEX de nome/alias por World/entidade nunca colidem com dado pré-existente
  // nem entre si (a origem já garantia unicidade; o remapeamento 1:1 preserva isso). ----
  const wikiFolderIdMap = new Map<string, string>();
  const wikiFolderParentPending: Array<{ newId: string; oldParentFolderId: string }> = [];
  for (const item of plan.wikiFolders) {
    const newWorldId = worldIdMap.get(item.oldWorldId); if (!newWorldId) continue;
    const newId = crypto.randomUUID();
    statements.push(c.env.DB.prepare('INSERT INTO wiki_folders (id,world_id,parent_folder_id,name,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind(newId, newWorldId, null, item.name, now, now));
    wikiFolderIdMap.set(item.oldId, newId);
    if (item.oldParentFolderId) wikiFolderParentPending.push({ newId, oldParentFolderId: item.oldParentFolderId });
  }
  for (const pending of wikiFolderParentPending) {
    const newParentId = wikiFolderIdMap.get(pending.oldParentFolderId);
    if (newParentId) statements.push(c.env.DB.prepare('UPDATE wiki_folders SET parent_folder_id=? WHERE id=?').bind(newParentId, pending.newId));
  }

  let wikiEntityMetadataCreated = 0;
  for (const item of plan.wikiEntityMetadata) {
    const newEntityId = entityIdMap.get(item.oldEntityId); if (!newEntityId) continue;
    const resolvedFolderId = item.oldFolderId ? wikiFolderIdMap.get(item.oldFolderId) ?? null : null;
    statements.push(c.env.DB.prepare('INSERT INTO wiki_entity_metadata (entity_id,folder_id,sort_order,updated_at) VALUES (?,?,?,?)').bind(newEntityId, resolvedFolderId, item.sortOrder, now));
    wikiEntityMetadataCreated += 1;
  }

  const worldTagIdMap = new Map<string, string>();
  for (const item of plan.worldTags) {
    const newWorldId = worldIdMap.get(item.oldWorldId); if (!newWorldId) continue;
    const newId = crypto.randomUUID();
    statements.push(c.env.DB.prepare('INSERT INTO world_tags (id,world_id,name,normalized_name,created_at) VALUES (?,?,?,?,?)').bind(newId, newWorldId, item.name, normalizeEditorialLabel(item.name), now));
    worldTagIdMap.set(item.oldId, newId);
  }

  let wikiEntityTagsCreated = 0;
  for (const item of plan.wikiEntityTags) {
    const newEntityId = entityIdMap.get(item.oldEntityId); const newTagId = worldTagIdMap.get(item.oldTagId);
    if (!newEntityId || !newTagId) continue;
    statements.push(c.env.DB.prepare('INSERT INTO wiki_entity_tags (entity_id,tag_id,created_at) VALUES (?,?,?)').bind(newEntityId, newTagId, now));
    wikiEntityTagsCreated += 1;
  }

  let wikiEntityAliasesCreated = 0;
  for (const item of plan.wikiEntityAliases) {
    const newEntityId = entityIdMap.get(item.oldEntityId); if (!newEntityId) continue;
    statements.push(c.env.DB.prepare('INSERT INTO wiki_entity_aliases (id,entity_id,alias,normalized_alias,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), newEntityId, item.alias, normalizeEditorialLabel(item.alias), now));
    wikiEntityAliasesCreated += 1;
  }

  // ---- Relations — created_by_user_id é SEMPRE o usuário autenticado (nunca o valor do
  // backup), mesmo princípio de owner_user_id/user_id usado em todo o restore. ----
  let entityRelationsCreated = 0;
  for (const item of plan.entityRelations) {
    const newWorldId = worldIdMap.get(item.oldWorldId); const newSourceId = entityIdMap.get(item.oldSourceEntityId); const newTargetId = entityIdMap.get(item.oldTargetEntityId);
    if (!newWorldId || !newSourceId || !newTargetId) continue;
    statements.push(c.env.DB.prepare(`INSERT INTO entity_relations (id,world_id,source_entity_id,target_entity_id,relation_type,label,label_normalized,description,direction,visibility,strength,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), newWorldId, newSourceId, newTargetId, item.input.relationType, item.input.label, normalizeLabel(item.input.label), item.input.description, item.input.direction, item.input.visibility, item.input.strength, user.id, now, now));
    entityRelationsCreated += 1;
  }

  // ---- Cartografia (F-002) ----
  const worldMapIdMap = new Map<string, string>();
  for (const item of plan.worldMaps) {
    const newWorldId = worldIdMap.get(item.oldWorldId); if (!newWorldId) continue;
    const newId = crypto.randomUUID();
    statements.push(c.env.DB.prepare('INSERT INTO world_maps (id,world_id,title,image_url,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(newId, newWorldId, item.input.title, item.input.imageUrl, item.input.notes, now, now));
    worldMapIdMap.set(item.oldId, newId);
  }
  let mapPinsCreated = 0;
  for (const item of plan.mapPins) {
    const newMapId = worldMapIdMap.get(item.oldMapId); if (!newMapId) continue;
    const resolvedEntityId = item.oldEntityId ? entityIdMap.get(item.oldEntityId) ?? null : null;
    statements.push(c.env.DB.prepare('INSERT INTO map_pins (id,map_id,entity_id,label,notes,x,y,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), newMapId, resolvedEntityId, item.input.label, item.input.notes, item.input.x, item.input.y, now, now));
    mapPinsCreated += 1;
  }

  // ---- External Resources (F-003) ----
  const externalResourceIdMap = new Map<string, string>();
  for (const item of plan.externalResources) {
    const newWorldId = worldIdMap.get(item.oldWorldId); if (!newWorldId) continue;
    const newId = crypto.randomUUID();
    statements.push(c.env.DB.prepare('INSERT INTO external_resources (id,world_id,title,url,description,resource_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(newId, newWorldId, item.input.title, item.input.url, item.input.description, item.input.resourceType, now, now));
    externalResourceIdMap.set(item.oldId, newId);
  }

  // ---- Timeline/Calendar: Eras -> Calendar (1 por World, mesma UNIQUE INDEX que garante isso
  // hoje) -> Event temporal details (Events), nessa ordem de dependência. ----
  const worldEraIdMap = new Map<string, string>();
  for (const item of plan.worldEras) {
    const newWorldId = worldIdMap.get(item.oldWorldId); if (!newWorldId) continue;
    const newId = crypto.randomUUID();
    statements.push(c.env.DB.prepare('INSERT INTO world_eras (id,world_id,name,name_normalized,description,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(newId, newWorldId, item.input.name, normalizeName(item.input.name), item.input.description, item.input.sortOrder, now, now));
    worldEraIdMap.set(item.oldId, newId);
  }
  const worldCalendarIdMap = new Map<string, string>(); // oldWorldId -> newCalendarId
  for (const item of plan.worldCalendars) {
    const newWorldId = worldIdMap.get(item.oldWorldId); if (!newWorldId) continue;
    const newId = crypto.randomUUID();
    statements.push(c.env.DB.prepare('INSERT INTO world_calendars (id,world_id,name,months_json,weekdays_json,cycles_json,holidays_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(newId, newWorldId, item.input.name, JSON.stringify(item.input.months), JSON.stringify(item.input.weekdays), JSON.stringify(item.input.cycles), JSON.stringify(item.input.holidays), now, now));
    worldCalendarIdMap.set(item.oldWorldId, newId);
  }
  const entityOldWorldId = new Map(plan.entities.map((item) => [item.oldId, item.oldWorldId]));
  let eventTemporalDetailsCreated = 0;
  for (const item of plan.eventTemporalDetails) {
    const newEntityId = entityIdMap.get(item.oldEntityId); if (!newEntityId) continue;
    const resolvedEraId = item.oldEraId ? worldEraIdMap.get(item.oldEraId) ?? null : null;
    const oldWorldId = entityOldWorldId.get(item.oldEntityId);
    const newCalendarId = item.hasCalendarDate && oldWorldId ? worldCalendarIdMap.get(oldWorldId) ?? null : null;
    const calendarDate = newCalendarId ? item.input.calendarDate : null;
    statements.push(c.env.DB.prepare(`INSERT INTO event_temporal_details (entity_id,era_id,historical_date,sort_key,precision,calendar_id,calendar_year,calendar_month_index,calendar_day,display_text,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(newEntityId, resolvedEraId, item.input.historicalDate, item.input.sortKey, item.input.precision, newCalendarId, calendarDate?.year ?? null, calendarDate?.monthIndex ?? null, calendarDate?.day ?? null, item.input.displayText, now));
    eventTemporalDetailsCreated += 1;
  }

  // ---- Adventures estruturadas (F-025): Scene -> Encounter/SceneEntity; Handout. ----
  const adventureSceneIdMap = new Map<string, string>();
  for (const item of plan.adventureScenes) {
    const newAdventureEntityId = entityIdMap.get(item.oldAdventureEntityId); if (!newAdventureEntityId) continue;
    const newId = crypto.randomUUID();
    statements.push(c.env.DB.prepare('INSERT INTO adventure_scenes (id,adventure_entity_id,sort_order,act,title,summary,read_aloud,gm_notes,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(newId, newAdventureEntityId, item.input.sortOrder, item.input.act, item.input.title, item.input.summary, item.input.readAloud, item.input.gmNotes, item.input.completed ? now : null, now, now));
    adventureSceneIdMap.set(item.oldId, newId);
  }
  let adventureEncountersCreated = 0;
  for (const item of plan.adventureEncounters) {
    const newSceneId = adventureSceneIdMap.get(item.oldSceneId); if (!newSceneId) continue;
    statements.push(c.env.DB.prepare('INSERT INTO adventure_encounters (id,scene_id,sort_order,name,difficulty,description,gm_notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), newSceneId, item.input.sortOrder, item.input.name, item.input.difficulty, item.input.description, item.input.gmNotes, now, now));
    adventureEncountersCreated += 1;
  }
  let adventureSceneEntitiesCreated = 0;
  for (const item of plan.adventureSceneEntities) {
    const newSceneId = adventureSceneIdMap.get(item.oldSceneId); const newEntityId = entityIdMap.get(item.oldEntityId);
    if (!newSceneId || !newEntityId) continue;
    statements.push(c.env.DB.prepare('INSERT INTO adventure_scene_entities (scene_id,entity_id,role,created_at) VALUES (?,?,?,?)').bind(newSceneId, newEntityId, item.role, now));
    adventureSceneEntitiesCreated += 1;
  }
  let adventureHandoutsCreated = 0;
  for (const item of plan.adventureHandouts) {
    const newAdventureEntityId = entityIdMap.get(item.oldAdventureEntityId); if (!newAdventureEntityId) continue;
    const resolvedSceneId = item.oldSceneId ? adventureSceneIdMap.get(item.oldSceneId) ?? null : null;
    const resolvedExternalResourceId = item.oldExternalResourceId ? externalResourceIdMap.get(item.oldExternalResourceId) ?? null : null;
    statements.push(c.env.DB.prepare('INSERT INTO adventure_handouts (id,adventure_entity_id,scene_id,external_resource_id,title,content,revealed_at,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), newAdventureEntityId, resolvedSceneId, resolvedExternalResourceId, item.input.title, item.input.content, item.input.revealed ? now : null, item.input.sortOrder, now, now));
    adventureHandoutsCreated += 1;
  }

  // ---- Journal folders (2ª passagem para parent_folder_id, mesmo padrão) ----
  const folderIdMap = new Map<string, string>();
  const folderParentPending: Array<{ newId: string; oldParentFolderId: string }> = [];
  for (const item of plan.journalFolders) {
    const newWorldId = worldIdMap.get(item.oldWorldId); if (!newWorldId) continue;
    const newId = crypto.randomUUID();
    statements.push(c.env.DB.prepare('INSERT INTO journal_folders (id,world_id,parent_folder_id,name,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind(newId, newWorldId, null, item.input.name, now, now));
    folderIdMap.set(item.oldId, newId);
    if (item.oldParentFolderId) folderParentPending.push({ newId, oldParentFolderId: item.oldParentFolderId });
  }
  for (const pending of folderParentPending) {
    const newParentId = folderIdMap.get(pending.oldParentFolderId);
    if (newParentId) statements.push(c.env.DB.prepare('UPDATE journal_folders SET parent_folder_id=? WHERE id=?').bind(newParentId, pending.newId));
  }

  // ---- Journal pages ----
  let journalPagesCreated = 0;
  for (const item of plan.journalPages) {
    const newWorldId = worldIdMap.get(item.oldWorldId); if (!newWorldId) continue;
    const newId = crypto.randomUUID();
    const resolvedFolderId = item.oldFolderId ? folderIdMap.get(item.oldFolderId) ?? null : null;
    statements.push(c.env.DB.prepare('INSERT INTO journal_pages (id,world_id,folder_id,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(newId, newWorldId, resolvedFolderId, item.input.title, item.input.content, now, now));
    statements.push(recordRevisionStatement(c.env.DB, { resourceType: 'JOURNAL_PAGE', resourceId: newId, ownerUserId: user.id, actorUserId: user.id, action: 'CREATE', snapshot: item.input, now }));
    journalPagesCreated += 1;
  }

  // ---- Campaigns — precisa de rpgIdMap (Library, já construído acima) + opcionalmente
  // groupIdMap/entityIdMap. Sem RPG restaurado (ex.: caiu em CONFLICT acima) a campanha inteira
  // é descartada — não há valor válido para a FK rpg_id NOT NULL. ----
  const campaignIdMap = new Map<string, string>();
  for (const item of plan.campaigns) {
    const newRpgId = rpgIdMap.get(item.oldRpgId); if (!newRpgId) continue;
    const newId = crypto.randomUUID();
    const resolvedPlayGroupId = item.oldPlayGroupId ? groupIdMap.get(item.oldPlayGroupId) ?? null : null;
    const resolvedAdventureEntityId = item.oldAdventureEntityId ? entityIdMap.get(item.oldAdventureEntityId) ?? null : null;
    statements.push(c.env.DB.prepare(`INSERT INTO campaigns (id,user_id,rpg_id,name,status,session_mode,game_master,session_zero_date,first_session_date,frequency,next_session_date,session_goal,play_group_id,adventure_entity_id,legacy_members_text,legacy_characters_text,legacy_sessions_completed,notes,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(newId, user.id, newRpgId, item.input.name, item.input.status, item.input.sessionMode, item.input.gameMaster, cleanNullable(item.input.sessionZeroDate), cleanNullable(item.input.firstSessionDate), item.input.frequency ?? null, cleanNullable(item.input.nextSessionDate), item.input.sessionGoal ?? null, resolvedPlayGroupId, resolvedAdventureEntityId, item.input.legacyMembersText, item.input.legacyCharactersText, 0, item.input.notes, now, now, item.input.status === 'COMPLETED' ? now : null));
    if (resolvedAdventureEntityId) statements.push(c.env.DB.prepare('INSERT INTO campaign_entities (campaign_id,entity_id,usage_type,created_at) VALUES (?,?,?,?)').bind(newId, resolvedAdventureEntityId, 'ACTIVE', now));
    campaignIdMap.set(item.oldId, newId);
  }

  // ---- Campaign Members — mesma regra de "nunca recriar outra pessoa" do Group Member; no
  // máx. 1 vínculo por (campanha, conta), mesma UNIQUE INDEX da tabela. ----
  const campaignMemberIdMap = new Map<string, string>();
  const usedCampaignUserPairs = new Set<string>();
  for (const item of plan.campaignMembers) {
    const newCampaignId = campaignIdMap.get(item.oldCampaignId); if (!newCampaignId) continue;
    const newId = crypto.randomUUID();
    const resolvedGroupMemberId = item.oldGroupMemberId ? groupMemberIdMap.get(item.oldGroupMemberId) ?? null : null;
    const resolvedCharacterEntityId = item.input.characterEntityId ? entityIdMap.get(item.input.characterEntityId) ?? null : null;
    let memberUserId = item.oldUserId;
    if (memberUserId) { const pairKey = `${newCampaignId}:${memberUserId}`; if (usedCampaignUserPairs.has(pairKey)) memberUserId = null; else usedCampaignUserPairs.add(pairKey); }
    statements.push(c.env.DB.prepare('INSERT INTO campaign_members (id,campaign_id,player_name,character_name,notes,active,character_entity_id,group_member_id,user_id,is_game_master,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(newId, newCampaignId, item.input.playerName, item.input.characterName, item.input.notes, Number(item.input.active), resolvedCharacterEntityId, resolvedGroupMemberId, memberUserId, Number(item.input.isGameMaster), now, now));
    if (resolvedCharacterEntityId) statements.push(c.env.DB.prepare('INSERT OR IGNORE INTO campaign_entities (campaign_id,entity_id,usage_type,created_at) VALUES (?,?,?,?)').bind(newCampaignId, resolvedCharacterEntityId, 'REFERENCE', now));
    campaignMemberIdMap.set(item.oldId, newId);
  }

  // ---- Campaign Sessions + Attendance ----
  let campaignSessionsCreated = 0; let campaignAttendanceCreated = 0;
  for (const item of plan.campaignSessions) {
    const newCampaignId = campaignIdMap.get(item.oldCampaignId); if (!newCampaignId) continue;
    const newId = crypto.randomUUID();
    statements.push(c.env.DB.prepare('INSERT INTO campaign_sessions (id,campaign_id,session_number,title,played_at,summary,gm_notes,next_hooks,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(newId, newCampaignId, item.sessionNumber, item.input.title, item.input.playedAt, item.input.summary, item.input.gmNotes, item.input.nextHooks, now, now));
    campaignSessionsCreated += 1;
    for (const oldMemberId of item.oldAttendeeMemberIds) {
      const newMemberId = campaignMemberIdMap.get(oldMemberId); if (!newMemberId) continue;
      statements.push(c.env.DB.prepare('INSERT INTO campaign_session_attendance (session_id,campaign_member_id) VALUES (?,?)').bind(newId, newMemberId));
      campaignAttendanceCreated += 1;
    }
  }

  // ---- VTT (F-029/F-030/F-032) — precisa de campaignIdMap (Campaigns, já construído acima).
  // Estado ao vivo (is_active/combat_active/combat_round/is_current_turn) sempre volta ao
  // default "inativo" — nunca "revive" uma sessão ao vivo a partir de um backup (ver comentário
  // no plano). ----
  const vttSceneIdMap = new Map<string, string>();
  for (const item of plan.vttScenes) {
    const newCampaignId = campaignIdMap.get(item.oldCampaignId); if (!newCampaignId) continue;
    const newId = crypto.randomUUID();
    const resolvedMapId = item.oldMapId ? worldMapIdMap.get(item.oldMapId) ?? null : null;
    statements.push(c.env.DB.prepare('INSERT INTO vtt_scenes (id,campaign_id,map_id,title,image_url,notes,is_active,fog_enabled,grid_cols,grid_rows,combat_active,combat_round,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?,?,0,0,?,?)')
      .bind(newId, newCampaignId, resolvedMapId, item.input.title, item.input.imageUrl, item.input.notes, Number(item.input.fogEnabled), item.input.gridCols, item.input.gridRows, now, now));
    vttSceneIdMap.set(item.oldId, newId);
  }
  const vttTokenIdMap = new Map<string, string>();
  for (const item of plan.vttTokens) {
    const newSceneId = vttSceneIdMap.get(item.oldSceneId); if (!newSceneId) continue;
    const newId = crypto.randomUUID();
    const resolvedEntityId = item.oldEntityId ? entityIdMap.get(item.oldEntityId) ?? null : null;
    statements.push(c.env.DB.prepare('INSERT INTO vtt_tokens (id,scene_id,entity_id,label,x,y,visible_to_players,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(newId, newSceneId, resolvedEntityId, item.input.label, item.input.x, item.input.y, Number(item.input.visibleToPlayers), now, now));
    vttTokenIdMap.set(item.oldId, newId);
  }
  let vttFogCellsCreated = 0;
  for (const item of plan.vttFogCells) {
    const newSceneId = vttSceneIdMap.get(item.oldSceneId); if (!newSceneId) continue;
    statements.push(c.env.DB.prepare('INSERT OR IGNORE INTO vtt_fog_cells (scene_id,col,row,revealed_at) VALUES (?,?,?,?)').bind(newSceneId, item.input.col, item.input.row, now));
    vttFogCellsCreated += 1;
  }
  let vttCombatantsCreated = 0;
  for (const item of plan.vttCombatants) {
    const newSceneId = vttSceneIdMap.get(item.oldSceneId); if (!newSceneId) continue;
    const resolvedTokenId = item.oldTokenId ? vttTokenIdMap.get(item.oldTokenId) ?? null : null;
    statements.push(c.env.DB.prepare('INSERT INTO vtt_combatants (id,scene_id,token_id,name,initiative,hp_current,hp_max,notes,visible_to_players,is_current_turn,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,?,?)')
      .bind(crypto.randomUUID(), newSceneId, resolvedTokenId, item.input.name, item.input.initiative, item.input.hpCurrent ?? null, item.input.hpMax ?? null, item.input.notes, Number(item.input.visibleToPlayers), now, now));
    vttCombatantsCreated += 1;
  }

  statements.push(c.env.DB.prepare('UPDATE backup_restore_jobs SET confirmed_at=? WHERE id=? AND user_id=?').bind(now, jobId, user.id));
  await c.env.DB.batch(statements);
  return c.json({
    restored: {
      worlds: worldIdMap.size, creatureStatTemplates: templateIdMap.size, entities: entityIdMap.size, journalFolders: folderIdMap.size, journalPages: journalPagesCreated, worldEntityLinks: worldEntityLinksCreated,
      library: rpgIdMap.size, groups: groupIdMap.size, groupMembers: groupMemberIdMap.size, campaigns: campaignIdMap.size, campaignMembers: campaignMemberIdMap.size, campaignSessions: campaignSessionsCreated, campaignAttendance: campaignAttendanceCreated,
      sheetTemplates: sheetTemplateIdMap.size, characterSheets: characterSheetsCreated,
      wikiFolders: wikiFolderIdMap.size, wikiEntityMetadata: wikiEntityMetadataCreated, worldTags: worldTagIdMap.size, wikiEntityTags: wikiEntityTagsCreated, wikiEntityAliases: wikiEntityAliasesCreated, entityRelations: entityRelationsCreated,
      worldMaps: worldMapIdMap.size, mapPins: mapPinsCreated, externalResources: externalResourceIdMap.size, worldEras: worldEraIdMap.size, worldCalendars: worldCalendarIdMap.size, eventTemporalDetails: eventTemporalDetailsCreated,
      adventureScenes: adventureSceneIdMap.size, adventureEncounters: adventureEncountersCreated, adventureSceneEntities: adventureSceneEntitiesCreated, adventureHandouts: adventureHandoutsCreated,
      vttScenes: vttSceneIdMap.size, vttTokens: vttTokenIdMap.size, vttFogCells: vttFogCellsCreated, vttCombatants: vttCombatantsCreated,
    },
    warnings: confirmWarnings,
  });
});
