import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  base64ToBytes, bytesToBase64, fileAssetKvKey, isValidFileAssetId,
  MAX_ASSET_BUNDLE_TOTAL_BYTES, MAX_FILE_ASSET_BYTES, MAX_FILE_ASSETS_PER_USER, sniffFileAssetContentType,
} from '../../domain/content/file-asset';
import { ownedEntity } from '../content/authorization';
import { ApiError, nowIso, readJson } from '../http';
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

// ---- F-015 Seção 8 (BATCH21): backup REAL de assets — bytes empacotados junto com a
// metadata num bundle próprio, nunca embutido no JSON principal de GET /export (não caberia
// no armazenamento de job de preview/confirm em D1 — ver src/domain/backup/types.ts). Mesmo
// padrão preview-nunca-escreve/confirm-sempre-revalida do restore principal
// (backup-restore.ts), mas sem job persistido no servidor: o bundle já está inteiro nas mãos
// de quem restaura (é o próprio arquivo baixado por GET /backup), então o preview só valida
// e devolve um resumo — o confirm reenvia o MESMO bundle e nunca confia que "já foi validado
// antes" (revalida do zero, exatamente como o resto deste arquivo já faz para todo upload). ----
const ASSET_BUNDLE_SCHEMA_VERSION = 1;
const assetBundleEntrySchema = z.strictObject({
  id: z.string().max(80), entityId: z.string().max(80).nullable(), filename: z.string().max(200), byteLength: z.number().int().positive(), dataBase64: z.string().min(1),
});
const assetBundleSchema = z.strictObject({ schemaVersion: z.literal(1), exportedAt: z.string(), assets: z.array(assetBundleEntrySchema).max(MAX_FILE_ASSETS_PER_USER) });
const assetBundleInputSchema = z.strictObject({ bundle: z.string().min(1).max(30_000_000) });

interface AssetBundleWarning { oldId: string; message: string; category: 'SKIP' | 'MISSING_ASSET' }
interface ValidAssetItem { oldId: string; filename: string; contentType: string; bytes: Uint8Array; entityId: string | null }

async function validateAssetBundle(c: Context<{ Bindings: Env; Variables: AppVariables }>, bundle: string): Promise<{ items: ValidAssetItem[]; warnings: AssetBundleWarning[] }> {
  let root: unknown;
  try { root = JSON.parse(bundle); } catch { throw new ApiError(422, 'INVALID_BUNDLE_FILE', 'O arquivo de bundle enviado não é um JSON válido.'); }
  const parsed = assetBundleSchema.safeParse(root);
  if (!parsed.success) throw new ApiError(422, 'INVALID_BUNDLE_FILE', 'O bundle não tem o formato esperado.');
  if (parsed.data.schemaVersion !== ASSET_BUNDLE_SCHEMA_VERSION) throw new ApiError(422, 'UNSUPPORTED_BUNDLE_VERSION', 'Este bundle de assets usa uma versão que esta versão do RPG Manager não suporta — gere um novo em Configurações → Exportar arquivos.');
  const userId = c.get('user').id;
  const items: ValidAssetItem[] = [];
  const warnings: AssetBundleWarning[] = [];
  for (const entry of parsed.data.assets) {
    let bytes: Uint8Array;
    try { bytes = base64ToBytes(entry.dataBase64); } catch { warnings.push({ oldId: entry.id, message: 'Conteúdo do arquivo corrompido no bundle — não será restaurado.', category: 'SKIP' }); continue; }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_ASSET_BYTES) { warnings.push({ oldId: entry.id, message: `Arquivo fora do limite permitido (${MAX_FILE_ASSET_BYTES / 1_000_000}MB) — não será restaurado.`, category: 'SKIP' }); continue; }
    // O content-type do bundle NUNCA é confiado (nem existe no schema) — sempre resniffado a
    // partir dos bytes reais, mesmo princípio de todo upload normal (nunca confia no que o
    // cliente declara).
    const contentType = sniffFileAssetContentType(bytes);
    if (!contentType) { warnings.push({ oldId: entry.id, message: 'Conteúdo não reconhecido como imagem (JPEG/PNG/WebP) ou PDF — não será restaurado.', category: 'MISSING_ASSET' }); continue; }
    let entityId: string | null = null;
    if (entry.entityId) {
      const owned = await c.env.DB.prepare("SELECT id FROM vault_entities WHERE id=? AND owner_user_id=? AND archived_at IS NULL").bind(entry.entityId, userId).first<{ id: string }>();
      if (owned) entityId = owned.id;
      else warnings.push({ oldId: entry.id, message: 'Entidade vinculada original não existe mais nesta conta — arquivo será restaurado sem vínculo.', category: 'SKIP' });
    }
    items.push({ oldId: entry.id, filename: entry.filename, contentType, bytes, entityId });
  }
  return { items, warnings };
}

