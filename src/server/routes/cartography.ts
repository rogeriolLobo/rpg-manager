// F-002: Cartografia zero-cost — mapas (imagem externa) + pins (coordenadas normalizadas),
// escopados por World. Versão 1.0 deliberadamente simples: NÃO é VTT (sem tokens em tempo
// real, fog of war, movimento ou WebSockets — ver docs/product/MASTER_BACKLOG.md). Mesmo
// padrão de autorização do Diário/External Resources: leitura para quem `canViewWorld`,
// escrita só pelo owner do World.
import { Hono, type Context } from 'hono';
import { mapPinInputSchema, worldMapInputSchema } from '../../shared/validation/schemas';
import { authorizedWorld, ownedWorld } from '../content/authorization';
import { ApiError, cleanNullable, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

export const cartographyRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

async function ownedMap(c: Context<{ Bindings: Env; Variables: AppVariables }>, worldId: string, mapId: string) {
  await ownedWorld(c, worldId);
  const map = await c.env.DB.prepare('SELECT id FROM world_maps WHERE id=? AND world_id=?').bind(mapId, worldId).first();
  if (!map) throw new ApiError(404, 'NOT_FOUND', 'Mapa não encontrado.');
}

async function validatePinEntity(c: Context<{ Bindings: Env; Variables: AppVariables }>, entityId: string | null): Promise<void> {
  if (!entityId) return;
  const entity = await c.env.DB.prepare('SELECT id FROM vault_entities WHERE id=? AND owner_user_id=? AND archived_at IS NULL')
    .bind(entityId, c.get('user').id).first();
  if (!entity) throw new ApiError(422, 'INVALID_PIN_ENTITY', 'Entidade vinculada inválida.');
}

cartographyRoutes.get('/:worldId', async (c) => {
  const worldId = c.req.param('worldId');
  await authorizedWorld(c, worldId);
  const rows = await c.env.DB.prepare(`SELECT id,title,image_url imageUrl,notes,created_at createdAt,updated_at updatedAt
    FROM world_maps WHERE world_id=? ORDER BY updated_at DESC`).bind(worldId).all();
  return c.json({ items: rows.results });
});

cartographyRoutes.post('/:worldId', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const input = await readJson(c, worldMapInputSchema);
  const id = crypto.randomUUID(), now = nowIso();
  await c.env.DB.prepare('INSERT INTO world_maps (id,world_id,title,image_url,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id, worldId, input.title, input.imageUrl, input.notes, now, now).run();
  return c.json({ item: { id, title: input.title, imageUrl: input.imageUrl, notes: input.notes, createdAt: now, updatedAt: now } }, 201);
});

cartographyRoutes.delete('/:worldId/:mapId', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const result = await c.env.DB.prepare('DELETE FROM world_maps WHERE id=? AND world_id=?').bind(c.req.param('mapId'), worldId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Mapa não encontrado.');
  return c.body(null, 204);
});

// Mapa + pins juntos (evita round-trip extra) — leitura para quem canViewWorld.
cartographyRoutes.get('/:worldId/:mapId', async (c) => {
  const worldId = c.req.param('worldId'), mapId = c.req.param('mapId');
  const world = await authorizedWorld(c, worldId);
  const map = await c.env.DB.prepare('SELECT id,title,image_url imageUrl,notes,created_at createdAt,updated_at updatedAt FROM world_maps WHERE id=? AND world_id=?').bind(mapId, worldId).first();
  if (!map) throw new ApiError(404, 'NOT_FOUND', 'Mapa não encontrado.');
  const pins = await c.env.DB.prepare(`SELECT p.id,p.label,p.notes,p.x,p.y,p.entity_id entityId,e.name entityName,p.created_at createdAt,p.updated_at updatedAt
    FROM map_pins p LEFT JOIN vault_entities e ON e.id=p.entity_id WHERE p.map_id=? ORDER BY p.created_at`).bind(mapId).all();
  return c.json({ map, pins: pins.results, isOwner: world.owner_user_id === c.get('user').id });
});

cartographyRoutes.post('/:worldId/:mapId/pins', async (c) => {
  const worldId = c.req.param('worldId'), mapId = c.req.param('mapId');
  await ownedMap(c, worldId, mapId);
  const input = await readJson(c, mapPinInputSchema);
  await validatePinEntity(c, input.entityId);
  const id = crypto.randomUUID(), now = nowIso();
  await c.env.DB.prepare('INSERT INTO map_pins (id,map_id,entity_id,label,notes,x,y,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, mapId, cleanNullable(input.entityId), input.label, input.notes, input.x, input.y, now, now).run();
  return c.json({ item: { id, label: input.label, notes: input.notes, x: input.x, y: input.y, entityId: input.entityId, createdAt: now, updatedAt: now } }, 201);
});

cartographyRoutes.patch('/:worldId/:mapId/pins/:pinId', async (c) => {
  const worldId = c.req.param('worldId'), mapId = c.req.param('mapId');
  await ownedMap(c, worldId, mapId);
  const input = await readJson(c, mapPinInputSchema);
  await validatePinEntity(c, input.entityId);
  const result = await c.env.DB.prepare('UPDATE map_pins SET entity_id=?,label=?,notes=?,x=?,y=?,updated_at=? WHERE id=? AND map_id=?')
    .bind(cleanNullable(input.entityId), input.label, input.notes, input.x, input.y, nowIso(), c.req.param('pinId'), mapId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Pin não encontrado.');
  return c.json({ success: true });
});

cartographyRoutes.delete('/:worldId/:mapId/pins/:pinId', async (c) => {
  const worldId = c.req.param('worldId'), mapId = c.req.param('mapId');
  await ownedMap(c, worldId, mapId);
  const result = await c.env.DB.prepare('DELETE FROM map_pins WHERE id=? AND map_id=?').bind(c.req.param('pinId'), mapId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Pin não encontrado.');
  return c.body(null, 204);
});
