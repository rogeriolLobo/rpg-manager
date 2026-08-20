// F-033 (Player View integrada): "Minhas Mesas" — o jogador descobre campanhas de que
// participa sem depender de link do GM (GET /campaigns/mine), mais o agregado por campanha
// (GET /campaigns/:id/player-home) reaproveitando GET /vault/:id (Meu Personagem) e
// adventure_handouts.revealed_at (Handouts) já existentes — ver src/server/routes/campaigns.ts.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://player-view.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.127.${requestSequence++ % 250}`,
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

// Vincula `player` como membro ativo (user_id preenchido) de uma campanha do `owner`, mesmo
// caminho de vtt.test.ts (único jeito real da API produzir campaign_members.user_id).
async function createCampaignWithPlayer(owner: Account, player: Account, extra: Record<string, unknown> = {}): Promise<{ campaignId: string; groupId: string }> {
  const groupResponse = await request('/groups', 'POST', { name: 'Grupo Player View', notes: '' }, owner);
  expect(groupResponse.status).toBe(201);
  const groupId = (await groupResponse.json() as { item: { id: string } }).item.id;
  const memberResponse = await request(`/groups/${groupId}/members`, 'POST', { playerName: 'Jogador', userId: player.userId, notes: '', active: true, isGameMaster: false }, owner);
  expect(memberResponse.status).toBe(201);
  const rpgId = await createRpg(owner);
  const response = await request('/campaigns', 'POST', {
    rpgId, name: 'Mesa Player View', status: 'PLANNING', gameMaster: 'Mestre Teste', playGroupId: groupId,
    adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null,
    nextSessionDate: null, sessionGoal: null, legacyMembersText: '', legacyCharactersText: '', notes: '', ...extra,
  }, owner);
  expect(response.status).toBe(201);
  const campaignId = (await response.json() as { item: { id: string } }).item.id;
  return { campaignId, groupId };
}

async function createVaultEntity(account: Account, entityType: string, name: string, visibility = 'PRIVATE'): Promise<string> {
  const response = await request('/vault', 'POST', {
    entityType, name, summary: '', description: '', visibility, worldId: null, groupId: null, parentEntityId: null,
    adventure: entityType === 'ADVENTURE' ? { adventureType: 'SHORT_CAMPAIGN', recommendedSessions: null, notes: '', premise: '', hooks: '', keyScenes: '', rewards: '' } : null,
    character: entityType === 'CHARACTER' ? { playerUserId: null, pronouns: '', concept: 'Guerreiro exilado', status: 'Ativo', notes: 'Ficha de teste' } : null,
  }, account);
  expect(response.status).toBe(201);
  return (await response.json() as { id: string }).id;
}

async function memberIdFor(owner: Account, campaignId: string, playerUserId: string): Promise<string> {
  const detail = await request(`/campaigns/${campaignId}`, 'GET', undefined, owner);
  const members = (await detail.json() as { members: Array<{ id: string; linkedUserId: string | null }> }).members;
  return members.find((member) => member.linkedUserId === playerUserId)!.id;
}

