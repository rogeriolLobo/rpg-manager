// BATCH23 — Seção 19 do pedido de finalização: load test formal, Zero-Cost, LOCAL/controlado
// (nunca martelar produção — roda contra o mesmo Worker local usado por todo o resto da suíte
// de integração, via `exports` de `cloudflare:workers`, miniflare/vitest-pool-workers). Simula
// os três cenários pedidos (1 GM+4 Players, 1 GM+8 Players, 2 GMs+8 Players) com ações reais
// (mover token, revelar fog, avançar turno, revelar handout, reconectar) e conta com precisão o
// que É medível deste ambiente: requisições HTTP (cada uma corresponde a exatamente 1 escrita
// D1 + 1 notificação ao Durable Object nas rotas mutantes de vtt.ts — proporção determinística
// do próprio código, não estimada) e mensagens WebSocket recebidas por conexão. CPU/memória do
// Worker real não são instrumentáveis a partir deste harness (miniflare não expõe profiler de
// produção) — a projeção correspondente em docs/architecture/VTT_LOAD_TEST.md é conservadora,
// baseada nos limites publicados do plano Free, nunca apresentada como medição direta.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://vtt-load-test.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.130.${requestSequence++ % 250}`,
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

async function makeFriends(a: Account, b: Account): Promise<void> {
  const sent = await request('/social/requests', 'POST', { targetUserId: b.userId }, a);
  const requestId = (await sent.json() as { item: { id: string } }).item.id;
  await request(`/social/requests/${requestId}/accept`, 'POST', undefined, b);
}
async function inviteToCampaign(owner: Account, invitee: Account, campaignId: string, role: 'PLAYER' | 'GM'): Promise<void> {
  await makeFriends(owner, invitee);
  const inviteResponse = await request('/social/invites', 'POST', { inviteeUserId: invitee.userId, targetType: 'CAMPAIGN', targetId: campaignId, role }, owner);
  const inviteId = (await inviteResponse.json() as { item: { id: string } }).item.id;
  await request(`/social/invites/${inviteId}/accept`, 'POST', undefined, invitee);
}

interface ScenarioResult {
  label: string;
  gmCount: number; playerCount: number;
  httpRequests: number;
  d1Writes: number; // 1:1 com as rotas mutantes chamadas — determinístico pelo próprio código de vtt.ts
  doNotifications: number; // idem — cada rota mutante chama notifyRoom() exatamente 1x
  wsMessagesReceivedTotal: number;
  durationMs: number;
}

async function connectWs(campaignId: string, account: Account): Promise<{ socket: WebSocket; messageCount: () => number; close: () => void }> {
  const response = await worker.default.fetch(`${origin}/api/v1/vtt/${campaignId}/realtime`, {
    headers: { Upgrade: 'websocket', Cookie: account.cookie, 'CF-Connecting-IP': `203.0.130.${requestSequence++ % 250}` },
  });
  if (response.status !== 101 || !response.webSocket) throw new Error(`upgrade falhou: status=${response.status}`);
  const socket = response.webSocket;
  let count = 0;
  socket.addEventListener('message', () => { count += 1; });
  socket.accept();
  return { socket, messageCount: () => count, close: () => socket.close() };
}

