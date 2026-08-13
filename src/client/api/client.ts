export class ClientApiError extends Error {
  constructor(public code: string, message: string, public status: number, public fields?: Record<string, string[]>, public requestId?: string) { super(message); }
}

function csrfToken(): string | undefined {
  return document.cookie.split('; ').find((entry) => entry.startsWith('rpg_csrf='))?.split('=').slice(1).join('=');
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers); const token = csrfToken();
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token && options.method && !['GET','HEAD'].includes(options.method)) headers.set('X-CSRF-Token', decodeURIComponent(token));
  const response = await fetch(`/api/v1${path}`, { ...options, headers, credentials: 'same-origin' });
  if (response.status === 204) return undefined as T;
  let body: ({ error?: { code: string; message: string; fields?: Record<string,string[]> }; requestId?: string } & T) | undefined;
  try { body = await response.json() as typeof body; } catch { body = undefined; }
  if (!response.ok && body?.error) throw new ClientApiError(body.error.code, body.error.message, response.status, body.error.fields, body.requestId ?? response.headers.get('X-Request-Id') ?? undefined);
  if (!response.ok) throw new ClientApiError('HTTP_ERROR', 'Não foi possível concluir a operação.', response.status, undefined, response.headers.get('X-Request-Id') ?? undefined);
  if (!body) throw new ClientApiError('INVALID_RESPONSE', 'O servidor retornou uma resposta inválida.', response.status, undefined, response.headers.get('X-Request-Id') ?? undefined);
  return body;
}

export const postJson = <T>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patchJson = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const deleteApi = <T>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined });
