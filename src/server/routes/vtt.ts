import { Hono, type Context } from 'hono';
import { vttSceneInputSchema, vttTokenInputSchema } from '../../shared/validation/schemas';
import { ownedEntity } from '../content/authorization';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

// F-029 (BATCH16): VTT — fundação (Scene/Map/tokens), sem realtime — ver
// migrations/0037_vtt_foundation.sql. Escrita é sempre owner-only (mesmo modelo de todo o
// resto de campaigns.ts — membros com is_game_master=1 hoje só têm leitura em qualquer parte
// do produto, nunca escrita; não é uma restrição nova criada aqui).
//
// GET /:campaignId/live é o único ponto do VTT onde alguém além do dono lê dados — por isso o
// filtro de visibilidade é aplicado sempre, para todo mundo, mesmo o dono (quem quiser o
// estado completo usa GET /scenes/:sceneId, owner-only). Decisão de segurança deliberada: a
// visão "ao vivo" NUNCA inclui entityId/entityName/entityType do token, só id/label/x/y — um
// token vinculado a uma Vault Entity PRIVATE/GM_ONLY marcado (por engano ou não)
// visible_to_players=1 não pode vazar o nome/tipo dessa entidade para o jogador; ele só vê o
// rótulo livre que o mestre digitou no token, nunca um atalho para o registro do Vault.

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;
interface SceneRow { id: string; campaign_id: string; map_id: string | null; title: string; image_url: string; notes: string; is_active: number; created_at: string; updated_at: string }
interface TokenRow { id: string; scene_id: string; entity_id: string | null; label: string; x: number; y: number; visible_to_players: number; created_at: string; updated_at: string; entity_name?: string | null; entity_type?: string | null }

export const vttRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function presentScene(row: SceneRow) { return { id: row.id, mapId: row.map_id, title: row.title, imageUrl: row.image_url, notes: row.notes, isActive: Boolean(row.is_active), createdAt: row.created_at, updatedAt: row.updated_at }; }
function presentToken(row: TokenRow) { return { id: row.id, sceneId: row.scene_id, entityId: row.entity_id, entityName: row.entity_name ?? null, entityType: row.entity_type ?? null, label: row.label, x: row.x, y: row.y, visibleToPlayers: Boolean(row.visible_to_players), createdAt: row.created_at, updatedAt: row.updated_at }; }
function presentPlayerToken(row: TokenRow) { return { id: row.id, label: row.label, x: row.x, y: row.y }; }

async function ownedCampaignId(c: AppContext, id: string): Promise<string> {
  const row = await c.env.DB.prepare('SELECT id FROM campaigns WHERE id=? AND user_id=?').bind(id, c.get('user').id).first();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Campanha não encontrada.');
  return id;
}
async function ownedScene(c: AppContext, campaignId: string, sceneId: string): Promise<SceneRow> {
  await ownedCampaignId(c, campaignId);
  const row = await c.env.DB.prepare('SELECT * FROM vtt_scenes WHERE id=? AND campaign_id=?').bind(sceneId, campaignId).first<SceneRow>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Cena não encontrada.');
  return row;
}
async function validMap(c: AppContext, mapId: string | null | undefined): Promise<void> {
  if (!mapId) return;
  const row = await c.env.DB.prepare('SELECT wm.id FROM world_maps wm JOIN worlds w ON w.id=wm.world_id WHERE wm.id=? AND w.owner_user_id=?').bind(mapId, c.get('user').id).first();
  if (!row) throw new ApiError(422, 'INVALID_MAP', 'Mapa inválido.');
}
// Resolve a imagem de fundo real (mapa da Cartografia OU image_url própria) — usado tanto na
// visão do GM quanto na visão "ao vivo" do jogador, para nenhuma das duas exigir uma segunda
// chamada a /cartography (cujo World pode não ser um World ao qual o jogador tenha acesso).
async function resolveImageUrl(c: AppContext, scene: SceneRow): Promise<string> {
  if (!scene.map_id) return scene.image_url;
  const map = await c.env.DB.prepare('SELECT image_url FROM world_maps WHERE id=?').bind(scene.map_id).first<{ image_url: string }>();
  return map?.image_url ?? scene.image_url;
}

vttRoutes.get('/:campaignId/scenes', async (c) => {
  const campaignId = c.req.param('campaignId'); await ownedCampaignId(c, campaignId);
  const scenes = await c.env.DB.prepare('SELECT * FROM vtt_scenes WHERE campaign_id=? ORDER BY updated_at DESC').bind(campaignId).all<SceneRow>();
  return c.json({ items: scenes.results.map(presentScene) });
});

vttRoutes.post('/:campaignId/scenes', async (c) => {
  const campaignId = c.req.param('campaignId'); await ownedCampaignId(c, campaignId);
  const input = await readJson(c, vttSceneInputSchema);
  if (!input.mapId && !input.imageUrl) throw new ApiError(422, 'INVALID_BACKGROUND', 'Informe um mapa da Cartografia ou uma URL de imagem de fundo.');
  await validMap(c, input.mapId);
  const id = crypto.randomUUID(), now = nowIso();
  await c.env.DB.prepare('INSERT INTO vtt_scenes (id,campaign_id,map_id,title,image_url,notes,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?)')
    .bind(id, campaignId, input.mapId ?? null, input.title, input.imageUrl, input.notes, now, now).run();
  return c.json({ id }, 201);
});