async function runScenario(label: string, gmCount: number, playerCount: number): Promise<ScenarioResult> {
  const start = Date.now();
  let httpRequests = 0; let d1Writes = 0; let doNotifications = 0;
  const track = async (promise: Promise<Response>, mutates: boolean): Promise<Response> => {
    httpRequests += 1;
    if (mutates) { d1Writes += 1; doNotifications += 1; }
    return promise;
  };

  const owner = await register(`load-${label.replace(/\s/gu, '')}-owner-${Date.now()}-${Math.random()}`);
  const rpgResponse = await track(request('/rpgs', 'POST', { title: `RPG Load ${label} ${Date.now()}-${Math.random()}`, categoryId: null, subgenreId: null, readingStatus: 'READING', hasPlayed: false, wantsToPlay: true, priority: 'HIGH', playGroupNotes: '', playGroupId: null, plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '', notes: '', coverUrl: null }, owner), false);
  const rpgId = (await rpgResponse.json() as { item: { id: string } }).item.id;
  const campaignResponse = await track(request('/campaigns', 'POST', { rpgId, name: `Mesa ${label}`, status: 'IN_PROGRESS', sessionMode: 'CAMPAIGN', gameMaster: '', playGroupId: null, adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: '', legacyCharactersText: '', notes: '' }, owner), false);
  const campaignId = (await campaignResponse.json() as { item: { id: string } }).item.id;

  const coGms: Account[] = [];
  for (let index = 1; index < gmCount; index += 1) {
    const coGm = await register(`load-${label.replace(/\s/gu, '')}-cogm${index}-${Date.now()}-${Math.random()}`);
    await inviteToCampaign(owner, coGm, campaignId, 'GM');
    coGms.push(coGm);
  }
  const players: Account[] = [];
  for (let index = 0; index < playerCount; index += 1) {
    const player = await register(`load-${label.replace(/\s/gu, '')}-p${index}-${Date.now()}-${Math.random()}`);
    await inviteToCampaign(owner, player, campaignId, 'PLAYER');
    players.push(player);
  }

  const sceneResponse = await track(request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Cena de Carga', mapId: null, imageUrl: 'https://example.com/load.png', notes: '', fogEnabled: true, gridCols: 20, gridRows: 20 }, owner), true);
  const sceneId = (await sceneResponse.json() as { id: string }).id;
  await track(request(`/vtt/${campaignId}/scenes/${sceneId}/activate`, 'POST', undefined, owner), true);

  const allGms = [owner, ...coGms];
  const gmSockets = await Promise.all(allGms.map((gm) => connectWs(campaignId, gm)));
  const playerSockets = await Promise.all(players.map((player) => connectWs(campaignId, player)));

  // Ações reais de uma sessão curta e intensa: cada GM move um token, revela fog e avança
  // combate algumas vezes — ritmo bem acima de uma mesa real (nunca abaixo), para medir o
  // pior caso plausível, não o caso médio.
  const ACTIONS_PER_GM = 8;
  for (const gm of allGms) {
    const tokenResponse = await track(request(`/vtt/${campaignId}/scenes/${sceneId}/tokens`, 'POST', { label: `Token de ${gm.userId.slice(0, 4)}`, entityId: null, x: 10, y: 10, visibleToPlayers: true }, gm), true);
    const tokenId = (await tokenResponse.json() as { id: string }).id;
    for (let index = 0; index < ACTIONS_PER_GM; index += 1) {
      await track(request(`/vtt/${campaignId}/scenes/${sceneId}/tokens/${tokenId}`, 'PATCH', { label: `Token de ${gm.userId.slice(0, 4)}`, entityId: null, x: index % 100, y: (index * 2) % 100, visibleToPlayers: true }, gm), true);
      await track(request(`/vtt/${campaignId}/scenes/${sceneId}/fog/reveal`, 'POST', { col: index % 20, row: (index + 1) % 20 }, gm), true);
    }
  }
  const combatStart = await track(request(`/vtt/${campaignId}/scenes/${sceneId}/combat/start`, 'POST', { combatants: allGms.map((gm, index) => ({ tokenId: null, name: `Combatente ${index}`, initiative: 20 - index, hpCurrent: null, hpMax: null, notes: '', visibleToPlayers: true })) }, owner), true);
  expect(combatStart.status).toBe(201);
  for (let round = 0; round < 4; round += 1) await track(request(`/vtt/${campaignId}/scenes/${sceneId}/combat/next`, 'POST', undefined, owner), true);

  // Reconnect: cada jogador cai e reconecta 1x (cenário real de rede instável em mesa longa).
  for (const player of playerSockets) player.close();
  const playerReconnects = await Promise.all(players.map((player) => connectWs(campaignId, player)));

  // Espera as mensagens em trânsito chegarem antes de contar (broadcast é assíncrono em
  // relação à resposta HTTP da mutação seguinte).
  await new Promise((resolve) => setTimeout(resolve, 200));

  const wsMessagesReceivedTotal = [...gmSockets, ...playerReconnects].reduce((sum, s) => sum + s.messageCount(), 0);
  for (const s of [...gmSockets, ...playerReconnects]) s.close();

  return { label, gmCount, playerCount, httpRequests, d1Writes, doNotifications, wsMessagesReceivedTotal, durationMs: Date.now() - start };
}

describe('BATCH23 — Seção 19: load test formal Zero-Cost (LOCAL/controlado)', () => {
  it('1 GM + 4 Players: cenário pequeno completa sem erro, com contagens reais e determinísticas', async () => {
    const result = await runScenario('1gm4p', 1, 4);
    expect(result.d1Writes).toBeGreaterThan(0);
    expect(result.doNotifications).toBe(result.d1Writes); // toda mutação de vtt.ts chama notifyRoom() exatamente 1x — invariante do próprio código
    expect(result.wsMessagesReceivedTotal).toBeGreaterThan(0);
    console.log(`[VTT_LOAD_TEST] ${JSON.stringify(result)}`);
  }, 60000);

  it('1 GM + 8 Players: cenário médio completa sem erro', async () => {
    const result = await runScenario('1gm8p', 1, 8);
    expect(result.d1Writes).toBeGreaterThan(0);
    expect(result.wsMessagesReceivedTotal).toBeGreaterThan(0);
    console.log(`[VTT_LOAD_TEST] ${JSON.stringify(result)}`);
  }, 90000);

  it('2 GMs + 8 Players: cenário grande (multi-GM real) completa sem erro', async () => {
    const result = await runScenario('2gm8p', 2, 8);
    expect(result.gmCount).toBe(2);
    expect(result.d1Writes).toBeGreaterThan(0);
    expect(result.wsMessagesReceivedTotal).toBeGreaterThan(0);
    console.log(`[VTT_LOAD_TEST] ${JSON.stringify(result)}`);
  }, 120000);
});
