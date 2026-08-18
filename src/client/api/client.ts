import { currentSessionEpoch } from './session-epoch';

export class ClientApiError extends Error {
  constructor(public code: string, message: string, public status: number, public fields?: Record<string, string[]>, public requestId?: string) { super(message); }
}

function csrfToken(): string | undefined {
  return document.cookie.split('; ').find((entry) => entry.startsWith('rpg_csrf='))?.split('=').slice(1).join('=');
}

// RPG-1.0-BATCH4: 401 com code=UNAUTHENTICATED (sessão ausente/expirada/revogada — ver
// requireAuth em src/server/auth/auth.ts) é o ÚNICO caso que deve derrubar a sessão no
// cliente. Login/troca de senha também usam status 401, mas com code=INVALID_CREDENTIALS
// (senha errada) — nunca deve disparar logout global, senão digitar a senha atual errada
// na tela de Segurança derrubaria a própria sessão válida do usuário. Por isso o gate é
// pelo `code`, nunca pelo `status` sozinho. `requestEpoch` evita reagir a uma resposta
// "fantasma" de uma requisição antiga que só resolveu depois de a sessão já ter mudado (ver
// session-epoch.ts). Quem escuta este evento: AuthProvider.
function reportIfSessionExpired(code: string, requestEpoch: number) {
  if (code === 'UNAUTHENTICATED' && requestEpoch === currentSessionEpoch()) window.dispatchEvent(new Event('rpg:unauthenticated'));
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const requestEpoch = currentSessionEpoch();
  const headers = new Headers(options.headers); const token = csrfToken();
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token && options.method && !['GET','HEAD'].includes(options.method)) headers.set('X-CSRF-Token', decodeURIComponent(token));
  const response = await fetch(`/api/v1${path}`, { ...options, headers, credentials: 'same-origin' });
  if (response.status === 204) return undefined as T;
  let body: ({ error?: { code: string; message: string; fields?: Record<string,string[]> }; requestId?: string } & T) | undefined;
  try { body = await response.json() as typeof body; } catch { body = undefined; }
  if (!response.ok && body?.error) { reportIfSessionExpired(body.error.code, requestEpoch); throw new ClientApiError(body.error.code, body.error.message, response.status, body.error.fields, body.requestId ?? response.headers.get('X-Request-Id') ?? undefined); }
  if (!response.ok) throw new ClientApiError('HTTP_ERROR', 'Não foi possível concluir a operação.', response.status, undefined, response.headers.get('X-Request-Id') ?? undefined);
  if (!body) throw new ClientApiError('INVALID_RESPONSE', 'O servidor retornou uma resposta inválida.', response.status, undefined, response.headers.get('X-Request-Id') ?? undefined);
  return body;
}

export const postJson = <T>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patchJson = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const putJson = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const deleteApi = <T>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined });
