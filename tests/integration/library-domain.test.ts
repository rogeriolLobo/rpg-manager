// LIB-002: normalização do domínio da Biblioteca (Game System + Publication +
// User Library Entry). Cobre o que auth-and-isolation.test.ts não cobre: a forma
// física das 3 tabelas, o split metadata/estado pessoal no PATCH, o import
// criando pelo mesmo caminho canônico do cadastro manual, e o backfill de dados
// legados (ver docs/library/LIBRARY_ARCHITECTURE.md).
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
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
      'CF-Connecting-IP': `203.0.113.${requestSequence++ % 250}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function register(name: string) {
  const response = await request('/auth/register', 'POST', {
    email: `${name}@example.com`, displayName: name, password: 'esta e uma senha longa 2026',
  });
  expect(response.status).toBe(201);
  const cookies = response.headers.get('set-cookie') ?? '';
  const session = cookies.match(/rpg_session=([^;,]+)/)?.[1];
  const csrf = cookies.match(/rpg_csrf=([^;,]+)/)?.[1];
  const body = await response.json() as { user: { id: string } };
  if (!session || !csrf) throw new Error('Cookies de autenticação ausentes.');
  return { userId: body.user.id, cookie: `rpg_session=${session}; rpg_csrf=${csrf}`, csrf };
}

// LIB-003: isbn fica null no fixture base de propósito. Testes deste arquivo não têm
// isolamento de storage entre `it()` blocks (só as migrations são reaplicadas em
// beforeEach — os dados persistem entre testes do mesmo arquivo), então dois testes
// usando o mesmo ISBN acionariam o dedup real um no outro (o comportamento correto do
// LIB-003, mas indesejado como acoplamento acidental entre testes independentes). Cada
// teste que precisa de um ISBN específico declara o seu, distinto dos demais.
const rpg = {
  title: 'Chamado de Cthulhu', categoryId: 'horror', subgenreId: 'horror-cosmico', readingStatus: 'READ', hasPlayed: true,
  wantsToPlay: true, priority: 'HIGH', playGroupNotes: '', plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '',
  notes: 'Notas pessoais', coverUrl: 'https://covers.openlibrary.org/b/isbn/generic-L.jpg', isbn: null as string | null,
  coverSourceUrl: null, coverSourceNote: null,
};

describe('LIB-002: Game System + Publication + User Library Entry', () => {
  it('CREATE grava as 3 tabelas ligadas (1 Game System + 1 Publication + 1 User Library Entry)', async () => {
    const account = await register('lib002-create');
    // ISBN exclusivo deste teste — ver nota no fixture `rpg` sobre isolamento entre testes.
    const isbn = '9783161484100';
    const created = await request('/rpgs', 'POST', { ...rpg, coverUrl: `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`, isbn }, account.cookie, account.csrf);
    expect(created.status).toBe(201);
    const item = ((await created.json()) as { item: { id: string; title: string; coverUrl: string; isbn: string } }).item;

    const row = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(item.id).first<{ publication_id: string }>();
    expect(row?.publication_id).toBeTruthy();
    const publication = await testEnv.DB.prepare('SELECT title,cover_url,isbn,isbn13,game_system_id,publication_type FROM publications WHERE id=?').bind(row!.publication_id).first<{
      title: string; cover_url: string; isbn: string; isbn13: string; game_system_id: string; publication_type: string;
    }>();
    expect(publication).toMatchObject({ title: 'Chamado de Cthulhu', cover_url: item.coverUrl, isbn, isbn13: isbn, publication_type: 'CORE_RULEBOOK' });
    const gameSystem = await testEnv.DB.prepare('SELECT name FROM game_systems WHERE id=?').bind(publication!.game_system_id).first<{ name: string }>();
    expect(gameSystem?.name).toBe('Chamado de Cthulhu');

    // GET reflete os dados compostos via JOIN, no mesmo formato achatado de sempre (compat de API).
    expect(item.title).toBe('Chamado de Cthulhu');
    expect(item.isbn).toBe(isbn);
  });

  it('PATCH separa metadata (Publication/Game System) de estado pessoal (User Library Entry) na mesma transação', async () => {
    const account = await register('lib002-patch');
    const created = await request('/rpgs', 'POST', rpg, account.cookie, account.csrf);
    const item = ((await created.json()) as { item: { id: string } }).item;

    // Altera só estado pessoal (wantsToPlay) — metadata (title/cover) precisa permanecer intacta.
    const personalOnly = await request(`/rpgs/${item.id}`, 'PATCH', { ...rpg, wantsToPlay: false }, account.cookie, account.csrf);
    expect(personalOnly.status).toBe(200);
    const afterPersonal = ((await personalOnly.json()) as { item: { wantsToPlay: boolean; coverUrl: string; title: string } }).item;
    expect(afterPersonal).toMatchObject({ wantsToPlay: false, coverUrl: rpg.coverUrl, title: 'Chamado de Cthulhu' });

    // Altera só metadata (título) — o Game System vinculado acompanha a mudança (1:1 nesta versão).
    const metadataOnly = await request(`/rpgs/${item.id}`, 'PATCH', { ...rpg, wantsToPlay: false, title: 'Trail of Cthulhu' }, account.cookie, account.csrf);
    expect(metadataOnly.status).toBe(200);
    const afterMetadata = ((await metadataOnly.json()) as { item: { title: string } }).item;
    expect(afterMetadata.title).toBe('Trail of Cthulhu');
    const row = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(item.id).first<{ publication_id: string }>();
    const publication = await testEnv.DB.prepare('SELECT title,game_system_id FROM publications WHERE id=?').bind(row!.publication_id).first<{ title: string; game_system_id: string }>();
    expect(publication?.title).toBe('Trail of Cthulhu');
    const gameSystem = await testEnv.DB.prepare('SELECT name,normalized_name FROM game_systems WHERE id=?').bind(publication!.game_system_id).first<{ name: string; normalized_name: string }>();
    expect(gameSystem).toMatchObject({ name: 'Trail of Cthulhu', normalized_name: 'trail of cthulhu' });
  });

  it('import CSV cria Game System + Publication + User Library Entry pelo mesmo caminho canônico do cadastro manual', async () => {
    const account = await register('lib002-import');
    // 9780306406157 = ISBN-13 equivalente do exemplo clássico 0-306-40615-2 (checksum real válido).
    const csv = ['Sistema / Jogo,Categoria,Subgênero,Status da leitura,Capa URL,ISBN', 'Vampiro A Mascara,Horror,Horror Pessoal,Lido,https://covers.openlibrary.org/b/isbn/1-L.jpg,9780306406157'].join('\n');
    const preview = await request('/import/preview', 'POST', { csv }, account.cookie, account.csrf);
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { jobId: string };
    const confirm = await request('/import/confirm', 'POST', { jobId: previewBody.jobId, approvedRows: [2] }, account.cookie, account.csrf);
    expect(confirm.status).toBe(200);
    expect(await confirm.json()).toMatchObject({ imported: 1 });

    const row = await testEnv.DB.prepare('SELECT id,publication_id FROM rpgs WHERE user_id=?').bind(account.userId).first<{ id: string; publication_id: string }>();
    expect(row?.publication_id).toBeTruthy();
    const publication = await testEnv.DB.prepare('SELECT title,cover_url,isbn,game_system_id FROM publications WHERE id=?').bind(row!.publication_id).first<{ title: string; cover_url: string; isbn: string; game_system_id: string }>();
    expect(publication).toMatchObject({ title: 'Vampiro A Mascara', cover_url: 'https://covers.openlibrary.org/b/isbn/1-L.jpg', isbn: '9780306406157' });
    const gameSystem = await testEnv.DB.prepare('SELECT id FROM game_systems WHERE id=?').bind(publication!.game_system_id).first();
    expect(gameSystem).toBeTruthy();
  });

  it('import ATUALIZACAO grava a capa em Publication (não mais na coluna legada de rpgs)', async () => {
    const account = await register('lib002-import-update');
    const created = await request('/rpgs', 'POST', { ...rpg, title: 'Kult', coverUrl: null }, account.cookie, account.csrf);
    const item = ((await created.json()) as { item: { id: string } }).item;
    const csv = ['Sistema / Jogo,Categoria,Subgênero,Status da leitura,Capa URL', 'Kult,Horror,Horror Cósmico,Lido,https://covers.openlibrary.org/b/isbn/2-L.jpg'].join('\n');
    const preview = await request('/import/preview', 'POST', { csv }, account.cookie, account.csrf);
    const previewBody = (await preview.json()) as { jobId: string; items: Array<{ row: number; classification: string }> };
    expect(previewBody.items[0].classification).toBe('ATUALIZACAO');
    const confirm = await request('/import/confirm', 'POST', { jobId: previewBody.jobId, approvedRows: [2] }, account.cookie, account.csrf);
    expect(await confirm.json()).toMatchObject({ imported: 0, updated: 1 });

    const row = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(item.id).first<{ publication_id: string }>();
    const publication = await testEnv.DB.prepare('SELECT cover_url FROM publications WHERE id=?').bind(row!.publication_id).first<{ cover_url: string }>();
    expect(publication?.cover_url).toBe('https://covers.openlibrary.org/b/isbn/2-L.jpg');
    // A coluna legada em rpgs nunca é escrita pelo app após o LIB-002 — continua NULL.
    const legacy = await testEnv.DB.prepare('SELECT cover_url FROM rpgs WHERE id=?').bind(item.id).first<{ cover_url: string | null }>();
    expect(legacy?.cover_url).toBeNull();
  });

  it('/export inclui publications e gameSystems (versão 7) escopados ao dono, sem vazar entre contas', async () => {
    const a = await register('lib002-export-a');
    const b = await register('lib002-export-b');
    await request('/rpgs', 'POST', rpg, a.cookie, a.csrf);
    // ISBN diferente (e não vazio) de propósito: este teste cobre escopo de export por dono,
    // não dedup entre contas (isso é coberto em tests/integration/publication-identity.test.ts) —
    // um ISBN igual ao de A faria B reaproveitar a Publication de A (comportamento correto do
    // LIB-003, mas erraria o que este teste especificamente verifica).
    await request('/rpgs', 'POST', { ...rpg, title: 'Outro RPG de B', isbn: '0306406152' }, b.cookie, b.csrf);
    const exported = await request('/export', 'GET', undefined, a.cookie);
    const body = (await exported.json()) as { version: number; data: { publications: Array<{ title: string }>; gameSystems: Array<{ name: string }>; publicationExternalIds: unknown[] } };
    expect(body.version).toBe(7);
    expect(body.data.publications).toHaveLength(1);
    expect(body.data.publications[0].title).toBe('Chamado de Cthulhu');
    expect(body.data.gameSystems).toHaveLength(1);
    expect(body.data.gameSystems[0].name).toBe('Chamado de Cthulhu');
    expect(body.data.publicationExternalIds).toEqual([]);
  });

  it('backfill idempotente: linha legada sem publication_id ganha Game System + Publication próprios sem perder dados', async () => {
    const account = await register('lib002-backfill');
    const now = new Date().toISOString();
    const legacyId = crypto.randomUUID();
    // Simula uma linha "pré-LIB-002": inserida direto no banco, sem publication_id, com os
    // valores legados de capa/ISBN nas colunas que a migration 0016 usa como origem do backfill.
    await testEnv.DB.prepare(`INSERT INTO rpgs (id,user_id,title,reading_status,has_played,wants_to_play,priority,play_group_notes,table_status,game_master,notes,cover_url,isbn,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(legacyId, account.userId, 'RPG Legado Pré-Migration', 'READ', 1, 1, 'HIGH', '', 'IDEA', '', '', 'https://exemplo.com/capa-legada.jpg', 'ISBN-LEGADO', now, now).run();

    const before = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(legacyId).first<{ publication_id: string | null }>();
    expect(before?.publication_id).toBeNull();

    // Mesmo backfill (deterministicamente correlacionado por rpgs.id) da migration 0016 —
    // reexecutado aqui para validar sua lógica isoladamente, já que o harness de teste aplica
    // as migrations contra uma base vazia (nenhuma linha legada existe nesse momento).
    await testEnv.DB.batch([
      testEnv.DB.prepare(`INSERT INTO game_systems (id, name, normalized_name, publisher, description, created_at, updated_at)
        SELECT 'gs_' || r.id, r.title, lower(r.title), '', '', r.created_at, r.updated_at FROM rpgs r WHERE r.publication_id IS NULL`),
      testEnv.DB.prepare(`INSERT INTO publications (id, game_system_id, publication_type, title, subtitle, edition, publisher, publication_year, language, isbn, isbn10, isbn13, description, cover_url, cover_source_url, cover_source_note, metadata_source, created_at, updated_at)
        SELECT 'pub_' || r.id, 'gs_' || r.id, 'CORE_RULEBOOK', r.title, '', '', '', NULL, '', r.isbn, NULL, NULL, '', r.cover_url, r.cover_source_url, r.cover_source_note, 'MANUAL', r.created_at, r.updated_at FROM rpgs r WHERE r.publication_id IS NULL`),
      testEnv.DB.prepare(`UPDATE rpgs SET publication_id = 'pub_' || id WHERE publication_id IS NULL`),
    ]);

    const after = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(legacyId).first<{ publication_id: string }>();
    expect(after?.publication_id).toBe(`pub_${legacyId}`);
    const publication = await testEnv.DB.prepare('SELECT title,cover_url,isbn,publication_type,game_system_id FROM publications WHERE id=?').bind(after!.publication_id).first<{
      title: string; cover_url: string; isbn: string; publication_type: string; game_system_id: string;
    }>();
    expect(publication).toMatchObject({ title: 'RPG Legado Pré-Migration', cover_url: 'https://exemplo.com/capa-legada.jpg', isbn: 'ISBN-LEGADO', publication_type: 'CORE_RULEBOOK', game_system_id: `gs_${legacyId}` });
    const gameSystem = await testEnv.DB.prepare('SELECT name FROM game_systems WHERE id=?').bind(publication!.game_system_id).first<{ name: string }>();
    expect(gameSystem?.name).toBe('RPG Legado Pré-Migration');

    // O read model real (GET, via API) reflete a linha migrada — igual a qualquer RPG novo.
    const got = await request(`/rpgs/${legacyId}`, 'GET', undefined, account.cookie);
    expect(got.status).toBe(200);
    const item = ((await got.json()) as { item: { title: string; coverUrl: string; isbn: string } }).item;
    expect(item).toMatchObject({ title: 'RPG Legado Pré-Migration', coverUrl: 'https://exemplo.com/capa-legada.jpg', isbn: 'ISBN-LEGADO' });

    // Reexecutar o backfill de novo é seguro (idempotente): nenhuma linha nova é afetada.
    const rerun = await testEnv.DB.prepare(`UPDATE rpgs SET publication_id = 'pub_' || id WHERE publication_id IS NULL`).run();
    expect(rerun.meta.changes).toBe(0);
  });
});
