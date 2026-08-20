// BATCH23 — Multi-GM (Seções 2-6 do pedido de finalização): Owner + 0..N Co-GMs por Campaign.
// Co-GM ganha acesso real (campaign_co_gms) ao aceitar um convite social de Campaign com
// role='GM' (src/server/routes/social.ts) — nunca promoção silenciosa. Matriz de segurança
// Owner/Co-GM/Player/Outsider cobrindo VTT, handout reveal, configurações administrativas
// sensíveis (owner-only) e IDOR entre campanhas — mais o cenário de realtime com 2 GMs reais
// conectados ao mesmo Durable Object.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { VttRealtimeServerMessage } from '../../src/domain/vtt-realtime';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://multi-gm.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.128.${requestSequence++ % 250}`,
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

async function createCampaign(owner: Account, name: string): Promise<{ campaignId: string; rpgId: string }> {
  const rpgResponse = await request('/rpgs', 'POST', { title: `RPG ${name} ${Date.now()}-${Math.random()}`, categoryId: null, subgenreId: null, readingStatus: 'READING', hasPlayed: false, wantsToPlay: true, priority: 'HIGH', playGroupNotes: '', playGroupId: null, plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '', notes: '', coverUrl: null }, owner);
  expect(rpgResponse.status).toBe(201);
  const rpgId = (await rpgResponse.json() as { item: { id: string } }).item.id;
  const campaignResponse = await request('/campaigns', 'POST', { rpgId, name, status: 'IN_PROGRESS', sessionMode: 'CAMPAIGN', gameMaster: '', playGroupId: null, adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: '', legacyCharactersText: '', notes: '' }, owner);
  expect(campaignResponse.status).toBe(201);
  const campaignId = (await campaignResponse.json() as { item: { id: string } }).item.id;
  return { campaignId, rpgId };
}

// Owner convida `account` como Co-GM real da campanha (role GM em social_invites) — mesmo
// fluxo de UI (InviteFriendPanel "Narrador (Co-Mestre)"), nunca um atalho de teste que pule a
// autorização real.
async function makeFriends(a: Account, b: Account): Promise<void> {
  const sent = await request('/social/requests', 'POST', { targetUserId: b.userId }, a);
  expect(sent.status).toBe(201);
  const requestId = (await sent.json() as { item: { id: string } }).item.id;
  const accepted = await request(`/social/requests/${requestId}/accept`, 'POST', undefined, b);
  expect(accepted.status).toBe(200);
}
async function inviteCoGm(owner: Account, coGm: Account, campaignId: string): Promise<void> {
  await makeFriends(owner, coGm);
  const inviteResponse = await request('/social/invites', 'POST', { inviteeUserId: coGm.userId, targetType: 'CAMPAIGN', targetId: campaignId, role: 'GM' }, owner);
  expect(inviteResponse.status).toBe(201);
  const inviteId = (await inviteResponse.json() as { item: { id: string } }).item.id;
  const acceptResponse = await request(`/social/invites/${inviteId}/accept`, 'POST', undefined, coGm);
  expect(acceptResponse.status).toBe(200);
}
async function addPlayer(owner: Account, player: Account, campaignId: string): Promise<void> {
  await makeFriends(owner, player);
  const inviteResponse = await request('/social/invites', 'POST', { inviteeUserId: player.userId, targetType: 'CAMPAIGN', targetId: campaignId, role: 'PLAYER' }, owner);
  expect(inviteResponse.status).toBe(201);
  const inviteId = (await inviteResponse.json() as { item: { id: string } }).item.id;
  const acceptResponse = await request(`/social/invites/${inviteId}/accept`, 'POST', undefined, player);
  expect(acceptResponse.status).toBe(200);
}

async function setup(suffix: string) {
  const owner = await register(`mgm-owner-${suffix}`);
  const coGm = await register(`mgm-cogm-${suffix}`);
  const player = await register(`mgm-player-${suffix}`);
  const outsider = await register(`mgm-outsider-${suffix}`);
  const { campaignId } = await createCampaign(owner, 'Campanha Multi-GM');
  await inviteCoGm(owner, coGm, campaignId);
  await addPlayer(owner, player, campaignId);
  return { owner, coGm, player, outsider, campaignId };
}

