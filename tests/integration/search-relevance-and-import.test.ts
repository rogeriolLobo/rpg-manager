// LIB-004A: qualidade da busca online (relevância/confiança/RPG-aware
// ranking), catálogo interno primeiro, e importação por URL oficial. Upstream
// sempre mockado — nunca depende de rede real em CI. Ver
// tests/integration/metadata-search.test.ts (LIB-004, ainda válido/não
// duplicado aqui) e docs/library/METADATA_PROVIDERS.md.
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
      'CF-Connecting-IP': `198.51.101.${requestSequence++ % 250}`,
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

// Response criada dentro do callback (não antes) — ver nota em metadata-search.test.ts
// sobre "Cannot perform I/O on behalf of a different request".
function mockUpstream(body: unknown, status = 200, contentType = 'application/json') {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': contentType } }))));
}
function mockUpstreamHtml(html: string, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(html, { status, headers: { 'Content-Type': 'text/html' } }))));
}
function mockUpstreamNeverCalled() {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => { throw new Error('fetch não deveria ter sido chamado — catálogo interno deveria ter respondido primeiro.'); }));
}

afterEach(() => { vi.unstubAllGlobals(); });

const base = {
  categoryId: null, subgenreId: null, readingStatus: 'NOT_STARTED', hasPlayed: false, wantsToPlay: false, priority: 'NONE',
  playGroupNotes: '', playGroupId: null, plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '', notes: '',
  coverUrl: null, coverSourceUrl: null, coverSourceNote: null,
};

