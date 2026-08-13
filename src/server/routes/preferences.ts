import { Hono } from 'hono';
import { activeWorldPreferenceSchema, themePreferenceSchema } from '../../shared/validation/schemas';
import { authorizedWorld } from '../content/authorization';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

export const preferenceRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

preferenceRoutes.get('/', async (c) => {
  const preference = await c.env.DB.prepare("SELECT COALESCE(theme,'SYSTEM') theme FROM user_preferences WHERE user_id=?")
    .bind(c.get('user').id).first<{ theme: 'LIGHT' | 'DARK' | 'SYSTEM' }>();
  return c.json({ theme: preference?.theme ?? 'SYSTEM' });
});
preferenceRoutes.patch('/', async (c) => {
  const input = await readJson(c, themePreferenceSchema);
  const userId = c.get('user').id;
  await c.env.DB.prepare(`INSERT INTO user_preferences (user_id,theme,updated_at) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme,updated_at=excluded.updated_at`)
    .bind(userId, input.theme, nowIso()).run();
  return c.json({ theme: input.theme });
});

preferenceRoutes.get('/active-world', async (c) => {
  const userId = c.get('user').id;
  const preference = await c.env.DB.prepare(`SELECT CASE WHEN EXISTS(
    SELECT 1 FROM worlds w WHERE w.id=p.active_world_id AND w.archived_at IS NULL
      AND (w.owner_user_id=? OR (w.visibility='GROUP' AND EXISTS(
        SELECT 1 FROM world_members wm WHERE wm.world_id=w.id AND wm.user_id=?))))
    THEN p.active_world_id ELSE NULL END activeWorldId FROM user_preferences p WHERE p.user_id=?`)
    .bind(userId, userId, userId).first<{ activeWorldId: string | null }>();
  return c.json({ activeWorldId: preference?.activeWorldId ?? null });
});

preferenceRoutes.patch('/active-world', async (c) => {
  const input = await readJson(c, activeWorldPreferenceSchema); const userId = c.get('user').id;
  if (input.activeWorldId) {
    const world = await authorizedWorld(c, input.activeWorldId);
    if (world.archived_at) throw new ApiError(422, 'INVALID_ACTIVE_WORLD', 'Um World arquivado não pode ficar ativo.');
  }
  await c.env.DB.prepare(`INSERT INTO user_preferences (user_id,active_world_id,updated_at) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET active_world_id=excluded.active_world_id,updated_at=excluded.updated_at`)
    .bind(userId, input.activeWorldId, nowIso()).run();
  return c.json({ activeWorldId: input.activeWorldId });
});
