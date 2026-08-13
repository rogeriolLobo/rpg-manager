import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://relations.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `192.0.2.${requestSequence++ % 250}`,
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

async function createWorld(owner: Account, name: string, visibility = 'GROUP') {
  const response = await request('/worlds', 'POST', { name, description: '', defaultRpgId: null, visibility }, owner);
  expect(response.status).toBe(201);
  return (await response.json() as { item: { id: string } }).item.id;
}

async function createGroup(owner: Account, player: Account, gameMaster: Account) {
  const response = await request('/groups', 'POST', { name: 'Mesa das relações', notes: '' }, owner);
  const groupId = (await response.json() as { item: { id: string } }).item.id;
  for (const [account, isGameMaster] of [[player, false], [gameMaster, true]] as const) {
    expect((await request(`/groups/${groupId}/members`, 'POST', {
      playerName: account.userId, userId: account.userId, notes: '', active: true, isGameMaster,
    }, owner)).status).toBe(201);
  }
  return groupId;
}

async function createRpg(owner: Account) {
  const response = await request('/rpgs', 'POST', {
    title: 'Sistema de relações', categoryId: 'fantasia', subgenreId: 'alta-fantasia', readingStatus: 'READING',
    hasPlayed: false, wantsToPlay: true, priority: 'HIGH', playGroupNotes: '', playGroupId: null,
    plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '', notes: '', coverUrl: null,
  }, owner);
  return (await response.json() as { item: { id: string } }).item.id;
}

async function createCampaign(owner: Account, groupId: string) {
  const response = await request('/campaigns', 'POST', {
    rpgId: await createRpg(owner), name: 'Campanha das relações', status: 'IN_PROGRESS', gameMaster: '', playGroupId: groupId,
    adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: 'WEEKLY', nextSessionDate: null,
    sessionGoal: 8, legacyMembersText: '', legacyCharactersText: '', notes: '',
  }, owner);
  expect(response.status).toBe(201);
  return (await response.json() as { item: { id: string } }).item.id;
}

async function createEntity(owner: Account, worldId: string, name: string, visibility: string, groupId: string | null = null) {
  const response = await request('/vault', 'POST', {
    entityType: 'NPC', name, summary: '', description: '', visibility, worldId, groupId,
    parentEntityId: null, adventure: null, lore: null,
  }, owner);
  expect(response.status).toBe(201);
  return (await response.json() as { id: string }).id;
}

const relation = (sourceEntityId: string, targetEntityId: string, relationType = 'ALLY', visibility = 'GROUP') => ({
  sourceEntityId, targetEntityId, relationType, label: '', description: '', direction: 'BIDIRECTIONAL', visibility, strength: 3,
});

