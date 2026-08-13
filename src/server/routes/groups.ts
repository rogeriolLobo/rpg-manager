import { Hono, type Context } from 'hono';
import { playGroupInputSchema, playGroupMemberCreateSchema, playGroupMemberUpdateSchema } from '../../shared/validation/schemas';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;
export const groupRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

async function ownedGroup(c: AppContext, id: string) {
  const group = await c.env.DB.prepare(`SELECT g.id,g.name,g.notes,g.created_at createdAt,g.updated_at updatedAt,
    (SELECT COALESCE(u.display_name,m.player_name) FROM play_group_members m LEFT JOIN users u ON u.id=m.user_id
      WHERE m.group_id=g.id AND m.is_game_master=1 LIMIT 1) gameMasterName
    FROM play_groups g WHERE g.id=? AND g.user_id=?`)
    .bind(id, c.get('user').id).first();
  if (!group) throw new ApiError(404, 'NOT_FOUND', 'Grupo não encontrado.');
  return group;
}

groupRoutes.get('/', async (c) => {
  const rows = await c.env.DB.prepare(`SELECT g.id,g.name,g.notes,g.created_at createdAt,g.updated_at updatedAt,
    (SELECT COUNT(*) FROM play_group_members m WHERE m.group_id=g.id) memberCount,
    (SELECT COUNT(*) FROM rpgs r WHERE r.play_group_id=g.id) rpgCount,
    (SELECT COUNT(*) FROM campaigns cp WHERE cp.play_group_id=g.id) campaignCount,
    (SELECT COALESCE(u.display_name,m.player_name) FROM play_group_members m LEFT JOIN users u ON u.id=m.user_id
      WHERE m.group_id=g.id AND m.is_game_master=1 LIMIT 1) gameMasterName
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
  const members = await c.env.DB.prepare(`SELECT m.id,COALESCE(u.display_name,m.player_name) playerName,m.user_id linkedUserId,
    m.notes,m.active,m.is_game_master isGameMaster,m.created_at createdAt,m.updated_at updatedAt
    FROM play_group_members m LEFT JOIN users u ON u.id=m.user_id
    WHERE m.group_id=? ORDER BY m.is_game_master DESC,m.active DESC,playerName COLLATE NOCASE`)
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
  await ownedGroup(c, c.req.param('id')); const input = await readJson(c, playGroupMemberCreateSchema); const id = crypto.randomUUID(); const now = nowIso();
  let playerName = input.playerName;
  if (input.userId) {
    const user = await c.env.DB.prepare('SELECT display_name displayName FROM users WHERE id=? AND disabled_at IS NULL AND deleted_at IS NULL')
      .bind(input.userId).first<{displayName:string}>();
    if (!user) throw new ApiError(422, 'INVALID_REGISTERED_USER', 'A conta selecionada não está disponível.');
    playerName = user.displayName;
  }
  const statements: D1PreparedStatement[] = [];
  if (input.isGameMaster) statements.push(
    c.env.DB.prepare('UPDATE play_group_members SET is_game_master=0,updated_at=? WHERE group_id=? AND is_game_master=1').bind(now,c.req.param('id')),
    c.env.DB.prepare(`UPDATE campaign_members SET is_game_master=0,updated_at=? WHERE group_member_id IN
      (SELECT id FROM play_group_members WHERE group_id=?)`).bind(now,c.req.param('id')),
  );
  statements.push(c.env.DB.prepare('INSERT INTO play_group_members (id,group_id,player_name,user_id,notes,active,is_game_master,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, c.req.param('id'), playerName, input.userId ?? null, input.notes, Number(input.active), Number(input.isGameMaster), now, now));
  try {
    await c.env.DB.batch(statements);
  } catch (error) { if (String(error).includes('UNIQUE')) throw new ApiError(409, 'DUPLICATE_GROUP_MEMBER', 'Este jogador ou esta conta já pertence ao grupo.'); throw error; }
  return c.json({ id }, 201);
});

groupRoutes.patch('/:id/members/:memberId', async (c) => {
  await ownedGroup(c, c.req.param('id')); const input = await readJson(c, playGroupMemberUpdateSchema); const now = nowIso();
  const member = await c.env.DB.prepare(`SELECT m.user_id userId,COALESCE(u.display_name,m.player_name) playerName
    FROM play_group_members m LEFT JOIN users u ON u.id=m.user_id WHERE m.id=? AND m.group_id=?`)
    .bind(c.req.param('memberId'),c.req.param('id')).first<{userId:string|null;playerName:string}>();
  if (!member) throw new ApiError(404, 'NOT_FOUND', 'Jogador não encontrado.');
  const playerName = member.userId ? member.playerName : input.playerName;
  const statements: D1PreparedStatement[] = [];
  if (input.isGameMaster) statements.push(
    c.env.DB.prepare('UPDATE play_group_members SET is_game_master=0,updated_at=? WHERE group_id=? AND id<>? AND is_game_master=1').bind(now,c.req.param('id'),c.req.param('memberId')),
    c.env.DB.prepare(`UPDATE campaign_members SET is_game_master=0,updated_at=? WHERE group_member_id IN
      (SELECT id FROM play_group_members WHERE group_id=? AND id<>?)`).bind(now,c.req.param('id'),c.req.param('memberId')),
  );
  statements.push(
    c.env.DB.prepare('UPDATE play_group_members SET player_name=?,notes=?,active=?,is_game_master=?,updated_at=? WHERE id=? AND group_id=?')
      .bind(playerName, input.notes, Number(input.active), Number(input.isGameMaster), now, c.req.param('memberId'), c.req.param('id')),
    c.env.DB.prepare(`UPDATE campaign_members SET player_name=?,active=?,is_game_master=?,updated_at=?
      WHERE group_member_id=? AND EXISTS (
        SELECT 1 FROM play_group_members member WHERE member.id=? AND member.group_id=?
      )`)
      .bind(playerName, Number(input.active), Number(input.isGameMaster), now, c.req.param('memberId'), c.req.param('memberId'), c.req.param('id')),
  );
  try {
    await c.env.DB.batch(statements);
  } catch (error) { if (String(error).includes('UNIQUE')) throw new ApiError(409, 'DUPLICATE_GROUP_MEMBER', 'Este jogador já pertence ao grupo.'); throw error; }
  return c.json({ success: true });
});

groupRoutes.delete('/:id/members/:memberId', async (c) => {
  await ownedGroup(c, c.req.param('id'));
  const result = await c.env.DB.prepare('DELETE FROM play_group_members WHERE id=? AND group_id=?').bind(c.req.param('memberId'), c.req.param('id')).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Jogador não encontrado.');
  return c.body(null, 204);
});
