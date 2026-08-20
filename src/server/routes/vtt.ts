import { Hono, type Context } from 'hono';
import { vttCombatantInputSchema, vttCombatStartSchema, vttFogCellInputSchema, vttSceneInputSchema, vttTokenInputSchema } from '../../shared/validation/schemas';
import type { VttGmScenePayload, VttPlayerScenePayload, VttRealtimeStateReason } from '../../domain/vtt-realtime';
import { authorizeCampaignManagement, authorizeCampaignParticipation, ownedEntity } from '../content/authorization';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

// F-029/F-030 (BATCH16): VTT — fundação (Scene/Map/tokens) + fog of war, sem realtime — ver
// migrations/0037_vtt_foundation.sql e migrations/0038_vtt_fog.sql.
//
// BATCH23 (Multi-GM, Seção 2-3 do pedido de finalização): escrita deixou de ser estritamente
// owner-only — Owner OU Co-GM (campaign_co_gms, migration 0041) via
// authorizeCampaignManagement() (src/server/content/authorization.ts), centralizado ali para
// nunca espalhar a checagem por cada rota. Membros comuns (is_game_master=1 ou não) continuam
// só com leitura filtrada via GET /live — isso não mudou; Co-GM é uma autorização própria,
// nunca derivada do rótulo de exibição is_game_master de campaign_members.
//
// GET /:campaignId/live é o único ponto do VTT onde alguém além do dono lê dados — por isso o
// filtro de visibilidade é aplicado sempre, para todo mundo, mesmo o dono (quem quiser o
// estado completo usa GET /scenes/:sceneId, owner-only). Decisões de segurança deliberadas:
// (1) a visão "ao vivo" NUNCA inclui entityId/entityName/entityType do token, só
// id/label/x/y — um token vinculado a uma Vault Entity PRIVATE/GM_ONLY marcado (por engano ou
// não) visible_to_players=1 não pode vazar o nome/tipo dessa entidade para o jogador; (2)
// quando fog_enabled, um token só chega ao jogador se também estiver numa célula revelada —
// igual GM_ONLY, a barreira é sempre no servidor, nunca uma máscara CSS por cima da imagem.

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;
interface SceneRow { id: string; campaign_id: string; map_id: string | null; title: string; image_url: string; notes: string; is_active: number; fog_enabled: number; grid_cols: number; grid_rows: number; combat_active: number; combat_round: number; created_at: string; updated_at: string }
interface TokenRow { id: string; scene_id: string; entity_id: string | null; label: string; x: number; y: number; visible_to_players: number; created_at: string; updated_at: string; entity_name?: string | null; entity_type?: string | null }
interface FogCellRow { col: number; row: number }
interface CombatantRow { id: string; scene_id: string; token_id: string | null; name: string; initiative: number; hp_current: number | null; hp_max: number | null; notes: string; visible_to_players: number; is_current_turn: number; created_at: string; updated_at: string }

export const vttRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function presentScene(row: SceneRow) { return { id: row.id, mapId: row.map_id, title: row.title, imageUrl: row.image_url, notes: row.notes, isActive: Boolean(row.is_active), fogEnabled: Boolean(row.fog_enabled), gridCols: row.grid_cols, gridRows: row.grid_rows, combatActive: Boolean(row.combat_active), combatRound: row.combat_round, createdAt: row.created_at, updatedAt: row.updated_at }; }
function presentCombatant(row: CombatantRow) { return { id: row.id, tokenId: row.token_id, name: row.name, initiative: row.initiative, hpCurrent: row.hp_current, hpMax: row.hp_max, notes: row.notes, visibleToPlayers: Boolean(row.visible_to_players), isCurrentTurn: Boolean(row.is_current_turn), createdAt: row.created_at, updatedAt: row.updated_at }; }
// Visão do jogador nunca inclui HP (F-032: GM-only nesta v1, mesmo princípio de nunca vazar
// mais do que o necessário — ver migrations/0039_vtt_combat.sql).
function presentPlayerCombatant(row: CombatantRow) { return { id: row.id, name: row.name, isCurrentTurn: Boolean(row.is_current_turn) }; }
// col/row da célula de fog em que um token cai, dado o tamanho normalizado (0-100) da grade da
// cena — usado tanto para validar reveal/hide quanto para filtrar tokens em /live.
function tokenFogCell(scene: SceneRow, token: { x: number; y: number }): { col: number; row: number } {
  return {
    col: Math.min(scene.grid_cols - 1, Math.max(0, Math.floor((token.x / 100) * scene.grid_cols))),
    row: Math.min(scene.grid_rows - 1, Math.max(0, Math.floor((token.y / 100) * scene.grid_rows))),
  };
}
function presentToken(row: TokenRow) { return { id: row.id, sceneId: row.scene_id, entityId: row.entity_id, entityName: row.entity_name ?? null, entityType: row.entity_type ?? null, label: row.label, x: row.x, y: row.y, visibleToPlayers: Boolean(row.visible_to_players), createdAt: row.created_at, updatedAt: row.updated_at }; }
function presentPlayerToken(row: TokenRow) { return { id: row.id, label: row.label, x: row.x, y: row.y }; }

