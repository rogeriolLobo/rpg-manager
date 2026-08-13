import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://timeline.example.com';
const password = 'esta e uma senha longa 2026';
let sequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `198.18.0.${sequence++ % 250}`,
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
  const userId = (await response.json() as { user: { id: string } }).user.id;
  if (!session || !csrf) throw new Error('Cookies ausentes.');
  return { userId, cookie: `rpg_session=${session}; rpg_csrf=${csrf}`, csrf };
}

async function createWorld(owner: Account, name: string, visibility = 'GROUP') {
  const response = await request('/worlds', 'POST', { name, description: '', defaultRpgId: null, visibility }, owner);
  return (await response.json() as { item: { id: string } }).item.id;
}

async function createGroup(owner: Account, player: Account) {
  const response = await request('/groups', 'POST', { name: 'Cronistas', notes: '' }, owner);
  const id = (await response.json() as { item: { id: string } }).item.id;
  expect((await request(`/groups/${id}/members`, 'POST', { playerName: 'Cronista', userId: player.userId, notes: '', active: true, isGameMaster: false }, owner)).status).toBe(201);
  return id;
}

async function createEvent(owner: Account, worldId: string, groupId: string | null, name: string, visibility: string) {
  const response = await request('/vault', 'POST', {
    entityType: 'EVENT', name, summary: 'Marco histórico', description: '', visibility, worldId, groupId,
    parentEntityId: null, adventure: null, lore: null,
  }, owner);
  expect(response.status).toBe(201);
  return (await response.json() as { id: string }).id;
}

const calendar = {
  name: 'Cômputo dos Corvos',
  months: [{ name: 'Aurora', days: 30 }, { name: 'Névoa', days: 18 }],
  weekdays: ['Corvo', 'Lua', 'Cinzas'],
  cycles: [{ name: 'Lua Rubra', lengthDays: 17, offset: 2 }],
  holidays: [{ name: 'Fundação', monthIndex: 0, day: 1, description: 'Início do império' }],
};

describe('Timeline e calendário do World', () => {
  it('ordena eventos sem calendário gregoriano e aplica autorização antes de responder', async () => {
    const owner = await register('timeline-owner');
    const player = await register('timeline-player');
    const outsider = await register('timeline-outsider');
    const worldId = await createWorld(owner, 'Império das Brumas');
    const groupId = await createGroup(owner, player);
    expect((await request(`/worlds/${worldId}/members`, 'POST', { userId: player.userId }, owner)).status).toBe(201);

    const eraResponse = await request(`/timeline/worlds/${worldId}/eras`, 'POST', { name: 'Era Imperial', description: '', sortOrder: 10 }, owner);
    expect(eraResponse.status).toBe(201);
    const eraId = (await eraResponse.json() as { item: { id: string } }).item.id;
    expect((await request(`/timeline/worlds/${worldId}/calendar`, 'PUT', calendar, owner)).status).toBe(200);

    const visibleEventId = await createEvent(owner, worldId, groupId, 'Fundação da Corte', 'GROUP');
    const privateEventId = await createEvent(owner, worldId, null, 'Conspiração secreta', 'PRIVATE');
    expect((await request(`/timeline/events/${visibleEventId}`, 'PATCH', {
      historicalDate: 'Ano -40 da Era Imperial', sortKey: -40010, eraId, precision: 'DAY',
      calendarDate: { year: -40, monthIndex: 0, day: 1 }, displayText: '1 de Aurora, ano -40',
    }, owner)).status).toBe(200);
    expect((await request(`/timeline/events/${privateEventId}`, 'PATCH', {
      historicalDate: 'Depois da fundação', sortKey: -39900, eraId, precision: 'APPROXIMATE', calendarDate: null, displayText: '',
    }, owner)).status).toBe(200);

    const playerTimeline = await request(`/timeline/worlds/${worldId}`, 'GET', undefined, player);
    expect(playerTimeline.status).toBe(200);
    const playerData = await playerTimeline.json() as { events: Array<{ id: string; temporal: { calendarDate: { year: number } | null } }> };
    expect(playerData.events.map((event) => event.id)).toEqual([visibleEventId]);
    expect(playerData.events[0].temporal.calendarDate?.year).toBe(-40);
    expect((await request(`/timeline/worlds/${worldId}`, 'GET', undefined, outsider)).status).toBe(404);

    expect((await request(`/timeline/events/${visibleEventId}`, 'PATCH', {
      historicalDate: '', sortKey: 1, eraId, precision: 'DAY', calendarDate: { year: 1, monthIndex: 1, day: 19 }, displayText: '',
    }, owner)).status).toBe(422);
    expect((await request(`/timeline/eras/${eraId}`, 'DELETE', undefined, owner)).status).toBe(409);
  });

  it('bloqueia cross-world e alteração de calendário que invalide eventos', async () => {
    const owner = await register('calendar-owner');
    const firstWorldId = await createWorld(owner, 'Primeiro', 'PRIVATE');
    const secondWorldId = await createWorld(owner, 'Segundo', 'PRIVATE');
    const eraId = (await (await request(`/timeline/worlds/${secondWorldId}/eras`, 'POST', { name: 'Era Estranha', description: '', sortOrder: 0 }, owner)).json() as { item: { id: string } }).item.id;
    await request(`/timeline/worlds/${firstWorldId}/calendar`, 'PUT', calendar, owner);
    const eventId = await createEvent(owner, firstWorldId, null, 'Evento', 'PRIVATE');
    expect((await request(`/timeline/events/${eventId}`, 'PATCH', {
      historicalDate: '', sortKey: 10, eraId, precision: 'ERA', calendarDate: null, displayText: '',
    }, owner)).status).toBe(422);
    expect((await request(`/timeline/events/${eventId}`, 'PATCH', {
      historicalDate: '', sortKey: 10, eraId: null, precision: 'DAY', calendarDate: { year: 1, monthIndex: 1, day: 18 }, displayText: '',
    }, owner)).status).toBe(200);
    expect((await request(`/timeline/worlds/${firstWorldId}/calendar`, 'PUT', { ...calendar, months: [{ name: 'Aurora', days: 30 }] }, owner)).status).toBe(409);
  });
});
