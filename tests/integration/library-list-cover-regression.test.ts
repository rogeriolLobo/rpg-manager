// LIB-004B: regressão real em produção — a grade da Biblioteca (GET /rpgs)
// parou de mostrar capas para RPGs que já tinham capa cadastrada. Causa raiz:
// a migration 0020 (LIB-004A) usava `DROP TABLE publications` para trocar
// uma CHECK constraint; `rpgs.publication_id` tem `ON DELETE SET NULL`
// (migration 0016), e `PRAGMA foreign_keys = OFF` no topo do arquivo NÃO
// suprimiu esse cascade — SQLite trata a pragma como no-op dentro de uma
// transação já aberta, e o D1 executa cada migration como uma transação
// implícita única. Resultado: `rpgs.publication_id` foi zerado em toda linha
// de produção que já existia antes da migration rodar (nunca reproduzido
// local/CI porque esses ambientes sempre migram um banco vazio — não havia
// nenhuma linha de `rpgs` para o cascade zerar). Ver
// docs/library/LIBRARY_ARCHITECTURE.md, seção "LIB-004B", e
// migrations/0021_repair_rpgs_publication_link.sql.
import { env, exports } from 'cloudflare:workers';
import { expect, it, describe } from 'vitest';
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
      'CF-Connecting-IP': `198.51.102.${requestSequence++ % 250}`,
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

const base = {
  categoryId: null, subgenreId: null, readingStatus: 'NOT_STARTED', hasPlayed: false, wantsToPlay: false, priority: 'NONE',
  playGroupNotes: '', playGroupId: null, plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '', notes: '',
  coverSourceUrl: null, coverSourceNote: null,
};

describe('LIB-004B: GET /rpgs (listagem) sempre projeta cover/metadata de publications, nunca do legado', () => {
  it('coverUrl da listagem vem de publications.cover_url, mesmo quando diverge do legado em rpgs', async () => {
    const a = await register('list-cover-source');
    const created = await request('/rpgs', 'POST', { ...base, title: 'Capa Correta', coverUrl: 'https://example.com/capa-atual.jpg' }, a.cookie, a.csrf);
    expect(created.status).toBe(201);
    const item = ((await created.json()) as { item: { id: string; publicationId?: string } }).item;
    const row = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(item.id).first<{ publication_id: string }>();

    // Simula um valor legado DIVERGENTE em rpgs.cover_url (histórico, nunca mais escrito pela
    // aplicação desde LIB-002) — a listagem precisa ignorar esse valor completamente.
    await testEnv.DB.prepare('UPDATE rpgs SET cover_url=? WHERE id=?').bind('https://legado-nunca-deveria-aparecer.example/x.jpg', item.id).run();

    const list = await request('/rpgs', 'GET', undefined, a.cookie);
    const body = await list.json() as { items: Array<{ id: string; coverUrl: string | null }> };
    const found = body.items.find((entry) => entry.id === item.id);
    expect(found?.coverUrl).toBe('https://example.com/capa-atual.jpg');
    expect(found?.coverUrl).not.toBe('https://legado-nunca-deveria-aparecer.example/x.jpg');

    // Mesma garantia no detail.
    const detail = await request(`/rpgs/${item.id}`, 'GET', undefined, a.cookie);
    const detailBody = await detail.json() as { item: { coverUrl: string | null } };
    expect(detailBody.item.coverUrl).toBe('https://example.com/capa-atual.jpg');
    void row;
  });

  it('publication sem capa -> coverUrl null na listagem (placeholder do frontend assume, não um valor inventado)', async () => {
    const a = await register('list-cover-null');
    const created = await request('/rpgs', 'POST', { ...base, title: 'Sem Capa Nenhuma' }, a.cookie, a.csrf);
    const item = ((await created.json()) as { item: { id: string } }).item;
    const list = await request('/rpgs', 'GET', undefined, a.cookie);
    const body = await list.json() as { items: Array<{ id: string; coverUrl: string | null }> };
    expect(body.items.find((entry) => entry.id === item.id)?.coverUrl).toBeNull();
  });

  // Reproduz A CORRUPÇÃO EXATA causada pela migration 0020, no nível de dados (não de query) —
  // documenta o raio de impacto real: com publication_id nulo mas a Publication correta ainda
  // existindo, a listagem hoje devolve null (comportamento correto de uma FK ausente — a
  // correção pertence à migration de reparo dos dados, não a uma query "defensiva" que
  // tentaria adivinhar o vínculo certo em tempo de leitura).
  it('publication_id nulo (estado corrompido) faz a listagem perder a capa mesmo com a Publication intacta — prova que o reparo tem que ser nos DADOS', async () => {
    const a = await register('list-cover-corrupted');
    const created = await request('/rpgs', 'POST', { ...base, title: 'Vítima da Corrupção', coverUrl: 'https://example.com/capa-intacta.jpg' }, a.cookie, a.csrf);
    const item = ((await created.json()) as { item: { id: string } }).item;
    const row = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(item.id).first<{ publication_id: string }>();
    expect(row?.publication_id).toBeTruthy();

    // Simula exatamente o efeito do ON DELETE SET NULL disparado pela migration 0020.
    await testEnv.DB.prepare('UPDATE rpgs SET publication_id=NULL WHERE id=?').bind(item.id).run();
    const publicationStillIntact = await testEnv.DB.prepare('SELECT cover_url FROM publications WHERE id=?').bind(row!.publication_id).first<{ cover_url: string }>();
    expect(publicationStillIntact?.cover_url).toBe('https://example.com/capa-intacta.jpg'); // a Publication nunca foi tocada.

    const list = await request('/rpgs', 'GET', undefined, a.cookie);
    const body = await list.json() as { items: Array<{ id: string; coverUrl: string | null }> };
    expect(body.items.find((entry) => entry.id === item.id)?.coverUrl).toBeNull(); // sintoma real reproduzido.

    // Restaura o vínculo exatamente como a migration 0021 faz em produção — lá o padrão
    // determinístico `pub_<rpg.id>` (só válido para o backfill original do LIB-002) resolve
    // o valor certo; aqui (Publication criada pelo fluxo normal do app, ID aleatório) o teste
    // usa o valor real capturado antes da corrupção — o ponto comprovado é o mesmo: restaurar
    // o `publication_id` restaura a capa na listagem, sem tocar em `publications`.
    await testEnv.DB.prepare('UPDATE rpgs SET publication_id=? WHERE id=? AND publication_id IS NULL').bind(row!.publication_id, item.id).run();
    const listAfterRepair = await request('/rpgs', 'GET', undefined, a.cookie);
    const bodyAfterRepair = await listAfterRepair.json() as { items: Array<{ id: string; coverUrl: string | null }> };
    expect(bodyAfterRepair.items.find((entry) => entry.id === item.id)?.coverUrl).toBe('https://example.com/capa-intacta.jpg');
  });
});

