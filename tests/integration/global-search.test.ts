// RPG MANAGER 1.0 — fechamento do P2 identificado em
// docs/audit/RPG_MANAGER_1_0_MATRIX.md ("Global Search sem teste de
// integração dedicado"): o único teste existente até aqui era uma única
// asserção incidental dentro de world-knowledge.test.ts (checando um
// resultado de entidade de Wiki), sem cobrir isolamento multi-tenant,
// visibilidade de World, permissão de entidade nem o comportamento
// deliberado de RPGs arquivados (LIB-006) especificamente através do
// endpoint GET /search (src/server/routes/search.ts).
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://search.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.114.${requestSequence++ % 250}`,
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

interface SearchItem { id: string; name: string; kind: string; worldId: string | null }
async function search(account: Account, query: string, worldId?: string) {
  const response = await request(`/search?q=${encodeURIComponent(query)}${worldId ? `&worldId=${worldId}` : ''}`, 'GET', undefined, account);
  return response;
}

const rpgBase = {
  categoryId: 'fantasia', subgenreId: 'alta-fantasia', readingStatus: 'READING', hasPlayed: false, wantsToPlay: true,
  priority: 'HIGH', playGroupNotes: '', playGroupId: null, plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '',
  notes: '', coverUrl: null,
};

const entity = (name: string, visibility = 'PRIVATE', extra: Record<string, unknown> = {}) => ({
  entityType: 'NPC', name, summary: '', description: '', visibility, worldId: null, groupId: null, parentEntityId: null, adventure: null, ...extra,
});

