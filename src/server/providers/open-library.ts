// LIB-004: primeiro BookMetadataProvider (Open Library) — fetch server-side
// contra um host FIXO, nunca arbitrário vindo do usuário (não é o mesmo fluxo
// de external coverUrl — ver docs/library/PUBLICATION_IDENTITY.md e
// docs/library/METADATA_PROVIDERS.md). Uso estritamente de baixo volume: uma
// busca por ação humana, sem crawling/bulk/sincronização (política de uso
// responsável da Open Library).
import { classifyIsbn } from '../../domain/rpg/isbn';
import { MetadataProviderError, type BookMetadataResult, type BookMetadataProvider } from '../../domain/rpg/metadata-provider';
import { applyDomainBoost, hasRpgSubjectSignal, meetsDisplayThreshold, scoreTitleMatch, tierRank } from '../../domain/rpg/search-relevance';

const SEARCH_HOST = 'https://openlibrary.org/search.json';
const ISBN_HOST = 'https://openlibrary.org/isbn';
const COVERS_HOST = 'https://covers.openlibrary.org/b/id';
const TIMEOUT_MS = 5000;
const RESULT_LIMIT = 10;
// Identificação da aplicação pedida pela Open Library para requests
// server-side (seção 7 do pedido) — sem secret, só identificação + contato.
const USER_AGENT = 'RPG-Manager/1.0 (+https://rpg-manager.editorahuginnemuninn.workers.dev; contato via GitHub rogeriolLobo/rpg-manager)';

async function fetchJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw new MetadataProviderError('TIMEOUT', 'Open Library não respondeu a tempo.');
    throw new MetadataProviderError('UPSTREAM_ERROR', 'Falha ao contatar a Open Library.');
  }
  if (!response.ok) {
    // 404 no lookup por ISBN é uma resposta válida de "não encontrado", tratada pelo chamador
    // (lookupByIsbn retorna null) — não é erro de provider.
    if (response.status === 404) return null;
    throw new MetadataProviderError('UPSTREAM_ERROR', `Open Library respondeu ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new MetadataProviderError('MALFORMED_RESPONSE', 'Resposta da Open Library não é JSON válido.');
  }
}

// Extrai um ano plausível de campos de data em texto livre (ex.: "August 31st
// 2010") — nunca inventa um ano quando ausente/ilegível (seção 12 do pedido).
function extractYear(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const match = /\b(1[0-9]{3}|20[0-9]{2})\b/u.exec(raw);
  if (!match) return undefined;
  const year = Number(match[1]);
  return year >= 1000 && year <= new Date().getUTCFullYear() + 1 ? year : undefined;
}

// Só confia num ISBN vindo do provider se o NOSSO validador (LIB-003) confirmar
// o checksum — "não confiar cegamente no provider" (seção 16 do pedido). Usada
// pela busca textual (array `isbn` misto, sem separação por tipo — classifica
// só o primeiro candidato, aceitando o que o classificador reconhecer).
function trustedIsbn(raw: unknown): { isbn10?: string; isbn13?: string } {
  if (typeof raw !== 'string') return {};
  const classified = classifyIsbn(raw);
  if (!classified) return {};
  return { isbn10: classified.isbn10 ?? undefined, isbn13: classified.isbn13 ?? undefined };
}

// Usadas pelo lookup por ISBN, onde a Open Library já separa isbn_10/isbn_13
// em arrays próprios — validamos cada um independentemente (nunca assume que
// um implica o outro; só a classificação real decide).
function trustedIsbn13(raw: unknown): string | undefined {
  return typeof raw === 'string' ? (classifyIsbn(raw)?.isbn13 ?? undefined) : undefined;
}
function trustedIsbn10(raw: unknown): string | undefined {
  return typeof raw === 'string' ? (classifyIsbn(raw)?.isbn10 ?? undefined) : undefined;
}

function coverUrlFromId(coverId: unknown): string | undefined {
  const id = Number(coverId);
  return Number.isInteger(id) && id > 0 ? `${COVERS_HOST}/${id}-L.jpg` : undefined;
}

function stripPrefix(value: unknown, prefix: string): string | null {
  return typeof value === 'string' && value.startsWith(prefix) ? value.slice(prefix.length) : (typeof value === 'string' ? value : null);
}

interface SearchDoc {
  key?: string; title?: string; subtitle?: string; author_name?: string[];
  first_publish_year?: number; publisher?: string[]; language?: string[];
  isbn?: string[]; cover_i?: number; edition_key?: string[]; subject?: string[];
}

// LIB-004A: `query` é necessário para calcular confiança LOCALMENTE (nunca
// confiamos na ordenação de relevância da Open Library — ver causa raiz em
// docs/library/METADATA_PROVIDERS.md, incidente "Rastro de Cthulhu").
function mapSearchDoc(doc: SearchDoc, query: string): BookMetadataResult | null {
  if (!doc.title) return null;
  const workId = stripPrefix(doc.key, '/works/');
  const editionId = doc.edition_key?.[0] ?? null;
  // Busca textual retorna a Obra — o primeiro ISBN da lista (quando presente) é só
  // representativo daquela obra, não uma seleção precisa de edição (seção 13 do pedido).
  const isbn = trustedIsbn(doc.isbn?.[0]);
  const { confidence: textConfidence } = scoreTitleMatch(query, doc.title, doc.subtitle);
  const confidence = applyDomainBoost(textConfidence, hasRpgSubjectSignal(doc.subject));
  return {
    source: 'OPEN_LIBRARY', origin: 'OPEN_LIBRARY', confidence, workId, editionId,
    sourceUrl: workId ? `https://openlibrary.org/works/${workId}` : SEARCH_HOST,
    title: doc.title, subtitle: doc.subtitle,
    authors: doc.author_name?.length ? doc.author_name.join(', ') : undefined,
    publisher: doc.publisher?.[0], publicationYear: doc.first_publish_year,
    language: doc.language?.[0],
    isbn10: isbn.isbn10, isbn13: isbn.isbn13,
    coverUrl: coverUrlFromId(doc.cover_i),
  };
}

