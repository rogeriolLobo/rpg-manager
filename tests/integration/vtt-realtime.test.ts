// F-031 (correção 2026-08-20): realtime real de VTT via Durable Object (VttRoomDO) + WebSocket —
// ver src/server/vtt-room-do.ts, src/server/routes/vtt.ts (rota GET /:campaignId/realtime) e
// docs/architecture/VTT_REALTIME_ZERO_COST_AUDIT.md. Cenários exigidos pela correção de
// roadmap (seção 12): GM/Player conectam, Outsider é rejeitado; GM move token → Player recebe;
// GM move token oculto → Player NUNCA recebe; GM revela fog → Player recebe; GM avança turno →
// Player recebe; disconnect/reconnect → snapshot correto; sequência cresce monotonicamente e
// RESYNC devolve um snapshot completo; dois jogadores quando aplicável.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { VttRealtimeServerMessage } from '../../src/domain/vtt-realtime';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://vtt-realtime.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.126.${requestSequence++ % 250}`,
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

async function createCampaignWithPlayers(owner: Account, players: Account[]): Promise<string> {
  const groupResponse = await request('/groups', 'POST', { name: 'Grupo Realtime', notes: '' }, owner);
  expect(groupResponse.status).toBe(201);
  const groupId = (await groupResponse.json() as { item: { id: string } }).item.id;
  for (const [index, player] of players.entries()) {
    const memberResponse = await request(`/groups/${groupId}/members`, 'POST', { playerName: `Jogador ${index}`, userId: player.userId, notes: '', active: true, isGameMaster: false }, owner);
    expect(memberResponse.status).toBe(201);
  }
  const rpgId = await createRpg(owner);
  const response = await request('/campaigns', 'POST', {
    rpgId, name: 'Mesa Realtime', status: 'PLANNING', gameMaster: '', playGroupId: groupId,
    adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null,
    nextSessionDate: null, sessionGoal: null, legacyMembersText: '', legacyCharactersText: '', notes: '',
  }, owner);
  expect(response.status).toBe(201);
  return (await response.json() as { item: { id: string } }).item.id;
}

