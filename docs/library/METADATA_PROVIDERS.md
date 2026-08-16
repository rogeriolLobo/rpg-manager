# Metadata Providers — Open Library (LIB-004: IMPLEMENTADO)

Desenhado em LIB-001, implementado em LIB-004. Ver
`docs/product/MASTER_BACKLOG.md` e `docs/library/PUBLICATION_IDENTITY.md`.

## Interface extensível (implementada em `src/domain/rpg/metadata-provider.ts`)

```ts
export type MetadataSource = 'OPEN_LIBRARY';

export interface BookMetadataResult {
  source: MetadataSource;
  workId: string | null;
  editionId: string | null;
  sourceUrl: string;
  title: string;
  subtitle?: string;
  authors?: string;       // texto simples ("Fulano, Beltrano"), não array
  publisher?: string;
  publicationYear?: number;
  language?: string;
  isbn10?: string;
  isbn13?: string;
  coverUrl?: string;       // sempre uma URL EXTERNA pública — nunca o servidor busca aqui
}

export interface BookMetadataProvider {
  search(query: string): Promise<BookMetadataResult[]>;
  lookupByIsbn(isbn13: string): Promise<BookMetadataResult | null>;
}
```

A UI (`OnlineSearchPanel`, `src/client/pages/library-pages.tsx`) só fala com
`GET /api/v1/rpgs/search-external?q=...` — nunca com `openlibrary.org`
diretamente. O backend (`src/server/routes/rpgs.ts`) resolve o provider
(`src/server/providers/open-library.ts`), esconde rate limit/erros de
terceiros do cliente e garante que o navegador nunca chama um host
arbitrário para a busca em si (a capa continua sendo carregada direto pelo
navegador — `<img>` — política inalterada desde LIB-001).

## Open Library — implementado (zero-cost, sem API key)

- Busca textual: `GET https://openlibrary.org/search.json?q=...&fields=key,title,subtitle,author_name,first_publish_year,publisher,language,isbn,cover_i,edition_key&limit=10` — só os campos usados (nunca `fields=*`, seção 4 do pedido). Retorna a **Obra** (Work) — `edition_key[0]`, quando presente, é só uma edição representativa, não uma seleção precisa.
- Lookup por ISBN: `GET https://openlibrary.org/isbn/{isbn13}.json` — retorna uma **Edição** (Edition) específica, mais precisa que a busca textual (seção 13 do pedido: Work ≠ Edition, `publications` representa uma edição). 404 é tratado como "não encontrado" (não é erro de provider).
- Capas: `https://covers.openlibrary.org/b/id/{coverId}-L.jpg`, construída a partir do Cover ID numérico retornado (`cover_i`/`covers[0]`) — nunca adivinhada, nunca buscada pelo servidor.
- **Host fixo, nunca vindo do usuário** — a query de busca é texto livre do usuário, mas o **destino** (`openlibrary.org`/`covers.openlibrary.org`) é hardcoded no provider. Diferente do fluxo de `coverUrl` externo (que aceita qualquer host HTTPS público porque só o navegador o busca) — aqui É o servidor que busca, então SSRF se aplica, mas contra um host fixo e conhecido, sem allowlist necessária.
- Identificação da aplicação: header `User-Agent` descritivo (`RPG-Manager/1.0 (+URL de produção; contato)`), sem secret, sem API key (Open Library não exige para este uso público de baixo volume).
- Timeout: `AbortSignal.timeout(5000)` em todo fetch — falha nunca derruba a Biblioteca, sempre um erro amigável (`502 PROVIDER_UNAVAILABLE`, mensagem "Você ainda pode cadastrar o livro manualmente").
- Rate limit local: endpoint autenticado + `DIRECTORY_RATE_LIMITER` (mesmo binding zero-cost já provisionado, chave prefixada `metadata-search:{userId}` para não competir com a busca de contas) — 30 buscas/60s por usuário.
- Uso responsável: busca só por ação explícita (botão "Buscar"/Enter, sem debounce automático a cada tecla), no máximo 10 resultados por busca, sem paginação profunda, sem crawling/sincronização em massa — exatamente o uso de "consulta pública de baixo volume" que a Open Library declara suportar.
- ISBN do provider **nunca é confiado cegamente**: todo ISBN retornado passa pelo validador de checksum real do LIB-003 (`src/domain/rpg/isbn.ts`) antes de ser usado como identidade — um ISBN malformado do provider é descartado, não persistido.
- Idioma/autor/editora: só mapeados quando presentes — nunca inventados quando ausentes (comum em registros de Edition, que às vezes não trazem autor; a busca por Work geralmente traz).

## Google Books — preparado, não ativado

Exige API key/OAuth para uso em produção com volume — incompatível com
a política Zero Cost sem uma conta paga associada. **Não implementado.**
A interface `BookMetadataProvider` já comporta adicionar um segundo
provider no futuro sem mudar a UI.

## Fluxo de busca (implementado)

```
Adicionar RPG/Livro
  [ Cadastro manual ] [ Buscar online ]

Buscar online:
[ Título, ISBN ou autor… ]  [ Buscar ]

Resultados (até 10):
  capa · título · subtítulo · autor(es) · editora · ano · ISBN
  [ Selecionar ]
```

## Preview antes de salvar (implementado — nunca é pulado)

1. Usuário busca → resultados exibidos (`OnlineSearchPanel`).
2. Usuário seleciona um resultado → o **mesmo formulário** do cadastro
   manual é preenchido com os dados resolvidos + um aviso "Dados de:
   Open Library. Revise antes de salvar." — essa tela já É o preview
   obrigatório (mesmos campos, editáveis, mesma validação de servidor).
3. Usuário pode editar qualquer campo antes de clicar "Salvar RPG"
   (mesmo botão do cadastro manual) ou voltar para "Buscar outro".
   Nenhum resultado é persistido só por ser selecionado.

## Provenance (implementado)

Cada publicação criada a partir de um resultado de busca registra, na
mesma transação da criação (nunca reescrito depois por um PATCH):

```
metadata_source = 'OPEN_LIBRARY' | 'MANUAL'
metadata_source_id    -- Edition ID preferido, Work ID como alternativa
metadata_source_url
metadata_fetched_at
```

e, em `publication_external_ids` (LIB-003), um registro por identificador
disponível (`WORK`/`EDITION`) — permite reencontrar a mesma Publication no
futuro mesmo sem ISBN em comum (seção 17 do pedido).

Edição manual de um campo específico depois de importado **não** apaga o
provenance da publicação como um todo — o PATCH nunca reescreve
`metadata_source`/`metadata_source_id`/etc, só os campos editoriais
visíveis, e só quando a Publication não está compartilhada (política do
LIB-003).

## Onde isso entra no modelo de dados

Ver `docs/library/LIBRARY_ARCHITECTURE.md` e
`docs/library/PUBLICATION_IDENTITY.md` — os campos de provenance e
`publication_external_ids` já existiam desde LIB-002/LIB-003; LIB-004 só
adicionou `publications.authors` (migration 0018) e passou a
efetivamente populá-los.
