# Metadata Providers — Open Library + catálogo interno + import por URL (LIB-004/LIB-004A: IMPLEMENTADO)

Desenhado em LIB-001, implementado em LIB-004, qualidade de busca corrigida em
LIB-004A. Ver `docs/product/MASTER_BACKLOG.md` e
`docs/library/PUBLICATION_IDENTITY.md`.

## Incidente real que originou o LIB-004A

Busca em produção por **"Rastro de Cthulhu"** (nome em português do RPG
*Trail of Cthulhu*, de Kenneth Hite/Pelgrane Press) retornava como único
resultado **"The Trail of Cthulhu"**, uma antologia de ficção de August
Derleth de 1945 — completamente errado, e apresentado como se fosse um match
confiável.

Causa raiz, reproduzida diretamente contra a API real antes de qualquer
mudança de código:

```
GET https://openlibrary.org/search.json?q=Rastro%20de%20Cthulhu
{"numFound":1, "docs":[{"title":"The Trail of Cthulhu","author_name":["August Derleth"], ...}]}
```

A Open Library é uma busca full-text ampla (Solr) sobre metadata de todas as
edições/traduções do catálogo; para essa query ela encontrou **um único
resultado fracamente relacionado** (correspondência textual difusa) e o
retornou como se fosse relevante. Até esta tarefa, o provider aceitava
**qualquer** doc retornado pelo upstream como um resultado válido — não havia
nenhum conceito de confiança/relevância calculado pelo nosso lado. Não era um
caso de "a Open Library não tem o livro" (ela tem: `9781934859070`, Work
`OL19907627W`, Edition `OL27092590M`) — era a ausência de um filtro de
relevância local.

## Confiança/relevância — calculada localmente, nunca herdada do provider

`src/domain/rpg/search-relevance.ts` (puro, sem D1/fetch): compara a query do
usuário contra `title`/`subtitle` de cada candidato, normalizando (NFKD,
remove diacríticos, minúsculas, stopwords curtas pt/en/es) e calculando
sobreposição de tokens (Jaccard) + contenção textual. Produz um tier:

```
EXACT   — igualdade textual literal (após normalização) ou identificador confiável (ISBN, alias confirmado)
HIGH    — forte sobreposição textual (contenção + Jaccard>=0.5, ou Jaccard>=0.75)
MEDIUM  — sobreposição textual moderada (Jaccard>=0.4)
LOW     — abaixo disso (nunca exibido)
```

**Nada abaixo de `MEDIUM` chega à resposta da API.** É melhor devolver uma
lista vazia ("Nenhum resultado confiável encontrado") do que apresentar um
livro errado — essa é a regra que resolve o incidente: "Rastro de Cthulhu"
contra "The Trail of Cthulhu" tem só um token em comum (`cthulhu`) de três
tokens significativos, Jaccard ≈ 0.33, tier `LOW` → filtrado.

### Sinal de assunto (RPG-aware, seção 5)

Quando o provider retorna `subject` (Open Library sempre pode, se pedido em
`fields`), assuntos que indicam jogo/RPG (`"role playing"`, `"fantasy
games"`, `"war games"`, etc. — lista curta em
`RPG_SUBJECT_KEYWORDS`) **amplificam** um resultado já `MEDIUM` para `HIGH`.
Nunca eleva `LOW` (não pode inventar relevância textual que não existe) nem
promove a `EXACT`. **Não é uma allowlist de editoras** — uma editora
desconhecida ainda pode publicar um RPG; o sinal é sempre sobre o *assunto*
retornado pelo provider, nunca sobre o nome de quem publicou.

## Interface extensível (`src/domain/rpg/metadata-provider.ts`)

```ts
export type MetadataSource = 'MANUAL' | 'OPEN_LIBRARY' | 'URL_IMPORT';
export type SearchResultOrigin = 'INTERNAL' | 'OPEN_LIBRARY' | 'URL_IMPORT';

export interface BookMetadataResult {
  source: MetadataSource;
  origin: SearchResultOrigin;       // LIB-004A: de onde o candidato veio nesta busca
  confidence: SearchConfidence;     // LIB-004A: EXACT | HIGH | MEDIUM | LOW — sempre calculado localmente
  workId: string | null;
  editionId: string | null;
  internalPublicationId?: string;   // LIB-004A: quando origin=INTERNAL, ID da Publication já existente
  matchedAlias?: string;            // LIB-004A: qual alias confirmado casou (só para UI explicar)
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
```

A UI (`OnlineSearchPanel`, `src/client/pages/library-pages.tsx`) só fala com
`GET /api/v1/rpgs/search-external?q=...` e `POST /api/v1/rpgs/import-url` —
nunca com hosts externos diretamente.

## Pipeline de busca (`GET /rpgs/search-external`, implementado)

```
query é ISBN?
  sim → catálogo interno por ISBN (findInternalPublicationByIsbn13)
        encontrado? retorna (EXACT, origin=INTERNAL)
        não → Open Library lookupByIsbn (EXACT, origin=OPEN_LIBRARY)
  não → catálogo interno por título + aliases confirmados (searchInternalCatalog)
        + Open Library search (filtrado por confiança, RPG-aware)
        → catálogo interno SEMPRE primeiro na lista (seção 9 do pedido)
```

