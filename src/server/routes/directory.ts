import { Hono } from 'hono';
import { ApiError } from '../http';
import type { AppVariables, Env } from '../types';

export const directoryRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

directoryRoutes.get('/users', async (c) => {
  const query = (c.req.query('q') ?? '').trim();
  if (query.length < 3 || query.length > 254) {
    throw new ApiError(422, 'INVALID_USER_SEARCH', 'Digite entre 3 e 254 caracteres para buscar uma conta.');
  }
  const rateLimit = await c.env.DIRECTORY_RATE_LIMITER.limit({ key: c.get('user').id });
  if (!rateLimit.success) throw new ApiError(429, 'RATE_LIMITED', 'Muitas buscas. Aguarde antes de tentar novamente.');
  // D1/SQLite rejeita com "LIKE or GLOB pattern too complex" padrões acima de um limite interno
  // relativamente baixo — achado real (BATCH23-26): um e-mail/nome de conta legítimo mais longo
  // (~50+ caracteres) já bastava para quebrar a busca com um erro cru de SQL vazando pro
  // usuário. A cláusula OR email_normalized=lower(?) já cobre e-mail exato mesmo assim (é
  // comparação direta, não LIKE) — truncar aqui só limita o CASAMENTO POR NOME PARCIAL, nunca a
  // busca por e-mail completo, que continua funcionando normalmente para qualquer tamanho aceito
  // no input original (3-254, validado acima).
  const likeTerm = query.slice(0, 40);
  const rows = await c.env.DB.prepare(`SELECT id,display_name displayName
    FROM users
    WHERE disabled_at IS NULL AND deleted_at IS NULL
      AND (display_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR email_normalized=lower(?))
    ORDER BY CASE WHEN display_name=? COLLATE NOCASE THEN 0 ELSE 1 END,display_name COLLATE NOCASE
    LIMIT 8`).bind(`%${escapeLike(likeTerm)}%`, query, query).all();
  return c.json({ items: rows.results });
});
