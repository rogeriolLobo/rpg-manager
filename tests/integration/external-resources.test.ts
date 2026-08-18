// F-003: External Resources — referência externa (link) zero-cost, escopada por World. Ver
// src/server/routes/external-resources.ts e docs/product/MASTER_BACKLOG.md.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://external-resources.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.115.${requestSequence++ % 250}`,
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

const resource = (extra: Record<string, unknown> = {}) => ({
  title: 'Mapa da Aldea', url: 'https://exemplo.com/mapa.png', description: '', resourceType: 'MAP', ...extra,
});

describe('External Resources — CRUD e authZ', () => {
  it('owner cria/edita/remove; membro do World (GROUP) só lê; outsider recebe 404', async () => {
    const owner = await register('extres-owner');
    const member = await register('extres-member');
    const outsider = await register('extres-outsider');
    const world = await request('/worlds', 'POST', { name: 'World de Recursos', description: '', defaultRpgId: null, visibility: 'GROUP' }, owner);
    const worldId = ((await world.json()) as { item: { id: string } }).item.id;
    await request(`/worlds/${worldId}/members`, 'POST', { userId: member.userId }, owner);

    // Outsider não vê nem a lista (World não é dele nem ele é membro).
    expect((await request(`/external-resources/${worldId}`, 'GET', undefined, outsider)).status).toBe(404);
    // Outsider não consegue criar.
    expect((await request(`/external-resources/${worldId}`, 'POST', resource(), outsider)).status).toBe(404);

    const created = await request(`/external-resources/${worldId}`, 'POST', resource(), owner);
    expect(created.status).toBe(201);
    const resourceId = ((await created.json()) as { item: { id: string } }).item.id;

    // Membro consegue LER (visibilidade de World GROUP), mas não criar/editar/remover.
    const memberList = await request(`/external-resources/${worldId}`, 'GET', undefined, member);
    expect(memberList.status).toBe(200);
    const memberBody = (await memberList.json()) as { world: { isOwner: boolean }; items: Array<{ id: string; title: string }> };
    expect(memberBody.world.isOwner).toBe(false);
    expect(memberBody.items.some((item) => item.id === resourceId)).toBe(true);
    expect((await request(`/external-resources/${worldId}/${resourceId}`, 'PATCH', resource({ title: 'Invadido' }), member)).status).toBe(404);
    expect((await request(`/external-resources/${worldId}/${resourceId}`, 'DELETE', undefined, member)).status).toBe(404);

    // Owner edita e remove normalmente.
    const updated = await request(`/external-resources/${worldId}/${resourceId}`, 'PATCH', resource({ title: 'Mapa Atualizado' }), owner);
    expect(updated.status).toBe(200);
    const afterUpdate = await request(`/external-resources/${worldId}`, 'GET', undefined, owner);
    expect(((await afterUpdate.json()) as { items: Array<{ title: string }> }).items[0].title).toBe('Mapa Atualizado');
    expect((await request(`/external-resources/${worldId}/${resourceId}`, 'DELETE', undefined, owner)).status).toBe(204);
    const afterDelete = await request(`/external-resources/${worldId}`, 'GET', undefined, owner);
    expect(((await afterDelete.json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  it('rejeita URL insegura (IP privado/loopback) e World de outra conta (IDOR)', async () => {
    const owner = await register('extres-security-owner');
    const outsider = await register('extres-security-outsider');
    const world = await request('/worlds', 'POST', { name: 'World Seguro', description: '', defaultRpgId: null, visibility: 'PRIVATE' }, owner);
    const worldId = ((await world.json()) as { item: { id: string } }).item.id;

    const insecure = await request(`/external-resources/${worldId}`, 'POST', resource({ url: 'https://127.0.0.1/x' }), owner);
    expect(insecure.status).toBe(422);

    const otherWorld = await request('/worlds', 'POST', { name: 'World do Outsider', description: '', defaultRpgId: null, visibility: 'PRIVATE' }, outsider);
    const otherWorldId = ((await otherWorld.json()) as { item: { id: string } }).item.id;
    // Owner não pode criar recurso num World que não é dele.
    expect((await request(`/external-resources/${otherWorldId}`, 'POST', resource(), owner)).status).toBe(404);
  });
});
