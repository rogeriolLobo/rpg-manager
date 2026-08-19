// F-029 (BATCH16): VTT — fundação (Scene/Map/tokens), sem realtime — ver
// src/server/routes/vtt.ts.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://vtt.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.125.${requestSequence++ % 250}`,
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

async function createRpg(account: Account): Promise<string> {
  const response = await request('/rpgs', 'POST', {
    title: `RPG ${Date.now()}-${Math.random()}`, categoryId: 'fantasia', subgenreId: 'alta-fantasia', readingStatus: 'READING',
    hasPlayed: false, wantsToPlay: true, priority: 'HIGH', playGroupNotes: '', playGroupId: null,
    plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '', notes: '', coverUrl: null,
  }, account);
  expect(response.status).toBe(201);
  return (await response.json() as { item: { id: string } }).item.id;
}

async function createCampaign(account: Account, extra: Record<string, unknown> = {}): Promise<string> {
  const rpgId = await createRpg(account);
  const response = await request('/campaigns', 'POST', {
    rpgId, name: 'Mesa VTT', status: 'PLANNING', gameMaster: '', playGroupId: null,
    adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null,
    nextSessionDate: null, sessionGoal: null, legacyMembersText: '', legacyCharactersText: '', notes: '', ...extra,
  }, account);
  expect(response.status).toBe(201);
  return (await response.json() as { item: { id: string } }).item.id;
}

async function createEntity(account: Account, name = 'Token NPC'): Promise<string> {
  const response = await request('/vault', 'POST', { entityType: 'NPC', name, summary: '', description: '', visibility: 'PRIVATE', worldId: null, groupId: null, parentEntityId: null, adventure: null }, account);
  expect(response.status).toBe(201);
  return (await response.json() as { id: string }).id;
}

// Vincula `player` como membro real (user_id preenchido) de uma campanha do `owner` via Grupo
// de Jogo — é o único caminho da API para produzir um campaign_members.user_id de verdade
// (POST /campaigns/:id/members nunca aceita userId diretamente).
async function createCampaignWithPlayer(owner: Account, player: Account): Promise<string> {
  const groupResponse = await request('/groups', 'POST', { name: 'Grupo VTT', notes: '' }, owner);
  expect(groupResponse.status).toBe(201);
  const groupId = (await groupResponse.json() as { item: { id: string } }).item.id;
  const memberResponse = await request(`/groups/${groupId}/members`, 'POST', { playerName: 'Jogador', userId: player.userId, notes: '', active: true, isGameMaster: false }, owner);
  expect(memberResponse.status).toBe(201);
  return createCampaign(owner, { playGroupId: groupId });
}