fileRoutes.get('/backup', async (c) => {
  const userId = c.get('user').id;
  const rows = await c.env.DB.prepare('SELECT id,entity_id,byte_length,filename FROM file_assets WHERE owner_user_id=? ORDER BY created_at').bind(userId).all<{ id: string; entity_id: string | null; byte_length: number; filename: string }>();
  const totalBytes = rows.results.reduce((sum, row) => sum + row.byte_length, 0);
  if (totalBytes > MAX_ASSET_BUNDLE_TOTAL_BYTES) {
    throw new ApiError(413, 'ASSET_BUNDLE_TOO_LARGE', `O total dos seus arquivos (${(totalBytes / 1_000_000).toFixed(1)}MB) excede o limite do bundle de backup (${MAX_ASSET_BUNDLE_TOTAL_BYTES / 1_000_000}MB). Remova alguns arquivos em Arquivos antes de gerar o backup, ou baixe-os individualmente.`);
  }
  const assets: Array<{ id: string; entityId: string | null; filename: string; byteLength: number; dataBase64: string }> = [];
  for (const row of rows.results) {
    const object = await c.env.ASSETS_KV.get(fileAssetKvKey(row.id), 'arrayBuffer');
    if (!object) continue; // metadata órfã (bytes já removidos do KV) — nunca trava o bundle inteiro, só é omitida
    assets.push({ id: row.id, entityId: row.entity_id, filename: row.filename, byteLength: row.byte_length, dataBase64: bytesToBase64(new Uint8Array(object)) });
  }
  return c.json({ schemaVersion: ASSET_BUNDLE_SCHEMA_VERSION, exportedAt: nowIso(), assets });
});

fileRoutes.post('/backup/preview', async (c) => {
  const { bundle } = await readJson(c, assetBundleInputSchema);
  const { items, warnings } = await validateAssetBundle(c, bundle);
  const count = await c.env.DB.prepare('SELECT COUNT(*) total FROM file_assets WHERE owner_user_id=?').bind(c.get('user').id).first<{ total: number }>();
  const remainingQuota = Math.max(0, MAX_FILE_ASSETS_PER_USER - Number(count?.total ?? 0));
  if (items.length > remainingQuota) warnings.push({ oldId: '', message: `Cota de ${MAX_FILE_ASSETS_PER_USER} arquivos por conta: apenas os primeiros ${remainingQuota} deste bundle serão restaurados.`, category: 'SKIP' });
  return c.json({ summary: { toRestore: Math.min(items.length, remainingQuota), skipped: warnings.length }, warnings, canConfirm: Math.min(items.length, remainingQuota) > 0 });
});

fileRoutes.post('/backup/confirm', async (c) => {
  const userId = c.get('user').id;
  const { bundle } = await readJson(c, assetBundleInputSchema);
  // Revalida do zero — nunca confia que a prévia já garantiu isso (o preview e o confirm são
  // duas chamadas independentes; nada fica guardado no servidor entre elas).
  const { items } = await validateAssetBundle(c, bundle);
  const count = await c.env.DB.prepare('SELECT COUNT(*) total FROM file_assets WHERE owner_user_id=?').bind(userId).first<{ total: number }>();
  let remainingQuota = Math.max(0, MAX_FILE_ASSETS_PER_USER - Number(count?.total ?? 0));
  const now = nowIso();
  let created = 0;
  for (const item of items) {
    if (remainingQuota <= 0) break;
    const id = crypto.randomUUID();
    await c.env.ASSETS_KV.put(fileAssetKvKey(id), item.bytes, { metadata: { contentType: item.contentType, uploadedAt: now, ownerUserId: userId } });
    try {
      await c.env.DB.prepare('INSERT INTO file_assets (id,owner_user_id,entity_id,content_type,byte_length,filename,created_at) VALUES (?,?,?,?,?,?,?)')
        .bind(id, userId, item.entityId, item.contentType, item.bytes.byteLength, item.filename, now).run();
    } catch (cause) {
      try { await c.env.ASSETS_KV.delete(fileAssetKvKey(id)); } catch { /* best-effort */ }
      throw cause;
    }
    created += 1;
    remainingQuota -= 1;
  }
  return c.json({ restored: { fileAssets: created } });
});