describe('BATCH23 — Multi-GM: matriz de segurança Owner/Co-GM/Player/Outsider', () => {
  it('Co-GM administra VTT (scene/token/fog/combat) igual ao Owner; Player e Outsider são bloqueados (404)', async () => {
    const { coGm, player, outsider, campaignId } = await setup(String(Date.now()) + Math.random());

    // Co-GM cria uma cena — mesma capacidade do Owner.
    const sceneResponse = await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Cena do Co-GM', mapId: null, imageUrl: 'https://example.com/co-gm.png', notes: '', fogEnabled: true, gridCols: 10, gridRows: 10 }, coGm);
    expect(sceneResponse.status).toBe(201);
    const sceneId = (await sceneResponse.json() as { id: string }).id;
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/activate`, 'POST', undefined, coGm)).status).toBe(200);

    // Co-GM manipula token, fog e combate.
    const tokenResponse = await request(`/vtt/${campaignId}/scenes/${sceneId}/tokens`, 'POST', { label: 'Monstro', entityId: null, x: 20, y: 20, visibleToPlayers: true }, coGm);
    expect(tokenResponse.status).toBe(201);
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/fog/reveal`, 'POST', { col: 1, row: 1 }, coGm)).status).toBe(201);
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/combat/start`, 'POST', { combatants: [{ tokenId: null, name: 'Inimigo', initiative: 10, hpCurrent: null, hpMax: null, notes: '', visibleToPlayers: true }] }, coGm)).status).toBe(201);

    // Player: leitura permitida (GET /live), escrita bloqueada com 404 (nunca 403 — anti-enumeração).
    expect((await request(`/vtt/${campaignId}/live`, 'GET', undefined, player)).status).toBe(200);
    expect((await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Tentativa de Player', mapId: null, imageUrl: 'https://example.com/x.png', notes: '', fogEnabled: false, gridCols: 10, gridRows: 10 }, player)).status).toBe(404);
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/tokens`, 'POST', { label: 'x', entityId: null, x: 1, y: 1, visibleToPlayers: false }, player)).status).toBe(404);

    // Outsider: bloqueado em tudo, incluindo a leitura de /live.
    expect((await request(`/vtt/${campaignId}/live`, 'GET', undefined, outsider)).status).toBe(404);
    expect((await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Tentativa de Outsider', mapId: null, imageUrl: 'https://example.com/x.png', notes: '', fogEnabled: false, gridCols: 10, gridRows: 10 }, outsider)).status).toBe(404);
  });

  it('Co-GM revela/oculta handout via rota de campanha; Player e Outsider bloqueados', async () => {
    const { owner, coGm, player, outsider, campaignId } = await setup(String(Date.now()) + Math.random());
    const adventureResponse = await request('/vault', 'POST', { entityType: 'ADVENTURE', name: 'Aventura Multi-GM', summary: '', description: '', visibility: 'PRIVATE', worldId: null, groupId: null, parentEntityId: null, adventure: { adventureType: 'ONE_SHOT', recommendedSessions: null, notes: '', premise: '', hooks: '', keyScenes: '', rewards: '' } }, owner);
    const adventureId = (await adventureResponse.json() as { id: string }).id;
    await request(`/campaigns/${campaignId}`, 'PATCH', { rpgId: (await (await request(`/campaigns/${campaignId}`, 'GET', undefined, owner)).json() as { item: { rpgId: string } }).item.rpgId, name: 'Campanha Multi-GM', status: 'IN_PROGRESS', sessionMode: 'CAMPAIGN', gameMaster: '', playGroupId: null, adventureEntityId: adventureId, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: '', legacyCharactersText: '', notes: '' }, owner);
    const handoutResponse = await request(`/adventures/${adventureId}/handouts`, 'POST', { title: 'Pergaminho', content: 'segredo', sceneId: null, externalResourceId: null, revealed: false, sortOrder: 0 }, owner);
    const handoutId = (await handoutResponse.json() as { id: string }).id;

    expect((await request(`/vtt/${campaignId}/handouts/${handoutId}/reveal`, 'POST', undefined, player)).status).toBe(404);
    expect((await request(`/vtt/${campaignId}/handouts/${handoutId}/reveal`, 'POST', undefined, outsider)).status).toBe(404);

    const revealResponse = await request(`/vtt/${campaignId}/handouts/${handoutId}/reveal`, 'POST', undefined, coGm);
    expect(revealResponse.status).toBe(200);
    const playerHome = await request(`/campaigns/${campaignId}/player-home`, 'GET', undefined, player);
    expect(((await playerHome.json()) as { handouts: Array<{ title: string }> }).handouts.some((h) => h.title === 'Pergaminho')).toBe(true);

    expect((await request(`/vtt/${campaignId}/handouts/${handoutId}/hide`, 'POST', undefined, coGm)).status).toBe(200);
    const playerHomeAfterHide = await request(`/campaigns/${campaignId}/player-home`, 'GET', undefined, player);
    expect(((await playerHomeAfterHide.json()) as { handouts: Array<{ title: string }> }).handouts.some((h) => h.title === 'Pergaminho')).toBe(false);
  });

  it('Co-GM NUNCA pode excluir a Campaign, transferir ownership (editar configurações) ou gerenciar outros Co-GMs — só o Owner', async () => {
    const { owner, coGm, campaignId } = await setup(String(Date.now()) + Math.random());

    // Configurações administrativas sensíveis: owner-only. Usa um RPG que o PRÓPRIO Co-GM
    // possui (para isolar exatamente a checagem de posse da Campaign — c.user_id=? — do PATCH,
    // não a validação de rpgId que rejeitaria antes mesmo de chegar lá se o Co-GM enviasse o
    // rpgId da campanha do Owner, que ele não possui).
    const coGmRpgResponse = await request('/rpgs', 'POST', { title: `RPG do Co-GM ${Date.now()}-${Math.random()}`, categoryId: null, subgenreId: null, readingStatus: 'READING', hasPlayed: false, wantsToPlay: true, priority: 'HIGH', playGroupNotes: '', playGroupId: null, plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '', notes: '', coverUrl: null }, coGm);
    const coGmRpgId = (await coGmRpgResponse.json() as { item: { id: string } }).item.id;
    const patchAttempt = await request(`/campaigns/${campaignId}`, 'PATCH', { rpgId: coGmRpgId, name: 'Nome alterado pelo Co-GM', status: 'IN_PROGRESS', sessionMode: 'CAMPAIGN', gameMaster: '', playGroupId: null, adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: '', legacyCharactersText: '', notes: '' }, coGm);
    expect(patchAttempt.status).toBe(404);

    // Excluir Campaign: owner-only.
    const deleteAttempt = await request(`/campaigns/${campaignId}`, 'DELETE', undefined, coGm);
    expect(deleteAttempt.status).toBe(404);

    // Revogar outro Co-GM: owner-only (mesmo tentando revogar a si mesmo).
    const revokeAttempt = await request(`/campaigns/${campaignId}/co-gms/${coGm.userId}`, 'DELETE', undefined, coGm);
    expect(revokeAttempt.status).toBe(404);

    // Owner consegue revogar normalmente, e a revogação realmente remove o acesso.
    const ownerRevoke = await request(`/campaigns/${campaignId}/co-gms/${coGm.userId}`, 'DELETE', undefined, owner);
    expect(ownerRevoke.status).toBe(204);
    const afterRevoke = await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Depois de revogado', mapId: null, imageUrl: 'https://example.com/x.png', notes: '', fogEnabled: false, gridCols: 10, gridRows: 10 }, coGm);
    expect(afterRevoke.status).toBe(404);

    // Campaign continua intacta e sob o mesmo Owner.
    const stillThere = await request(`/campaigns/${campaignId}`, 'GET', undefined, owner);
    expect(stillThere.status).toBe(200);
  });

  it('IDOR: Co-GM da Campaign A nunca administra a Campaign B, mesmo sendo do mesmo Owner', async () => {
    const suffix = String(Date.now()) + Math.random();
    const owner = await register(`mgm-idor-owner-${suffix}`);
    const coGm = await register(`mgm-idor-cogm-${suffix}`);
    const { campaignId: campaignA } = await createCampaign(owner, 'Campanha A');
    const { campaignId: campaignB } = await createCampaign(owner, 'Campanha B');
    await inviteCoGm(owner, coGm, campaignA);

    // Co-GM administra A normalmente.
    expect((await request(`/vtt/${campaignA}/scenes`, 'POST', { title: 'Cena A', mapId: null, imageUrl: 'https://example.com/a.png', notes: '', fogEnabled: false, gridCols: 10, gridRows: 10 }, coGm)).status).toBe(201);
    // Mas NUNCA administra B (nunca foi convidado para B).
    expect((await request(`/vtt/${campaignB}/scenes`, 'POST', { title: 'Cena B', mapId: null, imageUrl: 'https://example.com/b.png', notes: '', fogEnabled: false, gridCols: 10, gridRows: 10 }, coGm)).status).toBe(404);
    expect((await request(`/campaigns/${campaignB}`, 'GET', undefined, coGm)).status).toBe(404);
  });

  it('lista de Campanhas (GET /campaigns) inclui as campanhas co-administradas, não só as próprias', async () => {
    const { owner, coGm, campaignId } = await setup(String(Date.now()) + Math.random());
    const list = await request('/campaigns', 'GET', undefined, coGm);
    expect(list.status).toBe(200);
    const items = ((await list.json()) as { items: Array<{ id: string; isOwner: boolean }> }).items;
    const entry = items.find((item) => item.id === campaignId);
    expect(entry).toBeTruthy();
    expect(entry!.isOwner).toBe(false);

    const ownerList = await request('/campaigns', 'GET', undefined, owner);
    const ownerEntry = ((await ownerList.json()) as { items: Array<{ id: string; isOwner: boolean }> }).items.find((item) => item.id === campaignId);
    expect(ownerEntry!.isOwner).toBe(true);
  });
});