vttRoutes.get('/:campaignId/scenes/:sceneId', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  const scene = await ownedScene(c, campaignId, sceneId);
  const tokens = await c.env.DB.prepare('SELECT t.*,ve.name entity_name,ve.entity_type entity_type FROM vtt_tokens t LEFT JOIN vault_entities ve ON ve.id=t.entity_id WHERE t.scene_id=? ORDER BY t.created_at').bind(sceneId).all<TokenRow>();
  const resolvedImageUrl = await resolveImageUrl(c, scene);
  return c.json({ item: { ...presentScene(scene), resolvedImageUrl }, tokens: tokens.results.map(presentToken) });
});

vttRoutes.patch('/:campaignId/scenes/:sceneId', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, campaignId, sceneId);
  const input = await readJson(c, vttSceneInputSchema);
  if (!input.mapId && !input.imageUrl) throw new ApiError(422, 'INVALID_BACKGROUND', 'Informe um mapa da Cartografia ou uma URL de imagem de fundo.');
  await validMap(c, input.mapId);
  await c.env.DB.prepare('UPDATE vtt_scenes SET map_id=?,title=?,image_url=?,notes=?,updated_at=? WHERE id=?')
    .bind(input.mapId ?? null, input.title, input.imageUrl, input.notes, nowIso(), sceneId).run();
  return c.json({ success: true });
});

vttRoutes.delete('/:campaignId/scenes/:sceneId', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, campaignId, sceneId);
  await c.env.DB.prepare('DELETE FROM vtt_scenes WHERE id=?').bind(sceneId).run();
  return c.body(null, 204);
});

vttRoutes.post('/:campaignId/scenes/:sceneId/activate', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, campaignId, sceneId);
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE vtt_scenes SET is_active=0,updated_at=? WHERE campaign_id=? AND is_active=1 AND id!=?').bind(now, campaignId, sceneId),
    c.env.DB.prepare('UPDATE vtt_scenes SET is_active=1,updated_at=? WHERE id=?').bind(now, sceneId),
  ]);
  return c.json({ success: true });
});

vttRoutes.post('/:campaignId/scenes/:sceneId/deactivate', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, campaignId, sceneId);
  await c.env.DB.prepare('UPDATE vtt_scenes SET is_active=0,updated_at=? WHERE id=?').bind(nowIso(), sceneId).run();
  return c.json({ success: true });
});

vttRoutes.post('/:campaignId/scenes/:sceneId/tokens', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, campaignId, sceneId);
  const input = await readJson(c, vttTokenInputSchema);
  // O token só pode apontar para uma entidade do próprio dono (nunca cross-account) — reaproveita
  // ownedEntity em vez de reinventar a checagem, mesmo princípio de adventure_scene_entities.
  if (input.entityId) await ownedEntity(c, input.entityId);
  const id = crypto.randomUUID(), now = nowIso();
  await c.env.DB.prepare('INSERT INTO vtt_tokens (id,scene_id,entity_id,label,x,y,visible_to_players,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, sceneId, input.entityId ?? null, input.label, input.x, input.y, Number(input.visibleToPlayers), now, now).run();
  return c.json({ id }, 201);
});

vttRoutes.patch('/:campaignId/scenes/:sceneId/tokens/:tokenId', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, campaignId, sceneId);
  const input = await readJson(c, vttTokenInputSchema);
  if (input.entityId) await ownedEntity(c, input.entityId);
  const result = await c.env.DB.prepare('UPDATE vtt_tokens SET entity_id=?,label=?,x=?,y=?,visible_to_players=?,updated_at=? WHERE id=? AND scene_id=?')
    .bind(input.entityId ?? null, input.label, input.x, input.y, Number(input.visibleToPlayers), nowIso(), c.req.param('tokenId'), sceneId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Token não encontrado.');
  return c.json({ success: true });
});

vttRoutes.delete('/:campaignId/scenes/:sceneId/tokens/:tokenId', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, campaignId, sceneId);
  const result = await c.env.DB.prepare('DELETE FROM vtt_tokens WHERE id=? AND scene_id=?').bind(c.req.param('tokenId'), sceneId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Token não encontrado.');
  return c.body(null, 204);
});

vttRoutes.get('/:campaignId/live', async (c) => {
  const campaignId = c.req.param('campaignId'); const userId = c.get('user').id;
  const access = await c.env.DB.prepare(`SELECT c.id,
    (c.user_id=? OR EXISTS(SELECT 1 FROM campaign_members cm WHERE cm.campaign_id=c.id AND cm.user_id=? AND cm.active=1)) authorized
    FROM campaigns c WHERE c.id=?`).bind(userId, userId, campaignId).first<{ id: string; authorized: number }>();
  if (!access || !access.authorized) throw new ApiError(404, 'NOT_FOUND', 'Campanha não encontrada.');
  const scene = await c.env.DB.prepare('SELECT * FROM vtt_scenes WHERE campaign_id=? AND is_active=1').bind(campaignId).first<SceneRow>();
  if (!scene) return c.json({ item: null });
  const resolvedImageUrl = await resolveImageUrl(c, scene);
  const tokens = await c.env.DB.prepare('SELECT * FROM vtt_tokens WHERE scene_id=? AND visible_to_players=1 ORDER BY created_at').bind(scene.id).all<TokenRow>();
  return c.json({ item: { id: scene.id, title: scene.title, imageUrl: resolvedImageUrl, tokens: tokens.results.map(presentPlayerToken) } });
});
