import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://map-studio.example.com';
const password = 'esta e uma senha longa 2026';
let seq = 1;

interface Account {
  userId: string;
  cookie: string;
  csrf: string;
}

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.118.${seq++ % 250}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { Origin: origin } : {}),
      ...(account ? { Cookie: account.cookie, 'X-CSRF-Token': account.csrf } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function register(name: string): Promise<Account> {
  const response = await request('/auth/register', 'POST', {
    email: `${name}@example.com`,
    displayName: name,
    password,
  });
  expect(response.status).toBe(201);
  const cookies = response.headers.get('set-cookie') ?? '';
  const session = cookies.match(/rpg_session=([^;,]+)/)?.[1];
  const csrf = cookies.match(/rpg_csrf=([^;,]+)/)?.[1];
  const body = await response.json() as { user: { id: string } };
  if (!session || !csrf) throw new Error('cookies ausentes');
  return { userId: body.user.id, cookie: `rpg_session=${session}; rpg_csrf=${csrf}`, csrf };
}

async function createWorld(account: Account, name: string) {
  const response = await request('/worlds', 'POST', {
    name,
    description: '',
    defaultRpgId: null,
    visibility: 'PRIVATE',
  }, account);
  expect(response.status).toBe(201);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

const input = {
  name: 'Mapa independente',
  description: 'Sem World',
  mapType: 'TACTICAL',
  width: 1600,
  height: 900,
  gridType: 'SQUARE',
  gridSize: 50,
  backgroundAssetId: null,
};

const editorDocument = {
  version: 1 as const,
  backgroundColor: '#f5f1e8',
  layers: [{
    id: '00000000-0000-4000-8000-000000000101',
    name: 'Elementos',
    visible: true,
    locked: false,
    objects: [{
      id: '00000000-0000-4000-8000-000000000102',
      type: 'RECTANGLE' as const,
      x: 100,
      y: 120,
      width: 240,
      height: 180,
      rotation: 15,
      fill: '#8b5e3c',
      text: '',
    }],
  }],
};

describe('Map Studio User-First', () => {
  it('protege toda a superfície /maps com autenticação', async () => {
    expect((await request('/maps')).status).toBe(401);
    expect((await request('/maps', 'POST', input)).status).toBe(401);
  });

  it('cria, duplica, vincula/desvincula e preserva mapa ao excluir World', async () => {
    const owner = await register(`map-owner-${seq}`);
    const worldA = await createWorld(owner, 'World A');
    const worldB = await createWorld(owner, 'World B');
    const created = await request('/maps', 'POST', input, owner);
    expect(created.status).toBe(201);
    const mapId = ((await created.json()) as { item: { id: string; worldIds: string[] } }).item.id;

    expect((await request(`/maps/${mapId}/worlds/${worldA}`, 'POST', {}, owner)).status).toBe(201);
    expect((await request(`/maps/${mapId}/worlds/${worldB}`, 'POST', {}, owner)).status).toBe(201);

    const filtered = await request(`/maps?worldId=${worldA}`, 'GET', undefined, owner);
    expect(((await filtered.json()) as { items: Array<{ id: string }> }).items.map((map) => map.id)).toContain(mapId);

    expect((await request(`/maps/${mapId}/worlds/${worldA}`, 'DELETE', undefined, owner)).status).toBe(204);
    const detail = await request(`/maps/${mapId}`, 'GET', undefined, owner);
    expect(((await detail.json()) as { item: { worlds: Array<{ id: string }> } }).item.worlds.map((world) => world.id)).toEqual([worldB]);

    expect((await request(`/worlds/${worldB}`, 'DELETE', undefined, owner)).status).toBe(204);
    const afterWorldDelete = await request(`/maps/${mapId}`, 'GET', undefined, owner);
    expect(afterWorldDelete.status).toBe(200);
    expect(((await afterWorldDelete.json()) as { item: { worlds: unknown[] } }).item.worlds).toEqual([]);

    const copy = await request(`/maps/${mapId}/duplicate`, 'POST', {}, owner);
    expect(copy.status).toBe(201);
    const copyId = ((await copy.json()) as { id: string }).id;
    expect((await request(`/maps/${copyId}`, 'GET', undefined, owner)).status).toBe(200);
  });

  it('arquiva, bloqueia edição enquanto arquivado e permite restaurar', async () => {
    const owner = await register(`map-archive-${seq}`);
    const created = await request('/maps', 'POST', input, owner);
    const mapId = ((await created.json()) as { item: { id: string } }).item.id;

    expect((await request(`/maps/${mapId}/archive`, 'POST', {}, owner)).status).toBe(200);
    expect((await request(`/maps/${mapId}`, 'PATCH', input, owner)).status).toBe(409);

    const activeList = await request('/maps', 'GET', undefined, owner);
    expect(((await activeList.json()) as { items: Array<{ id: string }> }).items.map((map) => map.id)).not.toContain(mapId);

    const allList = await request('/maps?archived=1', 'GET', undefined, owner);
    expect(((await allList.json()) as { items: Array<{ id: string }> }).items.map((map) => map.id)).toContain(mapId);

    expect((await request(`/maps/${mapId}/restore`, 'POST', {}, owner)).status).toBe(200);
    expect((await request(`/maps/${mapId}`, 'PATCH', { ...input, name: 'Mapa restaurado' }, owner)).status).toBe(200);
  });

  it('persiste o documento do editor e rejeita gravação concorrente', async () => {
    const owner = await register(`map-content-${seq}`);
    const created = await request('/maps', 'POST', input, owner);
    const createdItem = ((await created.json()) as { item: { id: string; documentVersion: number } }).item;

    expect(createdItem.documentVersion).toBe(0);
    const documentWithFutureExtension = {
      ...editorDocument,
      extensions: {
        'future.terrain': { version: 1, strokes: [{ id: 'stroke-1', points: [[10, 20]] }] },
      },
    };
    const saved = await request(`/maps/${createdItem.id}/content`, 'PATCH', {
      expectedVersion: 0,
      document: documentWithFutureExtension,
    }, owner);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ success: true, version: 1 });

    const stale = await request(`/maps/${createdItem.id}/content`, 'PATCH', {
      expectedVersion: 0,
      document: { ...editorDocument, backgroundColor: '#ffffff' },
    }, owner);
    expect(stale.status).toBe(409);

    const detail = await request(`/maps/${createdItem.id}`, 'GET', undefined, owner);
    expect((await detail.json()) as unknown).toMatchObject({
      item: { documentVersion: 1, document: documentWithFutureExtension },
    });
  });

  it('isola ownership e não permite operar mapa de outro usuário', async () => {
    const owner = await register(`map-isolation-${seq}`);
    const other = await register(`map-other-${seq}`);
    const world = await createWorld(owner, 'World privado');
    const created = await request('/maps', 'POST', input, owner);
    const mapId = ((await created.json()) as { item: { id: string } }).item.id;

    expect((await request(`/maps/${mapId}`, 'GET', undefined, other)).status).toBe(404);
    expect((await request(`/maps/${mapId}`, 'PATCH', input, other)).status).toBe(404);
    expect((await request(`/maps/${mapId}/content`, 'PATCH', { expectedVersion: 0, document: editorDocument }, other)).status).toBe(404);
    expect((await request(`/maps/${mapId}/worlds/${world}`, 'POST', {}, other)).status).toBe(404);
    expect((await request(`/maps/${mapId}`, 'DELETE', undefined, other)).status).toBe(404);
  });
});
