import { Hono, type Context } from 'hono';
import { adventureEncounterInputSchema, adventureHandoutInputSchema, adventureSceneEntityInputSchema, adventureSceneInputSchema, type AdventureHandoutInput } from '../../shared/validation/schemas';
import { ownedEntity, type AuthorizedEntityRow } from '../content/authorization';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

// F-025 (BATCH13): Adventures aprofundadas — acts/scenes/encounters/handouts,
// estruturados e ligados ao Vault Entity ADVENTURE já existente. Nunca duplica NPCs/
// Locations/Items do Vault (adventure_scene_entities só referencia, mesmo princípio de
// campaign_entities). v1 é ferramenta de preparação do GM: tudo aqui é owned-only (mesmo
// modelo do Diário/Journal) — expor handouts revelados a jogadores fica para F-033 (Player
// View), que já lista F-025 como dependência no roadmap.

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;
interface AdventureEntityRow extends AuthorizedEntityRow { entity_type: string; world_id: string | null }
interface SceneRow { id:string; adventure_entity_id:string; sort_order:number; act:string; title:string; summary:string; read_aloud:string; gm_notes:string; completed_at:string|null; created_at:string; updated_at:string }
interface EncounterRow { id:string; scene_id:string; sort_order:number; name:string; difficulty:string; description:string; gm_notes:string; created_at:string; updated_at:string }
interface SceneEntityRow { sceneId:string; entityId:string; role:string; entityName:string; entityType:string }
interface HandoutRow { id:string; adventure_entity_id:string; scene_id:string|null; external_resource_id:string|null; external_resource_title:string|null; title:string; content:string; revealed_at:string|null; sort_order:number; created_at:string; updated_at:string }

export const adventureRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function presentScene(row: SceneRow) { return { id: row.id, act: row.act, title: row.title, summary: row.summary, readAloud: row.read_aloud, gmNotes: row.gm_notes, completed: Boolean(row.completed_at), sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at }; }
function presentEncounter(row: EncounterRow) { return { id: row.id, sceneId: row.scene_id, name: row.name, difficulty: row.difficulty, description: row.description, gmNotes: row.gm_notes, sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at }; }
function presentHandout(row: HandoutRow) { return { id: row.id, sceneId: row.scene_id, externalResourceId: row.external_resource_id, externalResourceTitle: row.external_resource_title, title: row.title, content: row.content, revealed: Boolean(row.revealed_at), sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at }; }

async function ownedAdventure(c: AppContext, id: string): Promise<AdventureEntityRow> {
  const entity = await ownedEntity(c, id) as AdventureEntityRow;
  if (entity.entity_type !== 'ADVENTURE') throw new ApiError(422, 'INVALID_ENTITY_TYPE', 'Somente entidades do tipo Adventure têm estrutura de acts/scenes/encounters.');
  return entity;
}
async function ownedScene(c: AppContext, adventureId: string, sceneId: string): Promise<SceneRow> {
  await ownedAdventure(c, adventureId);
  const row = await c.env.DB.prepare('SELECT * FROM adventure_scenes WHERE id=? AND adventure_entity_id=?').bind(sceneId, adventureId).first<SceneRow>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Cena não encontrada.');
  return row;
}
async function validHandoutRefs(c: AppContext, adventureWorldId: string | null, input: AdventureHandoutInput, adventureId: string): Promise<void> {
  if (input.sceneId) {
    const scene = await c.env.DB.prepare('SELECT id FROM adventure_scenes WHERE id=? AND adventure_entity_id=?').bind(input.sceneId, adventureId).first();
    if (!scene) throw new ApiError(422, 'INVALID_SCENE', 'Cena inválida.');
  }
  if (input.externalResourceId) {
    if (!adventureWorldId) throw new ApiError(422, 'INVALID_EXTERNAL_RESOURCE', 'A Adventure precisa pertencer a um World para referenciar um Recurso Externo.');
    const resource = await c.env.DB.prepare('SELECT id FROM external_resources WHERE id=? AND world_id=?').bind(input.externalResourceId, adventureWorldId).first();
    if (!resource) throw new ApiError(422, 'INVALID_EXTERNAL_RESOURCE', 'Recurso externo inválido para este World.');
  }
}

adventureRoutes.get('/:adventureId', async (c) => {
  const adventureId = c.req.param('adventureId');
  await ownedAdventure(c, adventureId);
  const [scenes, encounters, sceneEntities, handouts] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM adventure_scenes WHERE adventure_entity_id=? ORDER BY sort_order,created_at').bind(adventureId),
    c.env.DB.prepare('SELECT e.* FROM adventure_encounters e JOIN adventure_scenes s ON s.id=e.scene_id WHERE s.adventure_entity_id=? ORDER BY e.sort_order,e.created_at').bind(adventureId),
    c.env.DB.prepare('SELECT se.scene_id sceneId,se.entity_id entityId,se.role,ve.name entityName,ve.entity_type entityType FROM adventure_scene_entities se JOIN adventure_scenes s ON s.id=se.scene_id JOIN vault_entities ve ON ve.id=se.entity_id WHERE s.adventure_entity_id=? ORDER BY ve.name COLLATE NOCASE').bind(adventureId),
    c.env.DB.prepare('SELECT h.*,er.title external_resource_title FROM adventure_handouts h LEFT JOIN external_resources er ON er.id=h.external_resource_id WHERE h.adventure_entity_id=? ORDER BY h.sort_order,h.created_at').bind(adventureId),
  ]);
  const encountersByScene = new Map<string, ReturnType<typeof presentEncounter>[]>();
  for (const row of encounters.results as unknown as EncounterRow[]) { const list = encountersByScene.get(row.scene_id) ?? []; list.push(presentEncounter(row)); encountersByScene.set(row.scene_id, list); }
  const entitiesByScene = new Map<string, SceneEntityRow[]>();
  for (const row of sceneEntities.results as unknown as SceneEntityRow[]) { const list = entitiesByScene.get(row.sceneId) ?? []; list.push(row); entitiesByScene.set(row.sceneId, list); }
  return c.json({
    scenes: (scenes.results as unknown as SceneRow[]).map((row) => ({ ...presentScene(row), encounters: encountersByScene.get(row.id) ?? [], entities: entitiesByScene.get(row.id) ?? [] })),
    handouts: (handouts.results as unknown as HandoutRow[]).map(presentHandout),
  });
});

