import type { Env } from '../types';

interface TurnstileResponse { success: boolean }

export async function verifyTurnstile(env: Env, token: string | undefined, remoteIp: string | undefined): Promise<boolean> {
  if (env.ENVIRONMENT === 'test' && (env as unknown as Record<string, string>).E2E_BYPASS_RATE_LIMIT === '1') return true;
  if (!env.TURNSTILE_SECRET_KEY) return env.ENVIRONMENT !== 'production';
  if (!token) {
    console.log('[Turnstile] Failed: No token provided');
    return false;
  }
  const body = new FormData();
  body.set('secret', env.TURNSTILE_SECRET_KEY);
  body.set('response', token);
  if (remoteIp) body.set('remoteip', remoteIp);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    if (!response.ok) {
      console.log(`[Turnstile] Failed: HTTP ${response.status} ${response.statusText}`);
      return false;
    }
    const result = await response.json<TurnstileResponse>();
    console.log(`[Turnstile] Result: ${JSON.stringify(result)}`);
    return result.success;
  } catch (error) {
    console.log(`[Turnstile] Exception: ${error}`);
    return false;
  }
}