interface EditionDoc {
  key?: string; title?: string; subtitle?: string; publishers?: string[]; publish_date?: string;
  works?: Array<{ key?: string }>; covers?: number[]; languages?: Array<{ key?: string }>;
  isbn_10?: string[]; isbn_13?: string[]; by_statement?: string; subjects?: string[];
}

// Lookup por ISBN é sempre EXACT — ISBN é um identificador confiável, não uma
// comparação textual (seção 3 do pedido: "ISBN exato" é a primeira e mais
// forte etapa do pipeline, não precisa de score).
function mapEdition(doc: EditionDoc): BookMetadataResult | null {
  if (!doc.title) return null;
  const editionId = stripPrefix(doc.key, '/books/');
  const workId = stripPrefix(doc.works?.[0]?.key, '/works/');
  return {
    source: 'OPEN_LIBRARY', origin: 'OPEN_LIBRARY', confidence: 'EXACT', workId, editionId,
    sourceUrl: editionId ? `https://openlibrary.org/books/${editionId}` : ISBN_HOST,
    title: doc.title, subtitle: doc.subtitle,
    // Registros de edição nem sempre trazem autor (fica na Obra) — não fazemos uma segunda
    // chamada só para preencher isso (evita ampliar o volume de requests por busca única,
    // seção 5 do pedido); by_statement, quando existe, é o melhor esforço honesto.
    authors: doc.by_statement,
    publisher: doc.publishers?.[0], publicationYear: extractYear(doc.publish_date),
    language: stripPrefix(doc.languages?.[0]?.key, '/languages/') ?? undefined,
    isbn10: trustedIsbn10(doc.isbn_10?.[0]), isbn13: trustedIsbn13(doc.isbn_13?.[0]),
    coverUrl: coverUrlFromId(doc.covers?.[0]),
  };
}

export const openLibraryProvider: BookMetadataProvider = {
  async search(query: string): Promise<BookMetadataResult[]> {
    const url = `${SEARCH_HOST}?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('key,title,subtitle,author_name,first_publish_year,publisher,language,isbn,cover_i,edition_key,subject')}&limit=${RESULT_LIMIT}`;
    const payload = await fetchJson(url) as { docs?: SearchDoc[] } | null;
    const docs = payload?.docs ?? [];
    const results: BookMetadataResult[] = [];
    for (const doc of docs) { const mapped = mapSearchDoc(doc, query); if (mapped) results.push(mapped); }
    // LIB-004A: nunca apresenta um resultado LOW como se fosse confiável — abaixo do
    // limiar, é melhor "nenhum resultado confiável" do que um livro errado (seção 6).
    // Entre os que passam, ordena por confiança (EXACT/HIGH primeiro).
    return results
      .filter((result) => meetsDisplayThreshold(result.confidence))
      .sort((a, b) => tierRank(b.confidence) - tierRank(a.confidence))
      .slice(0, RESULT_LIMIT);
  },
  async lookupByIsbn(isbn13: string): Promise<BookMetadataResult | null> {
    const payload = await fetchJson(`${ISBN_HOST}/${encodeURIComponent(isbn13)}.json`) as EditionDoc | null;
    return payload ? mapEdition(payload) : null;
  },
};
