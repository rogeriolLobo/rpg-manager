import { Hono } from 'hono';
import { fileAssetKvKey, isValidFileAssetId, MAX_FILE_ASSET_BYTES, MAX_FILE_ASSETS_PER_USER, sniffFileAssetContentType } from '../../domain/content/file-asset';
import { ownedEntity } from '../content/authorization';
import { ApiError, nowIso } from '../http';
import type { AppVariables, Env } from '../types';

// F-028 (BATCH15): Files/Handouts/Assets — upload genérico (imagem/PDF), Zero Cost
// (Workers KV Free — ver src/domain/content/file-asset.ts e docs/library/COVER_STORAGE.md),
// opcionalmente ligado a uma Vault Entity (nunca duplica a entidade, só anexa). Leitura é
// SEMPRE owner-only (diferente de COVERS_KV, que é catálogo compartilhado) — um asset pode
// conter handout/mapa privado de mesa.

export const fileRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

interface FileAssetRow { id:string; entity_id:string|null; content_type:string; byte_length:number; filename:string; created_at:string }
function present(row: FileAssetRow) { return { id: row.id, entityId: row.entity_id, contentType: row.content_type, byteLength: row.byte_length, filename: row.filename, createdAt: row.created_at }; }

fileRoutes.get('/', async (c) => {
  const entityId = c.req.query('entityId');
  const userId = c.get('user').id;
  if (entityId) await ownedEntity(c, entityId);
  const rows = await c.env.DB.prepare(`SELECT * FROM file_assets WHERE owner_user_id=?${entityId ? ' AND entity_id=?' : ''} ORDER BY created_at DESC`)
    .bind(...(entityId ? [userId, entityId] : [userId])).all<FileAssetRow>();
  return c.json({ items: rows.results.map(present) });
});

fileRoutes.post('/', async (c) => {
  const userId = c.get('user').id;
  const contentLength = Number(c.req.header('Content-Length') ?? '0');
  if (contentLength > MAX_FILE_ASSET_BYTES) throw new ApiError(413, 'FILE_TOO_LARGE', `Arquivo maior que o limite permitido (${MAX_FILE_ASSET_BYTES / 1_000_000}MB).`);
  let formData: FormData;
  try { formData = await c.req.formData(); } catch { throw new ApiError(422, 'INVALID_UPLOAD', 'Envio inválido.'); }
  const file = formData.get('file');
  if (!(file instanceof File)) throw new ApiError(422, 'INVALID_UPLOAD', 'Selecione um arquivo.');
  if (file.size === 0) throw new ApiError(422, 'INVALID_UPLOAD', 'Arquivo vazio.');
  if (file.size > MAX_FILE_ASSET_BYTES) throw new ApiError(413, 'FILE_TOO_LARGE', `Arquivo maior que o limite permitido (${MAX_FILE_ASSET_BYTES / 1_000_000}MB).`);
  const entityIdField = formData.get('entityId');
  const entityId = typeof entityIdField === 'string' && entityIdField ? entityIdField : null;
  if (entityId) await ownedEntity(c, entityId);

  const count = await c.env.DB.prepare('SELECT COUNT(*) total FROM file_assets WHERE owner_user_id=?').bind(userId).first<{ total: number }>();
  if (Number(count?.total) >= MAX_FILE_ASSETS_PER_USER) throw new ApiError(409, 'FILE_QUOTA_EXCEEDED', `Limite de ${MAX_FILE_ASSETS_PER_USER} arquivos por conta atingido. Remova algum antes de enviar outro.`);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = sniffFileAssetContentType(bytes);
  if (!contentType) throw new ApiError(422, 'INVALID_FILE_FORMAT', 'Envie uma imagem (JPEG, PNG, WebP) ou um PDF.');

  const id = crypto.randomUUID(), now = nowIso();
  const filenameField = formData.get('filename');
  const filename = (typeof filenameField === 'string' && filenameField ? filenameField : file.name || '').slice(0, 200);
  await c.env.ASSETS_KV.put(fileAssetKvKey(id), bytes, { metadata: { contentType, uploadedAt: now, ownerUserId: userId } });
  try {
    await c.env.DB.prepare('INSERT INTO file_assets (id,owner_user_id,entity_id,content_type,byte_length,filename,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, userId, entityId, contentType, bytes.byteLength, filename, now).run();
  } catch (cause) {
    // Se o D1 falhar depois do KV já ter sido escrito, remove o órfão (best-effort) — nunca
    // deixa bytes sem metadata correspondente ocupando a cota gratuita para sempre.
    try { await c.env.ASSETS_KV.delete(fileAssetKvKey(id)); } catch { /* best-effort */ }
    throw cause;
  }
  return c.json({ item: { id, entityId, contentType, byteLength: bytes.byteLength, filename, createdAt: now } }, 201);
});

fileRoutes.get('/:id/content', async (c) => {
  const id = c.req.param('id');
  if (!isValidFileAssetId(id)) throw new ApiError(404, 'NOT_FOUND', 'Arquivo não encontrado.');
  const row = await c.env.DB.prepare('SELECT content_type,filename FROM file_assets WHERE id=? AND owner_user_id=?').bind(id, c.get('user').id).first<{ content_type: string; filename: string }>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Arquivo não encontrado.');
  const object = await c.env.ASSETS_KV.get(fileAssetKvKey(id), 'arrayBuffer');
  if (!object) throw new ApiError(404, 'NOT_FOUND', 'Arquivo não encontrado.');
  return new Response(object, {
    headers: {
      'Content-Type': row.content_type,
      'Content-Disposition': `inline; filename="${row.filename.replaceAll('"', '')}"`,
      // private: resposta autenticada/owner-only, nunca guardada por cache compartilhado.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

fileRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const result = await c.env.DB.prepare('DELETE FROM file_assets WHERE id=? AND owner_user_id=?').bind(id, c.get('user').id).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Arquivo não encontrado.');
  try { await c.env.ASSETS_KV.delete(fileAssetKvKey(id)); } catch { /* best-effort */ }
  return c.body(null, 204);
});
