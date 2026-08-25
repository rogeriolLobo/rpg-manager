import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://journal-user-first.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.117.${requestSequence++ % 250}`,
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
  if (!session || !csrf) throw new Error('Cookies ausentes.');
  return { cookie: `rpg_session=${session}; rpg_csrf=${csrf}`, csrf };
}

async function createWorld(account: Account, name: string): Promise<string> {
  const response = await request('/worlds', 'POST', { name, description: '', defaultRpgId: null, visibility: 'PRIVATE' }, account);
  expect(response.status).toBe(201);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

describe('Journal User-First e links N:N com Worlds', () => {
  it('mantém ownership no usuário ao vincular, desvincular e filtrar uma página em dois Worlds', async () => {
    const owner = await register(`journal-owner-${requestSequence}`);
    const stranger = await register(`journal-stranger-${requestSequence}`);
    const worldAId = await createWorld(owner, 'World A');
    const worldBId = await createWorld(owner, 'World B');
    const strangerWorldId = await createWorld(stranger, 'World Estranho');

    const created = await request('/journal/pages', 'POST', { title: 'Página independente', content: 'Conteúdo preservado', folderId: null }, owner);
    expect(created.status).toBe(201);
    const pageId = ((await created.json()) as { item: { id: string; worldIds: string[] } }).item.id;

    expect((await request(`/journal/pages/${pageId}/worlds/${worldAId}`, 'POST', {}, owner)).status).toBe(204);
    expect((await request(`/journal/pages/${pageId}/worlds/${worldAId}`, 'POST', {}, owner)).status).toBe(204);
    expect((await request(`/journal/pages/${pageId}/worlds/${worldBId}`, 'POST', {}, owner)).status).toBe(204);
    expect((await request(`/journal/pages/${pageId}/worlds/${strangerWorldId}`, 'POST', {}, owner)).status).toBe(404);
    expect((await request(`/journal/pages/${pageId}/worlds/${worldAId}`, 'POST', {}, stranger)).status).toBe(404);

    const global = await request('/journal', 'GET', undefined, owner);
    const globalBody = await global.json() as { pages: Array<{ id: string; worldIds: string[] }> };
    expect(globalBody.pages.find((page) => page.id === pageId)?.worldIds.sort()).toEqual([worldAId, worldBId].sort());

    const inWorldA = await request(`/journal/${worldAId}`, 'GET', undefined, owner);
    expect(((await inWorldA.json()) as { pages: Array<{ id: string }> }).pages.map((page) => page.id)).toContain(pageId);

    expect((await request(`/journal/pages/${pageId}/worlds/${worldAId}`, 'DELETE', undefined, owner)).status).toBe(204);
    const afterUnlink = await request('/journal', 'GET', undefined, owner);
    const afterUnlinkBody = await afterUnlink.json() as { pages: Array<{ id: string; worldIds: string[] }> };
    expect(afterUnlinkBody.pages.find((page) => page.id === pageId)?.worldIds).toEqual([worldBId]);
    const noLongerInWorldA = await request(`/journal/${worldAId}`, 'GET', undefined, owner);
    expect(((await noLongerInWorldA.json()) as { pages: Array<{ id: string }> }).pages.map((page) => page.id)).not.toContain(pageId);
  });
});
