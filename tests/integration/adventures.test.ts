// F-025 (BATCH13): Adventures aprofundadas — acts/scenes/encounters/handouts — ver
// src/server/routes/adventures.ts.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://adventures.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.122.${requestSequence++ % 250}`,
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

const entity = (name: string, extra: Record<string, unknown> = {}) => ({
  entityType: 'ADVENTURE', name, summary: '', description: '', visibility: 'PRIVATE',
  worldId: null, groupId: null, parentEntityId: null,
  adventure: { adventureType: 'ONE_SHOT', recommendedSessions: null, notes: '', premise: '', hooks: '', keyScenes: '', rewards: '' },
  ...extra,
});

async function createEntity(account: Account, extra: Record<string, unknown> = {}): Promise<string> {
  const response = await request('/vault', 'POST', entity('Aventura', extra), account);
  expect(response.status).toBe(201);
  return (await response.json() as { id: string }).id;
}

const sceneInput = (extra: Record<string, unknown> = {}) => ({ act: 'Ato 1', title: 'Cena', summary: '', readAloud: '', gmNotes: '', completed: false, sortOrder: 0, ...extra });
const encounterInput = (extra: Record<string, unknown> = {}) => ({ name: 'Encontro', difficulty: '', description: '', gmNotes: '', sortOrder: 0, ...extra });

describe('Adventures aprofundadas — scenes/encounters/entities (F-025)', () => {
  it('cria cena e encontro, vincula entidade do Vault sem duplicar, e GET agregado reflete tudo', async () => {
    const owner = await register('adv-owner');
    const adventureId = await createEntity(owner);
    const npcResponse = await request('/vault', 'POST', { entityType: 'NPC', name: 'Vilão', summary: '', description: '', visibility: 'PRIVATE', worldId: null, groupId: null, parentEntityId: null, adventure: null }, owner);
    expect(npcResponse.status).toBe(201);
    const npcId = (await npcResponse.json() as { id: string }).id;

    const sceneResponse = await request(`/adventures/${adventureId}/scenes`, 'POST', sceneInput(), owner);
    expect(sceneResponse.status).toBe(201);
    const sceneId = (await sceneResponse.json() as { id: string }).id;

    const encounterResponse = await request(`/adventures/${adventureId}/scenes/${sceneId}/encounters`, 'POST', encounterInput(), owner);
    expect(encounterResponse.status).toBe(201);

    expect((await request(`/adventures/${adventureId}/scenes/${sceneId}/entities`, 'POST', { entityId: npcId, role: 'Antagonista' }, owner)).status).toBe(201);

    const read = await request(`/adventures/${adventureId}`, 'GET', undefined, owner);
    expect(read.status).toBe(200);
    const body = await read.json() as { scenes: Array<{ id: string; title: string; encounters: Array<{ name: string }>; entities: Array<{ entityId: string; role: string }> }> };
    expect(body.scenes).toHaveLength(1);
    expect(body.scenes[0].encounters.map((encounterItem) => encounterItem.name)).toContain('Encontro');
    expect(body.scenes[0].entities).toMatchObject([{ entityId: npcId, role: 'Antagonista' }]);

    // A entidade NPC continua existindo e completa como sempre — nunca duplicada.
    expect((await request(`/vault/${npcId}`, 'GET', undefined, owner)).status).toBe(200);
  });

  it('só o dono da Adventure pode escrever (404, IDOR); rejeita vincular entidade de outro dono; entity_type é validado', async () => {
    const owner = await register('adv-owner-2');
    const outsider = await register('adv-outsider-2');
    const adventureId = await createEntity(owner);
    const sceneId = (await (await request(`/adventures/${adventureId}/scenes`, 'POST', sceneInput(), owner)).json() as { id: string }).id;

    expect((await request(`/adventures/${adventureId}/scenes`, 'POST', sceneInput(), outsider)).status).toBe(404);
    expect((await request(`/adventures/${adventureId}/scenes/${sceneId}`, 'PATCH', sceneInput({ title: 'Invadida' }), outsider)).status).toBe(404);
    expect((await request(`/adventures/${adventureId}`, 'GET', undefined, outsider)).status).toBe(404);

    // Entidade de outro dono nunca pode ser vinculada.
    const outsiderNpcId = await (async () => {
      const response = await request('/vault', 'POST', { entityType: 'NPC', name: 'NPC do outsider', summary: '', description: '', visibility: 'PRIVATE', worldId: null, groupId: null, parentEntityId: null, adventure: null }, outsider);
      return (await response.json() as { id: string }).id;
    })();
    expect((await request(`/adventures/${adventureId}/scenes/${sceneId}/entities`, 'POST', { entityId: outsiderNpcId, role: '' }, owner)).status).toBe(404);

    // Só entidades do tipo ADVENTURE têm estrutura de cenas.
    const npcId = await createEntity(owner, { entityType: 'NPC', adventure: null });
    expect((await request(`/adventures/${npcId}/scenes`, 'POST', sceneInput(), owner)).status).toBe(422);
  });

  it('excluir uma cena remove seus encontros e vínculos (cascade), mas nunca a entidade vinculada', async () => {
    const owner = await register('adv-owner-3');
    const adventureId = await createEntity(owner);
    const npcId = await createEntity(owner, { entityType: 'NPC', adventure: null });
    const sceneId = (await (await request(`/adventures/${adventureId}/scenes`, 'POST', sceneInput(), owner)).json() as { id: string }).id;
    await request(`/adventures/${adventureId}/scenes/${sceneId}/encounters`, 'POST', encounterInput(), owner);
    await request(`/adventures/${adventureId}/scenes/${sceneId}/entities`, 'POST', { entityId: npcId, role: '' }, owner);

    expect((await request(`/adventures/${adventureId}/scenes/${sceneId}`, 'DELETE', undefined, owner)).status).toBe(204);
    const read = await request(`/adventures/${adventureId}`, 'GET', undefined, owner);
    expect((await read.json() as { scenes: unknown[] }).scenes).toHaveLength(0);
    expect((await request(`/vault/${npcId}`, 'GET', undefined, owner)).status).toBe(200);
  });
});