// BATCH23 (Seção 20-21 do pedido de finalização — proteção de Free-tier): limite real por
// conta autenticada, aplicado a toda rota de GM (scenes/tokens/fog/combat, leitura e escrita)
// via ownedCampaignId/ownedScene — nunca espalhado rota a rota. 90/60s é generoso o bastante
// para uma mesa normal (mesmo o GM navegando rápido entre telas) mas barra um loop
// acidental/cliente quebrado de consumir a cota gratuita do Workers Free rapidamente. 429
// nunca vaza detalhe interno — mensagem clara, o client já sabe tratar erro genérico.
async function checkVttActionRateLimit(c: AppContext): Promise<void> {
  const result = await c.env.VTT_ACTION_RATE_LIMITER.limit({ key: c.get('user').id });
  if (!result.success) throw new ApiError(429, 'RATE_LIMITED', 'Muitas ações na Mesa Virtual em pouco tempo. Aguarde um instante.');
}
async function ownedCampaignId(c: AppContext, id: string): Promise<string> {
  await authorizeCampaignManagement(c, id); // Owner OU Co-GM — ver comentário no topo do arquivo
  await checkVttActionRateLimit(c);
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
// Recebe `db` puro (não o Context) porque é reaproveitada pelo Durable Object (F-031), que não
// tem um Hono Context — só o binding DB do seu próprio env.
async function resolveImageUrlDb(db: D1Database, scene: SceneRow): Promise<string> {
  if (!scene.map_id) return scene.image_url;
  const map = await db.prepare('SELECT image_url FROM world_maps WHERE id=?').bind(scene.map_id).first<{ image_url: string }>();
  return map?.image_url ?? scene.image_url;
}
async function resolveImageUrl(c: AppContext, scene: SceneRow): Promise<string> { return resolveImageUrlDb(c.env.DB, scene); }

// ── F-031 (correção 2026-08-20): builders puros reaproveitados por GET /live E pelo broadcast
// do Durable Object (VttRoomDO) — a MESMA função monta o payload nos dois casos, para nunca
// existir uma segunda implementação do filtro de segurança (nunca HP/entityId/entityName de
// token oculto, nunca fog não revelado — ver comentário no topo do arquivo). Nenhuma checagem
// de autorização aqui: quem chama (rota HTTP ou o próprio Durable Object, que só aceitou a
// conexão depois de validar sessão+membership no handshake) já garantiu isso antes.
export async function buildPlayerLiveScenePayload(db: D1Database, campaignId: string): Promise<VttPlayerScenePayload | null> {
  const scene = await db.prepare('SELECT * FROM vtt_scenes WHERE campaign_id=? AND is_active=1').bind(campaignId).first<SceneRow>();
  if (!scene) return null;
  const resolvedImageUrl = await resolveImageUrlDb(db, scene);
  const tokens = await db.prepare('SELECT * FROM vtt_tokens WHERE scene_id=? AND visible_to_players=1 ORDER BY created_at').bind(scene.id).all<TokenRow>();
  let visibleTokens = tokens.results;
  let fogCells: FogCellRow[] = [];
  if (scene.fog_enabled) {
    const fog = await db.prepare('SELECT col,row FROM vtt_fog_cells WHERE scene_id=?').bind(scene.id).all<FogCellRow>();
    fogCells = fog.results;
    const revealed = new Set(fogCells.map((cell) => `${cell.col}:${cell.row}`));
    visibleTokens = visibleTokens.filter((token) => { const cell = tokenFogCell(scene, token); return revealed.has(`${cell.col}:${cell.row}`); });
  }
  const combatants = scene.combat_active
    ? (await db.prepare('SELECT * FROM vtt_combatants WHERE scene_id=? AND visible_to_players=1 ORDER BY initiative DESC, created_at').bind(scene.id).all<CombatantRow>()).results
    : [];
  return { id: scene.id, title: scene.title, imageUrl: resolvedImageUrl, fogEnabled: Boolean(scene.fog_enabled), gridCols: scene.grid_cols, gridRows: scene.grid_rows, fogCells, tokens: visibleTokens.map(presentPlayerToken), combatActive: Boolean(scene.combat_active), combatRound: scene.combat_round, combatants: combatants.map(presentPlayerCombatant) };
}

export async function buildGmLiveScenePayload(db: D1Database, campaignId: string): Promise<VttGmScenePayload | null> {
  const scene = await db.prepare('SELECT * FROM vtt_scenes WHERE campaign_id=? AND is_active=1').bind(campaignId).first<SceneRow>();
  if (!scene) return null;
  const tokens = await db.prepare('SELECT t.*,ve.name entity_name,ve.entity_type entity_type FROM vtt_tokens t LEFT JOIN vault_entities ve ON ve.id=t.entity_id WHERE t.scene_id=? ORDER BY t.created_at').bind(scene.id).all<TokenRow>();
  const resolvedImageUrl = await resolveImageUrlDb(db, scene);
  const fog = await db.prepare('SELECT col,row FROM vtt_fog_cells WHERE scene_id=?').bind(scene.id).all<FogCellRow>();
  const combatants = await db.prepare('SELECT * FROM vtt_combatants WHERE scene_id=? ORDER BY initiative DESC, created_at').bind(scene.id).all<CombatantRow>();
  return { item: { ...presentScene(scene), resolvedImageUrl }, tokens: tokens.results.map(presentToken), fog: fog.results, combatants: combatants.results.map(presentCombatant) };
}

// Notifica o Durable Object da Campaign depois de uma escrita de sucesso em D1 — best-effort:
// nunca deve derrubar a resposta HTTP nem desfazer a escrita já commitada (qualquer erro é
// engolido). Toda rota mutante dá `await` nisto antes de responder — mais simples e mais
// correto do que `executionCtx.waitUntil` (que só garante "tentar rodar depois da resposta",
// sem qualquer garantia de quando/se completa): o pequeno custo de latência extra (um round
// trip a mais até o Durable Object) é aceitável para o uso real (mesa de RPG, poucos
// jogadores, updates medidos em segundos) e evita o cliente nunca saber se o broadcast
// realmente foi disparado. Se o Durable Object estiver indisponível, o polling de fallback
// (VttLivePage) eventualmente converge sozinho.
// Exportado para adventures.ts poder notificar a(s) Campaign(s) que usam uma Adventure quando
// um handout é revelado/ocultado (F-009 da correção de finalização) — mesma função, nunca uma
// reimplementação paralela do broadcast.
export async function notifyRoom(env: Env, campaignId: string, reason: VttRealtimeStateReason): Promise<void> {
  try {
    const stub = env.VTT_ROOMS.get(env.VTT_ROOMS.idFromName(campaignId));
    await stub.fetch('https://vtt-room.internal/broadcast', { method: 'POST', body: JSON.stringify({ reason }) });
  } catch { /* best-effort — ver comentário acima */ }
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
  await c.env.DB.prepare('INSERT INTO vtt_scenes (id,campaign_id,map_id,title,image_url,notes,is_active,fog_enabled,grid_cols,grid_rows,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?,?,?,?)')
    .bind(id, campaignId, input.mapId ?? null, input.title, input.imageUrl, input.notes, Number(input.fogEnabled), input.gridCols, input.gridRows, now, now).run();
  return c.json({ id }, 201);
});

