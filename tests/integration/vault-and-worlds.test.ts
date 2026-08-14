import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/server/types';
import { ENTITY_TYPES } from '../../src/domain/content/types';

const worker = exports as unknown as {
  default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
};
const testEnv = env as unknown as Env;
const origin = 'https://example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `198.51.100.${requestSequence++ % 250}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { Origin: origin } : {}),
      ...(account ? { Cookie: account.cookie, 'X-CSRF-Token': account.csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

interface Account { userId: string; cookie: string; csrf: string }

async function register(name: string): Promise<Account> {
  const response = await request('/auth/register', 'POST', {
    email: `${name}@example.com`, displayName: name, password,
  });
  expect(response.status).toBe(201);
  const cookies = response.headers.get('set-cookie') ?? '';
  const session = cookies.match(/rpg_session=([^;,]+)/)?.[1];
  const csrf = cookies.match(/rpg_csrf=([^;,]+)/)?.[1];
  const body = await response.json() as { user: { id: string } };
  if (!session || !csrf) throw new Error('Cookies de autenticação ausentes.');
  return { userId: body.user.id, cookie: `rpg_session=${session}; rpg_csrf=${csrf}`, csrf };
}

const entity = (name: string, visibility = 'PRIVATE', extra: Record<string, unknown> = {}) => ({
  entityType: 'NPC', name, summary: '', description: '', visibility,
  worldId: null, groupId: null, parentEntityId: null, adventure: null, ...extra,
});

async function createRpg(account: Account) {
  const response = await request('/rpgs', 'POST', {
    title: 'Blue Rose', categoryId: 'fantasia', subgenreId: 'alta-fantasia', readingStatus: 'READING',
    hasPlayed: false, wantsToPlay: true, priority: 'HIGH', playGroupNotes: '', playGroupId: null,
    plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '', notes: '', coverUrl: null,
  }, account);
  expect(response.status).toBe(201);
  return (await response.json() as { item: { id: string } }).item.id;
}

async function createGroup(account: Account, members: Array<{ account: Account; isGameMaster: boolean }>) {
  const response = await request('/groups', 'POST', { name: 'Mesa principal', notes: '' }, account);
  expect(response.status).toBe(201);
  const groupId = (await response.json() as { item: { id: string } }).item.id;
  for (const member of members) {
    const memberResponse = await request(`/groups/${groupId}/members`, 'POST', {
      playerName: 'substituído pela conta', userId: member.account.userId, notes: '', active: true,
      isGameMaster: member.isGameMaster,
    }, account);
    expect(memberResponse.status).toBe(201);
  }
  return groupId;
}

async function createCampaign(account: Account, rpgId: string, playGroupId: string) {
  const response = await request('/campaigns', 'POST', {
    rpgId, name: 'Campanha V2', status: 'IN_PROGRESS', gameMaster: '', playGroupId,
    adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: 'WEEKLY',
    nextSessionDate: null, sessionGoal: 8, legacyMembersText: '', legacyCharactersText: '', notes: '',
  }, account);
  expect(response.status).toBe(201);
  return (await response.json() as { item: { id: string } }).item.id;
}

async function createEntity(account: Account, input: ReturnType<typeof entity>) {
  const response = await request('/vault', 'POST', input, account);
  expect(response.status).toBe(201);
  return (await response.json() as { id: string }).id;
}

describe('Worlds, Vault e permissões V2', () => {
  it('protege entidade privada, mutações IDOR, mass assignment e filtros', async () => {
    const owner = await register('vault-owner');
    const outsider = await register('vault-outsider');
    const entityId = await createEntity(owner, entity('Segredo'));

    expect((await request(`/vault/${entityId}`, 'GET', undefined, outsider)).status).toBe(404);
    expect((await request(`/vault/${entityId}/archive`, 'POST', {}, outsider)).status).toBe(404);
    expect((await request(`/vault/${entityId}/restore`, 'POST', {}, outsider)).status).toBe(404);
    expect((await request(`/vault/${entityId}`, 'DELETE', undefined, outsider)).status).toBe(404);
    expect((await request('/vault', 'POST', { ...entity('Injetada'), ownerUserId: outsider.userId }, owner)).status).toBe(422);
    expect((await request('/vault?sort=name%20DESC%3BDELETE%20FROM%20users', 'GET', undefined, owner)).status).toBe(422);
    expect((await request('/vault?type=NOT_REAL', 'GET', undefined, owner)).status).toBe(422);
    expect((await request('/vault?search=%25%27%20OR%201%3D1--', 'GET', undefined, owner)).status).toBe(200);
  });

  it('aceita os onze tipos V2 sem antecipar fichas ou tabelas específicas', async () => {
    const owner = await register('all-types-owner');
    for (const entityType of ENTITY_TYPES) {
      const input = entity(`Entidade ${entityType}`, 'PRIVATE', {
        entityType,
        adventure: entityType === 'ADVENTURE'
          ? { adventureType: 'ONE_SHOT', recommendedSessions: 1, notes: '' }
          : null,
      });
      await createEntity(owner, input);
    }
    const list = await request('/vault?pageSize=50', 'GET', undefined, owner);
    expect(list.status).toBe(200);
    expect((await list.json() as { items: unknown[] }).items).toHaveLength(ENTITY_TYPES.length);
  });

  it('pagina Worlds e expõe as campanhas vinculadas ao grupo', async () => {
    const owner = await register('context-navigation-owner');
    for (let index = 1; index <= 13; index += 1) {
      expect((await request('/worlds', 'POST', {
        name: `World ${String(index).padStart(2, '0')}`, description: '', defaultRpgId: null, visibility: 'PRIVATE',
      }, owner)).status).toBe(201);
    }
    const secondPage = await request('/worlds?page=2&pageSize=12&sort=name', 'GET', undefined, owner);
    expect(secondPage.status).toBe(200);
    const worlds = await secondPage.json() as { items:Array<{name:string}>;pagination:{page:number;pageSize:number;total:number} };
    expect(worlds.pagination).toEqual({ page: 2, pageSize: 12, total: 13 });
    expect(worlds.items.map((world) => world.name)).toEqual(['World 13']);

    const groupId = await createGroup(owner, []);
    const campaignId = await createCampaign(owner, await createRpg(owner), groupId);
    const group = await request(`/groups/${groupId}`, 'GET', undefined, owner);
    expect(group.status).toBe(200);
    expect((await group.json() as { campaigns:Array<{id:string;name:string;rpgTitle:string}> }).campaigns)
      .toEqual([{ id: campaignId, name: 'Campanha V2', rpgTitle: 'Blue Rose', status: 'IN_PROGRESS' }]);
  });

  it('bloqueia IDOR de World, worldId alheio e vínculo cross-user', async () => {
    const owner = await register('world-owner');
    const outsider = await register('world-attacker');
    const worldResponse = await request('/worlds', 'POST', {
      name: 'World privado', description: '', defaultRpgId: null, visibility: 'PRIVATE',
    }, owner);
    const worldId = (await worldResponse.json() as { item: { id: string } }).item.id;
    expect((await request(`/worlds/${worldId}`, 'GET', undefined, outsider)).status).toBe(404);
    expect((await request(`/worlds/${worldId}`, 'PATCH', {
      name: 'Invadido', description: '', defaultRpgId: null, visibility: 'PRIVATE',
    }, outsider)).status).toBe(404);
    expect((await request(`/worlds/${worldId}/archive`, 'POST', {}, outsider)).status).toBe(404);
    expect((await request(`/worlds/${worldId}`, 'DELETE', undefined, outsider)).status).toBe(404);
    expect((await request('/vault', 'POST', entity('World manipulado', 'PRIVATE', { worldId }), outsider)).status).toBe(422);
    expect((await request('/vault', 'POST', entity('Enum inválido', 'PUBLIC'), outsider)).status).toBe(422);
    expect((await request('/vault', 'POST', entity('Payload grande', 'PRIVATE', { description: 'x'.repeat(20_001) }), outsider)).status).toBe(422);

    const ownerEntityId = await createEntity(owner, entity('Não vinculável'));
    const outsiderCampaignId = await createCampaign(outsider, await createRpg(outsider), await createGroup(outsider, []));
    expect((await request(`/campaigns/${outsiderCampaignId}/entities/${ownerEntityId}`, 'POST', { usageType: 'ACTIVE' }, outsider)).status).toBe(404);
    expect((await request(`/worlds/${worldId}/members`, 'POST', { userId: outsider.userId, role: 'OWNER' }, owner)).status).toBe(422);
  });

  it('aplica GROUP, CAMPAIGN, PLAYERS e GM_ONLY sem permitir impersonação', async () => {
    const owner = await register('permission-owner');
    const player = await register('permission-player');
    const gameMaster = await register('permission-gm');
    const outsider = await register('permission-outsider');
    const groupId = await createGroup(owner, [
      { account: player, isGameMaster: false },
      { account: gameMaster, isGameMaster: true },
    ]);
    const campaignId = await createCampaign(owner, await createRpg(owner), groupId);

    const groupEntityId = await createEntity(owner, entity('Do grupo', 'GROUP', { groupId }));
    expect((await request(`/vault/${groupEntityId}`, 'GET', undefined, player)).status).toBe(200);
    expect((await request(`/vault/${groupEntityId}`, 'GET', undefined, outsider)).status).toBe(404);

    for (const [visibility, playerStatus, gmStatus] of [
      ['CAMPAIGN', 200, 200], ['PLAYERS', 200, 200], ['GM_ONLY', 404, 200],
    ] as const) {
      const entityId = await createEntity(owner, entity(`${visibility} entity`, visibility));
      expect((await request(`/campaigns/${campaignId}/entities/${entityId}`, 'POST', { usageType: 'REFERENCE' }, owner)).status).toBe(201);
      expect((await request(`/vault/${entityId}`, 'GET', undefined, player)).status).toBe(playerStatus);
      expect((await request(`/vault/${entityId}`, 'GET', undefined, gameMaster)).status).toBe(gmStatus);
      expect((await request(`/vault/${entityId}`, 'GET', undefined, outsider)).status).toBe(404);
      expect((await request(`/campaigns/${campaignId}/entities/${entityId}`, 'DELETE', undefined, outsider)).status).toBe(404);
    }
  });

  it('preserva entidades ao arquivar World e ao concluir campanha, e bloqueia ciclos', async () => {
    const owner = await register('history-owner');
    const rpgId = await createRpg(owner);
    const worldResponse = await request('/worlds', 'POST', {
      name: 'Aldea', description: '', defaultRpgId: rpgId, visibility: 'PRIVATE',
    }, owner);
    expect(worldResponse.status).toBe(201);
    const worldId = (await worldResponse.json() as { item: { id: string } }).item.id;
    const parentId = await createEntity(owner, entity('Capital', 'PRIVATE', {
      entityType: 'LOCATION', worldId,
    }));
    const childId = await createEntity(owner, entity('Taverna', 'PRIVATE', {
      entityType: 'LOCATION', worldId, parentEntityId: parentId,
    }));
    expect((await request(`/vault/${parentId}`, 'PATCH', entity('Capital', 'PRIVATE', {
      entityType: 'LOCATION', worldId, parentEntityId: childId,
    }), owner)).status).toBe(422);

    expect((await request(`/worlds/${worldId}/archive`, 'POST', {}, owner)).status).toBe(200);
    expect((await request(`/vault/${childId}`, 'GET', undefined, owner)).status).toBe(200);
    expect((await request(`/worlds/${worldId}`, 'DELETE', undefined, owner)).status).toBe(409);

    const groupId = await createGroup(owner, []);
    const campaignId = await createCampaign(owner, rpgId, groupId);
    expect((await request(`/campaigns/${campaignId}/entities/${childId}`, 'POST', { usageType: 'ACTIVE' }, owner)).status).toBe(201);
    const updateCampaign = await request(`/campaigns/${campaignId}`, 'PATCH', {
      rpgId, name: 'Campanha V2', status: 'COMPLETED', gameMaster: '', playGroupId: groupId,
      adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: 'WEEKLY',
      nextSessionDate: null, sessionGoal: 8, legacyMembersText: '', legacyCharactersText: '', notes: '',
    }, owner);
    expect(updateCampaign.status).toBe(200);
    expect((await request(`/vault/${childId}`, 'GET', undefined, owner)).status).toBe(200);
    expect((await request(`/vault/${childId}`, 'DELETE', undefined, owner)).status).toBe(409);
  });

  it('anonimiza a conta e preserva o conteúdo histórico', async () => {
    const owner = await register('deleted-owner');
    const entityId = await createEntity(owner, entity('Legado'));
    expect((await request('/auth/account', 'DELETE', {
      currentPassword: password, confirmation: 'EXCLUIR MINHA CONTA',
    }, owner)).status).toBe(200);

    const user = await testEnv.DB.prepare('SELECT email,display_name,disabled_at,deleted_at FROM users WHERE id=?')
      .bind(owner.userId).first<{ email: string; display_name: string; disabled_at: string | null; deleted_at: string | null }>();
    expect(user?.email).toMatch(/^deleted\+.*@invalid\.local$/);
    expect(user?.display_name).toBe('Conta excluída');
    expect(user?.disabled_at).not.toBeNull();
    expect(user?.deleted_at).not.toBeNull();
    expect(await testEnv.DB.prepare('SELECT id FROM vault_entities WHERE id=?').bind(entityId).first()).not.toBeNull();
    expect((await request('/auth/login', 'POST', { email: 'deleted-owner@example.com', password })).status).toBe(401);
  });

  it('convites de World: aceita, é idempotente, respeita limite de usos, expiração e revogação', async () => {
    const owner = await register('invite-owner');
    const guest = await register('invite-guest');
    const worldResponse = await request('/worlds', 'POST', {
      name: 'World Convidável', description: '', defaultRpgId: null, visibility: 'GROUP',
    }, owner);
    const worldId = (await worldResponse.json() as { item: { id: string } }).item.id;

    // Só o owner pode criar convite; visibilidade PRIVATE bloqueia.
    expect((await request(`/world-invites/${worldId}`, 'POST', { expiresInDays: 7, maxUses: 1 }, guest)).status).toBe(404);

    const created = await request(`/world-invites/${worldId}`, 'POST', { expiresInDays: 7, maxUses: 1 }, owner);
    expect(created.status).toBe(201);
    const invite = (await created.json()) as { item: { id: string; code: string } };

    // Aceitar com token inválido/malformado não vaza informação sobre convites reais.
    expect((await request('/world-invites/accept/token-invalido-qualquer', 'POST', {}, guest)).status).toBe(404);

    const accepted = await request(`/world-invites/accept/${invite.item.code}`, 'POST', {}, guest);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ world: { id: worldId, name: 'World Convidável' }, alreadyMember: false });

    // Aceitar de novo com o mesmo token é idempotente (já é membro), não conta como um novo uso.
    const acceptedAgain = await request(`/world-invites/accept/${invite.item.code}`, 'POST', {}, guest);
    expect(acceptedAgain.status).toBe(200);
    expect(await acceptedAgain.json()).toMatchObject({ alreadyMember: true });

    // maxUses=1 já foi consumido: um terceiro usuário não consegue mais usar o mesmo convite.
    const other = await register('invite-other');
    expect((await request(`/world-invites/accept/${invite.item.code}`, 'POST', {}, other)).status).toBe(404);

    // Convite revogado não pode mais ser usado.
    const revocable = await request(`/world-invites/${worldId}`, 'POST', { expiresInDays: 7, maxUses: 5 }, owner);
    const revocableInvite = (await revocable.json()) as { item: { id: string; code: string } };
    expect((await request(`/world-invites/${worldId}/${revocableInvite.item.id}`, 'DELETE', undefined, owner)).status).toBe(204);
    expect((await request(`/world-invites/accept/${revocableInvite.item.code}`, 'POST', {}, other)).status).toBe(404);

    // Convite expirado (forçado via D1) não pode mais ser usado, mesmo com uso disponível.
    const expiring = await request(`/world-invites/${worldId}`, 'POST', { expiresInDays: 7, maxUses: 5 }, owner);
    const expiringInvite = (await expiring.json()) as { item: { id: string; code: string } };
    await testEnv.DB.prepare("UPDATE world_invites SET expires_at=? WHERE id=?")
      .bind('2020-01-01T00:00:00.000Z', expiringInvite.item.id).run();
    expect((await request(`/world-invites/accept/${expiringInvite.item.code}`, 'POST', {}, other)).status).toBe(404);
  });
});