describe('LIB-004A: regressão real "Rastro de Cthulhu"', () => {
  it('caso A: resultado único fracamente relacionado (August Derleth, ficção) nunca aparece', async () => {
    const a = await register('rastro-cthulhu-derleth');
    mockUpstream({
      docs: [{
        key: '/works/OL8265836W', title: 'The Trail of Cthulhu', author_name: ['August Derleth'],
        first_publish_year: 1945, publisher: ['Carroll & Graf Publishers'], language: ['spa', 'eng'],
        cover_i: 1289152, subject: ['Cthulhu (Fictitious character)', 'Fiction', 'Horror tales'],
      }],
    });
    const response = await request('/rpgs/search-external?q=Rastro+de+Cthulhu', 'GET', undefined, a.cookie);
    expect(response.status).toBe(200);
    const body = await response.json() as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  it('caso B: o RPG correto (Kenneth Hite / Pelgrane Press) aparece quando a query bate', async () => {
    const a = await register('rastro-cthulhu-hite');
    mockUpstream({
      docs: [{
        key: '/works/OL19907627W', title: 'Trail of Cthulhu', author_name: ['Kenneth Hite'],
        first_publish_year: 2008, publisher: ['Pelgrane Press'], language: ['eng'],
        isbn: ['9781934859070'], edition_key: ['OL27092590M'], subject: ['Fantasy games', 'Handbooks, manuals'],
      }],
    });
    const response = await request('/rpgs/search-external?q=Trail+of+Cthulhu', 'GET', undefined, a.cookie);
    const body = await response.json() as { results: Array<{ title: string; publisher: string; confidence: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ title: 'Trail of Cthulhu', publisher: 'Pelgrane Press', confidence: 'EXACT' });
  });
});

describe('LIB-004A: catálogo interno primeiro (GET /rpgs/search-external)', () => {
  it('encontra por título de uma Publication já cadastrada, sem chamar a Open Library', async () => {
    const a = await register('internal-by-title');
    mockUpstreamNeverCalled();
    const created = await request('/rpgs', 'POST', { ...base, title: 'Aventuras no Vazio Estelar', isbn: '9789188805553' }, a.cookie, a.csrf);
    expect(created.status).toBe(201);

    const response = await request('/rpgs/search-external?q=Aventuras+no+Vazio+Estelar', 'GET', undefined, a.cookie);
    expect(response.status).toBe(200);
    const body = await response.json() as { results: Array<{ title: string; origin: string; confidence: string; internalPublicationId: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ title: 'Aventuras no Vazio Estelar', origin: 'INTERNAL', confidence: 'EXACT' });
    expect(body.results[0].internalPublicationId).toBeTruthy();
  });

  it('encontra por ISBN exato de uma Publication já cadastrada, sem chamar a Open Library', async () => {
    const a = await register('internal-by-isbn');
    const created = await request('/rpgs', 'POST', { ...base, title: 'Crônicas do Abismo', isbn: '9789127432475' }, a.cookie, a.csrf);
    expect(created.status).toBe(201);
    mockUpstreamNeverCalled();

    const response = await request('/rpgs/search-external?q=9789127432475', 'GET', undefined, a.cookie);
    expect(response.status).toBe(200);
    const body = await response.json() as { results: Array<{ title: string; origin: string }> };
    expect(body.results).toEqual([expect.objectContaining({ title: 'Crônicas do Abismo', origin: 'INTERNAL' })]);
  });

  it('caso C: alias confirmado ("Rastro de Cthulhu" -> Publication real) resolve corretamente', async () => {
    const a = await register('internal-alias');
    const created = await request('/rpgs', 'POST', { ...base, title: 'Trail of Cthulhu', isbn: '9781934859070', publisher: 'Pelgrane Press' }, a.cookie, a.csrf);
    expect(created.status).toBe(201);
    const item = ((await created.json()) as { item: { id: string } }).item;
    const row = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(item.id).first<{ publication_id: string }>();
    await testEnv.DB.prepare('INSERT INTO publication_aliases (id,publication_id,title,language,source,confirmed,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), row!.publication_id, 'Rastro de Cthulhu', 'por', 'MANUAL', 1, new Date().toISOString()).run();

    mockUpstreamNeverCalled();
    const response = await request('/rpgs/search-external?q=Rastro+de+Cthulhu', 'GET', undefined, a.cookie);
    expect(response.status).toBe(200);
    const body = await response.json() as { results: Array<{ title: string; origin: string; matchedAlias: string; internalPublicationId: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ title: 'Trail of Cthulhu', origin: 'INTERNAL', matchedAlias: 'Rastro de Cthulhu', internalPublicationId: row!.publication_id });
  });

  it('alias NÃO confirmado nunca influencia a busca', async () => {
    const a = await register('internal-alias-unconfirmed');
    const created = await request('/rpgs', 'POST', { ...base, title: 'Segredos da Torre Negra', isbn: '9781910132753' }, a.cookie, a.csrf);
    const item = ((await created.json()) as { item: { id: string } }).item;
    const row = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(item.id).first<{ publication_id: string }>();
    await testEnv.DB.prepare('INSERT INTO publication_aliases (id,publication_id,title,language,source,confirmed,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), row!.publication_id, 'Alias Não Confirmado Específico', 'por', 'MANUAL', 0, new Date().toISOString()).run();

    mockUpstream({ docs: [] });
    const response = await request('/rpgs/search-external?q=Alias+N%C3%A3o+Confirmado+Espec%C3%ADfico', 'GET', undefined, a.cookie);
    const body = await response.json() as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  it('caso D: nenhum resultado confiável em lugar nenhum -> lista vazia honesta', async () => {
    const a = await register('internal-no-results');
    mockUpstream({ docs: [] });
    const response = await request('/rpgs/search-external?q=Um+Titulo+Que+Nao+Existe+Em+Lugar+Nenhum', 'GET', undefined, a.cookie);
    expect(response.status).toBe(200);
    expect((await response.json() as { results: unknown[] }).results).toEqual([]);
  });

  it('criar a partir de um resultado INTERNAL reaproveita a Publication existente (reusePublicationId)', async () => {
    const a = await register('internal-reuse-a');
    const b = await register('internal-reuse-b');
    const created = await request('/rpgs', 'POST', { ...base, title: 'Ecos do Mundo Cinza', isbn: '9781000001006' }, a.cookie, a.csrf);
    const itemA = ((await created.json()) as { item: { id: string } }).item;
    const rowA = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(itemA.id).first<{ publication_id: string }>();

    const createdB = await request('/rpgs', 'POST', { ...base, title: 'Ecos do Mundo Cinza (b)', isbn: null, reusePublicationId: rowA!.publication_id }, b.cookie, b.csrf);
    expect(createdB.status).toBe(201);
    const itemB = ((await createdB.json()) as { item: { id: string; title: string } }).item;
    expect(itemB.title).toBe('Ecos do Mundo Cinza'); // título vem da Publication reaproveitada, não do payload local.
    const rowB = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(itemB.id).first<{ publication_id: string }>();
    expect(rowB?.publication_id).toBe(rowA?.publication_id);
  });

  it('ALREADY_IN_LIBRARY também se aplica ao reaproveitar via reusePublicationId', async () => {
    const a = await register('internal-reuse-already');
    const created = await request('/rpgs', 'POST', { ...base, title: 'Sombras do Norte Gélido', isbn: '9789127432475' }, a.cookie, a.csrf);
    const item = ((await created.json()) as { item: { id: string } }).item;
    const row = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(item.id).first<{ publication_id: string }>();
    const again = await request('/rpgs', 'POST', { ...base, title: 'Sombras do Norte Gélido (de novo)', reusePublicationId: row!.publication_id }, a.cookie, a.csrf);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe('ALREADY_IN_LIBRARY');
  });

  it('reusePublicationId inválido/inexistente nunca quebra o create — cai para o fluxo normal', async () => {
    const a = await register('internal-reuse-invalid');
    const response = await request('/rpgs', 'POST', { ...base, title: 'RPG Novo de Verdade', reusePublicationId: 'pub_inexistente' }, a.cookie, a.csrf);
    expect(response.status).toBe(201);
    const item = ((await response.json()) as { item: { title: string } }).item;
    expect(item.title).toBe('RPG Novo de Verdade');
  });
});

describe('LIB-004A: POST /rpgs/import-url', () => {
  const jsonLdHtml = `<!doctype html><html><head>
    <title>Trail of Cthulhu - Pelgrane Press</title>
    <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Book', name: 'Trail of Cthulhu',
    author: { '@type': 'Person', name: 'Kenneth Hite' }, publisher: { '@type': 'Organization', name: 'Pelgrane Press' },
    datePublished: '2008-06-01', isbn: '9781934859070', image: 'https://www.pelgranepress.com/covers/toc.jpg',
    description: 'Um RPG de investigação Lovecraftiana.',
  })}</script>
  </head><body><h1>Trail of Cthulhu</h1></body></html>`;

  const ogOnlyHtml = `<!doctype html><html><head>
    <title>Produto sem JSON-LD</title>
    <meta property="og:title" content="Produto Via OpenGraph" />
    <meta property="og:image" content="https://www.example-publisher.com/cover.jpg" />
    <meta property="og:description" content="Descrição via OpenGraph." />
  </head><body></body></html>`;

  it('exige autenticação', async () => {
    expect((await request('/rpgs/import-url', 'POST', { url: 'https://example.com/x' })).status).toBe(401);
  });

  it('rejeita URL insegura (SSRF) antes de qualquer fetch', async () => {
    const a = await register('import-ssrf');
    mockUpstreamNeverCalled();
    const response = await request('/rpgs/import-url', 'POST', { url: 'https://127.0.0.1/admin' }, a.cookie, a.csrf);
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('INVALID_IMPORT_URL');
  });

  it('rejeita HTTP simples (não-HTTPS)', async () => {
    const a = await register('import-http');
    const response = await request('/rpgs/import-url', 'POST', { url: 'http://example.com/produto' }, a.cookie, a.csrf);
    expect(response.status).toBe(422);
  });

  it('extrai metadata de JSON-LD (schema.org/Book) com prioridade sobre OpenGraph', async () => {
    const a = await register('import-jsonld');
    mockUpstreamHtml(jsonLdHtml);
    const response = await request('/rpgs/import-url', 'POST', { url: 'https://www.pelgranepress.com/product/trail-of-cthulhu/' }, a.cookie, a.csrf);
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { title: string; authors: string; publisher: string; publicationYear: number; isbn13: string; source: string; origin: string } };
    expect(body.result).toMatchObject({
      title: 'Trail of Cthulhu', authors: 'Kenneth Hite', publisher: 'Pelgrane Press',
      publicationYear: 2008, isbn13: '9781934859070', source: 'URL_IMPORT', origin: 'URL_IMPORT',
    });
  });

  it('ISBN extraído da página é revalidado — ISBN inválido nunca é aceito cegamente', async () => {
    const a = await register('import-bad-isbn');
    const html = jsonLdHtml.replace('9781934859070', '1234567890123'); // falha checksum EAN-13 real.
    mockUpstreamHtml(html);
    const response = await request('/rpgs/import-url', 'POST', { url: 'https://www.pelgranepress.com/product/x/' }, a.cookie, a.csrf);
    const body = await response.json() as { result: { isbn13: string | undefined } };
    expect(body.result.isbn13).toBeUndefined();
  });

  it('sem JSON-LD, usa OpenGraph como fallback', async () => {
    const a = await register('import-og');
    mockUpstreamHtml(ogOnlyHtml);
    const response = await request('/rpgs/import-url', 'POST', { url: 'https://www.example-publisher.com/produto' }, a.cookie, a.csrf);
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { title: string } };
    expect(body.result.title).toBe('Produto Via OpenGraph');
  });

  it('página sem nenhuma metadata reconhecível -> erro amigável, não crasha', async () => {
    const a = await register('import-empty');
    mockUpstreamHtml('<!doctype html><html><head></head><body>Nada aqui.</body></html>');
    const response = await request('/rpgs/import-url', 'POST', { url: 'https://www.example-publisher.com/vazio' }, a.cookie, a.csrf);
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('IMPORT_NO_METADATA');
  });

  it('content-type não-HTML é rejeitado (nunca tenta interpretar binário como página)', async () => {
    const a = await register('import-binary');
    mockUpstream('%PDF-1.4 binary garbage', 200, 'application/pdf');
    const response = await request('/rpgs/import-url', 'POST', { url: 'https://www.example-publisher.com/catalogo.pdf' }, a.cookie, a.csrf);
    expect(response.status).toBe(502);
  });

  it('timeout do fetch retorna 502 amigável', async () => {
    const a = await register('import-timeout');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' })));
    const response = await request('/rpgs/import-url', 'POST', { url: 'https://www.example-publisher.com/produto' }, a.cookie, a.csrf);
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: { code: string; message: string } }).error.message).toContain('cadastrar manualmente');
  });

  it('rate limit local: bloqueia após muitas importações seguidas', async () => {
    const a = await register('import-rate-limit');
    mockUpstreamHtml(ogOnlyHtml);
    // Laço tolerante a timing: o binding de rate limit (mesmo padrão comprovado em
    // tests/integration/metadata-search.test.ts) é uma janela deslizante — exigir que a
    // 429 caia exatamente na N-ésima chamada é frágil a variação de precisão/latência entre
    // ambientes (passou local, mas não em CI mais lento — não é um problema de infra a
    // "rerun", é o teste assumindo uma contagem exata onde só "eventualmente bloqueia" é
    // garantido). Interrompe assim que a primeira 429 aparece, com uma margem generosa.
    let blocked = false;
    for (let i = 0; i < 60 && !blocked; i += 1) {
      const status = (await request('/rpgs/import-url', 'POST', { url: `https://www.example-publisher.com/produto-${i}` }, a.cookie, a.csrf)).status;
      if (status === 429) blocked = true;
    }
    expect(blocked).toBe(true);
  });

  it('preview de importação nunca salva nada sozinho — precisa de um POST /rpgs separado', async () => {
    const a = await register('import-no-autosave');
    mockUpstreamHtml(jsonLdHtml);
    await request('/rpgs/import-url', 'POST', { url: 'https://www.pelgranepress.com/product/trail-of-cthulhu-2/' }, a.cookie, a.csrf);
    const list = await request('/rpgs', 'GET', undefined, a.cookie);
    const body = await list.json() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(0);
  });

  it('confirmar um resultado importado grava provenance URL_IMPORT correta', async () => {
    const a = await register('import-confirm');
    // ISBN próprio deste teste (não colide com o real 9781934859070 usado no
    // cenário do alias confirmado — dedup por ISBN reaproveitaria a Publication
    // de lá e a provenance nunca seria reescrita nesse caso, por desenho).
    mockUpstreamHtml(jsonLdHtml.replace('9781934859070', '9781000002003'));
    const preview = await request('/rpgs/import-url', 'POST', { url: 'https://www.pelgranepress.com/product/trail-of-cthulhu-3/' }, a.cookie, a.csrf);
    const { result } = await preview.json() as { result: { title: string; sourceUrl: string; isbn13: string } };
    const created = await request('/rpgs', 'POST', {
      ...base, title: result.title, isbn: result.isbn13, metadataSource: 'URL_IMPORT',
      metadataSourceUrl: result.sourceUrl, metadataFetchedAt: new Date().toISOString(),
    }, a.cookie, a.csrf);
    expect(created.status).toBe(201);
    const item = ((await created.json()) as { item: { metadataSource: string } }).item;
    expect(item.metadataSource).toBe('URL_IMPORT');
  });

  // LIB-004C: reprodução real do smoke manual — HTML reduzido, mas fiel à
  // estrutura de https://retropunk.com.br/editora/roleplaying/rastro_de_cthulhu/
  // (capturada e auditada campo a campo antes de qualquer mudança de código —
  // ver docs/library/METADATA_PROVIDERS.md, seção "LIB-004C").
  const retropunkLikeHtml = `<!doctype html><html><head>
    <title>Rastro de Cthulhu - RetroPunk</title>
    <meta name="author" content="Daniel Martins"/>
    <meta property="og:title" content="Rastro de Cthulhu"/>
    <meta property="og:description" content=""/>
    <meta property="og:type" content="article"/>
    <meta property="og:site_name" content="RetroPunk"/>
    <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebPage', name: 'Rastro de Cthulhu - RetroPunk', datePublished: '2017-01-23T19:44:47+00:00', inLanguage: 'pt-BR' },
      { '@type': 'WebSite', name: 'RetroPunk', url: 'https://retropunk.com.br/editora/' },
    ],
  })}</script>
  </head><body><p>Rastro de Cthulhu é escrito por Kenneth Hite e ilustrado por Jérôme Huguenin.</p></body></html>`;

  it('LIB-004C: página sem nó Book/Product extrai título + idioma (WebPage.inLanguage), nunca inventa autor/editora/ano do conteúdo do site', async () => {
    const a = await register('import-retropunk');
    mockUpstreamHtml(retropunkLikeHtml);
    const response = await request('/rpgs/import-url', 'POST', { url: 'https://retropunk.com.br/editora/roleplaying/rastro_de_cthulhu/' }, a.cookie, a.csrf);
    expect(response.status).toBe(200);
    const body = await response.json() as { result: Record<string, unknown> };
    expect(body.result.title).toBe('Rastro de Cthulhu');
    expect(body.result.language).toBe('pt-BR'); // LIB-004C: novo — WebPage.inLanguage, sinal seguro.
    // Nunca inventado a partir de dado que não é bibliográfico:
    expect(body.result.authors).toBeUndefined(); // meta[name=author] é o autor do POST do blog (Daniel Martins), não do RPG.
    expect(body.result.publisher).toBeUndefined(); // og:site_name/WebSite.name é o site (RetroPunk), não necessariamente a editora do livro.
    expect(body.result.publicationYear).toBeUndefined(); // WebPage.datePublished é a data do post, não do livro.
    expect(body.result.description).toBeUndefined(); // og:description="" (vazio, não ausente) não pode "vencer" e virar um valor vazio persistido.
    expect(body.result.coverUrl).toBeUndefined(); // sem og:image/twitter:image/JSON-LD image — nenhuma mineração de <img> solto.
  });

  it('mescla POR CAMPO: JSON-LD com só "name" não descarta og:image (bug real corrigido — antes era fallback de documento inteiro)', async () => {
    const a = await register('import-merge-fields');
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Book', name: 'Só Título Via JSON-LD' })}</script>
      <meta property="og:image" content="https://www.example-publisher.com/capa-via-og.jpg" />
      <meta property="og:description" content="Descrição só existe no OpenGraph." />
    </head><body></body></html>`;
    mockUpstreamHtml(html);
    const response = await request('/rpgs/import-url', 'POST', { url: 'https://www.example-publisher.com/produto-misto' }, a.cookie, a.csrf);
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { title: string; coverUrl: string } };
    expect(body.result.title).toBe('Só Título Via JSON-LD'); // do JSON-LD
    expect(body.result.coverUrl).toBe('https://www.example-publisher.com/capa-via-og.jpg'); // do OpenGraph — não descartado
  });

  it('JSON-LD @type Product (não só Book) é reconhecido', async () => {
    const a = await register('import-product-type');
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Product', name: 'Produto Genérico',
      author: ['Autor Um', 'Autor Dois'], publisher: 'Editora Exemplo', image: 'https://www.example-publisher.com/produto.jpg',
    })}</script>
    </head><body></body></html>`;
    mockUpstreamHtml(html);
    const response = await request('/rpgs/import-url', 'POST', { url: 'https://www.example-publisher.com/produto-generico' }, a.cookie, a.csrf);
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { title: string; authors: string; publisher: string; coverUrl: string } };
    expect(body.result.title).toBe('Produto Genérico');
    expect(body.result.authors).toBe('Autor Um, Autor Dois'); // array de strings, não só de objetos Person
    expect(body.result.publisher).toBe('Editora Exemplo'); // publisher como string simples, não só Organization
    expect(body.result.coverUrl).toBe('https://www.example-publisher.com/produto.jpg');
  });

  it('JSON-LD malformado (erro de sintaxe) não derruba a importação — cai para OpenGraph', async () => {
    const a = await register('import-malformed-jsonld');
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">{ "@type": "Book", "name": "Livro Quebrado", }</script>
      <meta property="og:title" content="Título Via OpenGraph (fallback)" />
    </head><body></body></html>`;
    mockUpstreamHtml(html);
    const response = await request('/rpgs/import-url', 'POST', { url: 'https://www.example-publisher.com/produto-quebrado' }, a.cookie, a.csrf);
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { title: string } };
    expect(body.result.title).toBe('Título Via OpenGraph (fallback)');
  });

  it('twitter:image é usado quando não há og:image', async () => {
    const a = await register('import-twitter-image');
    const html = `<!doctype html><html><head>
      <meta property="og:title" content="Produto Com Twitter Card" />
      <meta name="twitter:image" content="https://www.example-publisher.com/capa-twitter.jpg" />
    </head><body></body></html>`;
    mockUpstreamHtml(html);
    const response = await request('/rpgs/import-url', 'POST', { url: 'https://www.example-publisher.com/produto-twitter' }, a.cookie, a.csrf);
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { coverUrl: string } };
    expect(body.result.coverUrl).toBe('https://www.example-publisher.com/capa-twitter.jpg');
  });
});
