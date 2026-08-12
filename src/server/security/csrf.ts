import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppVariables, Env } from '../types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function requireTrustedOrigin(c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next): Promise<Response | void> {
  if (SAFE_METHODS.has(c.req.method)) return next();
  const origin = c.req.header('Origin');
  const expectedOrigin = new URL(c.req.url).origin;
  if (!origin || origin !== expectedOrigin) return c.json({ error: { code: 'CSRF_ORIGIN', message: 'Origem da requisição inválida.' } }, 403);
  return next();
}

export async function requireCsrf(c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next): Promise<Response | void> {
  if (SAFE_METHODS.has(c.req.method)) return next();
  const cookieToken = getCookie(c, 'rpg_csrf');
  const headerToken = c.req.header('X-CSRF-Token');
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return c.json({ error: { code: 'CSRF_TOKEN', message: 'Token de segurança inválido.' } }, 403);
  }
  return next();
}
