import { Hono, type Context } from 'hono';
import { canonicalizeRelationEndpoints, isGenealogyRelation, validateRelation } from '../../domain/content/relations';
import { RELATION_TYPES, type RelationType } from '../../domain/content/types';
import { entityRelationInputSchema, type EntityRelationInput } from '../../shared/validation/schemas';
import { entityAuthorizationPredicate, entityAuthorizationValues, authorizedWorld, ownedWorld, worldEntityDiscoveryPredicate } from '../content/authorization';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

interface RelationRow {
  id: string;
  world_id: string;
  source_entity_id: string;
  source_name: string;
  source_type: string;
  target_entity_id: string;
  target_name: string;
  target_type: string;
  relation_type: RelationType;
  label: string;
  description: string;
  direction: 'DIRECTED' | 'BIDIRECTIONAL';
  visibility: EntityRelationInput['visibility'];
  strength: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface EntityReferenceRow {
  id: string;
  name: string;
  entity_type: string;
  visibility: EntityRelationInput['visibility'];
}

const RELATION_SELECT = `SELECT r.*,s.name source_name,s.entity_type source_type,t.name target_name,t.entity_type target_type
  FROM entity_relations r
  JOIN vault_entities s ON s.id=r.source_entity_id
  JOIN vault_entities t ON t.id=r.target_entity_id`;

function presentRelation(row: RelationRow) {
  return {
    id: row.id,
    worldId: row.world_id,
    source: { id: row.source_entity_id, name: row.source_name, entityType: row.source_type },
    target: { id: row.target_entity_id, name: row.target_name, entityType: row.target_type },
    relationType: row.relation_type,
    label: row.label,
    description: row.description,
    direction: row.direction,
    visibility: row.visibility,
    strength: row.strength,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function normalizeLabel(label: string): string {
  return label.trim().normalize('NFKC').toLocaleLowerCase('pt-BR');
}

function relationAuthorizationPredicate(): string {
  const sourceVisible = entityAuthorizationPredicate('s');
  const targetVisible = entityAuthorizationPredicate('t');
  const commonCampaign = (memberCondition = '') => `EXISTS(
    SELECT 1 FROM campaign_entities source_campaign
    JOIN campaign_entities target_campaign ON target_campaign.campaign_id=source_campaign.campaign_id
    JOIN campaign_members member ON member.campaign_id=source_campaign.campaign_id
    WHERE source_campaign.entity_id=r.source_entity_id
      AND target_campaign.entity_id=r.target_entity_id
      AND member.user_id=?${memberCondition}
  )`;
  return `(r.created_by_user_id=? OR (
    r.archived_at IS NULL
    AND ${sourceVisible}
    AND ${targetVisible}
    AND (
      (r.visibility='GROUP' AND EXISTS(SELECT 1 FROM world_members wm WHERE wm.world_id=r.world_id AND wm.user_id=?))
      OR (r.visibility='CAMPAIGN' AND ${commonCampaign()})
      OR (r.visibility='PLAYERS' AND ${commonCampaign(' AND member.active=1')})
      OR (r.visibility='GM_ONLY' AND ${commonCampaign(' AND member.active=1 AND member.is_game_master=1')})
    )
  ))`;
}

function relationAuthorizationValues(userId: string): string[] {
  return [
    userId,
    ...entityAuthorizationValues(userId),
    ...entityAuthorizationValues(userId),
    userId,
    userId,
    userId,
    userId,
  ];
}

async function validateEntityReferences(c: AppContext, worldId: string, input: EntityRelationInput) {
  const endpoints = canonicalizeRelationEndpoints(input.sourceEntityId, input.targetEntityId, input.direction);
  const normalizedInput = { ...input, ...endpoints };
  if (!validateRelation(normalizedInput)) {
    throw new ApiError(422, 'INVALID_RELATION', 'A relação possui pontas, tipo, direção ou rótulo incompatíveis.');
  }

  const rows = await c.env.DB.prepare(`SELECT id FROM vault_entities
    WHERE owner_user_id=? AND world_id=? AND archived_at IS NULL AND id IN (?,?)`)
    .bind(c.get('user').id, worldId, endpoints.sourceEntityId, endpoints.targetEntityId)
    .all<{ id: string }>();
  if (rows.results.length !== 2) {
    throw new ApiError(422, 'INVALID_RELATION_ENDPOINT', 'As duas entidades precisam pertencer ao mesmo World e proprietário.');
  }
  return normalizedInput;
}

async function ensureGenealogyConsistency(c: AppContext, worldId: string, input: EntityRelationInput, currentId: string | null) {
  if (!['PARENT', 'CHILD'].includes(input.relationType)) return;
  const existing = await c.env.DB.prepare(`SELECT id FROM entity_relations
    WHERE world_id=? AND archived_at IS NULL AND relation_type IN ('PARENT','CHILD')
      AND ((source_entity_id=? AND target_entity_id=?) OR (source_entity_id=? AND target_entity_id=?))
      AND (? IS NULL OR id<>?) LIMIT 1`)
    .bind(worldId, input.sourceEntityId, input.targetEntityId, input.targetEntityId, input.sourceEntityId, currentId, currentId)
    .first();
  if (existing) throw new ApiError(409, 'GENEALOGY_CONFLICT', 'Já existe uma relação parental entre estas entidades.');
}

async function ownedRelation(c: AppContext, relationId: string): Promise<RelationRow> {
  const row = await c.env.DB.prepare(`${RELATION_SELECT} WHERE r.id=? AND r.created_by_user_id=?`)
    .bind(relationId, c.get('user').id).first<RelationRow>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Relação não encontrada.');
  return row;
}

export const relationRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

relationRoutes.get('/worlds/:worldId', async (c) => {
  const userId = c.get('user').id;
  const world = await authorizedWorld(c, c.req.param('worldId'));
  const query = c.req.query();
  const archive = query.archive ?? 'active';
  if (!['active', 'archived', 'all'].includes(archive)) throw new ApiError(422, 'INVALID_FILTER', 'Filtro de arquivo inválido.');
  if (archive !== 'active' && world.owner_user_id !== userId) throw new ApiError(404, 'NOT_FOUND', 'World não encontrado.');
  if (query.type && !RELATION_TYPES.includes(query.type as RelationType)) throw new ApiError(422, 'INVALID_TYPE', 'Tipo de relação inválido.');

  const relationWhere = ['r.world_id=?', relationAuthorizationPredicate()];
  const relationFilters: unknown[] = [];
  if (archive === 'active') relationWhere.push('r.archived_at IS NULL');
  if (archive === 'archived') relationWhere.push('r.archived_at IS NOT NULL');
  if (query.type) { relationWhere.push('r.relation_type=?'); relationFilters.push(query.type); }
  if (query.search) {
    relationWhere.push("(s.name LIKE ? ESCAPE '\\' OR t.name LIKE ? ESCAPE '\\' OR r.label LIKE ? ESCAPE '\\')");
    const search = `%${query.search.slice(0, 100).replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    relationFilters.push(search, search, search);
  }
  const relationRows = await c.env.DB.prepare(`${RELATION_SELECT}
    WHERE ${relationWhere.join(' AND ')} ORDER BY r.updated_at DESC LIMIT 500`)
    .bind(world.id, ...relationAuthorizationValues(userId), ...relationFilters).all<RelationRow>();

  // F-022 (BATCH12): entidades linkadas ao World (world_entity_links) também podem
  // aparecer como nó do grafo — relações continuam escopadas ao World onde foram
  // criadas (r.world_id / visible_relation.world_id=e.world_id, inalterado).
  const nodeWhere = [worldEntityDiscoveryPredicate('e'), 'e.archived_at IS NULL', entityAuthorizationPredicate('e')];
  if (query.includeDisconnected !== 'true') {
    nodeWhere.push(`EXISTS(SELECT 1 FROM entity_relations visible_relation
      WHERE visible_relation.world_id=e.world_id AND visible_relation.archived_at IS NULL
        AND (visible_relation.source_entity_id=e.id OR visible_relation.target_entity_id=e.id))`);
  }
  const nodeRows = await c.env.DB.prepare(`SELECT e.id,e.name,e.entity_type,e.visibility FROM vault_entities e
    WHERE ${nodeWhere.join(' AND ')} ORDER BY e.name COLLATE NOCASE LIMIT 500`)
    .bind(world.id, world.id, ...entityAuthorizationValues(userId)).all<EntityReferenceRow>();

  const visibleNodeIds = new Set(nodeRows.results.map((node) => node.id));
  const relations = relationRows.results.filter((relation) => visibleNodeIds.has(relation.source_entity_id) && visibleNodeIds.has(relation.target_entity_id));
  return c.json({
    world: { id: world.id, name: String(world.name), isOwner: world.owner_user_id === userId },
    nodes: nodeRows.results.map((node) => ({ id: node.id, name: node.name, entityType: node.entity_type, visibility: node.visibility })),
    relations: relations.map(presentRelation),
  });
});

relationRoutes.get('/worlds/:worldId/genealogy', async (c) => {
  const worldId = c.req.param('worldId');
  await authorizedWorld(c, worldId);
  const userId = c.get('user').id;
  const rows = await c.env.DB.prepare(`${RELATION_SELECT}
    WHERE r.world_id=? AND r.archived_at IS NULL AND r.relation_type IN ('PARENT','CHILD','SIBLING','PARTNER')
      AND ${relationAuthorizationPredicate()} ORDER BY r.updated_at DESC LIMIT 500`)
    .bind(worldId, ...relationAuthorizationValues(userId)).all<RelationRow>();
  return c.json({ relations: rows.results.filter((row) => isGenealogyRelation(row.relation_type)).map(presentRelation) });
});

relationRoutes.post('/worlds/:worldId', async (c) => {
  const worldId = c.req.param('worldId');
  await ownedWorld(c, worldId);
  const rawInput = await readJson(c, entityRelationInputSchema);
  const input = await validateEntityReferences(c, worldId, rawInput);
  await ensureGenealogyConsistency(c, worldId, input, null);
  const id = crypto.randomUUID();
  const now = nowIso();
  try {
    await c.env.DB.prepare(`INSERT INTO entity_relations
      (id,world_id,source_entity_id,target_entity_id,relation_type,label,label_normalized,description,direction,visibility,strength,created_by_user_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, worldId, input.sourceEntityId, input.targetEntityId, input.relationType, input.label, normalizeLabel(input.label), input.description, input.direction, input.visibility, input.strength, c.get('user').id, now, now).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) throw new ApiError(409, 'RELATION_EXISTS', 'Esta relação já existe.');
    throw error;
  }
  const row = await ownedRelation(c, id);
  return c.json({ item: presentRelation(row) }, 201);
});

relationRoutes.patch('/:relationId', async (c) => {
  const current = await ownedRelation(c, c.req.param('relationId'));
  if (current.archived_at) throw new ApiError(409, 'RELATION_ARCHIVED', 'Restaure a relação antes de editar.');
  const rawInput = await readJson(c, entityRelationInputSchema);
  const input = await validateEntityReferences(c, current.world_id, rawInput);
  await ensureGenealogyConsistency(c, current.world_id, input, current.id);
  try {
    await c.env.DB.prepare(`UPDATE entity_relations SET source_entity_id=?,target_entity_id=?,relation_type=?,label=?,label_normalized=?,
      description=?,direction=?,visibility=?,strength=?,updated_at=? WHERE id=? AND created_by_user_id=?`)
      .bind(input.sourceEntityId, input.targetEntityId, input.relationType, input.label, normalizeLabel(input.label), input.description, input.direction, input.visibility, input.strength, nowIso(), current.id, c.get('user').id).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) throw new ApiError(409, 'RELATION_EXISTS', 'Esta relação já existe.');
    throw error;
  }
  return c.json({ item: presentRelation(await ownedRelation(c, current.id)) });
});

relationRoutes.delete('/:relationId', async (c) => {
  const current = await ownedRelation(c, c.req.param('relationId'));
  if (!current.archived_at) {
    await c.env.DB.prepare('UPDATE entity_relations SET archived_at=?,updated_at=? WHERE id=? AND created_by_user_id=?')
      .bind(nowIso(), nowIso(), current.id, c.get('user').id).run();
  }
  return c.body(null, 204);
});

relationRoutes.post('/:relationId/restore', async (c) => {
  const current = await ownedRelation(c, c.req.param('relationId'));
  if (!current.archived_at) return c.json({ item: presentRelation(current) });
  try {
    await c.env.DB.prepare('UPDATE entity_relations SET archived_at=NULL,updated_at=? WHERE id=? AND created_by_user_id=?')
      .bind(nowIso(), current.id, c.get('user').id).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) throw new ApiError(409, 'RELATION_EXISTS', 'Uma relação equivalente já está ativa.');
    throw error;
  }
  return c.json({ item: presentRelation(await ownedRelation(c, current.id)) });
});