Catálogo interno primeiro porque cada nova Publication cadastrada enriquece o
catálogo compartilhado — uma busca futura pelo mesmo título/ISBN/alias
encontra direto, sem precisar da Open Library. `Publication` não tem dono
(mesmo modelo de `categories`/`subgenres` desde LIB-002); a busca cobre TODO
o catálogo compartilhado, nunca notas/estado pessoal de outro usuário.

### Catálogo interno + aliases (`src/server/search/internal-catalog.ts`, migration `0019_publication_aliases.sql`)

```sql
CREATE TABLE publication_aliases (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'MANUAL' CHECK(source IN ('MANUAL','OPEN_LIBRARY','URL_IMPORT')),
  confirmed INTEGER NOT NULL DEFAULT 0,   -- só confirmed=1 entra na busca
  created_at TEXT NOT NULL
);
```

Resolve exatamente o caso "Rastro de Cthulhu": um alias confirmado
`{ publication_id: <Trail of Cthulhu>, title: "Rastro de Cthulhu" }` faz a
busca por "Rastro de Cthulhu" encontrar a Publication certa (`origin:
INTERNAL`, `matchedAlias: "Rastro de Cthulhu"`), sem depender de tradução
automática nenhuma (seção 8: nunca "tradução mágica" — mapeamentos vêm de
confirmação humana, nunca de heurística). **Não há UI de administração de
aliases nesta tarefa** — o schema e o caminho de leitura (busca) estão
prontos e testados (`tests/integration/search-relevance-and-import.test.ts`,
caso "alias confirmado"); a escrita de aliases fica para quando houver um
fluxo real de confirmação (ex.: usuário confirmando "isto é a mesma obra"),
deliberadamente fora de escopo agora.

Seleção de um resultado `INTERNAL` nunca cria uma nova Publication nem
reescreve provenance — `reusePublicationId` (validado contra o banco real no
servidor, nunca confiado cegamente) tem prioridade máxima em
`buildCreateLibraryEntryStatements`, acima até de external ID/ISBN.

Limite defensivo: a leitura do catálogo interno é limitada a 500
Publications/aliases por busca (`CATALOG_SCAN_LIMIT`) — suficiente para a
escala atual (dezenas de linhas); documentado como limite conhecido, não uma
quota de produto.

## Open Library — implementado (zero-cost, sem API key)

- Busca textual: `GET https://openlibrary.org/search.json?q=...&fields=key,title,subtitle,author_name,first_publish_year,publisher,language,isbn,cover_i,edition_key,subject&limit=10` — só os campos usados (nunca `fields=*`). `subject` (LIB-004A) alimenta o sinal RPG-aware. Retorna a **Obra** (Work).
- Lookup por ISBN: `GET https://openlibrary.org/isbn/{isbn13}.json` — retorna uma **Edição** (Edition) específica, sempre `confidence: EXACT` (identificador confiável, não precisa de score textual). 404 é tratado como "não encontrado".
- Capas: `https://covers.openlibrary.org/b/id/{coverId}-L.jpg`, construída a partir do Cover ID numérico — nunca adivinhada, nunca buscada pelo servidor. **Nunca baixamos automaticamente capas da Open Library para storage próprio** (desperdiçaria quota — seção 24 do pedido LIB-004A) — cover continua sendo carregada só pelo navegador via `<img>`.
- **Host fixo, nunca vindo do usuário** para a busca. Diferente do fluxo de importação por URL (abaixo), onde o host É fornecido pelo usuário.
- Timeout, rate limit, User-Agent, "não confiar cegamente em ISBN" — inalterados desde LIB-004 (ver seções anteriores deste arquivo no histórico do repositório).
- Se a Open Library falhar (timeout/5xx/malformado) mas o catálogo interno já tiver resultado, a busca **não falha inteira** — só retorna o que o catálogo interno encontrou (seção 8 do pedido original, agora estendida ao pipeline de duas fontes).

## Google Books — preparado, não ativado

Exige API key/OAuth para uso em produção com volume — incompatível com a
política Zero Cost. **Não implementado.**

## Importação por URL oficial (`POST /rpgs/import-url`, implementado — LIB-004A)

Fallback dentro do mesmo painel de busca: "Não encontrou? Importar de uma
página oficial". Único fluxo do domínio de metadata em que o **host vem do
usuário** — por isso a superfície de SSRF é tratada à parte, nunca reutiliza
a regra simplificada de `coverUrl` (`shared/security/cover-url.ts`, que só
protege o que o *navegador* carrega via `<img>`, nunca faz fetch no
servidor).

### `src/server/security/url-import.ts` — proteção SSRF

