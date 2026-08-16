// LIB-004: contrato de provider de metadata bibliográfica, independente de
// qualquer provider concreto — ver docs/library/METADATA_PROVIDERS.md. A UI e
// as rotas internas só conhecem este tipo; Open Library é o primeiro
// implementador (src/server/providers/open-library.ts), mas nada aqui
// depende dele.

export type MetadataSource = 'OPEN_LIBRARY';

// Tudo opcional exceto o mínimo para identificar/exibir o resultado — a Open
// Library nem sempre retorna todos os campos, e "não inventar campos
// ausentes" (seção 12 do pedido) significa que o mapeador nunca preenche um
// valor que o provider não forneceu.
export interface BookMetadataResult {
  source: MetadataSource;
  /** ID da Obra (Work) — não é ISBN, não é Edition. Seção 13 do pedido. */
  workId: string | null;
  /** ID da Edição específica — quando ausente, o resultado representa a Obra de forma geral (busca textual), não uma edição precisa. */
  editionId: string | null;
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
  /** Sempre uma URL EXTERNA pública (covers.openlibrary.org) — o servidor nunca busca a imagem em si, só o navegador via <img>, mesma política de LIB-001. */
  coverUrl?: string;
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