adventureRoutes.post('/:adventureId/scenes', async (c) => {
  const adventureId = c.req.param('adventureId'); await ownedAdventure(c, adventureId);
  const input = await readJson(c, adventureSceneInputSchema);
  const id = crypto.randomUUID(), now = nowIso();
  await c.env.DB.prepare('INSERT INTO adventure_scenes (id,adventure_entity_id,sort_order,act,title,summary,read_aloud,gm_notes,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, adventureId, input.sortOrder, input.act, input.title, input.summary, input.readAloud, input.gmNotes, input.completed ? now : null, now, now).run();
  return c.json({ id }, 201);
});

adventureRoutes.patch('/:adventureId/scenes/:sceneId', async (c) => {
  const adventureId = c.req.param('adventureId'), sceneId = c.req.param('sceneId');
  const current = await ownedScene(c, adventureId, sceneId);
  const input = await readJson(c, adventureSceneInputSchema);
  const now = nowIso();
  await c.env.DB.prepare('UPDATE adventure_scenes SET sort_order=?,act=?,title=?,summary=?,read_aloud=?,gm_notes=?,completed_at=?,updated_at=? WHERE id=?')
    .bind(input.sortOrder, input.act, input.title, input.summary, input.readAloud, input.gmNotes, input.completed ? (current.completed_at ?? now) : null, now, sceneId).run();
  return c.json({ success: true });
});

adventureRoutes.delete('/:adventureId/scenes/:sceneId', async (c) => {
  const adventureId = c.req.param('adventureId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, adventureId, sceneId);
  await c.env.DB.prepare('DELETE FROM adventure_scenes WHERE id=?').bind(sceneId).run();
  return c.body(null, 204);
});

adventureRoutes.post('/:adventureId/scenes/:sceneId/encounters', async (c) => {
  const adventureId = c.req.param('adventureId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, adventureId, sceneId);
  const input = await readJson(c, adventureEncounterInputSchema);
  const id = crypto.randomUUID(), now = nowIso();
  await c.env.DB.prepare('INSERT INTO adventure_encounters (id,scene_id,sort_order,name,difficulty,description,gm_notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, sceneId, input.sortOrder, input.name, input.difficulty, input.description, input.gmNotes, now, now).run();
  return c.json({ id }, 201);
});

adventureRoutes.patch('/:adventureId/scenes/:sceneId/encounters/:encounterId', async (c) => {
  const adventureId = c.req.param('adventureId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, adventureId, sceneId);
  const input = await readJson(c, adventureEncounterInputSchema);
  const result = await c.env.DB.prepare('UPDATE adventure_encounters SET sort_order=?,name=?,difficulty=?,description=?,gm_notes=?,updated_at=? WHERE id=? AND scene_id=?')
    .bind(input.sortOrder, input.name, input.difficulty, input.description, input.gmNotes, nowIso(), c.req.param('encounterId'), sceneId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Encontro não encontrado.');
  return c.json({ success: true });
});

adventureRoutes.delete('/:adventureId/scenes/:sceneId/encounters/:encounterId', async (c) => {
  const adventureId = c.req.param('adventureId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, adventureId, sceneId);
  const result = await c.env.DB.prepare('DELETE FROM adventure_encounters WHERE id=? AND scene_id=?').bind(c.req.param('encounterId'), sceneId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Encontro não encontrado.');
  return c.body(null, 204);
});

adventureRoutes.post('/:adventureId/scenes/:sceneId/entities', async (c) => {
  const adventureId = c.req.param('adventureId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, adventureId, sceneId);
  const input = await readJson(c, adventureSceneEntityInputSchema);
  // A entidade linkada precisa pertencer ao mesmo dono (nunca cross-account) — reaproveita
  // ownedEntity para validar em vez de reinventar a checagem.
  await ownedEntity(c, input.entityId);
  await c.env.DB.prepare(`INSERT INTO adventure_scene_entities (scene_id,entity_id,role,created_at) VALUES (?,?,?,?)
    ON CONFLICT(scene_id,entity_id) DO UPDATE SET role=excluded.role`).bind(sceneId, input.entityId, input.role, nowIso()).run();
  return c.json({ success: true }, 201);
});

adventureRoutes.delete('/:adventureId/scenes/:sceneId/entities/:entityId', async (c) => {
  const adventureId = c.req.param('adventureId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, adventureId, sceneId);
  await c.env.DB.prepare('DELETE FROM adventure_scene_entities WHERE scene_id=? AND entity_id=?').bind(sceneId, c.req.param('entityId')).run();
  return c.body(null, 204);
});

adventureRoutes.post('/:adventureId/handouts', async (c) => {
  const adventureId = c.req.param('adventureId'); const adventure = await ownedAdventure(c, adventureId);
  const input = await readJson(c, adventureHandoutInputSchema);
  await validHandoutRefs(c, adventure.world_id, input, adventureId);
  const id = crypto.randomUUID(), now = nowIso();
  await c.env.DB.prepare('INSERT INTO adventure_handouts (id,adventure_entity_id,scene_id,external_resource_id,title,content,revealed_at,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(id, adventureId, input.sceneId ?? null, input.externalResourceId ?? null, input.title, input.content, input.revealed ? now : null, input.sortOrder, now, now).run();
  return c.json({ id }, 201);
});

adventureRoutes.patch('/:adventureId/handouts/:handoutId', async (c) => {
  const adventureId = c.req.param('adventureId'); const adventure = await ownedAdventure(c, adventureId);
  const handoutId = c.req.param('handoutId');
  const current = await c.env.DB.prepare('SELECT revealed_at FROM adventure_handouts WHERE id=? AND adventure_entity_id=?').bind(handoutId, adventureId).first<{ revealed_at: string | null }>();
  if (!current) throw new ApiError(404, 'NOT_FOUND', 'Handout não encontrado.');
  const input = await readJson(c, adventureHandoutInputSchema);
  await validHandoutRefs(c, adventure.world_id, input, adventureId);
  const now = nowIso();
  await c.env.DB.prepare('UPDATE adventure_handouts SET scene_id=?,external_resource_id=?,title=?,content=?,revealed_at=?,sort_order=?,updated_at=? WHERE id=?')
    .bind(input.sceneId ?? null, input.externalResourceId ?? null, input.title, input.content, input.revealed ? (current.revealed_at ?? now) : null, input.sortOrder, now, handoutId).run();
  return c.json({ success: true });
});

adventureRoutes.delete('/:adventureId/handouts/:handoutId', async (c) => {
  const adventureId = c.req.param('adventureId'); await ownedAdventure(c, adventureId);
  const result = await c.env.DB.prepare('DELETE FROM adventure_handouts WHERE id=? AND adventure_entity_id=?').bind(c.req.param('handoutId'), adventureId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Handout não encontrado.');
  return c.body(null, 204);
});
