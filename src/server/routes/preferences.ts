import { Hono } from 'hono';
import { themePreferenceSchema } from '../../shared/validation/schemas';
import { nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

export const preferenceRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

preferenceRoutes.get('/', async (c) => {
  const preference = await c.env.DB.prepare("SELECT COALESCE(theme, 'SYSTEM') theme FROM user_preferences WHERE user_id=?")
    .bind(c.get('user').id).first<{ theme: 'LIGHT' | 'DARK' | 'SYSTEM' }>();
  return c.json({ theme: preference?.theme ?? 'SYSTEM' });
});
preferenceRoutes.patch('/', async (c) => {
  const input = await readJson(c, themePreferenceSchema);
  await c.env.DB.prepare(`INSERT INTO user_preferences (user_id,theme,updated_at) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme,updated_at=excluded.updated_at`)
    .bind(c.get('user').id, input.theme, nowIso()).run();
  return c.json({ theme: input.theme });
});
