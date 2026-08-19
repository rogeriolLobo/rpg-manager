// F-024 (BATCH13): One-Shots como especialização explícita de Campaign — ver
// src/server/routes/campaigns.ts (sessionMode).
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://campaign-session-mode.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.121.${requestSequence++ % 250}`,
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

const campaignInput = (rpgId: string, extra: Record<string, unknown> = {}) => ({
  rpgId, name: 'Mesa', status: 'PLANNING', gameMaster: '', playGroupId: null,
  adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null,
  nextSessionDate: null, sessionGoal: null, legacyMembersText: '', legacyCharactersText: '', notes: '', ...extra,
});

describe('Campaign — One-Shot explícito (F-024)', () => {
  it('sessionMode default é CAMPAIGN quando omitido; ONE_SHOT é aceito e refletido no GET', async () => {
    const owner = await register('session-mode-owner');
    const rpgId = await createRpg(owner);

    const defaultResponse = await request('/campaigns', 'POST', campaignInput(rpgId, { name: 'Campanha Padrão' }), owner);
    expect(defaultResponse.status).toBe(201);
    expect((await defaultResponse.json() as { item: { sessionMode: string } }).item.sessionMode).toBe('CAMPAIGN');

    const oneShotResponse = await request('/campaigns', 'POST', campaignInput(rpgId, { name: 'Mesa Única', sessionMode: 'ONE_SHOT' }), owner);
    expect(oneShotResponse.status).toBe(201);
    const oneShotBody = await oneShotResponse.json() as { item: { id: string; sessionMode: string } };
    expect(oneShotBody.item.sessionMode).toBe('ONE_SHOT');
    const read = await request(`/campaigns/${oneShotBody.item.id}`, 'GET', undefined, owner);
    expect(read.status).toBe(200);
    expect((await read.json() as { item: { sessionMode: string } }).item.sessionMode).toBe('ONE_SHOT');
  });

  it('rejeita sessionMode inválido; filtro ?sessionMode= só retorna o formato pedido; PATCH atualiza o formato', async () => {
    const owner = await register('session-mode-owner-2');
    const rpgId = await createRpg(owner);

    expect((await request('/campaigns', 'POST', campaignInput(rpgId, { sessionMode: 'INVALIDO' }), owner)).status).toBe(422);

    const campaignId = await (await request('/campaigns', 'POST', campaignInput(rpgId, { name: 'Vira One-Shot' }), owner)).json().then((body) => (body as { item: { id: string } }).item.id);
    const oneShotId = await (await request('/campaigns', 'POST', campaignInput(rpgId, { name: 'Já é One-Shot', sessionMode: 'ONE_SHOT' }), owner)).json().then((body) => (body as { item: { id: string } }).item.id);

    expect((await request('/campaigns?sessionMode=INVALIDO', 'GET', undefined, owner)).status).toBe(422);
    const oneShots = await request('/campaigns?sessionMode=ONE_SHOT', 'GET', undefined, owner);
    const oneShotIds = (await oneShots.json() as { items: Array<{ id: string }> }).items.map((item) => item.id);
    expect(oneShotIds).toContain(oneShotId);
    expect(oneShotIds).not.toContain(campaignId);

    const patch = await request(`/campaigns/${campaignId}`, 'PATCH', campaignInput(rpgId, { name: 'Vira One-Shot', sessionMode: 'ONE_SHOT' }), owner);
    expect(patch.status).toBe(200);
    expect((await patch.json() as { item: { sessionMode: string } }).item.sessionMode).toBe('ONE_SHOT');
  });
});
