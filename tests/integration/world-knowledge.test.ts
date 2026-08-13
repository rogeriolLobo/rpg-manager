import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://knowledge.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.113.${requestSequence++ % 250}`,
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

async function json<T>(response: Response): Promise<T> { return response.json() as Promise<T>; }

describe('World como espaço de conhecimento V2.1', () => {
  it('organiza o Vault, protege Diário, aceita convite e filtra Wiki/busca pelas permissões', async () => {
    const owner = await register('knowledge-owner');
    const player = await register('knowledge-player');

    const worldResponse = await request('/worlds', 'POST', { name: 'Aldea', description: 'Reinos do Norte', defaultRpgId: null, visibility: 'GROUP' }, owner);
    expect(worldResponse.status).toBe(201);
    const worldId = (await json<{ item: { id: string } }>(worldResponse)).item.id;

    const groupResponse = await request('/groups', 'POST', { name: 'Heróis de Aldea', notes: '' }, owner);
    const groupId = (await json<{ item: { id: string } }>(groupResponse)).item.id;
    expect((await request(`/groups/${groupId}/members`, 'POST', { playerName: 'jogador', userId: player.userId, notes: '', active: true, isGameMaster: false }, owner)).status).toBe(201);

    const targetResponse = await request('/vault', 'POST', { entityType: 'NPC', name: 'Lucien Valmont', summary: 'Guardião da corte', description: '', visibility: 'GROUP', worldId, groupId, parentEntityId: null, adventure: null, lore: null }, owner);
    const targetId = (await json<{ id: string }>(targetResponse)).id;
    const sourceResponse = await request('/vault', 'POST', { entityType: 'LORE', name: 'Crônica da Corte', summary: '', description: 'O juramento foi confiado ao [[Guardião Rubro]].', visibility: 'GROUP', worldId, groupId, parentEntityId: null, adventure: null, lore: { loreType: 'HISTORY', canonStatus: 'CANON', source: 'Arquivo real' } }, owner);
    const sourceId = (await json<{ id: string }>(sourceResponse)).id;
    expect(sourceId).toBeTruthy();
    expect((await request('/vault', 'POST', { entityType: 'LORE', name: 'Segredo do narrador', summary: '', description: '', visibility: 'PRIVATE', worldId, groupId: null, parentEntityId: null, adventure: null, lore: null }, owner)).status).toBe(201);

    const folderId = (await json<{ item: { id: string } }>(await request(`/knowledge/${worldId}/folders`, 'POST', { name: 'Corte', parentFolderId: null }, owner))).item.id;
    const tagId = (await json<{ item: { id: string } }>(await request(`/knowledge/${worldId}/tags`, 'POST', { name: 'Política' }, owner))).item.id;
    expect((await request(`/knowledge/${worldId}/entities/${targetId}`, 'PATCH', { folderId, tagIds: [tagId], aliases: ['Guardião Rubro'] }, owner)).status).toBe(200);

    expect((await request(`/journal/${worldId}/pages`, 'POST', { title: 'Plano secreto', content: 'Emboscada', folderId: null }, owner)).status).toBe(201);
    expect((await request(`/journal/${worldId}`, 'GET', undefined, player)).status).toBe(404);

    const inviteResponse = await request(`/world-invites/${worldId}`, 'POST', { expiresInDays: 7, maxUses: 1 }, owner);
    expect(inviteResponse.status).toBe(201);
    const code = (await json<{ item: { code: string } }>(inviteResponse)).item.code;
    expect((await request(`/world-invites/accept/${code}`, 'POST', {}, player)).status).toBe(200);
    expect(await json(await request(`/world-invites/accept/${code}`, 'POST', {}, player))).toEqual({ world: { id: worldId, name: 'Aldea' }, alreadyMember: true });

    const wikiResponse = await request(`/knowledge/${worldId}?search=Guardião`, 'GET', undefined, player);
    expect(wikiResponse.status).toBe(200);
    const wiki = await json<{ items: Array<{ id: string }>; aliases: Array<{ alias: string }> }>(wikiResponse);
    expect(wiki.items.map((item) => item.id)).toEqual([targetId]);
    expect(wiki.aliases.some((alias) => alias.alias === 'Guardião Rubro')).toBe(true);

    const allWiki = await json<{ items: Array<{ name: string }> }>(await request(`/knowledge/${worldId}`, 'GET', undefined, player));
    expect(allWiki.items.map((item) => item.name)).not.toContain('Segredo do narrador');
    const backlinks = await json<{ items: Array<{ id: string }> }>(await request(`/knowledge/${worldId}/entities/${targetId}/backlinks`, 'GET', undefined, player));
    expect(backlinks.items.map((item) => item.id)).toContain(sourceId);

    expect((await request('/preferences/active-world', 'PATCH', { activeWorldId: worldId }, player)).status).toBe(200);
    expect(await json(await request('/preferences/active-world', 'GET', undefined, player))).toEqual({ activeWorldId: worldId });
    const search = await json<{ items: Array<{ id: string; kind: string }> }>(await request(`/search?q=Guardião&worldId=${worldId}`, 'GET', undefined, player));
    expect(search.items).toContainEqual(expect.objectContaining({ id: targetId, kind: 'ENTITY' }));
  });
});