describe('Global Search (Command Palette) — isolamento e permissões', () => {
  it('rejeita query curta demais', async () => {
    const a = await register('gsearch-short-a');
    const response = await search(a, 'x');
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('SEARCH_TOO_SHORT');
  });

  it('nunca retorna campanhas/grupos/RPGs de outra conta, mesmo com o mesmo termo de busca', async () => {
    const a = await register('gsearch-isolation-a');
    const b = await register('gsearch-isolation-b');
    const uniqueTerm = `SegredoUnico${Date.now()}`;
    await request('/rpgs', 'POST', { ...rpgBase, title: `${uniqueTerm} RPG de B` }, b);
    await request('/groups', 'POST', { name: `${uniqueTerm} Grupo de B`, notes: '' }, b);

    const resultsForA = ((await (await search(a, uniqueTerm)).json()) as { items: SearchItem[] }).items;
    expect(resultsForA).toHaveLength(0);

    const resultsForB = ((await (await search(b, uniqueTerm)).json()) as { items: SearchItem[] }).items;
    expect(resultsForB.length).toBeGreaterThanOrEqual(2);
    expect(resultsForB.map((item) => item.kind).sort()).toEqual(['GROUP', 'RPG']);
  });

  it('RPG arquivado do próprio usuário continua aparecendo na busca (decisão deliberada do LIB-006 — nunca filtrado aqui)', async () => {
    const a = await register('gsearch-archived-a');
    const uniqueTerm = `ArquivadoBusca${Date.now()}`;
    const created = await request('/rpgs', 'POST', { ...rpgBase, title: `${uniqueTerm} RPG` }, a);
    const rpgId = ((await created.json()) as { item: { id: string } }).item.id;
    await request(`/rpgs/${rpgId}/archive`, 'POST', {}, a);

    const results = ((await (await search(a, uniqueTerm)).json()) as { items: SearchItem[] }).items;
    expect(results.some((item) => item.id === rpgId && item.kind === 'RPG')).toBe(true);
  });

  it('World PRIVATE de outra conta nunca aparece; World GROUP só aparece para membros', async () => {
    const owner = await register('gsearch-world-owner');
    const member = await register('gsearch-world-member');
    const outsider = await register('gsearch-world-outsider');
    const uniqueTerm = `MundoSecreto${Date.now()}`;

    const privateWorld = await request('/worlds', 'POST', { name: `${uniqueTerm} Privado`, description: '', defaultRpgId: null, visibility: 'PRIVATE' }, owner);
    expect(privateWorld.status).toBe(201);
    const privateResultsOutsider = ((await (await search(outsider, uniqueTerm)).json()) as { items: SearchItem[] }).items;
    expect(privateResultsOutsider.some((item) => item.kind === 'WORLD')).toBe(false);

    const groupWorld = await request('/worlds', 'POST', { name: `${uniqueTerm} Grupo`, description: '', defaultRpgId: null, visibility: 'GROUP' }, owner);
    const groupWorldId = ((await groupWorld.json()) as { item: { id: string } }).item.id;
    await request(`/worlds/${groupWorldId}/members`, 'POST', { userId: member.userId }, owner);

    const resultsForMember = ((await (await search(member, `${uniqueTerm} Grupo`)).json()) as { items: SearchItem[] }).items;
    expect(resultsForMember.some((item) => item.kind === 'WORLD' && item.id === groupWorldId)).toBe(true);

    const resultsForOutsider = ((await (await search(outsider, `${uniqueTerm} Grupo`)).json()) as { items: SearchItem[] }).items;
    expect(resultsForOutsider.some((item) => item.kind === 'WORLD' && item.id === groupWorldId)).toBe(false);
  });

  it('entidade GM_ONLY nunca aparece na busca de um Player, mas aparece para o GM (mesma authZ de canViewEntity)', async () => {
    const owner = await register('gsearch-entity-owner');
    const player = await register('gsearch-entity-player');
    const uniqueTerm = `SegredoDoMestre${Date.now()}`;
    const worldResponse = await request('/worlds', 'POST', { name: 'World de Busca', description: '', defaultRpgId: null, visibility: 'GROUP' }, owner);
    const worldId = ((await worldResponse.json()) as { item: { id: string } }).item.id;
    await request(`/worlds/${worldId}/members`, 'POST', { userId: player.userId }, owner);

    const entityResponse = await request('/vault', 'POST', entity(`${uniqueTerm} NPC`, 'GM_ONLY', { worldId }), owner);
    expect(entityResponse.status).toBe(201);
    const entityId = ((await entityResponse.json()) as { id: string }).id;

    const resultsForPlayer = ((await (await search(player, uniqueTerm, worldId)).json()) as { items: SearchItem[] }).items;
    expect(resultsForPlayer.some((item) => item.id === entityId)).toBe(false);

    const resultsForOwner = ((await (await search(owner, uniqueTerm, worldId)).json()) as { items: SearchItem[] }).items;
    expect(resultsForOwner.some((item) => item.id === entityId && item.kind === 'ENTITY')).toBe(true);
  });

  it('worldId estreita o resultado só para entidades daquele World', async () => {
    const owner = await register('gsearch-worldfilter-owner');
    const uniqueTerm = `FiltroWorld${Date.now()}`;
    const worldA = await request('/worlds', 'POST', { name: 'World A', description: '', defaultRpgId: null, visibility: 'PRIVATE' }, owner);
    const worldAId = ((await worldA.json()) as { item: { id: string } }).item.id;
    const worldB = await request('/worlds', 'POST', { name: 'World B', description: '', defaultRpgId: null, visibility: 'PRIVATE' }, owner);
    const worldBId = ((await worldB.json()) as { item: { id: string } }).item.id;

    const entityInA = await request('/vault', 'POST', entity(`${uniqueTerm} em A`, 'PRIVATE', { worldId: worldAId }), owner);
    const entityAId = ((await entityInA.json()) as { id: string }).id;
    const entityInB = await request('/vault', 'POST', entity(`${uniqueTerm} em B`, 'PRIVATE', { worldId: worldBId }), owner);
    const entityBId = ((await entityInB.json()) as { id: string }).id;

    const resultsScopedToA = ((await (await search(owner, uniqueTerm, worldAId)).json()) as { items: SearchItem[] }).items;
    expect(resultsScopedToA.some((item) => item.id === entityAId)).toBe(true);
    expect(resultsScopedToA.some((item) => item.id === entityBId)).toBe(false);
  });
});
