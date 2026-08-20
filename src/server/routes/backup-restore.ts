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
// 2) Escopo v1 do restore automatizado: Worlds, Creature Stat Templates,
//    Vault entities (+ todos os campos especializados), Journal (pastas e
//    páginas). Groups/Campaigns/Library, Wiki (organização), Relations,
//    Cartografia, External Resources, Timeline/Calendar e Revision History
//    continuam cobertos pelo EXPORT — nada é perdido no backup — mas ainda
//    não têm restore automatizado nesta v1. Ver FULL_ROADMAP.md.
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
  creatureStatTemplateInputSchema, journalFolderInputSchema, journalPageInputSchema, vaultEntityInputSchema, worldInputSchema,
  type CreatureStatTemplateInput, type JournalPageInput, type VaultEntityInput, type WorldInput,
} from '../../shared/validation/schemas';
import { createWorldSlug } from '../../domain/content/validation';
import { SUPPORTED_BACKUP_SCHEMA_VERSION, type BackupRestoreWarning } from '../../domain/backup/types';
import { ApiError, nowIso, readJson } from '../http';
import { hashSecret } from '../security/crypto';
import { recordRevisionStatement } from '../content/revisions';
import { specializedStatements } from './vault';
import type { AppVariables, Env } from '../types';

export const backupRestoreRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

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

interface WorldPlanItem { oldId: string; input: WorldInput }
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
interface RestorePlan {
  worlds: WorldPlanItem[]; creatureStatTemplates: TemplatePlanItem[]; entities: EntityPlanItem[];
  journalFolders: JournalFolderPlanItem[]; journalPages: JournalPagePlanItem[]; worldEntityLinks: WorldEntityLinkPlanItem[]; warnings: BackupRestoreWarning[];
}
const restorePlanSchema = z.strictObject({
  worlds: z.array(z.strictObject({ oldId: z.string(), input: worldInputSchema })),
  creatureStatTemplates: z.array(z.strictObject({ oldId: z.string(), oldWorldId: z.string(), input: creatureStatTemplateInputSchema })),
  entities: z.array(z.strictObject({ oldId: z.string(), oldWorldId: z.string().nullable(), oldParentEntityId: z.string().nullable(), oldTemplateId: z.string().nullable(), input: vaultEntityInputSchema })),
  journalFolders: z.array(z.strictObject({ oldId: z.string(), oldWorldId: z.string(), oldParentFolderId: z.string().nullable(), input: journalFolderInputSchema })),
  journalPages: z.array(z.strictObject({ oldId: z.string(), oldWorldId: z.string(), oldFolderId: z.string().nullable(), input: journalPageInputSchema })),
  worldEntityLinks: z.array(z.strictObject({ oldWorldId: z.string(), oldEntityId: z.string() })),
  warnings: z.array(z.strictObject({ domain: z.string(), oldId: z.string(), message: z.string() })),
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
    worlds.push({ oldId, input: parsed.data });
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

  return { worlds, creatureStatTemplates, entities, journalFolders, journalPages, worldEntityLinks, warnings };
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
  const rowCount = plan.worlds.length + plan.creatureStatTemplates.length + plan.entities.length + plan.journalFolders.length + plan.journalPages.length + plan.worldEntityLinks.length;
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
    summary: { worlds: plan.worlds.length, creatureStatTemplates: plan.creatureStatTemplates.length, entities: plan.entities.length, journalFolders: plan.journalFolders.length, journalPages: plan.journalPages.length, worldEntityLinks: plan.worldEntityLinks.length },
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
    const defaultRpgId = item.input.defaultRpgId && validRpgIds.has(item.input.defaultRpgId) ? item.input.defaultRpgId : null;
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

  statements.push(c.env.DB.prepare('UPDATE backup_restore_jobs SET confirmed_at=? WHERE id=? AND user_id=?').bind(now, jobId, user.id));
  await c.env.DB.batch(statements);
  return c.json({
    restored: { worlds: worldIdMap.size, creatureStatTemplates: templateIdMap.size, entities: entityIdMap.size, journalFolders: folderIdMap.size, journalPages: journalPagesCreated, worldEntityLinks: worldEntityLinksCreated },
  });
});