vttRoutes.get('/:campaignId/scenes/:sceneId', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  const scene = await ownedScene(c, campaignId, sceneId);
  const tokens = await c.env.DB.prepare('SELECT t.*,ve.name entity_name,ve.entity_type entity_type FROM vtt_tokens t LEFT JOIN vault_entities ve ON ve.id=t.entity_id WHERE t.scene_id=? ORDER BY t.created_at').bind(sceneId).all<TokenRow>();
  const resolvedImageUrl = await resolveImageUrl(c, scene);
  const fog = await c.env.DB.prepare('SELECT col,row FROM vtt_fog_cells WHERE scene_id=?').bind(sceneId).all<FogCellRow>();
  const combatants = await c.env.DB.prepare('SELECT * FROM vtt_combatants WHERE scene_id=? ORDER BY initiative DESC, created_at').bind(sceneId).all<CombatantRow>();
  return c.json({ item: { ...presentScene(scene), resolvedImageUrl }, tokens: tokens.results.map(presentToken), fog: fog.results, combatants: combatants.results.map(presentCombatant) });
});

vttRoutes.patch('/:campaignId/scenes/:sceneId', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, campaignId, sceneId);
  const input = await readJson(c, vttSceneInputSchema);
  if (!input.mapId && !input.imageUrl) throw new ApiError(422, 'INVALID_BACKGROUND', 'Informe um mapa da Cartografia ou uma URL de imagem de fundo.');
  await validMap(c, input.mapId);
  await c.env.DB.prepare('UPDATE vtt_scenes SET map_id=?,title=?,image_url=?,notes=?,fog_enabled=?,grid_cols=?,grid_rows=?,updated_at=? WHERE id=?')
    .bind(input.mapId ?? null, input.title, input.imageUrl, input.notes, Number(input.fogEnabled), input.gridCols, input.gridRows, nowIso(), sceneId).run();
  await notifyRoom(c.env, campaignId, 'SCENE_CHANGED');
  return c.json({ success: true });
});

