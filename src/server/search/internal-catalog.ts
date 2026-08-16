// LIB-004A: catálogo interno primeiro (seção 9 do pedido) — antes de bater na
// Open Library, procura no que o RPG Manager já conhece: título das
// Publications já cadastradas e aliases confirmados (título localizado, ex.:
// "Rastro de Cthulhu" -> "Trail of Cthulhu"). Publication é catálogo
// compartilhado, sem dono (mesmo modelo de categories/subgenres — ver
// docs/library/LIBRARY_ARCHITECTURE.md), então a busca cobre TODAS as
// Publications, não só as do usuário atual; User Library Entry (estado
// pessoal) continua isolado por user_id em todo o resto do app — nada aqui
// expõe notas/estado pessoal de outro usuário, só metadata editorial já
// compartilhada por design desde LIB-002.
import type { BookMetadataResult } from '../../domain/rpg/metadata-provider';
import { meetsDisplayThreshold, scoreTitleMatch, tierRank } from '../../domain/rpg/search-relevance';

// Limite defensivo de leitura: o catálogo ainda é pequeno (dezenas de linhas).
// Evita custo de leitura ilimitado se crescer muito antes de precisarmos de um
// índice de texto completo dedicado — limite conhecido, documentado em
// docs/library/METADATA_PROVIDERS.md, não uma quota de produto.
const CATALOG_SCAN_LIMIT = 500;

interface PublicationRow {
  id: string; title: string; subtitle: string; authors: string; publisher: string;
  publication_year: number | null; language: string; isbn10: string | null; isbn13: string | null; cover_url: string | null;
}
interface AliasRow extends PublicationRow { alias_title: string }

const PUBLICATION_FIELDS = 'id,title,subtitle,authors,publisher,publication_year,language,isbn10,isbn13,cover_url';

function toResult(row: PublicationRow, confidence: BookMetadataResult['confidence'], matchedAlias?: string): BookMetadataResult {
  return {
    source: 'MANUAL', origin: 'INTERNAL', confidence, workId: null, editionId: null,
    internalPublicationId: row.id, matchedAlias,
    sourceUrl: '', title: row.title, subtitle: row.subtitle || undefined,
    authors: row.authors || undefined, publisher: row.publisher || undefined,
    publicationYear: row.publication_year ?? undefined, language: row.language || undefined,
    isbn10: row.isbn10 ?? undefined, isbn13: row.isbn13 ?? undefined, coverUrl: row.cover_url ?? undefined,
  };
}

// ISBN é o identificador mais forte do pipeline (seção 3 do pedido: "ISBN
// exato" vem antes de tudo, inclusive antes do catálogo interno por título) —
// usado pela rota quando a query já é reconhecida como ISBN.
export async function findInternalPublicationByIsbn13(db: D1Database, isbn13: string): Promise<BookMetadataResult | null> {
  const row = await db.prepare(`SELECT ${PUBLICATION_FIELDS} FROM publications WHERE isbn13=?`).bind(isbn13).first<PublicationRow>();
  return row ? toResult(row, 'EXACT') : null;
}

export async function searchInternalCatalog(db: D1Database, query: string): Promise<BookMetadataResult[]> {
  const [publications, aliases] = await Promise.all([
    db.prepare(`SELECT ${PUBLICATION_FIELDS} FROM publications ORDER BY updated_at DESC LIMIT ?`).bind(CATALOG_SCAN_LIMIT).all<PublicationRow>(),
    // Só aliases CONFIRMADOS entram na busca — um alias não confirmado nunca deve
    // influenciar o que outro usuário encontra (seção 7/8 do pedido: nada de
    // "tradução mágica" automática afetando resultados de terceiros).
    db.prepare(`SELECT p.id,p.title,p.subtitle,p.authors,p.publisher,p.publication_year,p.language,p.isbn10,p.isbn13,p.cover_url,a.title alias_title
      FROM publication_aliases a JOIN publications p ON p.id = a.publication_id WHERE a.confirmed = 1 LIMIT ?`).bind(CATALOG_SCAN_LIMIT).all<AliasRow>(),
  ]);

  const candidates: BookMetadataResult[] = [];
  for (const pub of publications.results) {
    const { confidence } = scoreTitleMatch(query, pub.title, pub.subtitle || undefined);
    if (meetsDisplayThreshold(confidence)) candidates.push(toResult(pub, confidence));
  }
  for (const row of aliases.results) {
    // Compara a query contra o ALIAS (o termo localizado), não contra o título
    // canônico — é exatamente isso que resolve "Rastro de Cthulhu" quando um
    // alias confirmado existir (caso C do pedido).
    const { confidence } = scoreTitleMatch(query, row.alias_title);
    if (meetsDisplayThreshold(confidence)) candidates.push(toResult(row, confidence, row.alias_title));
  }

  // A mesma Publication pode bater por título E por alias — mantém só a melhor confiança.
  const byPublication = new Map<string, BookMetadataResult>();
  for (const candidate of candidates) {
    const key = candidate.internalPublicationId!;
    const existing = byPublication.get(key);
    if (!existing || tierRank(candidate.confidence) > tierRank(existing.confidence)) byPublication.set(key, candidate);
  }
  return [...byPublication.values()].sort((a, b) => tierRank(b.confidence) - tierRank(a.confidence));
}