- **Só HTTPS**, sem credenciais na URL, sem porta não-padrão.
- Bloqueia por hostname/IP-literal: `localhost` e variantes, loopback
  (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16` — inclui endpoints de
  metadata de cloud, `fe80::/10`), RFC1918 (`10/8`, `172.16/12`,
  `192.168/16`), CGNAT (`100.64.0.0/10`), faixas de documentação/reservadas,
  IPv4 mapeado em IPv6 (`::ffff:...`, incluindo a forma hexadecimal que o
  parser WHATWG normaliza).
- **Limitação honesta, documentada no próprio código**: o runtime de Workers
  não expõe resolução DNS prévia — `fetch()` resolve o host de forma opaca.
  Não é possível validar o IP real de conexão antes do fetch (proteção
  completa contra DNS rebinding exigiria controlar a resolução). Mitigado em
  profundidade por: bloqueio de IP-literal (cobre os vetores óbvios), HTTPS
  obrigatório, timeout curto, limite de tamanho de resposta, e revalidação de
  **cada** redirect antes de segui-lo (nunca `redirect:'follow'` automático —
  no máximo 3 saltos, cada `Location` revalidado do zero).
- Content-Type restrito a `text/html`/`application/xhtml+xml` — nunca tenta
  interpretar um PDF/binário como página de produto.
- Limite de resposta: 2MB, lido via stream com corte antecipado.
- Timeout: 5s.
- Rate limit local: `DIRECTORY_RATE_LIMITER` reaproveitado, chave
  `url-import:{userId}`.

### Extração de metadata (`extractPageMetadata`)

Prioridade JSON-LD > OpenGraph > `<title>`/`<meta name="description">`,
usando `HTMLRewriter` (API nativa de Workers, sem dependência nova):

1. `<script type="application/ld+json">` — procura um nó `@type: Book` ou
   `Product` (schema.org), inclusive dentro de `@graph`; extrai
   `name`/`author`/`publisher`/`datePublished`/`isbn`/`image`/`description`.
2. Sem JSON-LD utilizável: `og:title`/`og:image`/`og:description`.
3. Nenhuma metadata reconhecível: `422 IMPORT_NO_METADATA`, mensagem
   amigável — nunca crasha, cadastro manual continua disponível.

ISBN extraído é **revalidado pelo checksum real** (LIB-003) antes de ser
usado — nunca confiado cegamente, mesmo princípio da Open Library.
`confidence` de um resultado importado é sempre `HIGH` (é uma escolha
direcionada do usuário para uma página específica, não uma busca textual
ambígua) — o preview continua obrigatório de qualquer forma.

## Fluxo de busca (implementado)

```
Adicionar RPG/Livro
  [ Cadastro manual ] [ Buscar online ]

Buscar online:
[ Título, ISBN ou autor… ]  [ Buscar ]

Resultados (catálogo interno primeiro, até 10 no total):
  capa · título · subtítulo · autor(es) · editora · ano · ISBN · origem
  [ Selecionar ]

Nenhum resultado confiável?
  [ Não encontrou? Importar de uma página oficial ]
  URL → preview → confirmar
```

## Preview antes de salvar (implementado — nunca é pulado)

1. Usuário busca → resultados exibidos (`OnlineSearchPanel`), cada um já
   rotulado com a origem (catálogo interno / Open Library / importado).
2. Usuário seleciona um resultado → o **mesmo formulário** do cadastro
   manual é preenchido com os dados resolvidos + um aviso de origem
   (`"Já existe no catálogo do RPG Manager."` / `"Dados de: Open
   Library."` / `"Dados importados de uma página externa."`) — essa tela já
   É o preview obrigatório.
3. Usuário pode editar qualquer campo antes de "Salvar RPG" ou voltar para
   "Buscar outro". Nenhum resultado é persistido só por ser selecionado.

## Provenance (implementado)

Cada publicação criada a partir de um resultado de busca registra, na mesma
transação da criação (nunca reescrito depois por um PATCH):

```
metadata_source = 'OPEN_LIBRARY' | 'URL_IMPORT' | 'MANUAL'
metadata_source_id    -- Edition ID preferido (Open Library), Work ID como alternativa
metadata_source_url
metadata_fetched_at
```

Um resultado `INTERNAL` (catálogo já conhecido) **nunca** grava provenance
nova — ele reaproveita a Publication existente por `reusePublicationId`, com
a provenance original intacta (pode ser `MANUAL`, `OPEN_LIBRARY` ou
`URL_IMPORT`, o que já estava lá).

`publications.metadata_source` deixou de ter uma lista fechada de valores no
banco (migration `0020_publication_metadata_source_open.sql` — rebuild
seguro, só relaxa o `CHECK` para `length BETWEEN 1 AND 40`, preserva 100% das
linhas): a cada novo provider (ex.: um futuro Google Books) não é mais
necessária uma migration só para isso — o Zod (`shared/validation/schemas.ts`)
continua sendo a autoridade real de quais fontes são aceitas.

## Onde isso entra no modelo de dados

Ver `docs/library/LIBRARY_ARCHITECTURE.md` e
`docs/library/PUBLICATION_IDENTITY.md`. Migrations desta tarefa:
`0019_publication_aliases.sql` (nova tabela, aditiva) e
`0020_publication_metadata_source_open.sql` (rebuild seguro de
`publications`, preserva todas as linhas — ver seção acima).
