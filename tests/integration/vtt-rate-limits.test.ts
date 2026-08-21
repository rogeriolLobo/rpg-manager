// BATCH23 — Seção 20-21 do pedido de finalização: proteção de Free-tier para VTT. Confirma que
// os limites configurados em wrangler.jsonc (VTT_ACTION_RATE_LIMITER, VTT_CONNECT_RATE_LIMITER)
// realmente disparam 429 quando excedidos — "criar limites reais baseados na medição", nunca só
// documentação sem aplicação.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://vtt-rate-limits.example.com';
const password = 'esta e uma senha longa 2026';
const rateLimitBurstTimeoutMs = 15_000;
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.129.${requestSequence++ % 250}`,
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

async function createCampaign(owner: Account): Promise<string> {
  const rpgResponse = await request('/rpgs', 'POST', { title: `RPG Rate Limit ${Date.now()}-${Math.random()}`, categoryId: null, subgenreId: null, readingStatus: 'READING', hasPlayed: false, wantsToPlay: true, priority: 'HIGH', playGroupNotes: '', playGroupId: null, plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '', notes: '', coverUrl: null }, owner);
  const rpgId = (await rpgResponse.json() as { item: { id: string } }).item.id;
  const campaignResponse = await request('/campaigns', 'POST', { rpgId, name: 'Campanha Rate Limit', status: 'IN_PROGRESS', sessionMode: 'CAMPAIGN', gameMaster: '', playGroupId: null, adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: '', legacyCharactersText: '', notes: '' }, owner);
  return (await campaignResponse.json() as { item: { id: string } }).item.id;
}

// O binding RateLimit do Miniflare é aproximado. Cada rajada usa uma conta nova para isolar a
// chave e mantém a asserção de 429; o timeout local cobre apenas o custo intencional de até 110
// requisições sequenciais que atravessam autenticação, D1 e o binding no worker completo.
async function runActionBurst(): Promise<boolean> {
  const owner = await register(`vtt-rl-action-${Date.now()}-${Math.random()}`);
  const campaignId = await createCampaign(owner);
  for (let attempt = 0; attempt < 110; attempt += 1) {
    const response = await request(`/vtt/${campaignId}/scenes`, 'GET', undefined, owner);
    if (response.status === 429) return true;
    expect(response.status).toBe(200);
  }
  return false;
}
async function runConnectBurst(): Promise<boolean> {
  const owner = await register(`vtt-rl-connect-${Date.now()}-${Math.random()}`);
  const campaignId = await createCampaign(owner);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await worker.default.fetch(`${origin}/api/v1/vtt/${campaignId}/realtime`, {
      headers: { Upgrade: 'websocket', Cookie: owner.cookie, 'CF-Connecting-IP': `203.0.129.${requestSequence++ % 250}` },
    });
    if (response.status === 429) return true;
    expect(response.status).toBe(101);
    response.webSocket?.accept();
    response.webSocket?.close();
  }
  return false;
}

describe('BATCH23 — proteção de Free-tier: rate limits reais de VTT', () => {
  it('VTT_ACTION_RATE_LIMITER: acima do limite configurado, o servidor responde 429 (nunca deixa a cota estourar silenciosamente)', async () => {
    // O limite (wrangler.jsonc, VTT_ACTION_RATE_LIMITER) é 90/60s — 110 chamadas rápidas devem
    // cruzar o teto dentro da mesma janela. Até 3 rajadas com contas novas a cada tentativa.
    let sawRateLimited = await runActionBurst();
    if (!sawRateLimited) sawRateLimited = await runActionBurst();
    if (!sawRateLimited) sawRateLimited = await runActionBurst();
    expect(sawRateLimited).toBe(true);
  }, rateLimitBurstTimeoutMs);

  it('VTT_CONNECT_RATE_LIMITER: tentativas de upgrade WebSocket acima do limite recebem 429, nunca abrem o socket', async () => {
    // O limite (wrangler.jsonc, VTT_CONNECT_RATE_LIMITER) é 20/60s.
    let sawRateLimited = await runConnectBurst();
    if (!sawRateLimited) sawRateLimited = await runConnectBurst();
    if (!sawRateLimited) sawRateLimited = await runConnectBurst();
    expect(sawRateLimited).toBe(true);
  }, rateLimitBurstTimeoutMs);
});