vttRoutes.delete('/:campaignId/scenes/:sceneId', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, campaignId, sceneId);
  await c.env.DB.prepare('DELETE FROM vtt_scenes WHERE id=?').bind(sceneId).run();
  await notifyRoom(c.env, campaignId, 'SCENE_CHANGED');
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
  await notifyRoom(c.env, campaignId, 'SCENE_CHANGED');
  return c.json({ success: true });
});

vttRoutes.post('/:campaignId/scenes/:sceneId/deactivate', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, campaignId, sceneId);
  await c.env.DB.prepare('UPDATE vtt_scenes SET is_active=0,updated_at=? WHERE id=?').bind(nowIso(), sceneId).run();
  await notifyRoom(c.env, campaignId, 'SCENE_CHANGED');
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
  await notifyRoom(c.env, campaignId, 'TOKEN_MOVED');
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
  await notifyRoom(c.env, campaignId, 'TOKEN_MOVED');
  return c.json({ success: true });
});

vttRoutes.delete('/:campaignId/scenes/:sceneId/tokens/:tokenId', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, campaignId, sceneId);
  const result = await c.env.DB.prepare('DELETE FROM vtt_tokens WHERE id=? AND scene_id=?').bind(c.req.param('tokenId'), sceneId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Token não encontrado.');
  await notifyRoom(c.env, campaignId, 'TOKEN_MOVED');
  return c.body(null, 204);
});

async function cellInRange(scene: SceneRow, col: number, row: number): Promise<void> {
  if (col >= scene.grid_cols || row >= scene.grid_rows) throw new ApiError(422, 'INVALID_CELL', 'Célula fora da grade da cena.');
}

vttRoutes.post('/:campaignId/scenes/:sceneId/fog/reveal', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  const scene = await ownedScene(c, campaignId, sceneId);
  const input = await readJson(c, vttFogCellInputSchema);
  await cellInRange(scene, input.col, input.row);
  await c.env.DB.prepare('INSERT OR IGNORE INTO vtt_fog_cells (scene_id,col,row,revealed_at) VALUES (?,?,?,?)').bind(sceneId, input.col, input.row, nowIso()).run();
  await notifyRoom(c.env, campaignId, 'FOG_CHANGED');
  return c.json({ success: true }, 201);
});

vttRoutes.post('/:campaignId/scenes/:sceneId/fog/hide', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  const scene = await ownedScene(c, campaignId, sceneId);
  const input = await readJson(c, vttFogCellInputSchema);
  await cellInRange(scene, input.col, input.row);
  await c.env.DB.prepare('DELETE FROM vtt_fog_cells WHERE scene_id=? AND col=? AND row=?').bind(sceneId, input.col, input.row).run();
  await notifyRoom(c.env, campaignId, 'FOG_CHANGED');
  return c.json({ success: true });
});

vttRoutes.post('/:campaignId/scenes/:sceneId/fog/reset', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, campaignId, sceneId);
  await c.env.DB.prepare('DELETE FROM vtt_fog_cells WHERE scene_id=?').bind(sceneId).run();
  await notifyRoom(c.env, campaignId, 'FOG_CHANGED');
  return c.json({ success: true });
});

// ── F-032: Iniciativa/combate system-neutral ──
// Ordem de turno é sempre derivada (initiative DESC, created_at como desempate), nunca uma
// coluna de posição própria para manter — reordenar é só um UPDATE de initiative.
async function turnOrder(c: AppContext, sceneId: string): Promise<CombatantRow[]> {
  const rows = await c.env.DB.prepare('SELECT * FROM vtt_combatants WHERE scene_id=? ORDER BY initiative DESC, created_at').bind(sceneId).all<CombatantRow>();
  return rows.results;
}

vttRoutes.post('/:campaignId/scenes/:sceneId/combat/start', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  const scene = await ownedScene(c, campaignId, sceneId);
  if (scene.combat_active) throw new ApiError(409, 'COMBAT_ALREADY_ACTIVE', 'Já existe um combate em andamento nesta cena.');
  const input = await readJson(c, vttCombatStartSchema);
  const tokenIds = input.combatants.map((combatant) => combatant.tokenId).filter((id): id is string => Boolean(id));
  if (tokenIds.length) {
    const owned = await c.env.DB.prepare(`SELECT COUNT(*) total FROM vtt_tokens WHERE scene_id=? AND id IN (${tokenIds.map(() => '?').join(',')})`).bind(sceneId, ...tokenIds).first<{ total: number }>();
    if (Number(owned?.total) !== new Set(tokenIds).size) throw new ApiError(422, 'INVALID_TOKEN', 'Um dos tokens não pertence a esta cena.');
  }
  const now = nowIso();
  const statements: D1PreparedStatement[] = input.combatants.map((combatant) =>
    c.env.DB.prepare('INSERT INTO vtt_combatants (id,scene_id,token_id,name,initiative,hp_current,hp_max,notes,visible_to_players,is_current_turn,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,?,?)')
      .bind(crypto.randomUUID(), sceneId, combatant.tokenId ?? null, combatant.name, combatant.initiative, combatant.hpCurrent ?? null, combatant.hpMax ?? null, combatant.notes, Number(combatant.visibleToPlayers), now, now));
  statements.push(c.env.DB.prepare('UPDATE vtt_scenes SET combat_active=1,combat_round=1,updated_at=? WHERE id=?').bind(now, sceneId));
  await c.env.DB.batch(statements);
  // A ordem real só existe depois que todo mundo já tem ID gerado — marca o primeiro turno
  // numa segunda chamada simples (evita depender da ordem de execução do batch acima).
  const order = await turnOrder(c, sceneId);
  if (order.length) await c.env.DB.prepare('UPDATE vtt_combatants SET is_current_turn=1 WHERE id=?').bind(order[0].id).run();
  await notifyRoom(c.env, campaignId, 'COMBAT_UPDATED');
  return c.json({ success: true }, 201);
});

