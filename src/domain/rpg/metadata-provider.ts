// LIB-004: contrato de provider de metadata bibliográfica, independente de
// qualquer provider concreto — ver docs/library/METADATA_PROVIDERS.md. A UI e
// as rotas internas só conhecem este tipo; Open Library é o primeiro
// implementador (src/server/providers/open-library.ts), mas nada aqui
// depende dele.
import type { SearchConfidence } from './search-relevance';

// 'MANUAL' aparece aqui só porque um resultado de origem INTERNAL (catálogo já
// conhecido pelo RPG Manager — seção 9 do pedido LIB-004A) pode refletir uma
// Publication cuja provenance original é manual; não é uma nova fonte sendo
// gravada (reuso nunca reescreve provenance — ver buildCreateLibraryEntryStatements).
export type MetadataSource = 'MANUAL' | 'OPEN_LIBRARY' | 'URL_IMPORT';

// LIB-004A: de onde o candidato veio, para a UI diferenciar (não é o mesmo
// conceito de `MetadataSource`/provenance — um resultado INTERNAL não tem
// "fonte" nova, ele REUTILIZA a Publication já existente, com a provenance
// original intacta; ver docs/library/LIBRARY_ARCHITECTURE.md).
export type SearchResultOrigin = 'INTERNAL' | 'OPEN_LIBRARY' | 'URL_IMPORT';

// Tudo opcional exceto o mínimo para identificar/exibir o resultado — a Open
// Library nem sempre retorna todos os campos, e "não inventar campos
// ausentes" (seção 12 do pedido) significa que o mapeador nunca preenche um
// valor que o provider não forneceu.
export interface BookMetadataResult {
  source: MetadataSource;
  origin: SearchResultOrigin;
  /** LIB-004A: quão confiável é este candidato para a query digitada — ver src/domain/rpg/search-relevance.ts. Nunca EXACT/HIGH só por estar presente no upstream; sempre calculado localmente. */
  confidence: SearchConfidence;
  /** ID da Obra (Work) — não é ISBN, não é Edition. Seção 13 do pedido. */
  workId: string | null;
  /** ID da Edição específica — quando ausente, o resultado representa a Obra de forma geral (busca textual), não uma edição precisa. */
  editionId: string | null;
  /** LIB-004A: quando `origin === 'INTERNAL'`, o ID da Publication já existente no nosso catálogo — usado para reaproveitar em vez de criar uma nova (ver reusePublicationId em schemas.ts). */
  internalPublicationId?: string;
  /** LIB-004A: quando o match veio de um alias confirmado (ex.: título localizado), o alias que casou — só para a UI explicar o resultado, nunca persistido separadamente. */
  matchedAlias?: string;
  sourceUrl: string;
  title: string;
  subtitle?: string;
  /** Texto simples (ex.: "Fulano, Beltrano") — sem parsing estruturado, mesma convenção do restante do domínio (seção sobre não complicar sem necessidade). */
  authors?: string;
  publisher?: string;
  publicationYear?: number;
  /** Código de idioma curto conforme a Open Library retorna (ex.: "eng", "por") — sem tradução/normalização adicional. */
  language?: string;
  isbn10?: string;
  isbn13?: string;
  /** Sempre uma URL EXTERNA pública (covers.openlibrary.org ou a página importada) — o servidor nunca baixa a imagem em si para o nosso storage, só o navegador via <img>, mesma política de LIB-001. */
  coverUrl?: string;
  /** LIB-006: presente só quando `internalPublicationId` já é uma User Library Entry do usuário ATUAL (ativa ou arquivada) — ver src/domain/rpg/library-entry-state.ts. Nunca calculado a partir de outra conta. */
  libraryStatus?: 'ACTIVE_IN_LIBRARY' | 'ARCHIVED_IN_LIBRARY';
  /** LIB-006: ID da User Library Entry existente quando `libraryStatus` está presente — usado pela UI para linkar/oferecer Restaurar. */
  libraryEntryId?: string;
}

export interface BookMetadataProvider {
  search(query: string): Promise<BookMetadataResult[]>;
  lookupByIsbn(isbn13: string): Promise<BookMetadataResult | null>;
}

export class MetadataProviderError extends Error {
  constructor(public reason: 'TIMEOUT' | 'UPSTREAM_ERROR' | 'MALFORMED_RESPONSE', message: string) {
    super(message);
  }
}
