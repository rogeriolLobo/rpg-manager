import type { Env } from '../types';

interface TurnstileResponse { success: boolean }

export async function verifyTurnstile(env: Env, token: string | undefined, remoteIp: string | undefined): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return env.ENVIRONMENT !== 'production';
  if (!token) return false;
  const body = new FormData();
  body.set('secret', env.TURNSTILE_SECRET_KEY);
  body.set('response', token);
  if (remoteIp) body.set('remoteip', remoteIp);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  if (!response.ok) return false;
  const result = await response.json<TurnstileResponse>();
  return result.success;
}

