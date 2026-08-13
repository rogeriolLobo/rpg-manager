import { Hono, type Context } from 'hono';
import { playGroupInputSchema, playGroupMemberInputSchema } from '../../shared/validation/schemas';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;
export const groupRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

async function ownedGroup(c: AppContext, id: string) {
  const group = await c.env.DB.prepare('SELECT id,name,notes,created_at createdAt,updated_at updatedAt FROM play_groups WHERE id=? AND user_id=?')
    .bind(id, c.get('user').id).first();
  if (!group) throw new ApiError(404, 'NOT_FOUND', 'Grupo não encontrado.');
  return group;
}

groupRoutes.get('/', async (c) => {
  const rows = await c.env.DB.prepare(`SELECT g.id,g.name,g.notes,g.created_at createdAt,g.updated_at updatedAt,
    (SELECT COUNT(*) FROM play_group_members m WHERE m.group_id=g.id) memberCount,
    (SELECT COUNT(*) FROM rpgs r WHERE r.play_group_id=g.id) rpgCount,
    (SELECT COUNT(*) FROM campaigns cp WHERE cp.play_group_id=g.id) campaignCount
    FROM play_groups g WHERE g.user_id=? ORDER BY g.name COLLATE NOCASE`).bind(c.get('user').id).all();
  return c.json({ items: rows.results });
});

groupRoutes.post('/', async (c) => {
  const input = await readJson(c, playGroupInputSchema); const id = crypto.randomUUID(); const now = nowIso();
  try {
    await c.env.DB.prepare('INSERT INTO play_groups (id,user_id,name,notes,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .bind(id, c.get('user').id, input.name, input.notes, now, now).run();
  } catch (error) { if (String(error).includes('UNIQUE')) throw new ApiError(409, 'DUPLICATE_GROUP', 'Já existe um grupo com este nome.'); throw error; }
  return c.json({ item: await ownedGroup(c, id) }, 201);
});

groupRoutes.get('/:id', async (c) => {
  const item = await ownedGroup(c, c.req.param('id'));
  const members = await c.env.DB.prepare('SELECT id,player_name playerName,notes,active,created_at createdAt,updated_at updatedAt FROM play_group_members WHERE group_id=? ORDER BY active DESC,player_name COLLATE NOCASE')
    .bind(c.req.param('id')).all();
  return c.json({ item, members: members.results });
});

groupRoutes.patch('/:id', async (c) => {
  await ownedGroup(c, c.req.param('id')); const input = await readJson(c, playGroupInputSchema);
  try {
    await c.env.DB.prepare('UPDATE play_groups SET name=?,notes=?,updated_at=? WHERE id=? AND user_id=?')
      .bind(input.name, input.notes, nowIso(), c.req.param('id'), c.get('user').id).run();
  } catch (error) { if (String(error).includes('UNIQUE')) throw new ApiError(409, 'DUPLICATE_GROUP', 'Já existe um grupo com este nome.'); throw error; }
  return c.json({ item: await ownedGroup(c, c.req.param('id')) });
});

groupRoutes.delete('/:id', async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM play_groups WHERE id=? AND user_id=?').bind(c.req.param('id'), c.get('user').id).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Grupo não encontrado.');
  return c.body(null, 204);
});

groupRoutes.post('/:id/members', async (c) => {
  await ownedGroup(c, c.req.param('id')); const input = await readJson(c, playGroupMemberInputSchema); const id = crypto.randomUUID(); const now = nowIso();
  try {
    await c.env.DB.prepare('INSERT INTO play_group_members (id,group_id,player_name,notes,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, c.req.param('id'), input.playerName, input.notes, Number(input.active), now, now).run();
  } catch (error) { if (String(error).includes('UNIQUE')) throw new ApiError(409, 'DUPLICATE_GROUP_MEMBER', 'Este jogador já pertence ao grupo.'); throw error; }
  return c.json({ id }, 201);
});

groupRoutes.patch('/:id/members/:memberId', async (c) => {
  await ownedGroup(c, c.req.param('id')); const input = await readJson(c, playGroupMemberInputSchema); const now = nowIso();
  const statements = [
    c.env.DB.prepare('UPDATE play_group_members SET player_name=?,notes=?,active=?,updated_at=? WHERE id=? AND group_id=?')
      .bind(input.playerName, input.notes, Number(input.active), now, c.req.param('memberId'), c.req.param('id')),
    c.env.DB.prepare(`UPDATE campaign_members SET player_name=?,active=?,updated_at=?
      WHERE group_member_id=? AND EXISTS (
        SELECT 1 FROM play_group_members member WHERE member.id=? AND member.group_id=?
      )`)
      .bind(input.playerName, Number(input.active), now, c.req.param('memberId'), c.req.param('memberId'), c.req.param('id')),
  ];
  try {
    const [result] = await c.env.DB.batch(statements); if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Jogador não encontrado.');
  } catch (error) { if (String(error).includes('UNIQUE')) throw new ApiError(409, 'DUPLICATE_GROUP_MEMBER', 'Este jogador já pertence ao grupo.'); throw error; }
  return c.json({ success: true });
});

groupRoutes.delete('/:id/members/:memberId', async (c) => {
  await ownedGroup(c, c.req.param('id'));
  const result = await c.env.DB.prepare('DELETE FROM play_group_members WHERE id=? AND group_id=?').bind(c.req.param('memberId'), c.req.param('id')).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Jogador não encontrado.');
  return c.body(null, 204);
});
