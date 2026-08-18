// F-002: Cartografia (mapas + pins) — ver src/server/routes/cartography.ts.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://cartography.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.116.${requestSequence++ % 250}`,
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

const mapInput = (extra: Record<string, unknown> = {}) => ({ title: 'Mapa da Aldea', imageUrl: 'https://exemplo.com/mapa.png', notes: '', ...extra });
const pinInput = (extra: Record<string, unknown> = {}) => ({ label: 'Vila Central', notes: '', x: 42.5, y: 30, entityId: null, ...extra });

describe('Cartografia — mapas e pins', () => {
  it('owner cria mapa e pins; membro (GROUP) lê mas não escreve; outsider recebe 404', async () => {
    const owner = await register('cart-owner');
    const member = await register('cart-member');
    const outsider = await register('cart-outsider');
    const world = await request('/worlds', 'POST', { name: 'World Cartografado', description: '', defaultRpgId: null, visibility: 'GROUP' }, owner);
    const worldId = ((await world.json()) as { item: { id: string } }).item.id;
    await request(`/worlds/${worldId}/members`, 'POST', { userId: member.userId }, owner);

    expect((await request(`/cartography/${worldId}`, 'GET', undefined, outsider)).status).toBe(404);
    expect((await request(`/cartography/${worldId}`, 'POST', mapInput(), outsider)).status).toBe(404);

    const createdMap = await request(`/cartography/${worldId}`, 'POST', mapInput(), owner);
    expect(createdMap.status).toBe(201);
    const mapId = ((await createdMap.json()) as { item: { id: string } }).item.id;

    expect((await request(`/cartography/${worldId}/${mapId}/pins`, 'POST', pinInput(), member)).status).toBe(404);
    const createdPin = await request(`/cartography/${worldId}/${mapId}/pins`, 'POST', pinInput(), owner);
    expect(createdPin.status).toBe(201);
    const pinId = ((await createdPin.json()) as { item: { id: string } }).item.id;

    const memberView = await request(`/cartography/${worldId}/${mapId}`, 'GET', undefined, member);
    expect(memberView.status).toBe(200);
    const memberBody = (await memberView.json()) as { isOwner: boolean; pins: Array<{ id: string; label: string }> };
    expect(memberBody.isOwner).toBe(false);
    expect(memberBody.pins.map((pin) => pin.id)).toContain(pinId);

    expect((await request(`/cartography/${worldId}/${mapId}/pins/${pinId}`, 'PATCH', pinInput({ label: 'Invadido' }), member)).status).toBe(404);
    expect((await request(`/cartography/${worldId}/${mapId}/pins/${pinId}`, 'DELETE', undefined, member)).status).toBe(404);

    expect((await request(`/cartography/${worldId}/${mapId}/pins/${pinId}`, 'PATCH', pinInput({ label: 'Vila Renomeada' }), owner)).status).toBe(200);
    expect((await request(`/cartography/${worldId}/${mapId}/pins/${pinId}`, 'DELETE', undefined, owner)).status).toBe(204);
    expect((await request(`/cartography/${worldId}/${mapId}`, 'DELETE', undefined, member)).status).toBe(404);
    expect((await request(`/cartography/${worldId}/${mapId}`, 'DELETE', undefined, owner)).status).toBe(204);
  });

  it('valida coordenadas fora do intervalo [0,100], URL insegura e entidade vinculada', async () => {
    const owner = await register('cart-validation-owner');
    const world = await request('/worlds', 'POST', { name: 'World Validado', description: '', defaultRpgId: null, visibility: 'PRIVATE' }, owner);
    const worldId = ((await world.json()) as { item: { id: string } }).item.id;

    expect((await request(`/cartography/${worldId}`, 'POST', mapInput({ imageUrl: 'https://127.0.0.1/mapa.png' }), owner)).status).toBe(422);
    const map = await request(`/cartography/${worldId}`, 'POST', mapInput(), owner);
    const mapId = ((await map.json()) as { item: { id: string } }).item.id;

    expect((await request(`/cartography/${worldId}/${mapId}/pins`, 'POST', pinInput({ x: 101 }), owner)).status).toBe(422);
    expect((await request(`/cartography/${worldId}/${mapId}/pins`, 'POST', pinInput({ y: -1 }), owner)).status).toBe(422);
    expect((await request(`/cartography/${worldId}/${mapId}/pins`, 'POST', pinInput({ entityId: 'inexistente' }), owner)).status).toBe(422);

    const entity = await request('/vault', 'POST', { entityType: 'LOCATION', name: 'Torre Alta', summary: '', description: '', visibility: 'PRIVATE', worldId, groupId: null, parentEntityId: null, adventure: null, lore: null }, owner);
    expect(entity.status).toBe(201);
    const entityId = (await entity.json() as { id: string }).id;
    const pinWithEntity = await request(`/cartography/${worldId}/${mapId}/pins`, 'POST', pinInput({ entityId }), owner);
    expect(pinWithEntity.status).toBe(201);
    const view = await request(`/cartography/${worldId}/${mapId}`, 'GET', undefined, owner);
    const pins = (await view.json() as { pins: Array<{ entityId: string | null; entityName: string | null }> }).pins;
    expect(pins.find((pin) => pin.entityId === entityId)?.entityName).toBe('Torre Alta');
  });

  it('não permite vincular pin a entidade de outra conta (IDOR)', async () => {
    const owner = await register('cart-idor-owner');
    const outsider = await register('cart-idor-outsider');
    const world = await request('/worlds', 'POST', { name: 'World IDOR', description: '', defaultRpgId: null, visibility: 'PRIVATE' }, owner);
    const worldId = ((await world.json()) as { item: { id: string } }).item.id;
    const map = await request(`/cartography/${worldId}`, 'POST', mapInput(), owner);
    const mapId = ((await map.json()) as { item: { id: string } }).item.id;

    const outsiderWorld = await request('/worlds', 'POST', { name: 'World do Outsider', description: '', defaultRpgId: null, visibility: 'PRIVATE' }, outsider);
    const outsiderWorldId = ((await outsiderWorld.json()) as { item: { id: string } }).item.id;
    const outsiderEntity = await request('/vault', 'POST', { entityType: 'LOCATION', name: 'Segredo do Outsider', summary: '', description: '', visibility: 'PRIVATE', worldId: outsiderWorldId, groupId: null, parentEntityId: null, adventure: null, lore: null }, outsider);
    const outsiderEntityId = (await outsiderEntity.json() as { id: string }).id;

    expect((await request(`/cartography/${worldId}/${mapId}/pins`, 'POST', pinInput({ entityId: outsiderEntityId }), owner)).status).toBe(422);
  });
});
