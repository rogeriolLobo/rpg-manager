// Seção 9 da correção de finalização absoluta: Handout reveal via realtime — GM revela/oculta
// um handout (PATCH/POST/DELETE /adventures/:adventureId/handouts...) e a(s) Campaign(s) que
// usam essa Adventure recebem um evento tipado (HANDOUT_REVEALED/HANDOUT_HIDDEN) no MESMO canal
// Durable Object já usado pelo realtime de VTT (F-031) — nunca um canal novo, nunca conteúdo do
// handout enviado no evento (só o sinal; o client busca o conteúdo autorizado via HTTP normal,
// GET /campaigns/:id/player-home, que já filtra por revealed_at IS NOT NULL).
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { VttRealtimeServerMessage } from '../../src/domain/vtt-realtime';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://handout-realtime.example.com';
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
async function connect(campaignId: string, account: Account): Promise<SocketRecorder> {
  const response = await worker.default.fetch(`${origin}/api/v1/vtt/${campaignId}/realtime`, {
    headers: { Upgrade: 'websocket', Cookie: account.cookie, 'CF-Connecting-IP': `203.0.127.${requestSequence++ % 250}` },
  });
  if (response.status !== 101 || !response.webSocket) throw new Error(`upgrade falhou: status=${response.status}`);
  const ws = response.webSocket;
  const recorder = record(ws);
  ws.accept();
  return recorder;
}

async function setup(suffix: string): Promise<{ owner: Account; player: Account; campaignId: string; adventureId: string }> {
  const owner = await register(`handout-rt-owner-${suffix}`);
  const player = await register(`handout-rt-player-${suffix}`);
  const groupResponse = await request('/groups', 'POST', { name: 'Grupo Handout Realtime', notes: '' }, owner);
  const groupId = (await groupResponse.json() as { item: { id: string } }).item.id;
  await request(`/groups/${groupId}/members`, 'POST', { playerName: 'Jogador', userId: player.userId, notes: '', active: true, isGameMaster: false }, owner);
  const rpgResponse = await request('/rpgs', 'POST', { title: `RPG Handout ${Date.now()}`, categoryId: null, subgenreId: null, readingStatus: 'READING', hasPlayed: false, wantsToPlay: true, priority: 'HIGH', playGroupNotes: '', playGroupId: null, plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '', notes: '', coverUrl: null }, owner);
  const rpgId = (await rpgResponse.json() as { item: { id: string } }).item.id;
  const adventureResponse = await request('/vault', 'POST', { entityType: 'ADVENTURE', name: 'Aventura Realtime', summary: '', description: '', visibility: 'PRIVATE', worldId: null, groupId: null, parentEntityId: null, adventure: { adventureType: 'ONE_SHOT', recommendedSessions: null, notes: '', premise: '', hooks: '', keyScenes: '', rewards: '' } }, owner);
  const adventureId = (await adventureResponse.json() as { id: string }).id;
  const campaignResponse = await request('/campaigns', 'POST', { rpgId, name: 'Mesa Handout Realtime', status: 'IN_PROGRESS', sessionMode: 'CAMPAIGN', gameMaster: '', playGroupId: groupId, adventureEntityId: adventureId, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: '', legacyCharactersText: '', notes: '' }, owner);
  const campaignId = (await campaignResponse.json() as { item: { id: string } }).item.id;
  return { owner, player, campaignId, adventureId };
}

describe('Seção 9: Handout reveal via realtime (Durable Object)', () => {
  it('GM revela um handout -> Player conectado recebe HANDOUT_REVEALED; GM oculta -> Player recebe HANDOUT_HIDDEN', async () => {
    const { owner, player, campaignId, adventureId } = await setup(String(Date.now() + Math.random()));
    const handoutResponse = await request(`/adventures/${adventureId}/handouts`, 'POST', { title: 'Mapa do Tesouro', content: 'X marca o lugar', sceneId: null, externalResourceId: null, revealed: false, sortOrder: 0 }, owner);
    expect(handoutResponse.status).toBe(201);
    const handoutId = (await handoutResponse.json() as { id: string }).id;

    const playerSocket = await connect(campaignId, player);
    await playerSocket.waitFor((msg) => msg.type === 'HELLO');

    const revealResponse = await request(`/adventures/${adventureId}/handouts/${handoutId}`, 'PATCH', { title: 'Mapa do Tesouro', content: 'X marca o lugar', sceneId: null, externalResourceId: null, revealed: true, sortOrder: 0 }, owner);
    expect(revealResponse.status).toBe(200);
    const revealedMessage = await playerSocket.waitFor((msg) => msg.type === 'STATE' && msg.reason === 'HANDOUT_REVEALED');
    expect(revealedMessage.type).toBe('STATE');

    // Handout agora aparece na visão autorizada do jogador (o evento é só o sinal — o conteúdo
    // real sempre vem pela rota HTTP normal, nunca embutido na mensagem realtime).
    const playerHome = await request(`/campaigns/${campaignId}/player-home`, 'GET', undefined, player);
    const playerHomeBody = await playerHome.json() as { handouts: Array<{ title: string }> };
    expect(playerHomeBody.handouts.some((h) => h.title === 'Mapa do Tesouro')).toBe(true);

    const hideResponse = await request(`/adventures/${adventureId}/handouts/${handoutId}`, 'PATCH', { title: 'Mapa do Tesouro', content: 'X marca o lugar', sceneId: null, externalResourceId: null, revealed: false, sortOrder: 0 }, owner);
    expect(hideResponse.status).toBe(200);
    const hiddenMessage = await playerSocket.waitFor((msg) => msg.type === 'STATE' && msg.reason === 'HANDOUT_HIDDEN');
    expect(hiddenMessage.type).toBe('STATE');

    const playerHomeAfterHide = await request(`/campaigns/${campaignId}/player-home`, 'GET', undefined, player);
    const playerHomeAfterHideBody = await playerHomeAfterHide.json() as { handouts: Array<{ title: string }> };
    expect(playerHomeAfterHideBody.handouts.some((h) => h.title === 'Mapa do Tesouro')).toBe(false);

    playerSocket.close();
  });

  it('criar um handout já revelado notifica imediatamente; excluir um handout também notifica', async () => {
    const { owner, player, campaignId, adventureId } = await setup(String(Date.now() + Math.random()));
    const playerSocket = await connect(campaignId, player);
    await playerSocket.waitFor((msg) => msg.type === 'HELLO');

    const handoutResponse = await request(`/adventures/${adventureId}/handouts`, 'POST', { title: 'Bilhete', content: '', sceneId: null, externalResourceId: null, revealed: true, sortOrder: 0 }, owner);
    const handoutId = (await handoutResponse.json() as { id: string }).id;
    await playerSocket.waitFor((msg) => msg.type === 'STATE' && msg.reason === 'HANDOUT_REVEALED');

    await request(`/adventures/${adventureId}/handouts/${handoutId}`, 'DELETE', undefined, owner);
    const deletedMessage = await playerSocket.waitFor((msg) => msg.type === 'STATE' && msg.reason === 'HANDOUT_HIDDEN');
    expect(deletedMessage.type).toBe('STATE');

    playerSocket.close();
  });
});
