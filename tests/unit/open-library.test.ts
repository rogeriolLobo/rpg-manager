import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetadataProviderError } from '../../src/domain/rpg/metadata-provider';
import { openLibraryProvider } from '../../src/server/providers/open-library';

// LIB-004: fixtures baseadas em uma consulta real (única, manual, fora da suíte
// determinística — seção 32 do pedido) contra https://openlibrary.org, capturada
// durante o desenho desta tarefa. A suíte automatizada nunca depende da API real
// (seção 31 do pedido) — todo teste aqui mocka `fetch`.
function mockFetchOnce(body: unknown, init: { status?: number } = {}) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { 'Content-Type': 'application/json' } })));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('Open Library — search (LIB-004)', () => {
  it('mapeia docs reais com todos os campos presentes', async () => {
    mockFetchOnce({
      docs: [{
        key: '/works/OL31098762W', title: '100 Alien Plots', author_name: ['Donovan Corzo'],
        first_publish_year: 2022, publisher: ['Corzo Creations'], language: ['eng'],
        isbn: ['9781958297520', '1958297526'], cover_i: 12345678, edition_key: ['OL42707574M', 'OL42727464M'],
      }],
    });
    const results = await openLibraryProvider.search('alien rpg');
    expect(results).toEqual([{
      source: 'OPEN_LIBRARY', workId: 'OL31098762W', editionId: 'OL42707574M',
      sourceUrl: 'https://openlibrary.org/works/OL31098762W',
      title: '100 Alien Plots', subtitle: undefined, authors: 'Donovan Corzo',
      publisher: 'Corzo Creations', publicationYear: 2022, language: 'eng',
      isbn10: undefined, isbn13: '9781958297520',
      coverUrl: 'https://covers.openlibrary.org/b/id/12345678-L.jpg',
    }]);
  });

  it('não inventa campos ausentes (subtitle/author/publisher/cover faltando)', async () => {
    mockFetchOnce({ docs: [{ key: '/works/OL8382459W', title: 'Aliens: Enemies and Allies' }] });
    const results = await openLibraryProvider.search('aliens');
    expect(results).toEqual([{
      source: 'OPEN_LIBRARY', workId: 'OL8382459W', editionId: null,
      sourceUrl: 'https://openlibrary.org/works/OL8382459W',
      title: 'Aliens: Enemies and Allies', subtitle: undefined, authors: undefined,
      publisher: undefined, publicationYear: undefined, language: undefined,
      isbn10: undefined, isbn13: undefined, coverUrl: undefined,
    }]);
  });

  it('não confia em ISBN do provider que falha checksum (seção 16 do pedido)', async () => {
    mockFetchOnce({ docs: [{ key: '/works/OL1W', title: 'Livro com ISBN quebrado', isbn: ['1234567890123'] }] });
    const [result] = await openLibraryProvider.search('livro quebrado');
    expect(result.isbn13).toBeUndefined();
    expect(result.isbn10).toBeUndefined();
  });

  it('descarta doc sem título (não é um resultado utilizável)', async () => {
    mockFetchOnce({ docs: [{ key: '/works/OL1W' }, { key: '/works/OL2W', title: 'Válido' }] });
    const results = await openLibraryProvider.search('teste');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Válido');
  });

  it('limita a 10 resultados mesmo se o provider devolver mais', async () => {
    mockFetchOnce({ docs: Array.from({ length: 25 }, (_, i) => ({ key: `/works/OL${i}W`, title: `Livro ${i}` })) });
    const results = await openLibraryProvider.search('muitos resultados');
    expect(results).toHaveLength(10);
  });

  it('resposta sem docs retorna lista vazia (sem resultados, não é erro)', async () => {
    mockFetchOnce({ docs: [] });
    expect(await openLibraryProvider.search('nada encontrado')).toEqual([]);
  });
});

describe('Open Library — lookup por ISBN (LIB-004)', () => {
  it('mapeia edição real (works/publishers/covers/languages/isbn_13)', async () => {
    mockFetchOnce({
      key: '/books/OL25883754M', title: 'The Way of Kings', subtitle: 'Book One of the Stormlight Archive',
      publishers: ['Tor'], publish_date: 'August 31st 2010', works: [{ key: '/works/OL15358691W' }],
      covers: [7429768, 7389193], languages: [{ key: '/languages/eng' }, { key: '/languages/heb' }],
      isbn_13: ['9780765326355'], isbn_10: ['0765326353'],
    });
    const result = await openLibraryProvider.lookupByIsbn('9780765326355');
    expect(result).toEqual({
      source: 'OPEN_LIBRARY', workId: 'OL15358691W', editionId: 'OL25883754M',
      sourceUrl: 'https://openlibrary.org/books/OL25883754M',
      title: 'The Way of Kings', subtitle: 'Book One of the Stormlight Archive', authors: undefined,
      publisher: 'Tor', publicationYear: 2010, language: 'eng',
      isbn10: '0765326353', isbn13: '9780765326355',
      coverUrl: 'https://covers.openlibrary.org/b/id/7429768-L.jpg',
    });
  });

  it('usa by_statement como autores quando presente (edição não traz author_name)', async () => {
    mockFetchOnce({ key: '/books/OL1M', title: 'Livro', by_statement: 'Fulano de Tal', isbn_13: ['9783161484100'] });
    const result = await openLibraryProvider.lookupByIsbn('9783161484100');
    expect(result?.authors).toBe('Fulano de Tal');
  });

  it('404 (ISBN não encontrado) retorna null, não é erro de provider', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));
    expect(await openLibraryProvider.lookupByIsbn('9780000000002')).toBeNull();
  });

  it('data de publicação sem ano legível não inventa um ano', async () => {
    mockFetchOnce({ key: '/books/OL2M', title: 'Livro sem data legível', publish_date: 'desconhecida' });
    const result = await openLibraryProvider.lookupByIsbn('9783161484100');
    expect(result?.publicationYear).toBeUndefined();
  });
});

describe('Open Library — erros de provider (LIB-004)', () => {
  it('timeout vira MetadataProviderError(TIMEOUT)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' })));
    await expect(openLibraryProvider.search('qualquer coisa')).rejects.toMatchObject({ reason: 'TIMEOUT' });
    expect(MetadataProviderError).toBeTruthy();
  });

  it('erro de rede genérico vira MetadataProviderError(UPSTREAM_ERROR)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(openLibraryProvider.search('qualquer coisa')).rejects.toMatchObject({ reason: 'UPSTREAM_ERROR' });
  });

  it('resposta 5xx vira MetadataProviderError(UPSTREAM_ERROR)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Internal Server Error', { status: 503 })));
    await expect(openLibraryProvider.search('qualquer coisa')).rejects.toMatchObject({ reason: 'UPSTREAM_ERROR' });
  });

  it('resposta não-JSON vira MetadataProviderError(MALFORMED_RESPONSE)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>não é json</html>', { status: 200 })));
    await expect(openLibraryProvider.search('qualquer coisa')).rejects.toMatchObject({ reason: 'MALFORMED_RESPONSE' });
  });
});
