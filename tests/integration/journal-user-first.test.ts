import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://journal-user-first.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

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
  const body = await response.json() as { user: { id: string } };
  if (!session || !csrf) throw new Error('Cookies ausentes.');
  return { userId: body.user.id, cookie: `rpg_session=${session}; rpg_csrf=${csrf}`, csrf };
}

async function createWorld(account: Account, name: string, visibility: 'PRIVATE' | 'GROUP' = 'PRIVATE'): Promise<string> {
  const response = await request('/worlds', 'POST', { name, description: '', defaultRpgId: null, visibility }, account);
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

  it('cria página, revisão e vínculo opcional atomicamente sem deixar página órfã quando o World é inválido', async () => {
    const owner = await register(`journal-atomic-${requestSequence}`);
    const worldId = await createWorld(owner, 'World Atômico');

    const created = await request('/journal/pages', 'POST', { title: 'Ideia atômica', content: 'Uma operação', folderId: null, worldId }, owner);
    expect(created.status).toBe(201);
    const item = (await created.json()) as { item: { id: string; worldIds: string[] } };
    expect(item.item.worldIds).toEqual([worldId]);
    expect((await request(`/journal/pages/${item.item.id}/revisions`, 'GET', undefined, owner)).status).toBe(200);

    const invalid = await request('/journal/pages', 'POST', { title: 'Não persiste', content: '', folderId: null, worldId: '00000000-0000-0000-0000-000000000000' }, owner);
    expect(invalid.status).toBe(404);
    const journal = await request('/journal', 'GET', undefined, owner);
    const pages = ((await journal.json()) as { pages: Array<{ title: string }> }).pages;
    expect(pages.map((page) => page.title)).toEqual(['Ideia atômica']);
  });

  it('permite ao Player vincular seu Journal privado a um World em que participa sem transferir ownership', async () => {
    const worldOwner = await register(`journal-player-owner-${requestSequence}`);
    const player = await register(`journal-player-${requestSequence}`);
    const outsider = await register(`journal-player-outsider-${requestSequence}`);
    const worldId = await createWorld(worldOwner, 'World do Player', 'GROUP');
    expect((await request(`/worlds/${worldId}/members`, 'POST', { userId: player.userId }, worldOwner)).status).toBe(201);

    const playerWorlds = await request('/worlds?pageSize=100', 'GET', undefined, player);
    const playerWorldItems = ((await playerWorlds.json()) as { items: Array<{ id: string; isOwner: boolean }> }).items;
    expect(playerWorldItems).toContainEqual(expect.objectContaining({ id: worldId, isOwner: false }));

    const created = await request('/journal/pages', 'POST', { title: 'Nota do Player', content: 'Privada', folderId: null, worldId }, player);
    expect(created.status).toBe(201);
    const pageId = ((await created.json()) as { item: { id: string } }).item.id;
    expect((await request(`/journal/pages/${pageId}/worlds/${worldId}`, 'POST', {}, outsider)).status).toBe(404);
    const ownerJournalResponse = await request('/journal', 'GET', undefined, worldOwner);
    const ownerJournal = (await ownerJournalResponse.json()) as { pages: unknown[] };
    expect(ownerJournal.pages).toHaveLength(0);
    const playerJournalResponse = await request('/journal', 'GET', undefined, player);
    const playerJournal = (await playerJournalResponse.json()) as { pages: Array<{ id: string; worldIds: string[] }> };
    expect(playerJournal.pages).toContainEqual(expect.objectContaining({ id: pageId, worldIds: [worldId] }));
  });

  it('preserva a página ao excluir o World e protege todas as mutações/revisões contra outro owner', async () => {
    const owner = await register(`journal-delete-world-${requestSequence}`);
    const other = await register(`journal-delete-world-other-${requestSequence}`);
    const worldId = await createWorld(owner, 'World Descartável');
    const created = await request('/journal/pages', 'POST', { title: 'Página durável', content: 'Original', folderId: null, worldId }, owner);
    const pageId = ((await created.json()) as { item: { id: string } }).item.id;
    expect((await request(`/journal/pages/${pageId}`, 'PATCH', { title: 'Página durável', content: 'Editada', folderId: null }, owner)).status).toBe(200);

    expect((await request(`/journal/pages/${pageId}`, 'PATCH', { title: 'Ataque', content: '', folderId: null }, other)).status).toBe(404);
    expect((await request(`/journal/pages/${pageId}`, 'DELETE', undefined, other)).status).toBe(404);
    expect((await request(`/journal/pages/${pageId}/revisions`, 'GET', undefined, other)).status).toBe(404);
    expect((await request(`/journal/pages/${pageId}/revisions/1/restore`, 'POST', {}, other)).status).toBe(404);

    expect((await request(`/worlds/${worldId}`, 'DELETE', undefined, owner)).status).toBe(204);
    const journal = await request('/journal', 'GET', undefined, owner);
    const page = ((await journal.json()) as { pages: Array<{ id: string; worldIds: string[] }> }).pages.find((candidate) => candidate.id === pageId);
    expect(page).toEqual(expect.objectContaining({ id: pageId, worldIds: [] }));
  });

  it('mantém DELETE legado como exclusão da página, enquanto o endpoint novo continua unlink', async () => {
    const owner = await register(`journal-legacy-delete-${requestSequence}`);
    const worldId = await createWorld(owner, 'World Legado');
    const created = await request(`/journal/${worldId}/pages`, 'POST', { title: 'Página legada', content: '', folderId: null }, owner);
    const pageId = ((await created.json()) as { item: { id: string } }).item.id;

    expect((await request(`/journal/${worldId}/pages/${pageId}`, 'DELETE', undefined, owner)).status).toBe(204);
    const journal = await request('/journal', 'GET', undefined, owner);
    expect(((await journal.json()) as { pages: Array<{ id: string }> }).pages.map((page) => page.id)).not.toContain(pageId);
  });
});
