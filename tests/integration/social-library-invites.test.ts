// F-017/F-018 (BATCH8): Biblioteca social + convites de Grupo/Campanha para amigos —
// ver src/server/routes/social.ts (seções "Biblioteca social" e "Convites").
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://social-lib.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.118.${requestSequence++ % 250}`,
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

async function befriend(a: Account, b: Account) {
  const sent = await request('/social/requests', 'POST', { targetUserId: b.userId }, a);
  const { item } = await sent.json() as { item: { id: string } };
  await request(`/social/requests/${item.id}/accept`, 'POST', undefined, b);
}

const rpgInput = (extra: Record<string, unknown> = {}) => ({ title: 'Sistema Social', categoryId: null, subgenreId: null, readingStatus: 'NOT_STARTED', hasPlayed: false, wantsToPlay: true, priority: 'HIGH', playGroupNotes: 'nota privada do grupo', playGroupId: null, plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: 'Narrador Privado', notes: 'anotação bem privada', coverUrl: null, isbn: null, ...extra });

describe('Social — Biblioteca (F-017)', () => {
  it('amigo só vê a Biblioteca depois do opt-in; nunca vê campos privados; não-amigo nunca vê', async () => {
    const owner = await register('lib-owner');
    const friend = await register('lib-friend');
    const outsider = await register('lib-outsider');
    await befriend(owner, friend);

    const createdRpg = await request('/rpgs', 'POST', rpgInput(), owner);
    expect(createdRpg.status).toBe(201);
    const rpgId = (await createdRpg.json() as { item: { id: string } }).item.id;

    // Sem opt-in ainda — amigo não vê.
    expect((await request(`/social/friends/${owner.userId}/library`, 'GET', undefined, friend)).status).toBe(404);

    const optIn = await request('/preferences/library-visibility', 'PATCH', { libraryVisibleToFriends: true }, owner);
    expect(optIn.status).toBe(200);

    const view = await request(`/social/friends/${owner.userId}/library`, 'GET', undefined, friend);
    expect(view.status).toBe(200);
    const body = await view.json() as { owner: { displayName: string }; items: Array<Record<string, unknown>> };
    expect(body.owner.displayName).toBe('lib-owner');
    const item = body.items.find((entry) => entry.id === rpgId)!;
    expect(item.title).toBe('Sistema Social');
    // Campos privados nunca aparecem.
    for (const forbidden of ['notes', 'priority', 'playGroupNotes', 'playGroupId', 'gameMaster', 'plannedPlayDate', 'wantsToPlay']) {
      expect(item, `campo privado "${forbidden}" vazou`).not.toHaveProperty(forbidden);
    }

    // Outsider (não amigo) continua sem acesso mesmo com opt-in ligado.
    expect((await request(`/social/friends/${owner.userId}/library`, 'GET', undefined, outsider)).status).toBe(404);
  });

  it('interesse social é separado do campo pessoal "Quero jogar" e só o dono pode marcar/desmarcar', async () => {
    const owner = await register('interest-owner');
    const friend = await register('interest-friend');
    const outsider = await register('interest-outsider');
    await befriend(owner, friend);
    await request('/preferences/library-visibility', 'PATCH', { libraryVisibleToFriends: true }, owner);

    const createdRpg = await request('/rpgs', 'POST', rpgInput({ wantsToPlay: false }), owner);
    const rpgId = (await createdRpg.json() as { item: { id: string } }).item.id;

    // Outsider não pode marcar interesse num RPG que não é dele (IDOR).
    expect((await request(`/social/interest/${rpgId}`, 'POST', undefined, outsider)).status).toBe(404);

    expect((await request(`/social/interest/${rpgId}`, 'POST', undefined, owner)).status).toBe(201);
    const viewAfter = await request(`/social/friends/${owner.userId}/library`, 'GET', undefined, friend);
    const itemAfter = (await viewAfter.json() as { items: Array<{ id: string; sharedInterest: boolean }> }).items.find((entry) => entry.id === rpgId)!;
    expect(itemAfter.sharedInterest).toBeTruthy();

    expect((await request(`/social/interest/${rpgId}`, 'DELETE', undefined, owner)).status).toBe(204);
    const viewFinal = await request(`/social/friends/${owner.userId}/library`, 'GET', undefined, friend);
    const itemFinal = (await viewFinal.json() as { items: Array<{ id: string; sharedInterest: boolean }> }).items.find((entry) => entry.id === rpgId)!;
    expect(itemFinal.sharedInterest).toBeFalsy();
  });

  it('RPGs em comum (mesma Publication) aparecem como inCommon; RPG arquivado não aparece', async () => {
    const owner = await register('common-owner');
    const friend = await register('common-friend');
    await befriend(owner, friend);
    await request('/preferences/library-visibility', 'PATCH', { libraryVisibleToFriends: true }, owner);

    const ownerRpg = await request('/rpgs', 'POST', rpgInput({ isbn: '9780765326355' }), owner);
    const ownerRpgId = (await ownerRpg.json() as { item: { id: string; publicationId: string | null } }).item.id;
    await request('/rpgs', 'POST', rpgInput({ title: 'Sistema Social', isbn: '9780765326355' }), friend);

    const view = await request(`/social/friends/${owner.userId}/library`, 'GET', undefined, friend);
    const item = (await view.json() as { items: Array<{ id: string; inCommon: boolean }> }).items.find((entry) => entry.id === ownerRpgId)!;
    expect(item.inCommon).toBeTruthy();

    await request(`/rpgs/${ownerRpgId}/archive`, 'POST', {}, owner);
    const viewAfterArchive = await request(`/social/friends/${owner.userId}/library`, 'GET', undefined, friend);
    const itemsAfterArchive = (await viewAfterArchive.json() as { items: Array<{ id: string }> }).items;
    expect(itemsAfterArchive.find((entry) => entry.id === ownerRpgId)).toBeUndefined();
  });
});

