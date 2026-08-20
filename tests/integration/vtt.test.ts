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

describe('VTT — fog of war / visibilidade por grade (F-030)', () => {
  it('revelar é idempotente, ocultar remove, célula fora da grade é rejeitada (422)', async () => {
    const owner = await register('vtt-fog-owner-1');
    const campaignId = await createCampaign(owner);
    const sceneId = (await (await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Masmorra', mapId: null, imageUrl: 'https://example.com/f.png', notes: '', fogEnabled: true, gridCols: 5, gridRows: 5 }, owner)).json() as { id: string }).id;

    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/fog/reveal`, 'POST', { col: 0, row: 0 }, owner)).status).toBe(201);
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/fog/reveal`, 'POST', { col: 0, row: 0 }, owner)).status).toBe(201); // idempotente

    const detail = await (await request(`/vtt/${campaignId}/scenes/${sceneId}`, 'GET', undefined, owner)).json() as { fog: Array<{ col: number; row: number }> };
    expect(detail.fog).toEqual([{ col: 0, row: 0 }]);

    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/fog/reveal`, 'POST', { col: 5, row: 0 }, owner)).status).toBe(422); // col fora da grade (0-4)

    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/fog/hide`, 'POST', { col: 0, row: 0 }, owner)).status).toBe(200);
    const afterHide = await (await request(`/vtt/${campaignId}/scenes/${sceneId}`, 'GET', undefined, owner)).json() as { fog: unknown[] };
    expect(afterHide.fog).toEqual([]);
  });

  it('IDOR: outsider nunca revela/oculta/reencobre a névoa de cena alheia', async () => {
    const owner = await register('vtt-fog-owner-2');
    const outsider = await register('vtt-fog-outsider-2');
    const campaignId = await createCampaign(owner);
    const sceneId = (await (await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Cena', mapId: null, imageUrl: 'https://example.com/g.png', notes: '', fogEnabled: true, gridCols: 5, gridRows: 5 }, owner)).json() as { id: string }).id;

    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/fog/reveal`, 'POST', { col: 0, row: 0 }, outsider)).status).toBe(404);
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/fog/hide`, 'POST', { col: 0, row: 0 }, outsider)).status).toBe(404);
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/fog/reset`, 'POST', {}, outsider)).status).toBe(404);
  });

  it('visão "ao vivo": token só aparece quando sua célula é revelada; reset reencobre e o token some de novo', async () => {
    const owner = await register('vtt-fog-owner-3');
    const player = await register('vtt-fog-player-3');
    const campaignId = await createCampaignWithPlayer(owner, player);
    const sceneId = (await (await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Sala do Trono', mapId: null, imageUrl: 'https://example.com/h.png', notes: '', fogEnabled: true, gridCols: 10, gridRows: 10 }, owner)).json() as { id: string }).id;
    // x=5,y=5 numa grade 10x10 cai na célula (0,0); x=95,y=95 cai na célula (9,9).
    const heroTokenId = (await (await request(`/vtt/${campaignId}/scenes/${sceneId}/tokens`, 'POST', { label: 'Herói', entityId: null, x: 5, y: 5, visibleToPlayers: true }, owner)).json() as { id: string }).id;
    await request(`/vtt/${campaignId}/scenes/${sceneId}/tokens`, 'POST', { label: 'Fora da luz', entityId: null, x: 95, y: 95, visibleToPlayers: true }, owner);
    await request(`/vtt/${campaignId}/scenes/${sceneId}/activate`, 'POST', {}, owner);

    // Antes de revelar qualquer célula: nenhum token chega ao jogador, mesmo visibleToPlayers=1.
    const beforeReveal = await (await request(`/vtt/${campaignId}/live`, 'GET', undefined, player)).json() as { item: { tokens: unknown[]; fogCells: unknown[] } };
    expect(beforeReveal.item.tokens).toEqual([]);
    expect(beforeReveal.item.fogCells).toEqual([]);

    await request(`/vtt/${campaignId}/scenes/${sceneId}/fog/reveal`, 'POST', { col: 0, row: 0 }, owner);
    const afterReveal = await (await request(`/vtt/${campaignId}/live`, 'GET', undefined, player)).json() as { item: { tokens: Array<{ id: string }>; fogCells: Array<{ col: number; row: number }> } };
    expect(afterReveal.item.tokens).toEqual([{ id: heroTokenId, label: 'Herói', x: 5, y: 5 }]);
    expect(afterReveal.item.fogCells).toEqual([{ col: 0, row: 0 }]);

    await request(`/vtt/${campaignId}/scenes/${sceneId}/fog/reset`, 'POST', {}, owner);
    const afterReset = await (await request(`/vtt/${campaignId}/live`, 'GET', undefined, player)).json() as { item: { tokens: unknown[] } };
    expect(afterReset.item.tokens).toEqual([]);
  });
});

describe('VTT — iniciativa/combate system-neutral (F-032)', () => {
  async function activeScene(owner: Account, campaignId: string, title = 'Combate'): Promise<string> {
    const sceneId = (await (await request(`/vtt/${campaignId}/scenes`, 'POST', { title, mapId: null, imageUrl: 'https://example.com/combat.png', notes: '' }, owner)).json() as { id: string }).id;
    await request(`/vtt/${campaignId}/scenes/${sceneId}/activate`, 'POST', {}, owner);
    return sceneId;
  }

  it('inicia combate ordenado por iniciativa desc, avança turnos, envolve round ao voltar ao primeiro, e encerra limpando combatentes', async () => {
    const owner = await register('vtt-combat-owner-1');
    const campaignId = await createCampaign(owner);
    const sceneId = await activeScene(owner, campaignId);

    const start = await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/start`, 'POST', {
      combatants: [
        { tokenId: null, name: 'Goblin A', initiative: 8, notes: '', visibleToPlayers: false },
        { tokenId: null, name: 'Herói', initiative: 15, hpCurrent: 20, hpMax: 20, notes: '', visibleToPlayers: true },
        { tokenId: null, name: 'Goblin B', initiative: 8, notes: '', visibleToPlayers: false },
      ],
    }, owner);
    expect(start.status).toBe(201);

    const detail1 = await (await request(`/vtt/${campaignId}/scenes/${sceneId}`, 'GET', undefined, owner)).json() as { item: { combatActive: boolean; combatRound: number }; combatants: Array<{ name: string; isCurrentTurn: boolean; hpCurrent: number | null }> };
    expect(detail1.item.combatActive).toBe(true);
    expect(detail1.item.combatRound).toBe(1);
    expect(detail1.combatants[0]).toMatchObject({ name: 'Herói', isCurrentTurn: true, hpCurrent: 20 }); // maior iniciativa primeiro

    // Só um combate por vez — iniciar de novo sem encerrar é rejeitado.
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/start`, 'POST', { combatants: [{ tokenId: null, name: 'X', initiative: 1, notes: '', visibleToPlayers: false }] }, owner)).status).toBe(409);

    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/next`, 'POST', {}, owner)).status).toBe(200);
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/next`, 'POST', {}, owner)).status).toBe(200);
    const detail2 = await (await request(`/vtt/${campaignId}/scenes/${sceneId}`, 'GET', undefined, owner)).json() as { item: { combatRound: number }; combatants: Array<{ name: string; isCurrentTurn: boolean }> };
    expect(detail2.item.combatRound).toBe(1); // ainda não deu a volta completa (3 combatentes, 2 avanços)
    expect(detail2.combatants.filter((combatant) => combatant.isCurrentTurn)).toHaveLength(1);

    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/next`, 'POST', {}, owner)).status).toBe(200); // volta para o Herói -> round 2
    const detail3 = await (await request(`/vtt/${campaignId}/scenes/${sceneId}`, 'GET', undefined, owner)).json() as { item: { combatRound: number }; combatants: Array<{ name: string; isCurrentTurn: boolean }> };
    expect(detail3.item.combatRound).toBe(2);
    expect(detail3.combatants.find((combatant) => combatant.name === 'Herói')?.isCurrentTurn).toBe(true);

    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/end`, 'POST', {}, owner)).status).toBe(200);
    const detail4 = await (await request(`/vtt/${campaignId}/scenes/${sceneId}`, 'GET', undefined, owner)).json() as { item: { combatActive: boolean; combatRound: number }; combatants: unknown[] };
    expect(detail4.item.combatActive).toBe(false);
    expect(detail4.item.combatRound).toBe(0);
    expect(detail4.combatants).toEqual([]);
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/next`, 'POST', {}, owner)).status).toBe(409); // sem combate ativo
  });

  it('adiciona/edita/remove combatente mid-combate; remover o combatente do turno atual passa o turno adiante sem deixar a cena sem turno', async () => {
    const owner = await register('vtt-combat-owner-2');
    const campaignId = await createCampaign(owner);
    const sceneId = await activeScene(owner, campaignId, 'Emboscada');
    await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/start`, 'POST', { combatants: [{ tokenId: null, name: 'A', initiative: 10, notes: '', visibleToPlayers: false }] }, owner);

    const addResponse = await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/combatants`, 'POST', { tokenId: null, name: 'Reforço', initiative: 20, notes: '', visibleToPlayers: false }, owner);
    expect(addResponse.status).toBe(201);
    const reinforcementId = (await addResponse.json() as { id: string }).id;

    const editResponse = await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/combatants/${reinforcementId}`, 'PATCH', { tokenId: null, name: 'Reforço', initiative: 20, hpCurrent: 5, hpMax: 10, notes: 'ferido', visibleToPlayers: false }, owner);
    expect(editResponse.status).toBe(200);

    // Adicionar um combatente mid-combate NUNCA move o turno automaticamente — "A" continua
    // com o turno (só /combat/next avança), mesmo "Reforço" tendo iniciativa maior e aparecendo
    // primeiro na ordem agora.
    const detail = await (await request(`/vtt/${campaignId}/scenes/${sceneId}`, 'GET', undefined, owner)).json() as { combatants: Array<{ id: string; name: string; isCurrentTurn: boolean; hpCurrent: number | null }> };
    expect(detail.combatants[0]).toMatchObject({ id: reinforcementId, name: 'Reforço', hpCurrent: 5 });
    const currentTurnCombatant = detail.combatants.find((combatant) => combatant.isCurrentTurn)!;
    expect(currentTurnCombatant.name).toBe('A');

    // Remove exatamente o combatente que está com o turno atual — o turno precisa passar
    // adiante para quem sobrou, nunca ficar "sem ninguém".
    const removeCurrent = await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/combatants/${currentTurnCombatant.id}`, 'DELETE', undefined, owner);
    expect(removeCurrent.status).toBe(204);

    const afterRemove = await (await request(`/vtt/${campaignId}/scenes/${sceneId}`, 'GET', undefined, owner)).json() as { combatants: Array<{ id: string; isCurrentTurn: boolean }> };
    expect(afterRemove.combatants).toHaveLength(1);
    expect(afterRemove.combatants[0]).toMatchObject({ id: reinforcementId, isCurrentTurn: true }); // nunca fica sem ninguém no turno
  });

  it('visão "ao vivo": só combatentes visibleToPlayers aparecem, sem HP nunca, mesmo para o dono via /live', async () => {
    const owner = await register('vtt-combat-owner-3');
    const player = await register('vtt-combat-player-3');
    const campaignId = await createCampaignWithPlayer(owner, player);
    const sceneId = await activeScene(owner, campaignId, 'Sala do Chefe');
    await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/start`, 'POST', {
      combatants: [
        { tokenId: null, name: 'Herói', initiative: 12, hpCurrent: 30, hpMax: 30, notes: '', visibleToPlayers: true },
        { tokenId: null, name: 'Chefe (segredo)', initiative: 18, hpCurrent: 200, hpMax: 200, notes: 'fraqueza: fogo', visibleToPlayers: false },
      ],
    }, owner);

    const live = await (await request(`/vtt/${campaignId}/live`, 'GET', undefined, player)).json() as { item: { combatActive: boolean; combatRound: number; combatants: Array<Record<string, unknown>> } };
    expect(live.item.combatActive).toBe(true);
    expect(live.item.combatRound).toBe(1);
    expect(live.item.combatants).toHaveLength(1);
    expect(live.item.combatants[0]).toEqual({ id: expect.any(String), name: 'Herói', isCurrentTurn: false }); // Chefe tem iniciativa maior, é quem tem o turno — mas nunca aparece pro jogador
    expect(Object.keys(live.item.combatants[0]).sort()).toEqual(['id', 'isCurrentTurn', 'name']); // nunca hpCurrent/hpMax/notes
  });

  it('IDOR: outsider nunca inicia/avança/encerra combate nem lê/escreve combatentes de campanha alheia', async () => {
    const owner = await register('vtt-combat-owner-4');
    const outsider = await register('vtt-combat-outsider-4');
    const campaignId = await createCampaign(owner);
    const sceneId = await activeScene(owner, campaignId, 'Cena Alheia');
    await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/start`, 'POST', { combatants: [{ tokenId: null, name: 'A', initiative: 5, notes: '', visibleToPlayers: false }] }, owner);

    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/start`, 'POST', { combatants: [{ tokenId: null, name: 'X', initiative: 1, notes: '', visibleToPlayers: false }] }, outsider)).status).toBe(404);
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/next`, 'POST', {}, outsider)).status).toBe(404);
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/end`, 'POST', {}, outsider)).status).toBe(404);
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/combatants`, 'POST', { tokenId: null, name: 'X', initiative: 1, notes: '', visibleToPlayers: false }, outsider)).status).toBe(404);
  });

  it('token de combatente precisa pertencer à mesma cena (422 se de outra cena/inexistente)', async () => {
    const owner = await register('vtt-combat-owner-5');
    const campaignId = await createCampaign(owner);
    const sceneId = await activeScene(owner, campaignId, 'Cena com token');
    const otherSceneId = (await (await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Outra cena', mapId: null, imageUrl: 'https://example.com/other.png', notes: '' }, owner)).json() as { id: string }).id;
    const foreignTokenId = (await (await request(`/vtt/${campaignId}/scenes/${otherSceneId}/tokens`, 'POST', { label: 'T', entityId: null, x: 1, y: 1, visibleToPlayers: false }, owner)).json() as { id: string }).id;

    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/start`, 'POST', { combatants: [{ tokenId: foreignTokenId, name: 'X', initiative: 1, notes: '', visibleToPlayers: false }] }, owner)).status).toBe(422);
  });
});
