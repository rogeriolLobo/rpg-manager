// F-028 (BATCH15): Files/Handouts/Assets — upload genérico (imagem/PDF), Zero Cost
// (Workers KV Free) — ver src/server/routes/files.ts.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://file-assets.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.124.${requestSequence++ % 250}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { Origin: origin } : {}),
      ...(account ? { Cookie: account.cookie, 'X-CSRF-Token': account.csrf } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function register(name: string): Promise<Account> {
  const response = await request('/auth/register', 'POST', { email: `${name}@example.com`, displayName: name, password });
  expect(response.status).toBe(201);
  const cookies = response.headers.get('set-cookie') ?? '';
  const session = cookies.match(/rpg_session=([^;,]+)/)?.[1];
  const csrf = cookies.match(/rpg_csrf=([^;,]+)/)?.[1];
  const body = await response.json() as { user: { id: string } };
  if (!session || !csrf) throw new Error('Cookies ausentes.');
  return { userId: body.user.id, cookie: `rpg_session=${session}; rpg_csrf=${csrf}`, csrf };
}

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
const NOT_A_FILE_BYTES = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

async function upload(bytes: Uint8Array, account: Account, extra: Record<string, string> = {}, filename = 'arquivo.jpg') {
  const formData = new FormData();
  formData.set('file', new Blob([bytes as BlobPart]), filename);
  for (const [key, value] of Object.entries(extra)) formData.set(key, value);
  return worker.default.fetch(`${origin}/api/v1/files`, {
    method: 'POST',
    headers: { 'CF-Connecting-IP': `203.0.124.${requestSequence++ % 250}`, Origin: origin, Cookie: account.cookie, 'X-CSRF-Token': account.csrf },
    body: formData,
  });
}

async function createEntity(account: Account): Promise<string> {
  const response = await request('/vault', 'POST', { entityType: 'LOCATION', name: 'Local', summary: '', description: '', visibility: 'PRIVATE', worldId: null, groupId: null, parentEntityId: null, adventure: null }, account);
  expect(response.status).toBe(201);
  return (await response.json() as { id: string }).id;
}

describe('Files/Handouts/Assets — upload Zero Cost (F-028)', () => {
  it('envia JPEG e PDF válidos, lê os mesmos bytes de volta, e exclui', async () => {
    const owner = await register('file-owner');

    const jpegResponse = await upload(JPEG_BYTES, owner, {}, 'foto.jpg');
    expect(jpegResponse.status).toBe(201);
    const jpegBody = await jpegResponse.json() as { item: { id: string; contentType: string; filename: string } };
    expect(jpegBody.item).toMatchObject({ contentType: 'image/jpeg', filename: 'foto.jpg' });

    const read = await request(`/files/${jpegBody.item.id}/content`, 'GET', undefined, owner);
    expect(read.status).toBe(200);
    expect(read.headers.get('Content-Type')).toBe('image/jpeg');
    expect([...new Uint8Array(await read.arrayBuffer())]).toEqual([...JPEG_BYTES]);

    const pdfResponse = await upload(PDF_BYTES, owner, {}, 'ficha.pdf');
    expect(pdfResponse.status).toBe(201);
    expect((await pdfResponse.json() as { item: { contentType: string } }).item.contentType).toBe('application/pdf');

    const listed = await request('/files', 'GET', undefined, owner);
    expect((await listed.json() as { items: unknown[] }).items).toHaveLength(2);

    expect((await request(`/files/${jpegBody.item.id}`, 'DELETE', undefined, owner)).status).toBe(204);
    expect((await request(`/files/${jpegBody.item.id}/content`, 'GET', undefined, owner)).status).toBe(404);
  });

  it('rejeita arquivo com bytes inválidos (magic bytes), maior que o limite, e IDOR/quota', async () => {
    const owner = await register('file-owner-2');
    const outsider = await register('file-outsider-2');

    expect((await upload(NOT_A_FILE_BYTES, owner)).status).toBe(422);

    const tooLarge = new Uint8Array(6_000_000);
    tooLarge.set(JPEG_BYTES);
    expect((await upload(tooLarge, owner)).status).toBe(413);

    const uploaded = await upload(JPEG_BYTES, owner, {}, 'privado.jpg');
    const id = (await uploaded.json() as { item: { id: string } }).item.id;

    // Outsider nunca lê nem exclui o arquivo de outra conta.
    expect((await request(`/files/${id}/content`, 'GET', undefined, outsider)).status).toBe(404);
    expect((await request(`/files/${id}`, 'DELETE', undefined, outsider)).status).toBe(404);

    // ID inexistente/mal-formado nunca quebra, sempre 404.
    expect((await request('/files/id-invalido/content', 'GET', undefined, owner)).status).toBe(404);
  });

  it('anexa a uma Vault Entity do próprio dono (nunca de outro dono); filtro por entityId funciona', async () => {
    const owner = await register('file-owner-3');
    const outsider = await register('file-outsider-3');
    const entityId = await createEntity(owner);
    const outsiderEntityId = await createEntity(outsider);

    const attached = await upload(JPEG_BYTES, owner, { entityId }, 'mapa.jpg');
    expect(attached.status).toBe(201);
    expect((await attached.json() as { item: { entityId: string | null } }).item.entityId).toBe(entityId);

    // Não pode anexar a uma entidade de outro dono.
    expect((await upload(JPEG_BYTES, owner, { entityId: outsiderEntityId })).status).toBe(404);

    await upload(JPEG_BYTES, owner, {}, 'solto.jpg'); // sem entityId
    const filtered = await request(`/files?entityId=${entityId}`, 'GET', undefined, owner);
    const filteredItems = await filtered.json() as { items: Array<{ filename: string }> };
    expect(filteredItems.items.map((item) => item.filename)).toEqual(['mapa.jpg']);
  });
});
