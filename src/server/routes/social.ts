// F-016/F-019 (BATCH7): amizades, bloqueios e notificações in-app. Busca de
// usuário reaproveita GET /api/v1/directory/users (já existe, nunca expõe
// e-mail, rate-limited) — o frontend cruza o resultado com as listas de
// amigos/pedidos/bloqueios já carregadas em vez de a API anotar cada
// resultado (evita alterar um endpoint compartilhado com o fluxo de
// membros de Grupo/World).
import { Hono } from 'hono';
import { friendTargetInputSchema } from '../../shared/validation/schemas';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

export const socialRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

async function validTargetUser(env: Env, userId: string, selfId: string): Promise<void> {
  if (userId === selfId) throw new ApiError(422, 'INVALID_TARGET', 'Você não pode adicionar a si mesmo.');
  const row = await env.DB.prepare('SELECT id FROM users WHERE id=? AND disabled_at IS NULL AND deleted_at IS NULL').bind(userId).first();
  if (!row) throw new ApiError(422, 'INVALID_TARGET', 'A conta selecionada não está disponível.');
}

async function isBlocked(db: D1Database, userA: string, userB: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 FROM user_blocks WHERE (blocker_user_id=? AND blocked_user_id=?) OR (blocker_user_id=? AND blocked_user_id=?)`)
    .bind(userA, userB, userB, userA).first();
  return Boolean(row);
}

function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function notify(env: Env, userId: string, kind: 'FRIEND_REQUEST_RECEIVED' | 'FRIEND_REQUEST_ACCEPTED', payload: Record<string, unknown>): D1PreparedStatement {
  return env.DB.prepare('INSERT INTO notifications (id,user_id,kind,payload_json,created_at) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), userId, kind, JSON.stringify(payload), nowIso());
}

// ── Amigos ──
socialRoutes.get('/friends', async (c) => {
  const userId = c.get('user').id;
  const rows = await c.env.DB.prepare(`SELECT f.id,u.id userId,u.display_name displayName,f.created_at createdAt
    FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_id_a=? THEN f.user_id_b ELSE f.user_id_a END
    WHERE (f.user_id_a=? OR f.user_id_b=?) AND u.disabled_at IS NULL AND u.deleted_at IS NULL
    ORDER BY u.display_name COLLATE NOCASE`).bind(userId, userId, userId).all();
  return c.json({ items: rows.results });
});

socialRoutes.delete('/friends/:userId', async (c) => {
  const userId = c.get('user').id; const [a, b] = pair(userId, c.req.param('userId'));
  const result = await c.env.DB.prepare('DELETE FROM friendships WHERE user_id_a=? AND user_id_b=?').bind(a, b).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Amizade não encontrada.');
  return c.body(null, 204);
});

// ── Pedidos ──
socialRoutes.get('/requests', async (c) => {
  const userId = c.get('user').id;
  const [received, sent] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT r.id,u.id userId,u.display_name displayName,r.created_at createdAt FROM friend_requests r
      JOIN users u ON u.id=r.requester_user_id WHERE r.addressee_user_id=? ORDER BY r.created_at DESC`).bind(userId),
    c.env.DB.prepare(`SELECT r.id,u.id userId,u.display_name displayName,r.created_at createdAt FROM friend_requests r
      JOIN users u ON u.id=r.addressee_user_id WHERE r.requester_user_id=? ORDER BY r.created_at DESC`).bind(userId),
  ]);
  return c.json({ received: received.results, sent: sent.results });
});

socialRoutes.post('/requests', async (c) => {
  const requesterId = c.get('user').id;
  const rateLimit = await c.env.SOCIAL_RATE_LIMITER.limit({ key: requesterId });
  if (!rateLimit.success) throw new ApiError(429, 'RATE_LIMITED', 'Muitos pedidos. Aguarde antes de tentar novamente.');
  const input = await readJson(c, friendTargetInputSchema);
  const addresseeId = input.targetUserId;
  await validTargetUser(c.env, addresseeId, requesterId);
  if (await isBlocked(c.env.DB, requesterId, addresseeId)) throw new ApiError(409, 'BLOCKED', 'Não é possível enviar um pedido para esta conta.');
  const [a, b] = pair(requesterId, addresseeId);
  const alreadyFriends = await c.env.DB.prepare('SELECT 1 FROM friendships WHERE user_id_a=? AND user_id_b=?').bind(a, b).first();
  if (alreadyFriends) throw new ApiError(409, 'ALREADY_FRIENDS', 'Vocês já são amigos.');
  const ownPending = await c.env.DB.prepare('SELECT 1 FROM friend_requests WHERE requester_user_id=? AND addressee_user_id=?').bind(requesterId, addresseeId).first();
  if (ownPending) throw new ApiError(409, 'ALREADY_REQUESTED', 'Você já enviou um pedido para esta conta.');
  // Pedido cruzado: a outra conta já te pediu — aceitar é mais correto que empilhar um segundo pedido.
  const reverse = await c.env.DB.prepare('SELECT id FROM friend_requests WHERE requester_user_id=? AND addressee_user_id=?').bind(addresseeId, requesterId).first<{ id: string }>();
  if (reverse) {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM friend_requests WHERE id=?').bind(reverse.id),
      c.env.DB.prepare('INSERT INTO friendships (id,user_id_a,user_id_b,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(), a, b, nowIso()),
      notify(c.env, addresseeId, 'FRIEND_REQUEST_ACCEPTED', { userId: requesterId }),
    ]);
    return c.json({ status: 'ACCEPTED' }, 201);
  }
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO friend_requests (id,requester_user_id,addressee_user_id,created_at) VALUES (?,?,?,?)').bind(id, requesterId, addresseeId, nowIso()),
    notify(c.env, addresseeId, 'FRIEND_REQUEST_RECEIVED', { userId: requesterId }),
  ]);
  return c.json({ item: { id, status: 'PENDING' } }, 201);
});

