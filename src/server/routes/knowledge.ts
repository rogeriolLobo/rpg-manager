import { Hono } from 'hono';
import { ENTITY_TYPES, type VaultEntityType } from '../../domain/content/types';
import { extractWikiMentions, normalizeEditorialLabel } from '../../domain/content/wiki';
import { wikiEntityOrganizationSchema, wikiFolderInputSchema, worldTagInputSchema } from '../../shared/validation/schemas';
import { authorizedEntity, authorizedWorld, entityAuthorizationPredicate, entityAuthorizationValues, ownedEntity, ownedWorld } from '../content/authorization';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

export const knowledgeRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function escapedSearch(value: string): string {
  return `%${value.slice(0, 100).replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

async function validateFolderParent(env: Env, worldId: string, folderId: string | null, parentFolderId: string | null): Promise<void> {
  if (!parentFolderId) return;
  if (folderId === parentFolderId) throw new ApiError(422, 'INVALID_FOLDER_PARENT', 'Uma pasta não pode ser pai de si mesma.');
  const parent = await env.DB.prepare('SELECT id FROM wiki_folders WHERE id=? AND world_id=?').bind(parentFolderId, worldId).first();
  if (!parent) throw new ApiError(422, 'INVALID_FOLDER_PARENT', 'Pasta pai inválida.');
  if (!folderId) return;
  const descendants = await env.DB.prepare(`WITH RECURSIVE tree(id) AS (
    SELECT id FROM wiki_folders WHERE parent_folder_id=?
    UNION ALL SELECT f.id FROM wiki_folders f JOIN tree ON f.parent_folder_id=tree.id
  ) SELECT id FROM tree WHERE id=?`).bind(folderId, parentFolderId).first();
  if (descendants) throw new ApiError(422, 'INVALID_FOLDER_PARENT', 'A hierarquia de pastas não pode ser cíclica.');
}

knowledgeRoutes.get('/:worldId', async (c) => {
  const worldId = c.req.param('worldId');
  const world = await authorizedWorld(c, worldId);
  const userId = c.get('user').id;
  const query = c.req.query();
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(query.pageSize ?? '24', 10) || 24));
  const where = ['e.world_id=?', 'e.archived_at IS NULL', entityAuthorizationPredicate()];
  const values: unknown[] = [worldId, ...entityAuthorizationValues(userId)];
  if (query.type) {
    if (!ENTITY_TYPES.includes(query.type as VaultEntityType)) throw new ApiError(422, 'INVALID_TYPE', 'Tipo de entidade inválido.');
    where.push('e.entity_type=?'); values.push(query.type);
  }
  if (query.folderId === 'unfiled') where.push('m.folder_id IS NULL');
  else if (query.folderId) { where.push('m.folder_id=?'); values.push(query.folderId); }
  if (query.tagId) {
    where.push('EXISTS(SELECT 1 FROM wiki_entity_tags filter_tag WHERE filter_tag.entity_id=e.id AND filter_tag.tag_id=?)');
    values.push(query.tagId);
  }
  if (query.search) {
    where.push(`(e.name LIKE ? ESCAPE '\\' OR e.summary LIKE ? ESCAPE '\\' OR EXISTS(
      SELECT 1 FROM wiki_entity_aliases search_alias WHERE search_alias.entity_id=e.id AND search_alias.alias LIKE ? ESCAPE '\\'))`);
    const search = escapedSearch(query.search); values.push(search, search, search);
  }
  const clause = where.join(' AND ');
  const authValues = entityAuthorizationValues(userId);
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT e.id,e.entity_type entityType,e.name,e.summary,e.visibility,e.updated_at updatedAt,
      m.folder_id folderId,f.name folderName FROM vault_entities e
      LEFT JOIN wiki_entity_metadata m ON m.entity_id=e.id LEFT JOIN wiki_folders f ON f.id=m.folder_id
      WHERE ${clause} ORDER BY COALESCE(m.sort_order,0),e.name COLLATE NOCASE LIMIT ? OFFSET ?`)
      .bind(...values, pageSize, (page - 1) * pageSize),
    c.env.DB.prepare(`SELECT COUNT(*) total FROM vault_entities e LEFT JOIN wiki_entity_metadata m ON m.entity_id=e.id WHERE ${clause}`).bind(...values),
    c.env.DB.prepare('SELECT id,parent_folder_id parentFolderId,name,sort_order sortOrder FROM wiki_folders WHERE world_id=? ORDER BY sort_order,name COLLATE NOCASE').bind(worldId),
    c.env.DB.prepare('SELECT id,name FROM world_tags WHERE world_id=? ORDER BY name COLLATE NOCASE').bind(worldId),
    c.env.DB.prepare(`SELECT et.entity_id entityId,t.id,t.name FROM wiki_entity_tags et JOIN world_tags t ON t.id=et.tag_id
      JOIN vault_entities e ON e.id=et.entity_id WHERE e.world_id=? AND e.archived_at IS NULL AND ${entityAuthorizationPredicate()}
      ORDER BY t.name COLLATE NOCASE`).bind(worldId, ...authValues),
    c.env.DB.prepare(`SELECT a.entity_id entityId,a.id,a.alias FROM wiki_entity_aliases a JOIN vault_entities e ON e.id=a.entity_id
      WHERE e.world_id=? AND e.archived_at IS NULL AND ${entityAuthorizationPredicate()} ORDER BY a.alias COLLATE NOCASE`).bind(worldId, ...authValues),
  ]);
  return c.json({
    world: { id: world.id, name: String(world.name), isOwner: world.owner_user_id === userId },
    items: results[0].results,
    pagination: { page, pageSize, total: Number((results[1].results[0] as { total: number }).total) },
    folders: results[2].results,
    tags: results[3].results,
    entityTags: results[4].results,
    aliases: results[5].results,
  });
});