describe('Social — Convites de Grupo/Campanha (F-018)', () => {
  it('convidar exige ser dono do grupo E o convidado já ser amigo; aceitar cria membro vinculado; não duplica', async () => {
    const owner = await register('invite-owner');
    const friend = await register('invite-friend');
    const stranger = await register('invite-stranger');

    const group = await request('/groups', 'POST', { name: 'Mesa dos Convites', notes: '' }, owner);
    const groupId = (await group.json() as { item: { id: string } }).item.id;

    // Ainda não são amigos — convite rejeitado.
    expect((await request('/social/invites', 'POST', { inviteeUserId: friend.userId, targetType: 'GROUP', targetId: groupId }, owner)).status).toBe(422);

    await befriend(owner, friend);

    // Outsider (não dono do grupo) não pode convidar para ele.
    expect((await request('/social/invites', 'POST', { inviteeUserId: friend.userId, targetType: 'GROUP', targetId: groupId }, stranger)).status).toBe(404);

    const invite = await request('/social/invites', 'POST', { inviteeUserId: friend.userId, targetType: 'GROUP', targetId: groupId }, owner);
    expect(invite.status).toBe(201);
    const { item } = await invite.json() as { item: { id: string } };

    // Duplicado.
    expect((await request('/social/invites', 'POST', { inviteeUserId: friend.userId, targetType: 'GROUP', targetId: groupId }, owner)).status).toBe(409);

    // Só o convidado aceita.
    expect((await request(`/social/invites/${item.id}/accept`, 'POST', undefined, owner)).status).toBe(404);
    expect((await request(`/social/invites/${item.id}/accept`, 'POST', undefined, friend)).status).toBe(200);

    const groupDetail = await request(`/groups/${groupId}`, 'GET', undefined, owner);
    const members = (await groupDetail.json() as { members: Array<{ linkedUserId: string | null }> }).members;
    expect(members.some((member) => member.linkedUserId === friend.userId)).toBe(true);

    // Já é membro — convidar de novo é rejeitado.
    expect((await request('/social/invites', 'POST', { inviteeUserId: friend.userId, targetType: 'GROUP', targetId: groupId }, owner)).status).toBe(409);
  });

  it('recusar só pelo convidado; cancelar só pelo convidante; papel GM é exclusivo', async () => {
    const owner = await register('invite-gm-owner');
    const friendA = await register('invite-gm-friend-a');
    const friendB = await register('invite-gm-friend-b');
    await befriend(owner, friendA);
    await befriend(owner, friendB);

    const campaignRpg = await request('/rpgs', 'POST', rpgInput({ title: 'RPG da Campanha' }), owner);
    const rpgId = (await campaignRpg.json() as { item: { id: string } }).item.id;
    const campaign = await request('/campaigns', 'POST', { rpgId, name: 'Campanha dos Convites', status: 'PLANNING', gameMaster: 'Mestre', sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, playGroupId: null, adventureEntityId: null, legacyMembersText: '', legacyCharactersText: '', notes: '' }, owner);
    expect(campaign.status).toBe(201);
    const campaignId = (await campaign.json() as { item: { id: string } }).item.id;

    const inviteA = await request('/social/invites', 'POST', { inviteeUserId: friendA.userId, targetType: 'CAMPAIGN', targetId: campaignId, role: 'GM' }, owner);
    const { item: itemA } = await inviteA.json() as { item: { id: string } };
    expect((await request(`/social/invites/${itemA.id}/decline`, 'POST', undefined, owner)).status).toBe(404);
    expect((await request(`/social/invites/${itemA.id}/decline`, 'POST', undefined, friendA)).status).toBe(204);

    const inviteB = await request('/social/invites', 'POST', { inviteeUserId: friendB.userId, targetType: 'CAMPAIGN', targetId: campaignId, role: 'GM' }, owner);
    const { item: itemB } = await inviteB.json() as { item: { id: string } };
    expect((await request(`/social/invites/${itemB.id}`, 'DELETE', undefined, friendB)).status).toBe(404);
    expect((await request(`/social/invites/${itemB.id}`, 'DELETE', undefined, owner)).status).toBe(204);
  });
});