describe('BATCH23 — Multi-GM: realtime com 2 GMs reais no mesmo Durable Object', () => {
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
      headers: { Upgrade: 'websocket', Cookie: account.cookie, 'CF-Connecting-IP': `203.0.128.${requestSequence++ % 250}` },
    });
    if (response.status !== 101 || !response.webSocket) throw new Error(`upgrade falhou: status=${response.status}`);
    const ws = response.webSocket;
    const recorder = record(ws);
    ws.accept();
    return recorder;
  }

  it('GM-A (Owner) move token -> GM-B (Co-GM) recebe; GM-B revela fog -> GM-A recebe; Player só recebe visão filtrada', async () => {
    const { owner, coGm, player, campaignId } = await setup(String(Date.now()) + Math.random());
    const sceneResponse = await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Cena Multi-GM', mapId: null, imageUrl: 'https://example.com/multi.png', notes: '', fogEnabled: true, gridCols: 10, gridRows: 10 }, owner);
    const sceneId = (await sceneResponse.json() as { id: string }).id;
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/activate`, 'POST', undefined, owner)).status).toBe(200);

    const gmASocket = await connect(campaignId, owner);
    const gmBSocket = await connect(campaignId, coGm);
    const playerSocket = await connect(campaignId, player);
    await gmASocket.waitFor((msg) => msg.type === 'HELLO');
    await gmBSocket.waitFor((msg) => msg.type === 'HELLO');
    await playerSocket.waitFor((msg) => msg.type === 'HELLO');

    // GM-A (Owner) cria um token -> GM-B (Co-GM) recebe o evento em tempo real, visão de GM completa.
    const tokenResponse = await request(`/vtt/${campaignId}/scenes/${sceneId}/tokens`, 'POST', { label: 'Herói', entityId: null, x: 30, y: 30, visibleToPlayers: true }, owner);
    expect(tokenResponse.status).toBe(201);
    const gmBTokenMsg = await gmBSocket.waitFor((msg) => msg.type === 'STATE' && msg.reason === 'TOKEN_MOVED');
    expect(gmBTokenMsg.type === 'STATE' && gmBTokenMsg.role === 'GM' && gmBTokenMsg.payload?.tokens.some((t) => t.label === 'Herói')).toBe(true);

    // GM-B (Co-GM) revela fog -> GM-A (Owner) recebe.
    expect((await request(`/vtt/${campaignId}/scenes/${sceneId}/fog/reveal`, 'POST', { col: 2, row: 2 }, coGm)).status).toBe(201);
    const gmAFogMsg = await gmASocket.waitFor((msg) => msg.type === 'STATE' && msg.reason === 'FOG_CHANGED');
    expect(gmAFogMsg.type === 'STATE' && gmAFogMsg.role === 'GM' && gmAFogMsg.payload?.fog.some((cell) => cell.col === 2 && cell.row === 2)).toBe(true);

    // Player recebe o mesmo evento, mas SEMPRE a visão filtrada (payload de Player, nunca o de GM).
    const playerFogMsg = await playerSocket.waitFor((msg) => msg.type === 'STATE' && msg.reason === 'FOG_CHANGED');
    expect(playerFogMsg.type === 'STATE' && playerFogMsg.role === 'PLAYER').toBe(true);

    gmASocket.close(); gmBSocket.close(); playerSocket.close();
  });
});