async function activeScene(owner: Account, campaignId: string): Promise<string> {
  const sceneResponse = await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Cena Realtime', mapId: null, imageUrl: 'https://example.com/realtime.png', notes: '', fogEnabled: true, gridCols: 10, gridRows: 10 }, owner);
  expect(sceneResponse.status).toBe(201);
  const sceneId = (await sceneResponse.json() as { id: string }).id;
  expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/activate`, 'POST', {}, owner)).status).toBe(200);
  return sceneId;
}

// Grava TODA mensagem recebida num buffer assim que a conexão abre (nunca só depois que o
// teste decide esperar por algo) — o broadcast do Durable Object roda ANTES da resposta HTTP
// da mutação voltar ao teste (notifyRoom é `await`ado, não fire-and-forget — ver
// src/server/routes/vtt.ts), então por vezes a mensagem já chegou antes do teste sequer pedir
// para esperar por ela; sem buffer, um listener anexado tarde perderia a mensagem para sempre.
interface SocketRecorder { ws: WebSocket; waitFor(predicate: (msg: VttRealtimeServerMessage) => boolean, timeoutMs?: number): Promise<VttRealtimeServerMessage>; close(): void }

function record(ws: WebSocket): SocketRecorder {
  const buffer: VttRealtimeServerMessage[] = [];
  const waiters: Array<{ predicate: (msg: VttRealtimeServerMessage) => boolean; resolve: (msg: VttRealtimeServerMessage) => void }> = [];
  ws.addEventListener('message', (event) => {
    let data: VttRealtimeServerMessage;
    try { data = JSON.parse(event.data as string) as VttRealtimeServerMessage; } catch { return; }
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(data));
    if (waiterIndex >= 0) { waiters.splice(waiterIndex, 1)[0]!.resolve(data); return; }
    buffer.push(data);
  });
  return {
    ws,
    waitFor(predicate, timeoutMs = 3000) {
      const bufferedIndex = buffer.findIndex(predicate);
      if (bufferedIndex >= 0) return Promise.resolve(buffer.splice(bufferedIndex, 1)[0]!);
      return new Promise((resolve, reject) => {
        const entry = { predicate, resolve: (msg: VttRealtimeServerMessage) => { clearTimeout(timer); resolve(msg); } };
        const timer = setTimeout(() => {
          const index = waiters.indexOf(entry);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error('timeout aguardando mensagem esperada'));
        }, timeoutMs);
        waiters.push(entry);
      });
    },
    close() { ws.close(); },
  };
}

// Abre o WebSocket real do realtime (F-031) — mesmo caminho HTTP que o browser usaria
// (GET .../realtime com Upgrade: websocket), autenticado via cookie de sessão real (nunca um
// userId/role informado à parte — o servidor resolve isso sozinho a partir da sessão).
async function connect(campaignId: string, account: Account): Promise<SocketRecorder> {
  const response = await worker.default.fetch(`${origin}/api/v1/vtt/${campaignId}/realtime`, {
    headers: { Upgrade: 'websocket', Cookie: account.cookie, 'CF-Connecting-IP': `203.0.126.${requestSequence++ % 250}` },
  });
  if (response.status !== 101 || !response.webSocket) throw new Error(`upgrade falhou: status=${response.status}`);
  const ws = response.webSocket;
  const recorder = record(ws);
  ws.accept();
  return recorder;
}

describe('VTT — realtime via Durable Object + WebSocket (F-031, correção 2026-08-20)', () => {
  it('GM e Player conectam e recebem HELLO+SNAPSHOT; outsider é rejeitado antes do upgrade (404)', async () => {
    const owner = await register('rt-owner-1');
    const player = await register('rt-player-1');
    const outsider = await register('rt-outsider-1');
    const campaignId = await createCampaignWithPlayers(owner, [player]);
    await activeScene(owner, campaignId);

    const gmWs = await connect(campaignId, owner);
    const gmHello = await gmWs.waitFor((m) => m.type === 'HELLO');
    expect(gmHello).toMatchObject({ type: 'HELLO', role: 'GM' });
    const gmSnapshot = await gmWs.waitFor((m) => m.type === 'STATE');
    expect(gmSnapshot).toMatchObject({ type: 'STATE', reason: 'SNAPSHOT', role: 'GM' });

    const playerWs = await connect(campaignId, player);
    const playerHello = await playerWs.waitFor((m) => m.type === 'HELLO');
    expect(playerHello).toMatchObject({ type: 'HELLO', role: 'PLAYER' });

    // Outsider nunca chega a fazer upgrade — mesma authorization de GET /live, 404 antes do
    // WebSocket ser sequer aberto (anti-enumeração, nunca 403).
    const outsiderResponse = await worker.default.fetch(`${origin}/api/v1/vtt/${campaignId}/realtime`, {
      headers: { Upgrade: 'websocket', Cookie: outsider.cookie },
    });
    expect(outsiderResponse.status).toBe(404);
    expect(outsiderResponse.webSocket).toBeNull();

    gmWs.close(); playerWs.close();
  });

  it('GM move token visível → Player recebe a atualização; GM move token oculto → Player nunca recebe entityId/entityName nem o token', async () => {
    const owner = await register('rt-owner-2');
    const player = await register('rt-player-2');
    const campaignId = await createCampaignWithPlayers(owner, [player]);
    const sceneId = await activeScene(owner, campaignId);
    // Revela a célula (0,0) — grade 10x10, x/y=5 caem nela — para o token visível realmente
    // aparecer na visão do jogador (mesma barreira de fog do GET /live).
    await request(`/vtt/${campaignId}/scenes/${sceneId}/fog/reveal`, 'POST', { col: 0, row: 0 }, owner);

    const gmWs = await connect(campaignId, owner);
    await gmWs.waitFor((m) => m.type === 'HELLO');
    await gmWs.waitFor((m) => m.type === 'STATE');
    const playerWs = await connect(campaignId, player);
    await playerWs.waitFor((m) => m.type === 'HELLO');
    await playerWs.waitFor((m) => m.type === 'STATE');

    const visibleTokenResponse = await request(`/vtt/${campaignId}/scenes/${sceneId}/tokens`, 'POST', { label: 'Herói', entityId: null, x: 5, y: 5, visibleToPlayers: true }, owner);
    const visibleTokenId = (await visibleTokenResponse.json() as { id: string }).id;
    const playerUpdate = await playerWs.waitFor((m) => m.type === 'STATE' && m.reason === 'TOKEN_MOVED');
    expect(playerUpdate.type).toBe('STATE');
    if (playerUpdate.type === 'STATE' && playerUpdate.role === 'PLAYER') {
      expect(playerUpdate.payload?.tokens).toEqual([{ id: visibleTokenId, label: 'Herói', x: 5, y: 5 }]);
    }
    // O GM também está conectado e recebe esse mesmo broadcast — consome antes de esperar o
    // próximo, senão o waitFor seguinte pegaria esta mensagem em vez da do segundo token.
    await gmWs.waitFor((m) => m.type === 'STATE' && m.reason === 'TOKEN_MOVED');

    // Token oculto (célula fora do fog revelado, x=95/y=95 -> célula (9,9)) nunca aparece na
    // visão do jogador — mesma barreira de segurança de GET /live, agora via broadcast.
    await request(`/vtt/${campaignId}/scenes/${sceneId}/tokens`, 'POST', { label: 'Emboscada', entityId: null, x: 95, y: 95, visibleToPlayers: true }, owner);
    const gmUpdate = await gmWs.waitFor((m) => m.type === 'STATE' && m.reason === 'TOKEN_MOVED');
    expect(gmUpdate.type).toBe('STATE');
    if (gmUpdate.type === 'STATE' && gmUpdate.role === 'GM') expect(gmUpdate.payload?.tokens).toHaveLength(2); // GM vê os dois tokens
    // A visão do jogador para esse mesmo evento nunca inclui o segundo token (fora da fog).
    const playerUpdate2 = await playerWs.waitFor((m) => m.type === 'STATE' && m.reason === 'TOKEN_MOVED');
    if (playerUpdate2.type === 'STATE' && playerUpdate2.role === 'PLAYER') {
      expect(playerUpdate2.payload?.tokens).toEqual([{ id: visibleTokenId, label: 'Herói', x: 5, y: 5 }]); // só o token na célula revelada
    }

    gmWs.close(); playerWs.close();
  });

  it('GM revela fog → Player recebe FOG_CHANGED com a célula nova', async () => {
    const owner = await register('rt-owner-3');
    const player = await register('rt-player-3');
    const campaignId = await createCampaignWithPlayers(owner, [player]);
    const sceneId = await activeScene(owner, campaignId);

    const playerWs = await connect(campaignId, player);
    await playerWs.waitFor((m) => m.type === 'HELLO');
    await playerWs.waitFor((m) => m.type === 'STATE');

    await request(`/vtt/${campaignId}/scenes/${sceneId}/fog/reveal`, 'POST', { col: 2, row: 3 }, owner);
    const update = await playerWs.waitFor((m) => m.type === 'STATE' && m.reason === 'FOG_CHANGED');
    if (update.type === 'STATE' && update.role === 'PLAYER') expect(update.payload?.fogCells).toEqual([{ col: 2, row: 3 }]);

    playerWs.close();
  });

  it('GM inicia combate e avança turno → Player recebe COMBAT_UPDATED sem HP, com o turno correto', async () => {
    const owner = await register('rt-owner-4');
    const player = await register('rt-player-4');
    const campaignId = await createCampaignWithPlayers(owner, [player]);
    const sceneId = await activeScene(owner, campaignId);

    const playerWs = await connect(campaignId, player);
    await playerWs.waitFor((m) => m.type === 'HELLO');
    await playerWs.waitFor((m) => m.type === 'STATE');

    await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/start`, 'POST', {
      combatants: [
        { tokenId: null, name: 'Herói', initiative: 15, hpCurrent: 20, hpMax: 20, notes: '', visibleToPlayers: true },
        { tokenId: null, name: 'Chefe (segredo)', initiative: 5, hpCurrent: 200, hpMax: 200, notes: '', visibleToPlayers: false },
      ],
    }, owner);
    const started = await playerWs.waitFor((m) => m.type === 'STATE' && m.reason === 'COMBAT_UPDATED');
    if (started.type === 'STATE' && started.role === 'PLAYER') {
      expect(started.payload?.combatants).toEqual([{ id: expect.any(String), name: 'Herói', isCurrentTurn: true }]);
      expect(Object.keys(started.payload!.combatants[0]).sort()).toEqual(['id', 'isCurrentTurn', 'name']); // nunca HP
    }

    await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/next`, 'POST', {}, owner);
    const advanced = await playerWs.waitFor((m) => m.type === 'STATE' && m.reason === 'COMBAT_UPDATED');
    if (advanced.type === 'STATE' && advanced.role === 'PLAYER') expect(advanced.payload?.combatants[0].isCurrentTurn).toBe(false); // turno passou para o Chefe (invisível ao jogador)

    playerWs.close();
  });

  it('disconnect/reconnect: nova conexão recebe HELLO+SNAPSHOT com o estado atual correto (nunca exige replay)', async () => {
    const owner = await register('rt-owner-5');
    const player = await register('rt-player-5');
    const campaignId = await createCampaignWithPlayers(owner, [player]);
    const sceneId = await activeScene(owner, campaignId);
    await request(`/vtt/${campaignId}/scenes/${sceneId}/fog/reveal`, 'POST', { col: 0, row: 0 }, owner);
    await request(`/vtt/${campaignId}/scenes/${sceneId}/tokens`, 'POST', { label: 'Herói', entityId: null, x: 5, y: 5, visibleToPlayers: true }, owner);

    const firstConnection = await connect(campaignId, player);
    await firstConnection.waitFor((m) => m.type === 'HELLO');
    await firstConnection.waitFor((m) => m.type === 'STATE');
    firstConnection.close();

    // Muda o estado enquanto o jogador está desconectado — a próxima conexão precisa já
    // chegar com o estado NOVO, sem precisar replay de nenhum evento perdido.
    await request(`/vtt/${campaignId}/scenes/${sceneId}/tokens`, 'POST', { label: 'Recém-chegado', entityId: null, x: 6, y: 6, visibleToPlayers: true }, owner);

    const secondConnection = await connect(campaignId, player);
    await secondConnection.waitFor((m) => m.type === 'HELLO');
    const snapshot = await secondConnection.waitFor((m) => m.type === 'STATE' && m.reason === 'SNAPSHOT');
    if (snapshot.type === 'STATE' && snapshot.role === 'PLAYER') expect(snapshot.payload?.tokens).toHaveLength(2);

    secondConnection.close();
  });

  it('sequência de broadcast cresce monotonicamente; RESYNC do cliente sempre devolve um snapshot completo', async () => {
    const owner = await register('rt-owner-6');
    const player = await register('rt-player-6');
    const campaignId = await createCampaignWithPlayers(owner, [player]);
    const sceneId = await activeScene(owner, campaignId);

    const playerWs = await connect(campaignId, player);
    const hello = await playerWs.waitFor((m) => m.type === 'HELLO');
    const firstSnapshot = await playerWs.waitFor((m) => m.type === 'STATE');
    expect(hello).toMatchObject({ type: 'HELLO', sequence: 0 });
    expect(firstSnapshot).toMatchObject({ type: 'STATE', sequence: 0, reason: 'SNAPSHOT' });

    await request(`/vtt/${campaignId}/scenes/${sceneId}/fog/reveal`, 'POST', { col: 1, row: 1 }, owner);
    const afterFirstMutation = await playerWs.waitFor((m) => m.type === 'STATE');
    await request(`/vtt/${campaignId}/scenes/${sceneId}/fog/reveal`, 'POST', { col: 2, row: 2 }, owner);
    const afterSecondMutation = await playerWs.waitFor((m) => m.type === 'STATE');
    if (afterFirstMutation.type === 'STATE' && afterSecondMutation.type === 'STATE') {
      expect(afterSecondMutation.sequence).toBeGreaterThan(afterFirstMutation.sequence); // nunca anda para trás
    }

    playerWs.ws.send(JSON.stringify({ type: 'RESYNC' }));
    const resynced = await playerWs.waitFor((m) => m.type === 'STATE' && m.reason === 'SNAPSHOT');
    if (resynced.type === 'STATE' && resynced.role === 'PLAYER') expect(resynced.payload?.fogCells).toHaveLength(2); // estado atual completo, não um diff

    playerWs.close();
  });

  it('dois jogadores conectados simultaneamente recebem o mesmo broadcast filtrado', async () => {
    const owner = await register('rt-owner-7');
    const playerA = await register('rt-player-7a');
    const playerB = await register('rt-player-7b');
    const campaignId = await createCampaignWithPlayers(owner, [playerA, playerB]);
    const sceneId = await activeScene(owner, campaignId);
    await request(`/vtt/${campaignId}/scenes/${sceneId}/fog/reveal`, 'POST', { col: 0, row: 0 }, owner);

    const wsA = await connect(campaignId, playerA);
    await wsA.waitFor((m) => m.type === 'HELLO'); await wsA.waitFor((m) => m.type === 'STATE');
    const wsB = await connect(campaignId, playerB);
    await wsB.waitFor((m) => m.type === 'HELLO'); await wsB.waitFor((m) => m.type === 'STATE');

    const tokenResponse = await request(`/vtt/${campaignId}/scenes/${sceneId}/tokens`, 'POST', { label: 'Herói', entityId: null, x: 5, y: 5, visibleToPlayers: true }, owner);
    const tokenId = (await tokenResponse.json() as { id: string }).id;
    const updateA = await wsA.waitFor((m) => m.type === 'STATE' && m.reason === 'TOKEN_MOVED');
    const updateB = await wsB.waitFor((m) => m.type === 'STATE' && m.reason === 'TOKEN_MOVED');
    if (updateA.type === 'STATE' && updateA.role === 'PLAYER') expect(updateA.payload?.tokens).toEqual([{ id: tokenId, label: 'Herói', x: 5, y: 5 }]);
    if (updateB.type === 'STATE' && updateB.role === 'PLAYER') expect(updateB.payload?.tokens).toEqual([{ id: tokenId, label: 'Herói', x: 5, y: 5 }]);

    wsA.close(); wsB.close();
  });
});
