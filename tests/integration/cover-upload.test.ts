// LIB-005: upload/remoção/leitura de capa (Zero Cost — Workers KV Free), ver
// docs/library/COVER_STORAGE.md. Arquivo separado por escopo, mesmo padrão de
// isolamento dos demais arquivos de tests/integration (helpers locais, cada
// teste usa dados próprios).
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/server/types';

const worker = exports as unknown as {
  default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
};
const testEnv = env as unknown as Env;
const origin = 'https://example.com';
let requestSequence = 1;

async function request(path: string, method = 'GET', body?: unknown, cookie?: string, csrf?: string) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `198.18.2.${requestSequence++ % 250}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function uploadCover(rpgId: string, bytes: Uint8Array<ArrayBuffer>, cookie: string, csrf: string) {
  const formData = new FormData();
  formData.set('cover', new Blob([bytes]), 'cover.jpg');
  return worker.default.fetch(`${origin}/api/v1/rpgs/${rpgId}/cover`, {
    method: 'POST',
    headers: { 'CF-Connecting-IP': `198.18.2.${requestSequence++ % 250}`, Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf },
    body: formData,
  });
}

async function register(name: string) {
  const response = await request('/auth/register', 'POST', {
    email: `${name}@example.com`, displayName: name, password: 'esta e uma senha longa 2026',
  });
  expect(response.status).toBe(201);
  const cookies = response.headers.get('set-cookie') ?? '';
  const session = cookies.match(/rpg_session=([^;,]+)/)?.[1];
  const csrf = cookies.match(/rpg_csrf=([^;,]+)/)?.[1];
  const body = await response.json() as { user: { id: string } };
  if (!session || !csrf) throw new Error('Cookies de autenticação ausentes.');
  return { userId: body.user.id, cookie: `rpg_session=${session}; rpg_csrf=${csrf}`, csrf };
}

const base = {
  categoryId: null, subgenreId: null, readingStatus: 'NOT_STARTED', hasPlayed: false, wantsToPlay: false, priority: 'NONE',
  playGroupNotes: '', playGroupId: null, plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '', notes: '',
  coverUrl: null, coverSourceUrl: null, coverSourceNote: null,
};

// Bytes reais mínimos de JPEG/PNG (headers oficiais) — mesmos usados em
// tests/unit/cover-asset.test.ts.
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

async function createRpg(title: string, cookie: string, csrf: string, extra: Record<string, unknown> = {}) {
  const created = await request('/rpgs', 'POST', { ...base, title, ...extra }, cookie, csrf);
  expect(created.status).toBe(201);
  return ((await created.json()) as { item: { id: string } }).item;
}

describe('LIB-005: upload de capa (Zero Cost — Workers KV)', () => {
  it('dono envia capa válida (JPEG) → 200, coverAssetId presente, leitura via /media/covers/:id devolve os mesmos bytes', async () => {
    const a = await register('lib005-upload-a');
    const item = await createRpg('Capa por Upload', a.cookie, a.csrf);

    const uploaded = await uploadCover(item.id, JPEG_BYTES, a.cookie, a.csrf);
    expect(uploaded.status).toBe(200);
    const updated = ((await uploaded.json()) as { item: { coverAssetId: string | null; coverUrl: string | null } }).item;
    expect(updated.coverAssetId).toBeTruthy();
    // A URL externa (coverUrl) nunca é tocada pelo upload — continua null (não foi definida).
    expect(updated.coverUrl).toBeNull();

    const media = await request(`/media/covers/${updated.coverAssetId}`, 'GET', undefined, a.cookie);
    expect(media.status).toBe(200);
    expect(media.headers.get('Content-Type')).toBe('image/jpeg');
    const bytes = new Uint8Array(await media.arrayBuffer());
    expect([...bytes]).toEqual([...JPEG_BYTES]);
  });

  it('preserva uma capa por URL externa já existente — upload só some por cima na apresentação, não apaga cover_url', async () => {
    const a = await register('lib005-preserve-a');
    const item = await createRpg('Capa Externa Preservada', a.cookie, a.csrf, { coverUrl: 'https://exemplo.com/capa-original.jpg' });

    const uploaded = await uploadCover(item.id, JPEG_BYTES, a.cookie, a.csrf);
    expect(uploaded.status).toBe(200);
    const updated = ((await uploaded.json()) as { item: { coverAssetId: string | null; coverUrl: string | null } }).item;
    expect(updated.coverAssetId).toBeTruthy();
    expect(updated.coverUrl).toBe('https://exemplo.com/capa-original.jpg'); // intocado no banco.
  });

  it('rejeita conteúdo que não é uma imagem real, mesmo com nome/extensão de imagem (nunca confia no Content-Type declarado)', async () => {
    const a = await register('lib005-invalid-a');
    const item = await createRpg('Capa Inválida', a.cookie, a.csrf);
    const fakeBytes = new TextEncoder().encode('isto nao e uma imagem, so texto');
    const uploaded = await uploadCover(item.id, fakeBytes, a.cookie, a.csrf);
    expect(uploaded.status).toBe(422);
    expect(((await uploaded.json()) as { error: { code: string } }).error.code).toBe('INVALID_COVER_FORMAT');
  });

  it('rejeita arquivo vazio e arquivo maior que o limite', async () => {
    const a = await register('lib005-limits-a');
    const item = await createRpg('Capa Limites', a.cookie, a.csrf);

    const empty = await uploadCover(item.id, new Uint8Array([]), a.cookie, a.csrf);
    expect(empty.status).toBe(422);
    expect(((await empty.json()) as { error: { code: string } }).error.code).toBe('INVALID_UPLOAD');

    const tooBig = new Uint8Array(2_100_000);
    tooBig.set(JPEG_BYTES); // header válido — o bloqueio precisa ser por tamanho, não por formato.
    const big = await uploadCover(item.id, tooBig, a.cookie, a.csrf);
    expect(big.status).toBe(413);
    expect(((await big.json()) as { error: { code: string } }).error.code).toBe('COVER_TOO_LARGE');
  });

  it('não permite enviar/remover capa de um RPG de outra conta (IDOR)', async () => {
    const a = await register('lib005-idor-a');
    const b = await register('lib005-idor-b');
    const item = await createRpg('RPG de A', a.cookie, a.csrf);

    const uploadByB = await uploadCover(item.id, JPEG_BYTES, b.cookie, b.csrf);
    expect(uploadByB.status).toBe(404);

    const deleteByB = await request(`/rpgs/${item.id}/cover`, 'DELETE', undefined, b.cookie, b.csrf);
    expect(deleteByB.status).toBe(404);
  });

  it('trocar a capa remove o asset anterior do KV (não acumula lixo na cota gratuita)', async () => {
    const a = await register('lib005-replace-a');
    const item = await createRpg('Capa Trocada', a.cookie, a.csrf);

    const first = await uploadCover(item.id, JPEG_BYTES, a.cookie, a.csrf);
    const firstAssetId = ((await first.json()) as { item: { coverAssetId: string } }).item.coverAssetId;

    const second = await uploadCover(item.id, JPEG_BYTES, a.cookie, a.csrf);
    const secondAssetId = ((await second.json()) as { item: { coverAssetId: string } }).item.coverAssetId;
    expect(secondAssetId).not.toBe(firstAssetId);

    const oldMedia = await request(`/media/covers/${firstAssetId}`, 'GET', undefined, a.cookie);
    expect(oldMedia.status).toBe(404);
    const newMedia = await request(`/media/covers/${secondAssetId}`, 'GET', undefined, a.cookie);
    expect(newMedia.status).toBe(200);
  });

  it('DELETE remove a capa enviada (coverAssetId volta a null, asset some do KV) e um segundo DELETE dá 404', async () => {
    const a = await register('lib005-delete-a');
    const item = await createRpg('Capa Removida', a.cookie, a.csrf);
    const uploaded = await uploadCover(item.id, JPEG_BYTES, a.cookie, a.csrf);
    const assetId = ((await uploaded.json()) as { item: { coverAssetId: string } }).item.coverAssetId;

    const removed = await request(`/rpgs/${item.id}/cover`, 'DELETE', undefined, a.cookie, a.csrf);
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { item: { coverAssetId: string | null } }).item.coverAssetId).toBeNull();

    const media = await request(`/media/covers/${assetId}`, 'GET', undefined, a.cookie);
    expect(media.status).toBe(404);

    const removeAgain = await request(`/rpgs/${item.id}/cover`, 'DELETE', undefined, a.cookie, a.csrf);
    expect(removeAgain.status).toBe(404);
  });

  it('respeita SHARED_PUBLICATION_METADATA_LOCKED: bloqueia upload e remoção quando a Publication tem 2+ referências', async () => {
    const isbn = '9788575220436'; // mesmo ISBN de exemplo usado em publication-identity.test.ts
    const a = await register('lib005-locked-a');
    const b = await register('lib005-locked-b');
    const itemA = await createRpg('3D&T Alpha', a.cookie, a.csrf, { isbn });
    await createRpg('3D&T Alpha', b.cookie, b.csrf, { isbn }); // agora compartilhada (refCount=2)

    const uploadLocked = await uploadCover(itemA.id, JPEG_BYTES, a.cookie, a.csrf);
    expect(uploadLocked.status).toBe(422);
    const uploadBody = (await uploadLocked.json()) as { error: { code: string; fields?: Record<string, string[]> } };
    expect(uploadBody.error.code).toBe('SHARED_PUBLICATION_METADATA_LOCKED');
    expect(uploadBody.error.fields?.cover?.[0]).toBeTruthy();

    const deleteLocked = await request(`/rpgs/${itemA.id}/cover`, 'DELETE', undefined, a.cookie, a.csrf);
    expect(deleteLocked.status).toBe(422);
    expect(((await deleteLocked.json()) as { error: { code: string } }).error.code).toBe('SHARED_PUBLICATION_METADATA_LOCKED');

    const publication = await testEnv.DB.prepare('SELECT cover_asset_id FROM publications WHERE isbn13=?').bind(isbn).first<{ cover_asset_id: string | null }>();
    expect(publication?.cover_asset_id).toBeNull();
  });

  it('ID de capa mal-formado ou inexistente devolve 404 (nunca vaza distinção entre "não existe" e "não autorizado")', async () => {
    const a = await register('lib005-notfound-a');
    const malformed = await request('/media/covers/../../etc/passwd', 'GET', undefined, a.cookie);
    expect(malformed.status).toBe(404);
    const missing = await request(`/media/covers/${crypto.randomUUID()}`, 'GET', undefined, a.cookie);
    expect(missing.status).toBe(404);
  });
});
