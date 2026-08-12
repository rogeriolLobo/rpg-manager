import type { Context } from 'hono';
import type { ZodType } from 'zod';
import type { AppVariables, Env } from './types';

export class ApiError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429, public code: string, message: string, public fields?: unknown) {
    super(message);
  }
}

export async function readJson<T>(c: Context<{ Bindings: Env; Variables: AppVariables }>, schema: ZodType<T>): Promise<T> {
  const length = Number(c.req.header('content-length') ?? 0);
  if (length > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'O conteúdo enviado excede o limite permitido.');
  let body: unknown;
  try { body = await c.req.json(); } catch { throw new ApiError(400, 'MALFORMED_JSON', 'JSON inválido.'); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(422, 'VALIDATION_ERROR', 'Dados inválidos.', parsed.error.flatten().fieldErrors);
  return parsed.data;
}

export function nowIso(): string { return new Date().toISOString(); }
export function cleanNullable(value: string | null | undefined): string | null { return value ? value : null; }