vttRoutes.post('/:campaignId/scenes/:sceneId/combat/next', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  const scene = await ownedScene(c, campaignId, sceneId);
  if (!scene.combat_active) throw new ApiError(409, 'COMBAT_NOT_ACTIVE', 'Nenhum combate em andamento nesta cena.');
  const order = await turnOrder(c, sceneId);
  if (!order.length) throw new ApiError(409, 'NO_COMBATANTS', 'Nenhum combatente nesta cena.');
  const currentIndex = order.findIndex((combatant) => combatant.is_current_turn);
  const nextIndex = (currentIndex + 1) % order.length;
  const wrapped = nextIndex === 0;
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  if (currentIndex >= 0) statements.push(c.env.DB.prepare('UPDATE vtt_combatants SET is_current_turn=0,updated_at=? WHERE id=?').bind(now, order[currentIndex].id));
  statements.push(c.env.DB.prepare('UPDATE vtt_combatants SET is_current_turn=1,updated_at=? WHERE id=?').bind(now, order[nextIndex].id));
  if (wrapped) statements.push(c.env.DB.prepare('UPDATE vtt_scenes SET combat_round=combat_round+1,updated_at=? WHERE id=?').bind(now, sceneId));
  await c.env.DB.batch(statements);
  await notifyRoom(c.env, campaignId, 'COMBAT_UPDATED');
  return c.json({ success: true });
});

vttRoutes.post('/:campaignId/scenes/:sceneId/combat/end', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, campaignId, sceneId);
  // Combate é ferramenta de mesa efêmera (mesmo princípio de F-001: nunca versionar dado
  // efêmero de VTT) — encerrar limpa os combatentes, não arquiva histórico de round a round.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM vtt_combatants WHERE scene_id=?').bind(sceneId),
    c.env.DB.prepare('UPDATE vtt_scenes SET combat_active=0,combat_round=0,updated_at=? WHERE id=?').bind(nowIso(), sceneId),
  ]);
  await notifyRoom(c.env, campaignId, 'COMBAT_UPDATED');
  return c.json({ success: true });
});

vttRoutes.post('/:campaignId/scenes/:sceneId/combat/combatants', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  const scene = await ownedScene(c, campaignId, sceneId);
  if (!scene.combat_active) throw new ApiError(409, 'COMBAT_NOT_ACTIVE', 'Nenhum combate em andamento nesta cena.');
  const input = await readJson(c, vttCombatantInputSchema);
  if (input.tokenId) {
    const owned = await c.env.DB.prepare('SELECT id FROM vtt_tokens WHERE id=? AND scene_id=?').bind(input.tokenId, sceneId).first();
    if (!owned) throw new ApiError(422, 'INVALID_TOKEN', 'Token inválido para esta cena.');
  }
  const id = crypto.randomUUID(), now = nowIso();
  await c.env.DB.prepare('INSERT INTO vtt_combatants (id,scene_id,token_id,name,initiative,hp_current,hp_max,notes,visible_to_players,is_current_turn,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,?,?)')
    .bind(id, sceneId, input.tokenId ?? null, input.name, input.initiative, input.hpCurrent ?? null, input.hpMax ?? null, input.notes, Number(input.visibleToPlayers), now, now).run();
  await notifyRoom(c.env, campaignId, 'COMBAT_UPDATED');
  return c.json({ id }, 201);
});

vttRoutes.patch('/:campaignId/scenes/:sceneId/combat/combatants/:combatantId', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, campaignId, sceneId);
  const input = await readJson(c, vttCombatantInputSchema);
  if (input.tokenId) {
    const owned = await c.env.DB.prepare('SELECT id FROM vtt_tokens WHERE id=? AND scene_id=?').bind(input.tokenId, sceneId).first();
    if (!owned) throw new ApiError(422, 'INVALID_TOKEN', 'Token inválido para esta cena.');
  }
  const result = await c.env.DB.prepare('UPDATE vtt_combatants SET token_id=?,name=?,initiative=?,hp_current=?,hp_max=?,notes=?,visible_to_players=?,updated_at=? WHERE id=? AND scene_id=?')
    .bind(input.tokenId ?? null, input.name, input.initiative, input.hpCurrent ?? null, input.hpMax ?? null, input.notes, Number(input.visibleToPlayers), nowIso(), c.req.param('combatantId'), sceneId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Combatente não encontrado.');
  await notifyRoom(c.env, campaignId, 'COMBAT_UPDATED');
  return c.json({ success: true });
});

