// LIB-004: busca externa (Open Library) + confirmação (create com provenance/
// external IDs). Upstream sempre mockado (`vi.stubGlobal('fetch', ...)`) —
// nunca depende da Open Library real em CI (seção 31 do pedido). Testes deste
// arquivo compartilham o D1 dentro do mesmo run (só migrations são
// reaplicadas em beforeEach) — cada teste usa ISBN/external ID próprios (ver
// mesma nota em tests/integration/publication-identity.test.ts).
import { env, exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/server/types';

const worker = exports as unknown as {
  default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
};
const testEnv = env as unknown as Env;
const origin = 'https://example.com';
let requestSequence = 1;

async function request(path: string, method = 'GET', body?: unknown, cookie?: string, csrf?: string) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `198.51.100.${requestSequence++ % 250}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function register(name: string) {
  const response = await request('/auth/register', 'POST', { email: `${name}@example.com`, displayName: name, password: 'esta e uma senha longa 2026' });
  expect(response.status).toBe(201);
  const cookies = response.headers.get('set-cookie') ?? '';
  const session = cookies.match(/rpg_session=([^;,]+)/)?.[1];
  const csrf = cookies.match(/rpg_csrf=([^;,]+)/)?.[1];
  const body = await response.json() as { user: { id: string } };
  if (!session || !csrf) throw new Error('Cookies de autenticação ausentes.');
  return { userId: body.user.id, cookie: `rpg_session=${session}; rpg_csrf=${csrf}`, csrf };
}

// A Response precisa ser criada DENTRO do callback do mock, não antes — Workers
// proíbe "I/O de um handler de request sendo acessado por outro" (streams de
// Response/Request só podem ser usados no mesmo contexto de request em que
// foram criados). `mockImplementation` garante que a Response só existe quando
// `fetch()` é de fato chamado, dentro do request real do teste.
function mockUpstream(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))));
}

afterEach(() => { vi.unstubAllGlobals(); });

const base = {
  categoryId: null, subgenreId: null, readingStatus: 'NOT_STARTED', hasPlayed: false, wantsToPlay: false, priority: 'NONE',
  playGroupNotes: '', playGroupId: null, plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '', notes: '',
  coverUrl: null, coverSourceUrl: null, coverSourceNote: null,
};

describe('LIB-004: GET /rpgs/search-external', () => {
  it('exige autenticação', async () => {
    expect((await request('/rpgs/search-external?q=alien')).status).toBe(401);
  });

  it('rejeita query curta demais', async () => {
    const a = await register('search-short-query');
    expect((await request('/rpgs/search-external?q=a', 'GET', undefined, a.cookie)).status).toBe(422);
  });

  it('busca textual: mapeia resultados da Open Library', async () => {
    const a = await register('search-title');
    mockUpstream({ docs: [{ key: '/works/OL1W', title: 'Alien RPG', author_name: ['Free League'], first_publish_year: 2019, publisher: ['Free League Publishing'], isbn: ['9789188805553'], edition_key: ['OL1M'] }] });
    const response = await request('/rpgs/search-external?q=alien+rpg', 'GET', undefined, a.cookie);
    expect(response.status).toBe(200);
    const body = await response.json() as { results: Array<{ title: string; workId: string; editionId: string; isbn13: string }> };
    expect(body.results).toEqual([expect.objectContaining({ title: 'Alien RPG', workId: 'OL1W', editionId: 'OL1M', isbn13: '9789188805553' })]);
  });

  it('detecta ISBN na query e faz lookup exato (não busca textual)', async () => {
    const a = await register('search-isbn');
    mockUpstream({ key: '/books/OL2M', title: 'Livro por ISBN', works: [{ key: '/works/OL2W' }], isbn_13: ['9783161484100'] });
    const response = await request('/rpgs/search-external?q=978-3-16-148410-0', 'GET', undefined, a.cookie);
    expect(response.status).toBe(200);
    const body = await response.json() as { results: Array<{ title: string; editionId: string }> };
    expect(body.results).toEqual([expect.objectContaining({ title: 'Livro por ISBN', editionId: 'OL2M' })]);
  });

  it('timeout do provider retorna 502 com mensagem amigável, sem derrubar a Biblioteca', async () => {
    const a = await register('search-timeout');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' })));
    const response = await request('/rpgs/search-external?q=timeout+test', 'GET', undefined, a.cookie);
    expect(response.status).toBe(502);
    const errorBody = await response.json() as { error: { code: string; message: string } };
    expect(errorBody.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(errorBody.error.message).toContain('cadastrar o livro manualmente');
  });

  it('erro 5xx do provider retorna 502', async () => {
    const a = await register('search-5xx');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('boom', { status: 503 }))));
    expect((await request('/rpgs/search-external?q=provider+error', 'GET', undefined, a.cookie)).status).toBe(502);
  });

  it('resposta malformada (não-JSON) retorna 502', async () => {
    const a = await register('search-malformed');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('<html></html>', { status: 200 }))));
    expect((await request('/rpgs/search-external?q=malformed', 'GET', undefined, a.cookie)).status).toBe(502);
  });

  it('rate limit local: bloqueia após muitas buscas seguidas', async () => {
    const a = await register('search-rate-limit');
    mockUpstream({ docs: [] });
    let lastStatus = 200;
    for (let i = 0; i < 35; i += 1) lastStatus = (await request(`/rpgs/search-external?q=busca${i}`, 'GET', undefined, a.cookie)).status;
    expect(lastStatus).toBe(429);
  });
});

describe('LIB-004: confirmar resultado de busca (POST /rpgs com provenance)', () => {
  it('cria Publication com metadata rica + external IDs + provenance', async () => {
    const a = await register('confirm-create');
    const payload = {
      ...base, title: 'Alien RPG', isbn: '9789188805553', subtitle: 'Core Rulebook', publisher: 'Free League Publishing',
      publicationYear: 2019, language: 'eng', authors: 'Free League', publicationType: 'CORE_RULEBOOK',
      coverUrl: 'https://covers.openlibrary.org/b/id/12345-L.jpg',
      metadataSource: 'OPEN_LIBRARY', metadataSourceId: 'OL1M', metadataSourceUrl: 'https://openlibrary.org/books/OL1M',
      metadataFetchedAt: new Date().toISOString(), externalWorkId: 'OL1W', externalEditionId: 'OL1M',
    };
    const created = await request('/rpgs', 'POST', payload, a.cookie, a.csrf);
    expect(created.status).toBe(201);
    const item = ((await created.json()) as { item: { id: string; subtitle: string; authors: string; publisher: string; publicationYear: number; language: string; metadataSource: string } }).item;
    expect(item).toMatchObject({ subtitle: 'Core Rulebook', authors: 'Free League', publisher: 'Free League Publishing', publicationYear: 2019, language: 'eng', metadataSource: 'OPEN_LIBRARY' });

    const row = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(item.id).first<{ publication_id: string }>();
    const externalIds = await testEnv.DB.prepare('SELECT provider,external_id,external_type FROM publication_external_ids WHERE publication_id=? ORDER BY external_type').bind(row!.publication_id).all();
    expect(externalIds.results).toEqual([
      { provider: 'OPEN_LIBRARY', external_id: 'OL1M', external_type: 'EDITION' },
      { provider: 'OPEN_LIBRARY', external_id: 'OL1W', external_type: 'WORK' },
    ]);
  });

  it('cadastro manual continua sem provenance (metadataSource=MANUAL, sem external IDs)', async () => {
    const a = await register('confirm-manual');
    const created = await request('/rpgs', 'POST', { ...base, title: 'RPG Manual' }, a.cookie, a.csrf);
    const item = ((await created.json()) as { item: { id: string; metadataSource: string } }).item;
    expect(item.metadataSource).toBe('MANUAL');
    const row = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(item.id).first<{ publication_id: string }>();
    const count = await testEnv.DB.prepare('SELECT COUNT(*) total FROM publication_external_ids WHERE publication_id=?').bind(row!.publication_id).first<{ total: number }>();
    expect(count?.total).toBe(0);
  });

  it('dedup por external Edition ID: segunda conta reaproveita a Publication mesmo sem ISBN em comum', async () => {
    const editionId = 'OL999M';
    const a = await register('confirm-dedup-a');
    const b = await register('confirm-dedup-b');
    const payloadA = { ...base, title: 'Kult Divinity Lost', isbn: '9789127432475', metadataSource: 'OPEN_LIBRARY', externalEditionId: editionId, externalWorkId: 'OL999W' };
    const createdA = await request('/rpgs', 'POST', payloadA, a.cookie, a.csrf);
    expect(createdA.status).toBe(201);
    const itemA = ((await createdA.json()) as { item: { id: string } }).item;
    // B seleciona o MESMO resultado (mesma Edition), mas digitou o ISBN vazio no formulário —
    // a identidade por external ID ainda resolve para a mesma Publication (seção 17 do pedido).
    const payloadB = { ...base, title: 'Kult (outra grafia)', isbn: null, metadataSource: 'OPEN_LIBRARY', externalEditionId: editionId, externalWorkId: 'OL999W' };
    const createdB = await request('/rpgs', 'POST', payloadB, b.cookie, b.csrf);
    expect(createdB.status).toBe(201);
    const itemB = ((await createdB.json()) as { item: { id: string; title: string } }).item;
    expect(itemB.title).toBe('Kult Divinity Lost');

    const rowA = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(itemA.id).first<{ publication_id: string }>();
    const rowB = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(itemB.id).first<{ publication_id: string }>();
    expect(rowA?.publication_id).toBe(rowB?.publication_id);
  });

  it('ALREADY_IN_LIBRARY também se aplica a resultado de busca já adicionado', async () => {
    const a = await register('confirm-already');
    const payload = { ...base, title: 'Mörk Borg', isbn: '9781910132753', metadataSource: 'OPEN_LIBRARY', externalEditionId: 'OL777M' };
    expect((await request('/rpgs', 'POST', payload, a.cookie, a.csrf)).status).toBe(201);
    const again = await request('/rpgs', 'POST', { ...payload, title: 'Mörk Borg (de novo)' }, a.cookie, a.csrf);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe('ALREADY_IN_LIBRARY');
  });
});