describe('LIB-004B: técnica segura de rebuild de tabela — captura/restaura FKs de outras tabelas', () => {
  // Prova o MECANISMO root cause (não é suposição): recria a sequência exata da migration 0020
  // sobre uma tabela pai/filho mínima com a MESMA relação de chave estrangeira
  // (`ON DELETE SET NULL`), e mostra que `PRAGMA foreign_keys = OFF` sozinho não a impede dentro
  // do runtime de Workers/D1 usado pelos testes de integração (mesmo motor por trás de
  // produção) — depois prova que a técnica de captura-antes/restaura-depois evita o problema.
  it('DROP TABLE de uma tabela pai zera FKs "ON DELETE SET NULL" de outra tabela mesmo com PRAGMA foreign_keys=OFF antes', async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS regression_parent (id TEXT PRIMARY KEY, name TEXT)'),
      testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS regression_child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES regression_parent(id) ON DELETE SET NULL)'),
      testEnv.DB.prepare("INSERT INTO regression_parent (id, name) VALUES ('rp1','Original')"),
      testEnv.DB.prepare("INSERT INTO regression_child (id, parent_id) VALUES ('rc1','rp1')"),
    ]);

    await testEnv.DB.batch([
      testEnv.DB.prepare('PRAGMA foreign_keys = OFF'),
      testEnv.DB.prepare('CREATE TABLE regression_parent_new (id TEXT PRIMARY KEY, name TEXT)'),
      testEnv.DB.prepare('INSERT INTO regression_parent_new (id, name) SELECT id, name FROM regression_parent'),
      testEnv.DB.prepare('DROP TABLE regression_parent'),
      testEnv.DB.prepare('ALTER TABLE regression_parent_new RENAME TO regression_parent'),
    ]);

    const after = await testEnv.DB.prepare('SELECT parent_id FROM regression_child WHERE id=?').bind('rc1').first<{ parent_id: string | null }>();
    expect(after?.parent_id).toBeNull(); // reproduz o bug real — prova o mecanismo, não é hipotético.

    await testEnv.DB.batch([
      testEnv.DB.prepare('DROP TABLE regression_child'),
      testEnv.DB.prepare('DROP TABLE regression_parent'),
    ]);
  });

  it('técnica correta: capturar valores de FK antes do DROP e restaurar depois, na mesma migration', async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS regression_parent (id TEXT PRIMARY KEY, name TEXT)'),
      testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS regression_child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES regression_parent(id) ON DELETE SET NULL)'),
      testEnv.DB.prepare("INSERT INTO regression_parent (id, name) VALUES ('rp2','Original')"),
      testEnv.DB.prepare("INSERT INTO regression_child (id, parent_id) VALUES ('rc2','rp2')"),
    ]);

    // D1 não autoriza `CREATE TEMP TABLE` (SQLITE_AUTH) — usa uma tabela normal como
    // backup (mesma ideia, só não é `TEMP`), removida ao final da mesma sequência.
    await testEnv.DB.batch([
      // Captura ANTES do DROP — sobrevive independente do cascade disparar ou não.
      testEnv.DB.prepare('CREATE TABLE _fk_backup (id TEXT PRIMARY KEY, parent_id TEXT)'),
      testEnv.DB.prepare('INSERT INTO _fk_backup SELECT id, parent_id FROM regression_child WHERE parent_id IS NOT NULL'),
      testEnv.DB.prepare('CREATE TABLE regression_parent_new (id TEXT PRIMARY KEY, name TEXT)'),
      testEnv.DB.prepare('INSERT INTO regression_parent_new (id, name) SELECT id, name FROM regression_parent'),
      testEnv.DB.prepare('DROP TABLE regression_parent'),
      testEnv.DB.prepare('ALTER TABLE regression_parent_new RENAME TO regression_parent'),
      // Restaura DEPOIS — corrige o cascade, se tiver disparado.
      testEnv.DB.prepare('UPDATE regression_child SET parent_id = (SELECT parent_id FROM _fk_backup WHERE _fk_backup.id = regression_child.id) WHERE id IN (SELECT id FROM _fk_backup)'),
      testEnv.DB.prepare('DROP TABLE _fk_backup'),
    ]);

    const after = await testEnv.DB.prepare('SELECT parent_id FROM regression_child WHERE id=?').bind('rc2').first<{ parent_id: string | null }>();
    expect(after?.parent_id).toBe('rp2'); // técnica correta preserva o vínculo.

    await testEnv.DB.batch([
      testEnv.DB.prepare('DROP TABLE regression_child'),
      testEnv.DB.prepare('DROP TABLE regression_parent'),
    ]);
  });
});