vttRoutes.delete('/:campaignId/scenes/:sceneId/combat/combatants/:combatantId', async (c) => {
  const campaignId = c.req.param('campaignId'), sceneId = c.req.param('sceneId');
  await ownedScene(c, campaignId, sceneId);
  const combatantId = c.req.param('combatantId');
  const removing = await c.env.DB.prepare('SELECT is_current_turn FROM vtt_combatants WHERE id=? AND scene_id=?').bind(combatantId, sceneId).first<{ is_current_turn: number }>();
  if (!removing) throw new ApiError(404, 'NOT_FOUND', 'Combatente não encontrado.');
  const statements: D1PreparedStatement[] = [c.env.DB.prepare('DELETE FROM vtt_combatants WHERE id=? AND scene_id=?').bind(combatantId, sceneId)];
  // Removendo o combatente do turno atual: passa o turno para o próximo da ordem restante
  // (nunca deixa a cena sem ninguém marcado como turno atual enquanto houver combatentes).
  if (removing.is_current_turn) {
    const remaining = (await turnOrder(c, sceneId)).filter((combatant) => combatant.id !== combatantId);
    if (remaining.length) statements.push(c.env.DB.prepare('UPDATE vtt_combatants SET is_current_turn=1,updated_at=? WHERE id=?').bind(nowIso(), remaining[0].id));
  }
  await c.env.DB.batch(statements);
  await notifyRoom(c.env, campaignId, 'COMBAT_UPDATED');
  return c.body(null, 204);
});

// BATCH23 (Multi-GM, Seção 3 do pedido de finalização — "revelar/ocultar handouts" está na
// lista do que Co-GM pode fazer): reveal/hide ESCOPADOS POR CAMPANHA, autorizados via
// authorizeCampaignManagement (Owner OU Co-GM) — nunca a rota de adventures.ts
// (PATCH /adventures/:adventureId/handouts/:handoutId), que continua exigindo posse da Vault
// Entity (owner_user_id do dono da Adventure) e por isso não pode ser aberta a um Co-GM sem
// estender a semântica single-owner de Vault Entity — mudança maior, fora do escopo desta
// rodada (ver docs/product/MASTER_BACKLOG.md). O handout precisa pertencer à Adventure
// vinculada à MESMA Campaign (campaigns.adventure_entity_id) — nunca um handout de outra
// Adventure do Owner.
async function toggleCampaignHandout(c: AppContext, campaignId: string, handoutId: string, reveal: boolean): Promise<void> {
  await authorizeCampaignManagement(c, campaignId);
  const campaign = await c.env.DB.prepare('SELECT adventure_entity_id FROM campaigns WHERE id=?').bind(campaignId).first<{ adventure_entity_id: string | null }>();
  if (!campaign?.adventure_entity_id) throw new ApiError(404, 'NOT_FOUND', 'Handout não encontrado.');
  const handout = await c.env.DB.prepare('SELECT revealed_at FROM adventure_handouts WHERE id=? AND adventure_entity_id=?').bind(handoutId, campaign.adventure_entity_id).first<{ revealed_at: string | null }>();
  if (!handout) throw new ApiError(404, 'NOT_FOUND', 'Handout não encontrado.');
  const wasRevealed = handout.revealed_at !== null;
  if (wasRevealed === reveal) return; // já está no estado pedido — no-op idempotente, sem notificar de novo
  await c.env.DB.prepare('UPDATE adventure_handouts SET revealed_at=? WHERE id=?').bind(reveal ? nowIso() : null, handoutId).run();
  await notifyRoom(c.env, campaignId, reveal ? 'HANDOUT_REVEALED' : 'HANDOUT_HIDDEN');
}
vttRoutes.post('/:campaignId/handouts/:handoutId/reveal', async (c) => {
  await toggleCampaignHandout(c, c.req.param('campaignId'), c.req.param('handoutId'), true);
  return c.json({ success: true });
});
vttRoutes.post('/:campaignId/handouts/:handoutId/hide', async (c) => {
  await toggleCampaignHandout(c, c.req.param('campaignId'), c.req.param('handoutId'), false);
  return c.json({ success: true });
});

