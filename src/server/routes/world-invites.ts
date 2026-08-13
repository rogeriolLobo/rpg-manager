import { Hono } from 'hono';
import { worldInviteInputSchema } from '../../shared/validation/schemas';
import { ownedWorld } from '../content/authorization';
import { ApiError, nowIso, readJson } from '../http';
import { hashSecret, randomToken } from '../security/crypto';
import type { AppVariables, Env } from '../types';

export const worldInviteRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

worldInviteRoutes.get('/:worldId', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const invites = await c.env.DB.prepare(`SELECT id,code_hint codeHint,role,expires_at expiresAt,max_uses maxUses,
    use_count useCount,revoked_at revokedAt,created_at createdAt FROM world_invites WHERE world_id=? ORDER BY created_at DESC`)
    .bind(worldId).all();
  return c.json({ items: invites.results });
});

worldInviteRoutes.post('/:worldId', async (c) => {
  const worldId = c.req.param('worldId'); const world = await ownedWorld(c, worldId);
  if (world.archived_at) throw new ApiError(409, 'WORLD_ARCHIVED', 'Restaure o World antes de criar convites.');
  if (world.visibility !== 'GROUP') throw new ApiError(409, 'WORLD_NOT_SHARED', 'Defina o World como “Membros convidados” antes de criar um convite.');
  const input = await readJson(c, worldInviteInputSchema);
  const token = randomToken(24); const tokenHash = await hashSecret(token, c.env.PASSWORD_PEPPER);
  const id = crypto.randomUUID(), now = new Date(), expiresAt = new Date(now.getTime() + input.expiresInDays * 86_400_000).toISOString();
  await c.env.DB.prepare(`INSERT INTO world_invites
    (id,world_id,created_by_user_id,token_hash,code_hint,role,expires_at,max_uses,created_at)
    VALUES (?,?,?,?,?,'VIEWER',?,?,?)`)
    .bind(id, worldId, c.get('user').id, tokenHash, token.slice(-6).toUpperCase(), expiresAt, input.maxUses, now.toISOString()).run();
  return c.json({ item: { id, code: token, codeHint: token.slice(-6).toUpperCase(), expiresAt, maxUses: input.maxUses } }, 201);
});

worldInviteRoutes.delete('/:worldId/:inviteId', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const result = await c.env.DB.prepare('UPDATE world_invites SET revoked_at=? WHERE id=? AND world_id=? AND revoked_at IS NULL')
    .bind(nowIso(), c.req.param('inviteId'), worldId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Convite ativo não encontrado.');
  return c.body(null, 204);
});

worldInviteRoutes.post('/accept/:token', async (c) => {
  const token = c.req.param('token');
  if (!/^[A-Za-z0-9_-]{24,80}$/u.test(token)) throw new ApiError(404, 'INVALID_INVITE', 'Convite inválido ou expirado.');
  const tokenHash = await hashSecret(token, c.env.PASSWORD_PEPPER);
  const invite = await c.env.DB.prepare(`SELECT i.id,i.world_id worldId,i.expires_at expiresAt,i.max_uses maxUses,
    i.use_count useCount,i.revoked_at revokedAt,w.name worldName,w.archived_at worldArchivedAt
    FROM world_invites i JOIN worlds w ON w.id=i.world_id WHERE i.token_hash=?`).bind(tokenHash).first<{
      id: string; worldId: string; expiresAt: string; maxUses: number; useCount: number; revokedAt: string | null;
      worldName: string; worldArchivedAt: string | null;
    }>();
  const now = nowIso();
  if (!invite || invite.revokedAt || invite.worldArchivedAt || invite.expiresAt <= now) {
    throw new ApiError(404, 'INVALID_INVITE', 'Convite inválido ou expirado.');
  }
  const userId = c.get('user').id;
  const existing = await c.env.DB.prepare('SELECT role FROM world_members WHERE world_id=? AND user_id=?').bind(invite.worldId, userId).first();
  if (existing) return c.json({ world: { id: invite.worldId, name: invite.worldName }, alreadyMember: true });
  if (Number(invite.useCount) >= Number(invite.maxUses)) throw new ApiError(404, 'INVALID_INVITE', 'Convite inválido ou expirado.');
  if (!existing) {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT OR IGNORE INTO world_members (world_id,user_id,role,created_at)
        SELECT world_id,?,'VIEWER',? FROM world_invites
        WHERE id=? AND revoked_at IS NULL AND expires_at>? AND use_count<max_uses`).bind(userId, now, invite.id, now),
      c.env.DB.prepare('UPDATE world_invites SET use_count=use_count+1 WHERE id=? AND changes()=1').bind(invite.id),
    ]);
  }
  const membership = await c.env.DB.prepare('SELECT role FROM world_members WHERE world_id=? AND user_id=?').bind(invite.worldId, userId).first();
  if (!membership) throw new ApiError(404, 'INVALID_INVITE', 'Convite inválido ou expirado.');
  return c.json({ world: { id: invite.worldId, name: invite.worldName }, alreadyMember: false });
});
