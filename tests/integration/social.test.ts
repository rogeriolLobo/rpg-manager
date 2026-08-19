// F-016/F-019 (BATCH7): amizades, bloqueios e notificações — ver src/server/routes/social.ts.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://social.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.117.${requestSequence++ % 250}`,
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

describe('Social — amizades, bloqueios, notificações', () => {
  it('fluxo completo: pedido → recebido/enviado → aceitar → amigos → notificação → remover', async () => {
    const alice = await register('social-alice');
    const bob = await register('social-bob');

    const sent = await request('/social/requests', 'POST', { targetUserId: bob.userId }, alice);
    expect(sent.status).toBe(201);
    const { item } = await sent.json() as { item: { id: string; status: string } };
    expect(item.status).toBe('PENDING');

    const aliceRequests = await request('/social/requests', 'GET', undefined, alice);
    const aliceBody = await aliceRequests.json() as { sent: Array<{ userId: string }>; received: Array<{ userId: string }> };
    expect(aliceBody.sent.map((r) => r.userId)).toContain(bob.userId);
    expect(aliceBody.received).toHaveLength(0);

    const bobRequests = await request('/social/requests', 'GET', undefined, bob);
    const bobBody = await bobRequests.json() as { sent: Array<{ userId: string }>; received: Array<{ userId: string }> };
    expect(bobBody.received.map((r) => r.userId)).toContain(alice.userId);

    // Só o addressee (bob) pode aceitar — alice tentando aceitar o próprio pedido recebe 404.
    expect((await request(`/social/requests/${item.id}/accept`, 'POST', undefined, alice)).status).toBe(404);

    const accept = await request(`/social/requests/${item.id}/accept`, 'POST', undefined, bob);
    expect(accept.status).toBe(200);

    const aliceFriends = (await (await request('/social/friends', 'GET', undefined, alice)).json()) as { items: Array<{ userId: string }> };
    expect(aliceFriends.items.map((f) => f.userId)).toContain(bob.userId);
    const bobFriends = (await (await request('/social/friends', 'GET', undefined, bob)).json()) as { items: Array<{ userId: string }> };
    expect(bobFriends.items.map((f) => f.userId)).toContain(alice.userId);

    // Pedido não existe mais para nenhum dos dois.
    const aliceRequestsAfter = await (await request('/social/requests', 'GET', undefined, alice)).json() as { sent: unknown[] };
    expect(aliceRequestsAfter.sent).toHaveLength(0);

    // Notificação de aceite chegou para quem pediu (alice).
    const aliceNotifications = await (await request('/social/notifications', 'GET', undefined, alice)).json() as { items: Array<{ id: string; kind: string; payload: { userId: string }; readAt: string | null }> };
    const acceptedNotification = aliceNotifications.items.find((n) => n.kind === 'FRIEND_REQUEST_ACCEPTED');
    expect(acceptedNotification?.payload.userId).toBe(bob.userId);
    expect(acceptedNotification?.readAt).toBeNull();
    const markRead = await request(`/social/notifications/${acceptedNotification!.id}/read`, 'POST', undefined, alice);
    expect(markRead.status).toBe(200);

    // Notificação de pedido recebido chegou para bob quando o pedido foi enviado.
    const bobNotifications = await (await request('/social/notifications', 'GET', undefined, bob)).json() as { items: Array<{ kind: string }> };
    expect(bobNotifications.items.some((n) => n.kind === 'FRIEND_REQUEST_RECEIVED')).toBe(true);

    // Remover amizade — qualquer um dos dois pode.
    expect((await request(`/social/friends/${bob.userId}`, 'DELETE', undefined, alice)).status).toBe(204);
    const aliceFriendsAfter = await (await request('/social/friends', 'GET', undefined, alice)).json() as { items: unknown[] };
    expect(aliceFriendsAfter.items).toHaveLength(0);
  });

  it('recusar só pelo addressee; cancelar só pelo requester; outsider nunca enxerga o pedido de outra dupla', async () => {
    const alice = await register('social-decline-alice');
    const bob = await register('social-decline-bob');
    const carol = await register('social-decline-carol');

    const sent = await request('/social/requests', 'POST', { targetUserId: bob.userId }, alice);
    const { item } = await sent.json() as { item: { id: string } };

    // outsider (carol) não pode agir sobre o pedido de alice/bob.
    expect((await request(`/social/requests/${item.id}/decline`, 'POST', undefined, carol)).status).toBe(404);
    expect((await request(`/social/requests/${item.id}`, 'DELETE', undefined, carol)).status).toBe(404);
    // requester (alice) não pode "recusar" o próprio pedido enviado (só addressee recusa).
    expect((await request(`/social/requests/${item.id}/decline`, 'POST', undefined, alice)).status).toBe(404);
    // addressee (bob) não pode "cancelar" (só requester cancela).
    expect((await request(`/social/requests/${item.id}`, 'DELETE', undefined, bob)).status).toBe(404);

    expect((await request(`/social/requests/${item.id}/decline`, 'POST', undefined, bob)).status).toBe(204);
    const aliceFriends = await (await request('/social/friends', 'GET', undefined, alice)).json() as { items: unknown[] };
    expect(aliceFriends.items).toHaveLength(0);
  });

  it('pedido cruzado (B já pediu A) vira aceite automático em vez de segundo pedido pendente', async () => {
    const alice = await register('social-cross-alice');
    const bob = await register('social-cross-bob');
    await request('/social/requests', 'POST', { targetUserId: alice.userId }, bob);
    const crossed = await request('/social/requests', 'POST', { targetUserId: bob.userId }, alice);
    expect(crossed.status).toBe(201);
    const body = await crossed.json() as { status: string };
    expect(body.status).toBe('ACCEPTED');
    const aliceFriends = await (await request('/social/friends', 'GET', undefined, alice)).json() as { items: Array<{ userId: string }> };
    expect(aliceFriends.items.map((f) => f.userId)).toContain(bob.userId);
  });

  it('rejeita: a si mesmo, alvo inexistente, duplicado, e já amigos', async () => {
    const alice = await register('social-reject-alice');
    const bob = await register('social-reject-bob');
    expect((await request('/social/requests', 'POST', { targetUserId: alice.userId }, alice)).status).toBe(422);
    expect((await request('/social/requests', 'POST', { targetUserId: 'conta-inexistente' }, alice)).status).toBe(422);
    // mass assignment: campo extra é rejeitado (strictObject).
    expect((await request('/social/requests', 'POST', { targetUserId: bob.userId, autoAccept: true }, alice)).status).toBe(422);

    const first = await request('/social/requests', 'POST', { targetUserId: bob.userId }, alice);
    expect(first.status).toBe(201);
    expect((await request('/social/requests', 'POST', { targetUserId: bob.userId }, alice)).status).toBe(409);

    const { item } = await first.json() as { item: { id: string } };
    await request(`/social/requests/${item.id}/accept`, 'POST', undefined, bob);
    expect((await request('/social/requests', 'POST', { targetUserId: bob.userId }, alice)).status).toBe(409);
  });

  it('bloquear remove amizade/pedido existente nos dois sentidos e impede novo pedido; desbloquear libera de novo', async () => {
    const alice = await register('social-block-alice');
    const bob = await register('social-block-bob');
    const first = await request('/social/requests', 'POST', { targetUserId: bob.userId }, alice);
    const { item } = await first.json() as { item: { id: string } };
    await request(`/social/requests/${item.id}/accept`, 'POST', undefined, bob);

    expect((await request('/social/blocks', 'POST', { targetUserId: bob.userId }, alice)).status).toBe(201);
    // amizade sumiu para os dois lados.
    const aliceFriends = await (await request('/social/friends', 'GET', undefined, alice)).json() as { items: unknown[] };
    expect(aliceFriends.items).toHaveLength(0);
    const bobFriends = await (await request('/social/friends', 'GET', undefined, bob)).json() as { items: unknown[] };
    expect(bobFriends.items).toHaveLength(0);

    // Bloqueado não consegue pedir de novo — nem quem bloqueou, nem quem foi bloqueado.
    expect((await request('/social/requests', 'POST', { targetUserId: alice.userId }, bob)).status).toBe(409);
    expect((await request('/social/requests', 'POST', { targetUserId: bob.userId }, alice)).status).toBe(409);
    // bloqueio duplicado.
    expect((await request('/social/blocks', 'POST', { targetUserId: bob.userId }, alice)).status).toBe(409);
    // só quem bloqueou pode desbloquear — bob tentando "desbloquear" a si mesmo na lista de alice não existe pra ele.
    expect((await request(`/social/blocks/${alice.userId}`, 'DELETE', undefined, bob)).status).toBe(404);

    expect((await request(`/social/blocks/${bob.userId}`, 'DELETE', undefined, alice)).status).toBe(204);
    const secondRequest = await request('/social/requests', 'POST', { targetUserId: bob.userId }, alice);
    expect(secondRequest.status).toBe(201);
  });

  it('notificações são owner-only e "marcar todas como lidas" não afeta outra conta', async () => {
    const alice = await register('social-notif-alice');
    const bob = await register('social-notif-bob');
    const carol = await register('social-notif-carol');
    await request('/social/requests', 'POST', { targetUserId: bob.userId }, alice);

    const bobNotifications = await (await request('/social/notifications', 'GET', undefined, bob)).json() as { items: Array<{ id: string }> };
    expect(bobNotifications.items.length).toBeGreaterThan(0);
    const notificationId = bobNotifications.items[0].id;
    // Carol não pode marcar a notificação de bob como lida.
    expect((await request(`/social/notifications/${notificationId}/read`, 'POST', undefined, carol)).status).toBe(404);
    expect((await request(`/social/notifications/${notificationId}/read`, 'POST', undefined, bob)).status).toBe(200);

    await request('/social/notifications/read-all', 'POST', undefined, carol);
    const bobAfterCarolReadAll = await (await request('/social/notifications', 'GET', undefined, bob)).json() as { items: Array<{ readAt: string | null }> };
    expect(bobAfterCarolReadAll.items[0].readAt).not.toBeNull();
  });
});