describe('VTT — fundação de cenas e tokens (F-029)', () => {
  it('dono cria cena (validando fundo obrigatório), token vinculado à própria entidade, e lê o detalhe agregado', async () => {
    const owner = await register('vtt-owner');
    const campaignId = await createCampaign(owner);
    const entityId = await createEntity(owner);

    expect((await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Sem fundo', mapId: null, imageUrl: '', notes: '' }, owner)).status).toBe(422);

    const sceneResponse = await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Taverna', mapId: null, imageUrl: 'https://example.com/taverna.png', notes: 'primeira cena' }, owner);
    expect(sceneResponse.status).toBe(201);
    const sceneId = (await sceneResponse.json() as { id: string }).id;

    const tokenResponse = await request(`/vtt/${campaignId}/scenes/${sceneId}/tokens`, 'POST', { label: 'Goblin', entityId, x: 30, y: 40, visibleToPlayers: true }, owner);
    expect(tokenResponse.status).toBe(201);

    const detail = await request(`/vtt/${campaignId}/scenes/${sceneId}`, 'GET', undefined, owner);
    expect(detail.status).toBe(200);
    const detailBody = await detail.json() as { item: { title: string; resolvedImageUrl: string }; tokens: Array<{ label: string; entityName: string | null; visibleToPlayers: boolean }> };
    expect(detailBody.item.title).toBe('Taverna');
    expect(detailBody.item.resolvedImageUrl).toBe('https://example.com/taverna.png');
    expect(detailBody.tokens).toMatchObject([{ label: 'Goblin', entityName: 'Token NPC', visibleToPlayers: true }]);
  });

  it('só uma cena ativa por campanha; ativar uma desativa a anterior', async () => {
    const owner = await register('vtt-owner-2');
    const campaignId = await createCampaign(owner);
    const sceneA = (await (await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'A', mapId: null, imageUrl: 'https://example.com/a.png', notes: '' }, owner)).json() as { id: string }).id;
    const sceneB = (await (await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'B', mapId: null, imageUrl: 'https://example.com/b.png', notes: '' }, owner)).json() as { id: string }).id;

    expect((await request(`/vtt/${campaignId}/scenes/${sceneA}/activate`, 'POST', {}, owner)).status).toBe(200);
    expect((await request(`/vtt/${campaignId}/scenes/${sceneB}/activate`, 'POST', {}, owner)).status).toBe(200);

    const scenes = await (await request(`/vtt/${campaignId}/scenes`, 'GET', undefined, owner)).json() as { items: Array<{ id: string; isActive: boolean }> };
    expect(scenes.items.find((scene) => scene.id === sceneA)?.isActive).toBe(false);
    expect(scenes.items.find((scene) => scene.id === sceneB)?.isActive).toBe(true);
  });

  it('IDOR: outsider nunca lê/escreve cenas ou tokens de campanha alheia; token não pode apontar para entidade de outro dono', async () => {
    const owner = await register('vtt-owner-3');
    const outsider = await register('vtt-outsider-3');
    const campaignId = await createCampaign(owner);
    const sceneResponse = await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Cena', mapId: null, imageUrl: 'https://example.com/c.png', notes: '' }, owner);
    const sceneId = (await sceneResponse.json() as { id: string }).id;

    expect((await request(`/vtt/${campaignId}/scenes`, 'GET', undefined, outsider)).status).toBe(404);
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}`, 'GET', undefined, outsider)).status).toBe(404);
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}`, 'PATCH', { title: 'Hack', mapId: null, imageUrl: 'https://example.com/x.png', notes: '' }, outsider)).status).toBe(404);
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}`, 'DELETE', undefined, outsider)).status).toBe(404);
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/tokens`, 'POST', { label: 'X', entityId: null, x: 1, y: 1, visibleToPlayers: false }, outsider)).status).toBe(404);

    const outsiderEntityId = await createEntity(outsider, 'Entidade do outsider');
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/tokens`, 'POST', { label: 'X', entityId: outsiderEntityId, x: 1, y: 1, visibleToPlayers: false }, owner)).status).toBe(404);
  });

  it('mapa inválido (de outro dono) é rejeitado (422); ID inexistente sempre 404', async () => {
    const owner = await register('vtt-owner-4');
    const otherOwner = await register('vtt-other-4');
    const campaignId = await createCampaign(owner);

    const worldResponse = await request('/worlds', 'POST', { name: 'World do outro', description: '', visibility: 'PRIVATE', defaultRpgId: null }, otherOwner);
    const worldId = (await worldResponse.json() as { item: { id: string } }).item.id;
    const mapResponse = await request(`/cartography/${worldId}`, 'POST', { title: 'Mapa alheio', imageUrl: 'https://example.com/m.png', notes: '' }, otherOwner);
    const mapId = (await mapResponse.json() as { item: { id: string } }).item.id;

    expect((await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Cena', mapId, imageUrl: '', notes: '' }, owner)).status).toBe(422);
    expect((await request(`/vtt/${campaignId}/scenes/id-inexistente`, 'GET', undefined, owner)).status).toBe(404);
  });

  it('visão "ao vivo": jogador vê só a cena ativa e só tokens visíveis, sem vazar entityId/entityName; sem cena ativa devolve item:null; não-membro recebe 404', async () => {
    const owner = await register('vtt-owner-5');
    const player = await register('vtt-player-5');
    const outsider = await register('vtt-outsider-5');
    const campaignId = await createCampaignWithPlayer(owner, player);
    const entityId = await createEntity(owner, 'NPC secreto');

    // Sem cena ativa ainda: jogador autorizado recebe item:null (não erro).
    const noSceneLive = await request(`/vtt/${campaignId}/live`, 'GET', undefined, player);
    expect(noSceneLive.status).toBe(200);
    expect((await noSceneLive.json() as { item: null }).item).toBeNull();

    const sceneId = (await (await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Cena ao vivo', mapId: null, imageUrl: 'https://example.com/live.png', notes: '' }, owner)).json() as { id: string }).id;
    const visibleTokenId = (await (await request(`/vtt/${campaignId}/scenes/${sceneId}/tokens`, 'POST', { label: 'Herói', entityId: null, x: 20, y: 20, visibleToPlayers: true }, owner)).json() as { id: string }).id;
    await request(`/vtt/${campaignId}/scenes/${sceneId}/tokens`, 'POST', { label: 'Emboscada oculta', entityId, x: 80, y: 80, visibleToPlayers: false }, owner);
    await request(`/vtt/${campaignId}/scenes/${sceneId}/activate`, 'POST', {}, owner);

    const live = await request(`/vtt/${campaignId}/live`, 'GET', undefined, player);
    expect(live.status).toBe(200);
    const liveBody = await live.json() as { item: { title: string; imageUrl: string; tokens: Array<Record<string, unknown>> } };
    expect(liveBody.item.title).toBe('Cena ao vivo');
    expect(liveBody.item.tokens).toHaveLength(1);
    expect(liveBody.item.tokens[0]).toEqual({ id: visibleTokenId, label: 'Herói', x: 20, y: 20 });
    // Nunca vaza entityId/entityName/entityType — mesmo do token visível.
    expect(Object.keys(liveBody.item.tokens[0]).sort()).toEqual(['id', 'label', 'x', 'y']);

    // Não-membro da campanha nunca acessa /live (anti-enumeração, 404).
    expect((await request(`/vtt/${campaignId}/live`, 'GET', undefined, outsider)).status).toBe(404);
  });

  it('excluir a cena remove também os tokens (cascade) e a cena some da listagem', async () => {
    const owner = await register('vtt-owner-6');
    const campaignId = await createCampaign(owner);
    const sceneId = (await (await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Descartável', mapId: null, imageUrl: 'https://example.com/d.png', notes: '' }, owner)).json() as { id: string }).id;
    await request(`/vtt/${campaignId}/scenes/${sceneId}/tokens`, 'POST', { label: 'T', entityId: null, x: 1, y: 1, visibleToPlayers: false }, owner);

    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}`, 'DELETE', undefined, owner)).status).toBe(204);
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}`, 'GET', undefined, owner)).status).toBe(404);
    const scenes = await (await request(`/vtt/${campaignId}/scenes`, 'GET', undefined, owner)).json() as { items: unknown[] };
    expect(scenes.items).toHaveLength(0);
  });
});
