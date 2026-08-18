// F-003 (External Resources) — referência externa zero-cost (link HTTPS + metadata),
// escopada por World. Deliberadamente NÃO é um Vault Entity: `vault_entities.entity_type`
// tem CHECK(entity_type IN (...)) fechado (migration 0006) — adicionar um valor novo exigiria
// um rebuild da tabela mais referenciada por FK do produto (parent_entity_id, campaign_entities,
// entity_relations, event_temporal_details, e todas as tabelas de detalhe especializado), o
// mesmo tipo de operação que causou o incidente real do LIB-004B (docs/architecture/
// DATABASE_MIGRATION_SAFETY.md) — desproporcional e arriscado sob prazo. Em vez disso, uma
// tabela própria, pequena, aditiva, sem nenhuma FK de entrada (nada referencia
// external_resources.id ainda) — ver migrations/0023_external_resources.sql.
//
// Visibilidade reaproveita o modelo do World (não o modelo de 5 níveis do Vault): leitura para
// quem já pode ver o World (owner ou membro de um World GROUP — mesma authorizedWorld já usada
// por Wiki/Relations/Timeline), escrita só pelo owner (mesmo padrão do Diário/journal.ts).
import { Hono } from 'hono';
import { externalResourceInputSchema } from '../../shared/validation/schemas';
import { authorizedWorld, ownedWorld } from '../content/authorization';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

export const externalResourceRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

externalResourceRoutes.get('/:worldId', async (c) => {
  const worldId = c.req.param('worldId');
  const world = await authorizedWorld(c, worldId);
  const rows = await c.env.DB.prepare(`SELECT id,title,url,description,resource_type resourceType,created_at createdAt,updated_at updatedAt
    FROM external_resources WHERE world_id=? ORDER BY updated_at DESC`).bind(worldId).all();
  return c.json({ world: { id: world.id, name: String(world.name), isOwner: world.owner_user_id === c.get('user').id }, items: rows.results });
});

externalResourceRoutes.post('/:worldId', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const input = await readJson(c, externalResourceInputSchema);
  const id = crypto.randomUUID(), now = nowIso();
  await c.env.DB.prepare(`INSERT INTO external_resources (id,world_id,title,url,description,resource_type,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).bind(id, worldId, input.title, input.url, input.description, input.resourceType, now, now).run();
  return c.json({ item: { id, title: input.title, url: input.url, description: input.description, resourceType: input.resourceType, createdAt: now, updatedAt: now } }, 201);
});

externalResourceRoutes.patch('/:worldId/:resourceId', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const input = await readJson(c, externalResourceInputSchema);
  const result = await c.env.DB.prepare(`UPDATE external_resources SET title=?,url=?,description=?,resource_type=?,updated_at=? WHERE id=? AND world_id=?`)
    .bind(input.title, input.url, input.description, input.resourceType, nowIso(), c.req.param('resourceId'), worldId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Recurso externo não encontrado.');
  return c.json({ success: true });
});

externalResourceRoutes.delete('/:worldId/:resourceId', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const result = await c.env.DB.prepare('DELETE FROM external_resources WHERE id=? AND world_id=?').bind(c.req.param('resourceId'), worldId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Recurso externo não encontrado.');
  return c.body(null, 204);
});