knowledgeRoutes.get('/:worldId/entities/:entityId/backlinks', async (c) => {
  const worldId = c.req.param('worldId');
  await authorizedWorld(c, worldId);
  const target = await authorizedEntity(c, c.req.param('entityId'));
  if (target.world_id !== worldId) throw new ApiError(404, 'NOT_FOUND', 'Entidade não encontrada neste World.');
  const aliases = await c.env.DB.prepare('SELECT alias FROM wiki_entity_aliases WHERE entity_id=?').bind(target.id).all<{ alias: string }>();
  const targetNames = new Set([normalizeEditorialLabel(String(target.name)), ...aliases.results.map((item) => normalizeEditorialLabel(item.alias))]);
  const userId = c.get('user').id;
  const sources = await c.env.DB.prepare(`SELECT e.id,e.name,e.entity_type entityType,e.description FROM vault_entities e
    WHERE e.world_id=? AND e.id<>? AND e.archived_at IS NULL AND ${entityAuthorizationPredicate()} ORDER BY e.name COLLATE NOCASE`)
    .bind(worldId, target.id, ...entityAuthorizationValues(userId)).all<{ id: string; name: string; entityType: string; description: string }>();
  return c.json({ items: sources.results.filter((source) => extractWikiMentions(source.description).some((mention) => targetNames.has(mention))).map(({ description: _description, ...source }) => source) });
});

knowledgeRoutes.post('/:worldId/folders', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const input = await readJson(c, wikiFolderInputSchema); await validateFolderParent(c.env, worldId, null, input.parentFolderId);
  const id = crypto.randomUUID(), now = nowIso();
  await c.env.DB.prepare('INSERT INTO wiki_folders (id,world_id,parent_folder_id,name,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .bind(id, worldId, input.parentFolderId, input.name, now, now).run();
  return c.json({ item: { id, name: input.name, parentFolderId: input.parentFolderId } }, 201);
});

knowledgeRoutes.patch('/:worldId/folders/:folderId', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const folderId = c.req.param('folderId');
  const folder = await c.env.DB.prepare('SELECT id FROM wiki_folders WHERE id=? AND world_id=?').bind(folderId, worldId).first();
  if (!folder) throw new ApiError(404, 'NOT_FOUND', 'Pasta não encontrada.');
  const input = await readJson(c, wikiFolderInputSchema); await validateFolderParent(c.env, worldId, folderId, input.parentFolderId);
  await c.env.DB.prepare('UPDATE wiki_folders SET parent_folder_id=?,name=?,updated_at=? WHERE id=? AND world_id=?')
    .bind(input.parentFolderId, input.name, nowIso(), folderId, worldId).run();
  return c.json({ success: true });
});