describe('Player View — "Minhas Mesas" (F-033)', () => {
  it('GET /campaigns/mine só lista campanhas onde o usuário é membro ativo; nunca as de outro usuário nem membros inativos', async () => {
    const owner = await register('pv-owner-1');
    const player = await register('pv-player-1');
    const outsider = await register('pv-outsider-1');
    const { campaignId } = await createCampaignWithPlayer(owner, player);

    const playerList = await request('/campaigns/mine', 'GET', undefined, player);
    expect(playerList.status).toBe(200);
    const playerIds = (await playerList.json() as { items: Array<{ id: string; rpgTitle: string; gameMaster: string }> }).items;
    expect(playerIds.map((item) => item.id)).toContain(campaignId);
    expect(playerIds[0].gameMaster).toBe('Mestre Teste');

    const outsiderList = await request('/campaigns/mine', 'GET', undefined, outsider);
    expect((await outsiderList.json() as { items: unknown[] }).items).toHaveLength(0);

    // Desativa o membro — some da lista do jogador.
    const memberId = await memberIdFor(owner, campaignId, player.userId);
    await request(`/campaigns/${campaignId}/members/${memberId}`, 'PATCH', { playerName: 'Jogador', characterName: '', characterEntityId: null, notes: '', active: false }, owner);
    const afterDeactivate = await request('/campaigns/mine', 'GET', undefined, player);
    expect((await afterDeactivate.json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).not.toContain(campaignId);
  });

  it('player-home: IDOR — outsider recebe 404 (anti-enumeração); dono também acessa (preview)', async () => {
    const owner = await register('pv-owner-2');
    const player = await register('pv-player-2');
    const outsider = await register('pv-outsider-2');
    const { campaignId } = await createCampaignWithPlayer(owner, player);

    expect((await request(`/campaigns/${campaignId}/player-home`, 'GET', undefined, outsider)).status).toBe(404);
    expect((await request(`/campaigns/${campaignId}/player-home`, 'GET', undefined, player)).status).toBe(200);
    expect((await request(`/campaigns/${campaignId}/player-home`, 'GET', undefined, owner)).status).toBe(200);
    expect((await request('/campaigns/id-inexistente/player-home', 'GET', undefined, player)).status).toBe(404);
  });

  it('"Meu Personagem": GM vincula um Vault CHARACTER ao membro; player-home devolve o id; GET /vault/:id só funciona se a visibility permitir (PLAYERS/CAMPAIGN), nunca PRIVATE', async () => {
    const owner = await register('pv-owner-3');
    const player = await register('pv-player-3');
    const { campaignId } = await createCampaignWithPlayer(owner, player);
    const memberId = await memberIdFor(owner, campaignId, player.userId);

    // Personagem PRIVATE (default): o vínculo é salvo, mas o jogador ainda não pode LER a
    // entidade via /vault/:id — visibility é sempre a barreira real, nunca o vínculo sozinho.
    const privateCharacterId = await createVaultEntity(owner, 'CHARACTER', 'Herói Privado', 'PRIVATE');
    const linkPrivate = await request(`/campaigns/${campaignId}/members/${memberId}`, 'PATCH', { playerName: 'Jogador', characterName: 'Herói Privado', characterEntityId: privateCharacterId, notes: '', active: true }, owner);
    expect(linkPrivate.status).toBe(200);
    const homeAfterPrivate = await (await request(`/campaigns/${campaignId}/player-home`, 'GET', undefined, player)).json() as { item: { characterEntityId: string | null } };
    expect(homeAfterPrivate.item.characterEntityId).toBe(privateCharacterId);
    expect((await request(`/vault/${privateCharacterId}`, 'GET', undefined, player)).status).toBe(404);

    // Personagem visibility PLAYERS: agora o jogador consegue ler via /vault/:id (reaproveitado,
    // nenhuma rota nova) — inclui os dados de character (concept/status/notes).
    const playersCharacterId = await createVaultEntity(owner, 'CHARACTER', 'Herói Visível', 'PLAYERS');
    await request(`/campaigns/${campaignId}/members/${memberId}`, 'PATCH', { playerName: 'Jogador', characterName: 'Herói Visível', characterEntityId: playersCharacterId, notes: '', active: true }, owner);
    const characterRead = await request(`/vault/${playersCharacterId}`, 'GET', undefined, player);
    expect(characterRead.status).toBe(200);
    const characterBody = await characterRead.json() as { item: { name: string; character: { concept: string; status: string } | null } };
    expect(characterBody.item.name).toBe('Herói Visível');
    expect(characterBody.item.character?.concept).toBe('Guerreiro exilado');

    // Nunca aceita entidade de outro dono (IDOR) nem tipo diferente de CHARACTER.
    const otherOwner = await register('pv-other-owner-3');
    const foreignCharacterId = await createVaultEntity(otherOwner, 'CHARACTER', 'Personagem Alheio', 'PLAYERS');
    expect((await request(`/campaigns/${campaignId}/members/${memberId}`, 'PATCH', { playerName: 'Jogador', characterName: '', characterEntityId: foreignCharacterId, notes: '', active: true }, owner)).status).toBe(422);
    const npcId = await createVaultEntity(owner, 'NPC', 'Não é personagem');
    expect((await request(`/campaigns/${campaignId}/members/${memberId}`, 'PATCH', { playerName: 'Jogador', characterName: '', characterEntityId: npcId, notes: '', active: true }, owner)).status).toBe(422);
  });

  it('Handouts: player-home só devolve handouts revelados da Adventure ligada à campanha, nunca os não revelados', async () => {
    const owner = await register('pv-owner-4');
    const player = await register('pv-player-4');
    const adventureId = await createVaultEntity(owner, 'ADVENTURE', 'Aventura Principal');
    const { campaignId } = await createCampaignWithPlayer(owner, player, { adventureEntityId: adventureId });

    const revealedResponse = await request(`/adventures/${adventureId}/handouts`, 'POST', { title: 'Mapa do Tesouro', content: 'Um mapa rasgado.', sceneId: null, externalResourceId: null, revealed: true, sortOrder: 0 }, owner);
    expect(revealedResponse.status).toBe(201);
    const hiddenResponse = await request(`/adventures/${adventureId}/handouts`, 'POST', { title: 'Segredo do Vilão (GM only)', content: 'Nunca deveria vazar.', sceneId: null, externalResourceId: null, revealed: false, sortOrder: 1 }, owner);
    expect(hiddenResponse.status).toBe(201);

    const home = await (await request(`/campaigns/${campaignId}/player-home`, 'GET', undefined, player)).json() as { handouts: Array<{ title: string }> };
    expect(home.handouts).toHaveLength(1);
    expect(home.handouts[0].title).toBe('Mapa do Tesouro');
    expect(home.handouts.some((handout) => handout.title.includes('Segredo'))).toBe(false);
  });

  it('VTT: player-home reflete hasActiveScene corretamente (F-031, reaproveitado sem nova implementação)', async () => {
    const owner = await register('pv-owner-5');
    const player = await register('pv-player-5');
    const { campaignId } = await createCampaignWithPlayer(owner, player);

    const beforeActivate = await (await request(`/campaigns/${campaignId}/player-home`, 'GET', undefined, player)).json() as { item: { hasActiveScene: boolean } };
    expect(beforeActivate.item.hasActiveScene).toBe(false);

    const sceneResponse = await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Cena 1', mapId: null, imageUrl: 'https://example.com/pv.png', notes: '' }, owner);
    const sceneId = (await sceneResponse.json() as { id: string }).id;
    await request(`/vtt/${campaignId}/scenes/${sceneId}/activate`, 'POST', {}, owner);

    const afterActivate = await (await request(`/campaigns/${campaignId}/player-home`, 'GET', undefined, player)).json() as { item: { hasActiveScene: boolean } };
    expect(afterActivate.item.hasActiveScene).toBe(true);
  });
});