describe('Relations, Graph e Genealogy V2.2', () => {
  it('filtra arestas e nós no servidor e bloqueia IDOR, cross-world e duplicidade', async () => {
    const owner = await register('relation-owner');
    const player = await register('relation-player');
    const gameMaster = await register('relation-gm');
    const outsider = await register('relation-outsider');
    const worldId = await createWorld(owner, 'Aldea');
    const otherWorldId = await createWorld(owner, 'Outro mundo', 'PRIVATE');
    const groupId = await createGroup(owner, player, gameMaster);
    const campaignId = await createCampaign(owner, groupId);

    expect((await request(`/worlds/${worldId}/members`, 'POST', { userId: player.userId }, owner)).status).toBe(201);
    expect((await request(`/worlds/${worldId}/members`, 'POST', { userId: gameMaster.userId }, owner)).status).toBe(201);

    const firstId = await createEntity(owner, worldId, 'Lucien', 'GROUP', groupId);
    const secondId = await createEntity(owner, worldId, 'Mara', 'GROUP', groupId);
    const secretA = await createEntity(owner, worldId, 'Segredo A', 'PLAYERS');
    const secretB = await createEntity(owner, worldId, 'Segredo B', 'PLAYERS');
    const otherId = await createEntity(owner, otherWorldId, 'Intruso de outro World', 'PRIVATE');
    for (const entityId of [secretA, secretB]) {
      expect((await request(`/campaigns/${campaignId}/entities/${entityId}`, 'POST', { usageType: 'REFERENCE' }, owner)).status).toBe(201);
    }

    const publicResponse = await request(`/relations/worlds/${worldId}`, 'POST', relation(firstId, secondId), owner);
    expect(publicResponse.status).toBe(201);
    const relationId = (await publicResponse.json() as { item: { id: string } }).item.id;
    expect((await request(`/relations/worlds/${worldId}`, 'POST', relation(secondId, firstId), owner)).status).toBe(409);
    expect((await request(`/relations/worlds/${worldId}`, 'POST', relation(firstId, otherId), owner)).status).toBe(422);
    expect((await request(`/relations/${relationId}`, 'DELETE', undefined, outsider)).status).toBe(404);

    const gmOnlyResponse = await request(`/relations/worlds/${worldId}`, 'POST', {
      ...relation(secretA, secretB, 'SECRET', 'GM_ONLY'), direction: 'DIRECTED', label: 'Verdade oculta',
    }, owner);
    expect(gmOnlyResponse.status).toBe(201);

    const playerGraph = await request(`/relations/worlds/${worldId}?includeDisconnected=true`, 'GET', undefined, player);
    expect(playerGraph.status).toBe(200);
    const playerData = await playerGraph.json() as { relations: Array<{ id: string }>; nodes: Array<{ id: string }> };
    expect(playerData.relations.map((item) => item.id)).toEqual([relationId]);
    expect(playerData.nodes.map((item) => item.id)).toEqual(expect.arrayContaining([firstId, secondId, secretA, secretB]));

    const gmGraph = await request(`/relations/worlds/${worldId}?includeDisconnected=true`, 'GET', undefined, gameMaster);
    const gmData = await gmGraph.json() as { relations: Array<{ label: string }> };
    expect(gmData.relations.map((item) => item.label)).toContain('Verdade oculta');
    expect((await request(`/relations/worlds/${worldId}`, 'GET', undefined, outsider)).status).toBe(404);

    expect((await request(`/relations/${relationId}`, 'DELETE', undefined, owner)).status).toBe(204);
    expect((await request(`/relations/${relationId}/restore`, 'POST', {}, owner)).status).toBe(200);
  });

  it('impõe direção familiar e evita relações parentais contraditórias', async () => {
    const owner = await register('genealogy-owner');
    const worldId = await createWorld(owner, 'Linhagens', 'PRIVATE');
    const parentId = await createEntity(owner, worldId, 'Ancestral', 'PRIVATE');
    const childId = await createEntity(owner, worldId, 'Herdeiro', 'PRIVATE');

    expect((await request(`/relations/worlds/${worldId}`, 'POST', {
      ...relation(parentId, childId, 'PARENT', 'PRIVATE'), direction: 'BIDIRECTIONAL',
    }, owner)).status).toBe(422);
    expect((await request(`/relations/worlds/${worldId}`, 'POST', {
      ...relation(parentId, childId, 'PARENT', 'PRIVATE'), direction: 'DIRECTED',
    }, owner)).status).toBe(201);
    expect((await request(`/relations/worlds/${worldId}`, 'POST', {
      ...relation(childId, parentId, 'CHILD', 'PRIVATE'), direction: 'DIRECTED',
    }, owner)).status).toBe(409);

    const genealogy = await request(`/relations/worlds/${worldId}/genealogy`, 'GET', undefined, owner);
    expect(genealogy.status).toBe(200);
    expect((await genealogy.json() as { relations: Array<{ relationType: string }> }).relations)
      .toEqual([expect.objectContaining({ relationType: 'PARENT' })]);
  });
});