socialRoutes.post('/requests/:id/accept', async (c) => {
  const userId = c.get('user').id; const requestId = c.req.param('id');
  const request = await c.env.DB.prepare('SELECT * FROM friend_requests WHERE id=? AND addressee_user_id=?').bind(requestId, userId).first<{ requester_user_id: string; addressee_user_id: string }>();
  if (!request) throw new ApiError(404, 'NOT_FOUND', 'Pedido não encontrado.');
  const [a, b] = pair(request.requester_user_id, request.addressee_user_id);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM friend_requests WHERE id=?').bind(requestId),
    c.env.DB.prepare('INSERT INTO friendships (id,user_id_a,user_id_b,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(), a, b, nowIso()),
    notify(c.env, request.requester_user_id, 'FRIEND_REQUEST_ACCEPTED', { userId }),
  ]);
  return c.json({ success: true });
});

socialRoutes.post('/requests/:id/decline', async (c) => {
  const userId = c.get('user').id;
  const result = await c.env.DB.prepare('DELETE FROM friend_requests WHERE id=? AND addressee_user_id=?').bind(c.req.param('id'), userId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Pedido não encontrado.');
  return c.body(null, 204);
});

socialRoutes.delete('/requests/:id', async (c) => {
  const userId = c.get('user').id;
  const result = await c.env.DB.prepare('DELETE FROM friend_requests WHERE id=? AND requester_user_id=?').bind(c.req.param('id'), userId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Pedido não encontrado.');
  return c.body(null, 204);
});

// ── Bloqueios ──
socialRoutes.get('/blocks', async (c) => {
  const rows = await c.env.DB.prepare(`SELECT b.id,u.id userId,u.display_name displayName,b.created_at createdAt
    FROM user_blocks b JOIN users u ON u.id=b.blocked_user_id WHERE b.blocker_user_id=? ORDER BY b.created_at DESC`)
    .bind(c.get('user').id).all();
  return c.json({ items: rows.results });
});

socialRoutes.post('/blocks', async (c) => {
  const blockerId = c.get('user').id;
  const rateLimit = await c.env.SOCIAL_RATE_LIMITER.limit({ key: blockerId });
  if (!rateLimit.success) throw new ApiError(429, 'RATE_LIMITED', 'Muitas ações. Aguarde antes de tentar novamente.');
  const input = await readJson(c, friendTargetInputSchema);
  const blockedId = input.targetUserId;
  if (blockedId === blockerId) throw new ApiError(422, 'INVALID_TARGET', 'Você não pode bloquear a si mesmo.');
  const target = await c.env.DB.prepare('SELECT id FROM users WHERE id=? AND disabled_at IS NULL AND deleted_at IS NULL').bind(blockedId).first();
  if (!target) throw new ApiError(422, 'INVALID_TARGET', 'A conta selecionada não está disponível.');
  const [a, b] = pair(blockerId, blockedId);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO user_blocks (id,blocker_user_id,blocked_user_id,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(), blockerId, blockedId, nowIso()),
      c.env.DB.prepare('DELETE FROM friendships WHERE user_id_a=? AND user_id_b=?').bind(a, b),
      c.env.DB.prepare('DELETE FROM friend_requests WHERE (requester_user_id=? AND addressee_user_id=?) OR (requester_user_id=? AND addressee_user_id=?)').bind(blockerId, blockedId, blockedId, blockerId),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new ApiError(409, 'ALREADY_BLOCKED', 'Esta conta já está bloqueada.');
    throw error;
  }
  return c.json({ success: true }, 201);
});

socialRoutes.delete('/blocks/:userId', async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM user_blocks WHERE blocker_user_id=? AND blocked_user_id=?').bind(c.get('user').id, c.req.param('userId')).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Bloqueio não encontrado.');
  return c.body(null, 204);
});

// ── Notificações ──
socialRoutes.get('/notifications', async (c) => {
  const rows = await c.env.DB.prepare(`SELECT id,kind,payload_json payloadJson,read_at readAt,created_at createdAt
    FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50`).bind(c.get('user').id).all();
  return c.json({ items: rows.results.map((row) => ({ ...row, payload: JSON.parse(String((row as { payloadJson: string }).payloadJson)) })) });
});

socialRoutes.post('/notifications/:id/read', async (c) => {
  const result = await c.env.DB.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL')
    .bind(nowIso(), c.req.param('id'), c.get('user').id).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Notificação não encontrada.');
  return c.json({ success: true });
});

socialRoutes.post('/notifications/read-all', async (c) => {
  await c.env.DB.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').bind(nowIso(), c.get('user').id).run();
  return c.json({ success: true });
});
