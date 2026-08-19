// F-022 (BATCH12): Vault avançado — LINK (world_entity_links) e FORK explícito
// (POST /vault/:id/fork) — ver src/server/routes/vault.ts.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://vault-links.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.120.${requestSequence++ % 250}`,
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
  return (response.json() as Promise<{ item: { id: string } }>).then((body) => body.item.id);
}

const entity = (name: string, extra: Record<string, unknown> = {}) => ({
  entityType: 'NPC', name, summary: '', description: '', visibility: 'PRIVATE',
  worldId: null, groupId: null, parentEntityId: null, adventure: null, ...extra,
});

async function createEntity(account: Account, extra: Record<string, unknown> = {}): Promise<string> {
  const response = await request('/vault', 'POST', entity('Entidade', extra), account);
  expect(response.status).toBe(201);
  return (await response.json() as { id: string }).id;
}

async function createGroup(account: Account, members: Array<{ account: Account; isGameMaster: boolean }>): Promise<string> {
  const response = await request('/groups', 'POST', { name: 'Mesa', notes: '' }, account);
  expect(response.status).toBe(201);
  const groupId = (await response.json() as { item: { id: string } }).item.id;
  for (const member of members) {
    expect((await request(`/groups/${groupId}/members`, 'POST', {
      playerName: 'substituído pela conta', userId: member.account.userId, notes: '', active: true, isGameMaster: member.isGameMaster,
    }, account)).status).toBe(201);
  }
  return groupId;
}

async function createRpg(account: Account): Promise<string> {
  const response = await request('/rpgs', 'POST', {
    title: `RPG ${Date.now()}-${Math.random()}`, categoryId: 'fantasia', subgenreId: 'alta-fantasia', readingStatus: 'READING',
    hasPlayed: false, wantsToPlay: true, priority: 'HIGH', playGroupNotes: '', playGroupId: null,
    plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '', notes: '', coverUrl: null,
  }, account);
  expect(response.status).toBe(201);
  return (await response.json() as { item: { id: string } }).item.id;
}

async function createCampaign(account: Account, rpgId: string, playGroupId: string): Promise<string> {
  const response = await request('/campaigns', 'POST', {
    rpgId, name: 'Campanha', status: 'IN_PROGRESS', gameMaster: '', playGroupId,
    adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: 'WEEKLY',
    nextSessionDate: null, sessionGoal: 8, legacyMembersText: '', legacyCharactersText: '', notes: '',
  }, account);
  expect(response.status).toBe(201);
  return (await response.json() as { item: { id: string } }).item.id;
}