knowledgeRoutes.delete('/:worldId/folders/:folderId', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const folderId = c.req.param('folderId');
  const child = await c.env.DB.prepare('SELECT id FROM wiki_folders WHERE parent_folder_id=? LIMIT 1').bind(folderId).first();
  if (child) throw new ApiError(409, 'FOLDER_HAS_CHILDREN', 'Mova ou exclua as subpastas primeiro.');
  const result = await c.env.DB.prepare('DELETE FROM wiki_folders WHERE id=? AND world_id=?').bind(folderId, worldId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Pasta não encontrada.');
  return c.body(null, 204);
});

knowledgeRoutes.post('/:worldId/tags', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const input = await readJson(c, worldTagInputSchema); const normalized = normalizeEditorialLabel(input.name);
  const duplicate = await c.env.DB.prepare('SELECT id FROM world_tags WHERE world_id=? AND normalized_name=?').bind(worldId, normalized).first();
  if (duplicate) throw new ApiError(409, 'TAG_ALREADY_EXISTS', 'Esta tag já existe no World.');
  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO world_tags (id,world_id,name,normalized_name,created_at) VALUES (?,?,?,?,?)').bind(id, worldId, input.name, normalized, nowIso()).run();
  return c.json({ item: { id, name: input.name } }, 201);
});

knowledgeRoutes.delete('/:worldId/tags/:tagId', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const result = await c.env.DB.prepare('DELETE FROM world_tags WHERE id=? AND world_id=?').bind(c.req.param('tagId'), worldId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Tag não encontrada.');
  return c.body(null, 204);
});

knowledgeRoutes.patch('/:worldId/entities/:entityId', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const entity = await ownedEntity(c, c.req.param('entityId'));
  if (entity.world_id !== worldId) throw new ApiError(404, 'NOT_FOUND', 'Entidade não encontrada neste World.');
  const input = await readJson(c, wikiEntityOrganizationSchema);
  if (input.folderId) {
    const folder = await c.env.DB.prepare('SELECT id FROM wiki_folders WHERE id=? AND world_id=?').bind(input.folderId, worldId).first();
    if (!folder) throw new ApiError(422, 'INVALID_WIKI_FOLDER', 'Pasta inválida.');
  }
  const tagIds = [...new Set(input.tagIds)];
  if (tagIds.length) {
    const placeholders = tagIds.map(() => '?').join(',');
    const count = await c.env.DB.prepare(`SELECT COUNT(*) total FROM world_tags WHERE world_id=? AND id IN (${placeholders})`).bind(worldId, ...tagIds).first<{ total: number }>();
    if (Number(count?.total) !== tagIds.length) throw new ApiError(422, 'INVALID_WIKI_TAG', 'Uma ou mais tags são inválidas.');
  }
  const aliases = [...new Map(input.aliases.map((alias) => [normalizeEditorialLabel(alias), alias.trim()])).entries()]
    .filter(([normalized]) => normalized !== normalizeEditorialLabel(String(entity.name)));
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`INSERT INTO wiki_entity_metadata (entity_id,folder_id,updated_at) VALUES (?,?,?)
      ON CONFLICT(entity_id) DO UPDATE SET folder_id=excluded.folder_id,updated_at=excluded.updated_at`).bind(entity.id, input.folderId, now),
    c.env.DB.prepare('DELETE FROM wiki_entity_tags WHERE entity_id=?').bind(entity.id),
    c.env.DB.prepare('DELETE FROM wiki_entity_aliases WHERE entity_id=?').bind(entity.id),
    ...tagIds.map((tagId) => c.env.DB.prepare('INSERT INTO wiki_entity_tags (entity_id,tag_id,created_at) VALUES (?,?,?)').bind(entity.id, tagId, now)),
    ...aliases.map(([normalized, alias]) => c.env.DB.prepare('INSERT INTO wiki_entity_aliases (id,entity_id,alias,normalized_alias,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), entity.id, alias, normalized, now)),
  ];
  await c.env.DB.batch(statements);
  return c.json({ success: true });
});
