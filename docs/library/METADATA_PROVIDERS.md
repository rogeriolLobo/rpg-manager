# Metadata Providers — Desenho (LIB-001)

**Status: DESENHADO, NÃO IMPLEMENTADO nesta sessão.** Ver
`docs/product/MASTER_BACKLOG.md`.

## Interface extensível

```ts
interface BookMetadataResult {
  source: 'OPEN_LIBRARY' | 'GOOGLE_BOOKS';
  sourceId: string;
  sourceUrl: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publisher?: string;
  publicationYear?: number;
  language?: string;
  isbn10?: string;
  isbn13?: string;
  coverUrl?: string; // sempre uma URL EXTERNA pública — nunca o servidor busca aqui
}

interface BookMetadataProvider {
  search(query: string): Promise<BookMetadataResult[]>;
  lookupByIsbn(isbn: string): Promise<BookMetadataResult | null>;
}
```

A UI nunca fala diretamente com uma API externa específica — só com
essa interface, resolvida no backend (evita expor rate limits/erros de
terceiros diretamente ao cliente e mantém a política de não fazer o
navegador chamar hosts arbitrários).

## Open Library — primeiro provider (zero-cost, sem API key)

- Busca por ISBN: `https://openlibrary.org/isbn/{isbn}.json`.
- Busca por título/autor: `https://openlibrary.org/search.json?q=...`.
- Capas: `https://covers.openlibrary.org/b/id/{coverId}-L.jpg` (usar o
  Cover ID/OLID retornado pela busca, não adivinhar a URL).
- **O servidor faz esse fetch** (para a API JSON do Open Library, não
  para a imagem) — isso É um fetch server-side real, então a proteção
  contra SSRF *se aplica aqui*, mas contra um host fixo e conhecido
  (`openlibrary.org`), não contra uma URL arbitrária do usuário — não
  precisa (e não deve) reusar `isPublicHttpsUrl`/allowlist de capas
  para isso; o host é hardcoded no provider.
- Rate limit: respeitar os limites da Open Library (não documentados
  formalmente como número fixo, mas a prática recomendada é debounce
  no cliente antes de disparar busca — nunca uma request por tecla —
  e cache de resultado por sessão/ISBN para não repetir a mesma busca).
- Idioma: Open Library nem sempre retorna idioma consistente — mapear
  só quando presente, nunca inventar.

## Google Books — preparado, não ativado

Exige API key/OAuth para uso em produção com volume — incompatível com
a política Zero Cost sem uma conta paga associada (mesmo o tier
gratuito exige cadastro/possível necessidade futura de billing).
**Não implementar agora.** A interface `BookMetadataProvider` já
comporta adicionar um segundo provider no futuro sem mudar a UI, só
implementando `search`/`lookupByIsbn` para a API do Google Books
quando/se o produto decidir assumir esse custo/complexidade.

## Fluxo de busca (UI)

```
Adicionar RPG/Livro
[ ISBN ou título ]  [ Buscar ]

Resultados:
  capa · título · autor(es) · editora · ano · ISBN
  [ Selecionar ]
```

## Preview antes de salvar (obrigatório)

Nenhum resultado externo é salvo automaticamente. Fluxo:

1. Usuário busca → resultados exibidos.
2. Usuário seleciona um resultado → **preview** (mesmos campos que
   seriam salvos, fonte visível, capa visível).
3. Usuário pode **aceitar** (preenche o formulário, ainda sem salvar —
   o Salvar RPG continua sendo o mesmo botão/fluxo de sempre),
   **editar** (ajusta campos antes de salvar) ou **cancelar** (volta à
   busca/formulário vazio).

## Provenance

Cada publicação criada ou atualizada a partir de um provider registra:

```
metadata_source = 'OPEN_LIBRARY' | 'GOOGLE_BOOKS' | 'MANUAL'
metadata_source_id
metadata_source_url
metadata_fetched_at
```

Edição manual de um campo específico depois de importado **não** apaga
o provenance da publicação como um todo (o registro de onde veio o
cadastro original é histórico), mas o produto pode, no futuro, marcar
campo a campo se foi editado manualmente após o import — fora do
escopo desta sessão, só citado para não fechar essa porta na
arquitetura.

## Onde isso entra no modelo de dados

Ver `docs/library/LIBRARY_ARCHITECTURE.md` (Opção A) — os campos de
provenance vivem na tabela `publications`, não em `rpgs`/estado
pessoal.