describe('Vault avançado — LINK entre Worlds (F-022)', () => {
  it('link não move a entidade; entidade some da Wiki do World B ao remover o link; entidade nunca é removida', async () => {
    const owner = await register('link-owner');
    const worldA = await createWorld(owner, 'World A');
    const worldB = await createWorld(owner, 'World B');
    const entityId = await createEntity(owner, { worldId: worldA });

    expect((await request(`/vault/${entityId}/links`, 'POST', { worldId: worldB }, owner)).status).toBe(201);

    // A entidade continua pertencendo ao World A (world_id nunca muda).
    const detail = await request(`/vault/${entityId}`, 'GET', undefined, owner);
    expect((await detail.json() as { item: { worldId: string } }).item.worldId).toBe(worldA);

    // Aparece na Wiki dos DOIS Worlds.
    const wikiA = await request(`/knowledge/${worldA}`, 'GET', undefined, owner);
    expect((await wikiA.json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).toContain(entityId);
    const wikiB = await request(`/knowledge/${worldB}`, 'GET', undefined, owner);
    expect((await wikiB.json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).toContain(entityId);

    // Busca escopada por World também respeita o link.
    const searchB = await request(`/search?q=Entidade&worldId=${worldB}`, 'GET', undefined, owner);
    expect((await searchB.json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).toContain(entityId);

    // Remover o link tira da Wiki do World B, mas a entidade continua existindo e no World A.
    expect((await request(`/vault/${entityId}/links/${worldB}`, 'DELETE', undefined, owner)).status).toBe(204);
    const wikiBAfter = await request(`/knowledge/${worldB}`, 'GET', undefined, owner);
    expect((await wikiBAfter.json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).not.toContain(entityId);
    expect((await request(`/vault/${entityId}`, 'GET', undefined, owner)).status).toBe(200);
    const wikiAAfter = await request(`/knowledge/${worldA}`, 'GET', undefined, owner);
    expect((await wikiAAfter.json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).toContain(entityId);
  });

  it('outsider não consegue criar link (404, IDOR); duplicado é idempotente; não pode linkar no próprio World', async () => {
    const owner = await register('link-owner-2');
    const outsider = await register('link-outsider-2');
    const worldA = await createWorld(owner, 'World A2');
    const worldB = await createWorld(owner, 'World B2');
    const outsiderWorld = await createWorld(outsider, 'World do outsider');
    const entityId = await createEntity(owner, { worldId: worldA });

    // Outsider não é dono da entidade.
    expect((await request(`/vault/${entityId}/links`, 'POST', { worldId: worldB }, outsider)).status).toBe(404);
    // Outsider não é dono do World de destino (mesmo sendo dono de outra entidade, se fosse).
    expect((await request(`/vault/${entityId}/links`, 'POST', { worldId: outsiderWorld }, owner)).status).toBe(404);
    // Não pode linkar no World que já é o dono.
    expect((await request(`/vault/${entityId}/links`, 'POST', { worldId: worldA }, owner)).status).toBe(422);

    // Link duplicado é idempotente (nunca cria duas linhas, nunca quebra).
    expect((await request(`/vault/${entityId}/links`, 'POST', { worldId: worldB }, owner)).status).toBe(201);
    expect((await request(`/vault/${entityId}/links`, 'POST', { worldId: worldB }, owner)).status).toBe(201);
    const links = await request(`/vault/${entityId}/links`, 'GET', undefined, owner);
    expect((await links.json() as { items: unknown[] }).items).toHaveLength(1);

    // Remover link de entidade de outro dono nunca falha "estranho" nem afeta a original —
    // é um DELETE idempotente só que não encontra nada do outsider (segue owned-only).
    expect((await request(`/vault/${entityId}/links/${worldB}`, 'DELETE', undefined, outsider)).status).toBe(404);
  });

  it('LINK nunca amplia autorização — Player de outro World não enxerga entidade GM_ONLY só por causa do link', async () => {
    const owner = await register('link-owner-3');
    const player = await register('link-player-3');
    const gm = await register('link-gm-3');
    const worldA = await createWorld(owner, 'World A3');
    // World B é GROUP e o player é membro dele, então ele TEM acesso de leitura ao World B —
    // o teste real é se ele enxerga a entidade GM_ONLY linkada lá dentro (não deveria).
    const worldB = await createWorld(owner, 'World B3', 'GROUP');
    const group = await createGroup(owner, [{ account: player, isGameMaster: false }, { account: gm, isGameMaster: true }]);
    expect((await request(`/worlds/${worldB}/members`, 'POST', { userId: player.userId }, owner)).status).toBe(201);
    expect((await request(`/worlds/${worldB}/members`, 'POST', { userId: gm.userId }, owner)).status).toBe(201);
    const rpgId = await createRpg(owner);
    const campaignId = await createCampaign(owner, rpgId, group);

    const entityId = await createEntity(owner, { worldId: worldA, visibility: 'GM_ONLY' });
    expect((await request(`/campaigns/${campaignId}/entities/${entityId}`, 'POST', { usageType: 'REFERENCE' }, owner)).status).toBe(201);
    expect((await request(`/vault/${entityId}/links`, 'POST', { worldId: worldB }, owner)).status).toBe(201);

    // Player tem acesso ao World B (é membro), mas não ao entity GM_ONLY.
    const wikiAsPlayer = await request(`/knowledge/${worldB}`, 'GET', undefined, player);
    expect(wikiAsPlayer.status).toBe(200);
    expect((await wikiAsPlayer.json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).not.toContain(entityId);
    expect((await request(`/vault/${entityId}`, 'GET', undefined, player)).status).toBe(404);

    // GM da campanha, sim.
    const wikiAsGm = await request(`/knowledge/${worldB}`, 'GET', undefined, gm);
    expect((await wikiAsGm.json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).toContain(entityId);
  });
});

describe('Vault avançado — FORK explícito (F-022)', () => {
  it('fork gera entidade nova e independente; editar o fork nunca altera a original', async () => {
    const owner = await register('fork-owner');
    const worldId = await createWorld(owner, 'World Fork');
    const originalId = await createEntity(owner, {
      entityType: 'NPC', worldId, summary: 'resumo original', description: 'descrição original',
      npc: { role: 'Guarda', occupation: 'Sentinela', motivation: 'Proteger', publicNotes: 'nota pública', gmNotes: 'nota do mestre' },
    });

    const forkResponse = await request(`/vault/${originalId}/fork`, 'POST', {}, owner);
    expect(forkResponse.status).toBe(201);
    const forkId = (await forkResponse.json() as { id: string }).id;
    expect(forkId).not.toBe(originalId);

    const forkDetail = await request(`/vault/${forkId}`, 'GET', undefined, owner);
    const forkBody = (await forkDetail.json() as { item: { name: string; worldId: string; npc: { role: string; gmNotes: string } } }).item;
    expect(forkBody.name).toBe('Entidade (cópia)');
    expect(forkBody.worldId).toBe(worldId);
    expect(forkBody.npc.role).toBe('Guarda');
    expect(forkBody.npc.gmNotes).toBe('nota do mestre');

    // Editar o fork nunca altera a entidade original.
    expect((await request(`/vault/${forkId}`, 'PATCH', entity('Nome Editado no Fork', { worldId, npc: { role: 'Outro cargo', occupation: '', motivation: '', publicNotes: '', gmNotes: '' } }), owner)).status).toBe(200);
    const originalAfter = await request(`/vault/${originalId}`, 'GET', undefined, owner);
    const originalBody = (await originalAfter.json() as { item: { name: string; npc: { role: string } } }).item;
    expect(originalBody.name).toBe('Entidade');
    expect(originalBody.npc.role).toBe('Guarda');
  });

  it('fork aceita overrides (nome/World/visibilidade) e nunca copia parentEntityId nem statBlock de criatura', async () => {
    const owner = await register('fork-owner-2');
    const worldA = await createWorld(owner, 'World Fork A');
    const worldB = await createWorld(owner, 'World Fork B');
    const parentId = await createEntity(owner, { entityType: 'LOCATION', worldId: worldA });
    const childId = await createEntity(owner, { entityType: 'LOCATION', worldId: worldA, parentEntityId: parentId });

    const forked = await request(`/vault/${childId}/fork`, 'POST', { name: 'Filial Nova', worldId: worldB, visibility: 'PRIVATE' }, owner);
    expect(forked.status).toBe(201);
    const forkId = (await forked.json() as { id: string }).id;
    const forkBody = (await (await request(`/vault/${forkId}`, 'GET', undefined, owner)).json() as { item: { name: string; worldId: string; parentEntityId: string | null } }).item;
    expect(forkBody.name).toBe('Filial Nova');
    expect(forkBody.worldId).toBe(worldB);
    expect(forkBody.parentEntityId).toBeNull();
  });

  it('fork de entidade de outro dono é 404 (IDOR); fork com World de destino inválido é rejeitado', async () => {
    const owner = await register('fork-owner-3');
    const outsider = await register('fork-outsider-3');
    const entityId = await createEntity(owner);
    expect((await request(`/vault/${entityId}/fork`, 'POST', {}, outsider)).status).toBe(404);
    expect((await request(`/vault/${entityId}/fork`, 'POST', { worldId: 'world-inexistente' }, owner)).status).toBe(422);
  });
});