describe('Adventures aprofundadas — handouts (F-025)', () => {
  it('cria handout de texto livre, opcionalmente ligado a uma cena; alterna revelado', async () => {
    const owner = await register('adv-handout-owner');
    const adventureId = await createEntity(owner);
    const sceneId = (await (await request(`/adventures/${adventureId}/scenes`, 'POST', sceneInput(), owner)).json() as { id: string }).id;

    const created = await request(`/adventures/${adventureId}/handouts`, 'POST', { title: 'Carta misteriosa', content: 'Prezado aventureiro...', sceneId, externalResourceId: null, revealed: false, sortOrder: 0 }, owner);
    expect(created.status).toBe(201);
    const handoutId = (await created.json() as { id: string }).id;

    const patch = await request(`/adventures/${adventureId}/handouts/${handoutId}`, 'PATCH', { title: 'Carta misteriosa', content: 'Prezado aventureiro...', sceneId, externalResourceId: null, revealed: true, sortOrder: 0 }, owner);
    expect(patch.status).toBe(200);
    const read = await request(`/adventures/${adventureId}`, 'GET', undefined, owner);
    const body = await read.json() as { handouts: Array<{ id: string; revealed: boolean; sceneId: string | null }> };
    expect(body.handouts.find((handout) => handout.id === handoutId)).toMatchObject({ revealed: true, sceneId });
  });

  it('rejeita cena inválida e recurso externo de outro World/inexistente; recurso externo exige Adventure com World', async () => {
    const owner = await register('adv-handout-owner-2');
    const adventureNoWorld = await createEntity(owner);
    expect((await request(`/adventures/${adventureNoWorld}/handouts`, 'POST', { title: 'X', content: '', sceneId: 'inexistente', externalResourceId: null, revealed: false, sortOrder: 0 }, owner)).status).toBe(422);
    expect((await request(`/adventures/${adventureNoWorld}/handouts`, 'POST', { title: 'X', content: '', sceneId: null, externalResourceId: 'recurso-inexistente', revealed: false, sortOrder: 0 }, owner)).status).toBe(422);

    // Excluir handout de outro dono é 404.
    const outsider = await register('adv-handout-outsider-2');
    const created = await request(`/adventures/${adventureNoWorld}/handouts`, 'POST', { title: 'X', content: '', sceneId: null, externalResourceId: null, revealed: false, sortOrder: 0 }, owner);
    const handoutId = (await created.json() as { id: string }).id;
    expect((await request(`/adventures/${adventureNoWorld}/handouts/${handoutId}`, 'DELETE', undefined, outsider)).status).toBe(404);
    expect((await request(`/adventures/${adventureNoWorld}/handouts/${handoutId}`, 'DELETE', undefined, owner)).status).toBe(204);
  });
});