// Checagem de authorization compartilhada entre GET /live e a rota de upgrade de WebSocket
// (F-031) — dono OU membro ativo da Campaign. Não-membro sempre recebe 404 (nunca 403 — mesmo
// padrão anti-enumeração do resto do produto), e o papel (GM/PLAYER) é resolvido aqui, no
// servidor, nunca aceito de um valor informado pelo client.
async function authorizeLiveAccess(c: AppContext, campaignId: string): Promise<'GM' | 'PLAYER'> {
  // BATCH23: Co-GM resolve como 'GM' — mesmo tipo já usado pelo protocolo realtime (nenhuma
  // mudança de schema/mensagem necessária). Ver authorizeCampaignParticipation.
  return authorizeCampaignParticipation(c, campaignId);
}

vttRoutes.get('/:campaignId/live', async (c) => {
  const campaignId = c.req.param('campaignId');
  await authorizeLiveAccess(c, campaignId);
  return c.json({ item: await buildPlayerLiveScenePayload(c.env.DB, campaignId) });
});

// F-031 (correção 2026-08-20): upgrade de WebSocket para o realtime real da mesa — mesma
// authorization de GET /live, feita ANTES de encaminhar ao Durable Object (nunca confiar em
// nada validado só dentro do DO). O papel resolvido no servidor vai como query param só porque
// a Durable Object Namespace API não repassa Variables do Hono; não é um dado sensível (é o
// MESMO papel que a authorization acima já calculou, não uma entrada do client).
vttRoutes.get('/:campaignId/realtime', async (c) => {
  const campaignId = c.req.param('campaignId');
  const role = await authorizeLiveAccess(c, campaignId);
  if (c.req.header('Upgrade') !== 'websocket') throw new ApiError(400, 'UPGRADE_REQUIRED', 'Esta rota exige upgrade de WebSocket.');
  // BATCH23 (Seção 20 do pedido de finalização): proteção contra reconnect burst — 20
  // tentativas de conexão/60s por conta é generoso para qualquer rede instável real (o hook
  // client já espera WS_RECONNECT_DELAY_MS=5s entre tentativas), mas barra um loop de
  // reconexão descontrolado. Verificado ANTES do upgrade — nunca chega a acordar o Durable
  // Object para uma tentativa já reprovada.
  const connectLimit = await c.env.VTT_CONNECT_RATE_LIMITER.limit({ key: c.get('user').id });
  if (!connectLimit.success) throw new ApiError(429, 'RATE_LIMITED', 'Muitas tentativas de conexão em pouco tempo. Aguarde um instante.');
  const stub = c.env.VTT_ROOMS.get(c.env.VTT_ROOMS.idFromName(campaignId));
  // Encaminha a requisição de upgrade preservando a MESMA URL (`new Request(outraUrl, req)`
  // travava o handshake num navegador real — DevTools nunca reportava erro, o WebSocket
  // simplesmente ficava para sempre em CONNECTING; um cliente WebSocket puro via Node não
  // reproduzia isso, então nunca apareceu nos testes de integração). Os headers do request
  // original são imutáveis (`c.req.raw.headers.set` falha com "Can't modify immutable
  // headers."), então precisam ser copiados para um novo Headers mutável antes de acrescentar
  // os metadados — nada disso é informado pelo client, já foi resolvido acima a partir da
  // sessão real.
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Vtt-Role', role);
  headers.set('X-Vtt-User-Id', c.get('user').id);
  return stub.fetch(new Request(c.req.raw.url, { method: c.req.raw.method, headers }));
});
