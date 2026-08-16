# Biblioteca — Decisão de Arquitetura (LIB-001)

## Decisão sobre o bug de coverUrl (implementada nesta sessão)

Ver `docs/library/COVER_STORAGE.md` para o desenho completo (atual +
futuro). Resumo da mudança já em produção: `coverUrl` deixou de ser
validada contra uma allowlist fixa de hosts + fetch do servidor, e
passou a ser validada só sintaticamente (HTTPS público, sem IP privado/
loopback, sem protocolo perigoso) — porque o servidor nunca busca essa
URL, só o navegador (`<img src>`). A CSP (`img-src`) foi ajustada em
conjunto para não bloquear no navegador o que o servidor já aceita.

## Decisão sobre o modelo de domínio (System → Publication → User State)

**Decisão: recomendar a evolução, mas NÃO implementá-la nesta sessão.**

### Por quê não agora

A separação proposta (`GameSystem` → `Publication` → estado pessoal por
usuário) é uma mudança de domínio real, não um ajuste de bug. Ela exige:

- nova(s) tabela(s) (`game_systems`, `publications` e uma tabela de
  associação `user_publications` para o estado pessoal — o `rpgs` atual
  viraria essa terceira tabela);
- migração de dados dos 30 registros reais de produção, preservando
  100% do conteúdo (nenhum campo pode ser perdido);
- reescrita de toda a camada de leitura (`present()`, filtros, busca,
  paginação, recomendação) para fazer `JOIN` em vez de `SELECT *`;
- reescrita do importer CSV para o novo modelo de duas (ou três)
  entidades;
- ampla bateria de testes de regressão para garantir que os 30 RPGs
  reais continuam idênticos, campo a campo, depois da migração.

Fazer isso com o mesmo rigor aplicado ao resto desta sessão (audit →
implement → test first → CI → deploy → smoke) não cabe com segurança na
mesma sessão que já corrigiu dois incidentes de produção e auditou o
1.0 inteiro. Implementar às pressas violaria diretamente a instrução do
próprio responsável do produto: "não faça feature pela metade" e "não
rewrite automaticamente".

### Caminho ADITIVO recomendado (quando for feito)

Duas opções avaliadas:

**Opção A — Tabelas novas, migração posterior (recomendada).**

```sql
CREATE TABLE game_systems (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  game_system_id TEXT REFERENCES game_systems(id) ON DELETE RESTRICT,
  publication_type TEXT NOT NULL CHECK(publication_type IN (
    'CORE_RULEBOOK','PLAYER_GUIDE','GM_GUIDE','SUPPLEMENT','SETTING',
    'ADVENTURE','ONE_SHOT','CAMPAIGN','BESTIARY','SCREEN','OTHER')),
  title TEXT NOT NULL,
  subtitle TEXT,
  edition TEXT,
  publisher TEXT,
  publication_year INTEGER,
  language TEXT,
  isbn10 TEXT,
  isbn13 TEXT,
  authors TEXT NOT NULL DEFAULT '[]',        -- JSON array
  description TEXT NOT NULL DEFAULT '',
  cover_type TEXT NOT NULL DEFAULT 'NONE' CHECK(cover_type IN ('NONE','EXTERNAL_URL','UPLOAD')),
  cover_asset_id TEXT,                       -- KV key, quando cover_type=UPLOAD
  external_cover_url TEXT,                   -- quando cover_type=EXTERNAL_URL
  cover_source_url TEXT,
  cover_source_note TEXT,
  metadata_source TEXT NOT NULL DEFAULT 'MANUAL' CHECK(metadata_source IN ('MANUAL','OPEN_LIBRARY','GOOGLE_BOOKS')),
  metadata_source_id TEXT,
  metadata_source_url TEXT,
  metadata_fetched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_publications_isbn13 ON publications(isbn13) WHERE isbn13 IS NOT NULL;

-- rpgs vira o "estado pessoal": renomear seria destrutivo demais; o caminho
-- aditivo é uma nova coluna nullable publication_id em rpgs, preenchida por
-- uma migration de dados (não de schema) num passo separado e reversível.
ALTER TABLE rpgs ADD COLUMN publication_id TEXT REFERENCES publications(id) ON DELETE SET NULL;
```

Isso é aditivo (`ALTER TABLE ADD COLUMN` nullable, `CREATE TABLE` novas)
— nenhum dado existente é tocado na migration de schema. A migração de
DADOS (criar uma `publication` para cada `rpgs` existente e apontar
`publication_id`) é um passo **separado**, escrito como script
idempotente, testado em D1 local com uma cópia dos 30 registros antes
de rodar contra produção — nunca como parte automática do deploy.

Os campos hoje em `rpgs` que são claramente editoriais (`cover_url`,
`isbn`, `cover_source_url`, `cover_source_note`) migrariam para
`publications`; os campos de estado pessoal (`reading_status`,
`has_played`, `wants_to_play`, `priority`, `play_group_notes`,
`play_group_id`, `planned_play_date`, `table_status`, `game_master`,
`notes`) continuam em `rpgs`, que passa a ser conceitualmente
`user_library_entries`.

**Opção B — manter tudo em `rpgs` indefinidamente.** Mais simples, mas
não suporta o requisito futuro de duas pessoas terem o mesmo livro na
biblioteca sem duplicar metadata, nem dedup real por ISBN entre
usuários diferentes. Viável só se o produto nunca precisar de
compartilhamento de biblioteca entre contas (contradiz a seção 27 do
pedido, que pede que a arquitetura não impeça isso no futuro).

**Recomendação: Opção A, em uma sessão dedicada**, com o mesmo processo
rigoroso (arquiteto → backend → frontend → QA → devops) usado nesta.

### LIB-003 — Identidade, ISBN, provenance e deduplicação segura (implementado)

Ver `docs/library/PUBLICATION_IDENTITY.md` para o desenho completo. Resumo
das decisões que alteram o que este documento (seção "LIB-002 —
Implementado", acima) descrevia como escopo do LIB-002:

- **Reuso/dedup entre criações passou a existir**, restrito a identidade
  exata de ISBN-13 (direto ou derivado de ISBN-10) — a decisão de LIB-002
  de "sempre criar Publication distinta" foi deliberadamente revista
  agora que existe uma política de segurança para metadata compartilhada
  (abaixo), fechando a lacuna que LIB-002 tinha deixado em aberto.
- **Política de metadata compartilhada**: editável livremente enquanto a
  Publication tiver 1 única User Library Entry; bloqueada
  (`422 SHARED_PUBLICATION_METADATA_LOCKED`) quando compartilhada por
  mais de uma conta. Estado pessoal nunca é afetado por essa trava.
- **`rpgs.publication_id` agora é único por `user_id`**
  (`idx_rpgs_user_publication_unique`) — uma biblioteca não pode ter duas
  entries para a mesma Publication.
- **`publications.isbn13`/`isbn10` agora são únicos** (índices parciais)
  — identidade real de Publication a partir desta migration.
- Título continua nunca sendo usado para decidir reuso (só ISBN).

## O que a Opção A NÃO muda

- Nenhum RPG existente é perdido ou alterado incorretamente (migração
  de dados testada e reversível antes de tocar produção).
- A API pública (`GET/POST/PATCH /rpgs`) pode continuar retornando o
  formato atual (achatado) por compatibilidade, com `present()` fazendo
  o `JOIN` internamente — o frontend não precisa mudar no dia da
  migration.
- `UNIQUE(user_id, title)` pode ser substituído por dedup real (ISBN
  primeiro, provider+ID depois, título só como último recurso com
  preview de conflito) sem quebrar RPGs que não têm ISBN.

## Separação metadata editorial × estado pessoal

Já é conceitualmente clara no código atual (`present()` distingue os
dois grupos de campos na resposta), só não é fisicamente separada em
tabelas. A Opção A formaliza fisicamente uma separação que já existe
logicamente — reduz risco de "vazamento" de provenance externa para
campos pessoais (seção 19 do pedido), porque campos de metadata (com
`metadata_source`) passam a viver numa tabela que só o dono da
publicação (ou, no futuro, qualquer usuário que a referencie) edita,
separada da tabela de estado pessoal por usuário.

## Suporte a publicações futuras (System → Core Book → Adventure → Campaign)

A Opção A já modela isso via `publication_type` (`CORE_RULEBOOK`,
`ADVENTURE`, `ONE_SHOT`, `CAMPAIGN`, etc.) — não precisa de mudança
adicional de schema para isso no futuro, só popular o enum conforme o
produto evoluir.

---

## LIB-002 — Implementado (migration `0016_library_domain_normalization.sql`)

A Opção A acima foi implementada nesta sessão, com os ajustes de escopo
abaixo (documentados porque divergem ou detalham o desenho original).

### Escopo de criação: sem reuso/dedup nesta versão

`game_systems`/`publications` **não têm coluna `user_id`** (são
fisicamente tabelas de catálogo, não de estado por usuário — o mesmo
padrão já usado por `categories`/`subgenres`), mas o **comportamento**
de escrita do LIB-002 é 1:1: toda criação (manual ou import) sempre gera
um novo `game_systems` + `publications`, nunca reaproveita uma linha
existente, mesmo com título ou ISBN idênticos (dentro da mesma conta ou
entre contas diferentes). `UNIQUE(user_id, title)` em `rpgs` continua
sendo a única defesa contra duplicata, exatamente como antes desta
migration.

Isso é deliberado, não uma limitação esquecida: a seção 13 do pedido que
motivou o LIB-002 exige que "cada publication tenha apenas um owner
associado" nesta fase, e a seção 14 proíbe transformar `publications` em
catálogo compartilhado sem revisão de segurança dedicada. Dedup real por
ISBN (seção 15) e reuso entre contas (habilitando "biblioteca visível
para amigos" no futuro) ficam para uma sessão futura com desenho de
autorização próprio — a física das tabelas já suporta isso sem nova
migration de schema quando chegar a hora.

### category_id/subgenre_id continuam em `rpgs`

Auditados como conceitualmente pertencentes ao catálogo (Game System),
não ao estado pessoal — mas **não foram movidos** nesta migration.
Mover exigiria uma segunda mudança de schema não relacionada (adicionar
as colunas em `game_systems`, migrar os dados, reescrever todas as
queries de filtro/busca/contagem que hoje leem `r.category_id`/
`r.subgenre_id` diretamente) — fora do escopo de "uma fundação por vez".
Fica registrado como candidato a uma sessão futura, não como pendência
esquecida.

### Fonte de verdade após o cutover

`publications` é a fonte de verdade para `title`/`coverUrl`/`isbn`/
`coverSourceUrl`/`coverSourceNote` — todo `SELECT` do app usa o JOIN
canônico (`src/server/routes/library-writes.ts`, `LIBRARY_ENTRY_JOIN`).
As colunas homônimas em `rpgs` continuam fisicamente na tabela (nenhuma
coluna foi removida — migration aditiva) mas **não são mais escritas**
pelo app após esta migration, exceto `rpgs.title`: essa continua sendo
escrita em paralelo (dual-write) porque `UNIQUE(user_id, title)` e
`NOT NULL CHECK` são constraints físicas da tabela `rpgs` que a
aplicação não pode deixar de satisfazer sem uma migration destrutiva de
schema (fora de escopo aqui). As demais (`cover_url`, `isbn`,
`cover_source_url`, `cover_source_note` em `rpgs`) ficam congeladas no
valor que tinham no momento da migration — mantidas apenas como rede de
segurança para rollback lógico, nunca lidas pelo app.

### `archived_at`

Coluna aditiva adicionada em `rpgs` (nullable, nunca definida por nenhum
código desta sessão) — arquitetura pronta para F-011 (Archive de RPG),
que continua `NOT_STARTED` e fora de escopo do LIB-002.

### O que NÃO mudou (compatibilidade)

- Nenhum endpoint novo (`/game-systems`, `/publications`) — não fazia
  sentido nesta fase (seção 19 do pedido).
- `GET/POST/PATCH /rpgs` continuam com o mesmo formato de payload
  achatado — o frontend (`library-pages.tsx`) não precisou mudar.
- Import CSV usa a mesma camada canônica de escrita do cadastro manual
  (`buildCreateLibraryEntryStatements`, `src/server/routes/library-writes.ts`).

## LIB-004 — Busca online de publicações / Open Library (implementado)

Ver `docs/library/METADATA_PROVIDERS.md` para o desenho completo do
provider e `docs/library/PUBLICATION_IDENTITY.md` para a política de
segurança de metadata compartilhada (reaproveitada sem alteração — um
resultado de busca confirmado passa pelo mesmo `buildCreateLibraryEntryStatements`
do LIB-002/003, sem caminho paralelo). Resumo do que muda:

- **`GET /api/v1/rpgs/search-external`** (novo, único endpoint novo desta
  tarefa): autenticado, rate limit local (`DIRECTORY_RATE_LIMITER`
  reaproveitado com chave própria — nenhum recurso Cloudflare novo),
  detecta ISBN na query (lookup exato) vs busca textual, timeout de 5s,
  nunca propaga erro cru do provider (`502 PROVIDER_UNAVAILABLE` com
  mensagem amigável). Não persiste nada — só devolve candidatos.
- **`rpgInputSchema` ganhou campos opcionais**: `subtitle`, `publisher`,
  `publicationYear`, `language`, `publicationType`, `authors`,
  `metadataSource`, `metadataSourceId`, `metadataSourceUrl`,
  `metadataFetchedAt`, `externalWorkId`, `externalEditionId` — todos
  opcionais, cadastro manual não envia nenhum (fica `MANUAL`/em branco).
- **`buildCreateLibraryEntryStatements` ganhou uma 3ª prioridade de
  resolução de identidade**: Edition ID externo → Work ID externo → ISBN
  (LIB-003) → nenhuma correspondência. Ao criar uma Publication nova,
  agora também grava os campos ricos (`subtitle`/`publisher`/
  `publication_year`/`language`/`authors`/provenance) e insere em
  `publication_external_ids` (`INSERT OR IGNORE`, nunca duplica nem
  reatribui um external ID já usado por outra Publication).
- **`buildUpdateLibraryEntryStatements` ganhou os mesmos campos ricos na
  trava de metadata compartilhada** (LIB-003) — editar subtítulo/
  editora/ano/idioma/tipo/autores de uma Publication com 2+ referências
  é bloqueado do mesmo jeito que título/ISBN/capa já eram.
- **PATCH nunca resolve identidade nem reescreve provenance/external
  IDs** — isso só acontece no CREATE (busca → seleção → preview →
  confirmar é sempre um create). Editar um RPG existente nunca "rebusca"
  Open Library nem troca a origem registrada do dado.
- **Frontend**: `OnlineSearchPanel` (novo componente) + `mode` de
  `RpgFormFields` (`manual` | `search` | `preview`) — "manual" continua
  sendo o padrão/imediatamente visível ao abrir `/app/library/new` (sem
  isso, os fluxos E2E e o cadastro manual existentes quebrariam). Selecionar
  um resultado preenche o MESMO formulário do cadastro manual — essa tela
  já é o preview obrigatório (seção 18 do pedido), não uma tela separada.
- **Migration 0018** (aditiva): `ALTER TABLE publications ADD COLUMN
  authors` — único campo novo necessário (subtitle/publisher/
  publication_year/language/publication_type/metadata_source* já
  existiam desde a migration 0016 do LIB-002, só não eram populados).

### Testando fetch server-side em `@cloudflare/vitest-pool-workers`

Descoberta desta sessão, registrada para não ser redescoberta: mockar
`fetch` global via `vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new
Response(...)))` falha com `"Cannot perform I/O on behalf of a different
request"` quando o código sob teste roda dentro de
`exports.default.fetch()` (o handler HTTP real) — a `Response` mockada é
criada fora do contexto de request em que é consumida, e Workers proíbe
isso (streams de I/O são amarrados ao request que os criou). Correção:
usar `mockImplementation(() => Promise.resolve(new Response(...)))` —
cria a `Response` só quando `fetch()` é de fato chamado, dentro do
request real. Ver `tests/integration/metadata-search.test.ts`.

## LIB-004A — Qualidade da busca online / catálogo interno / import por URL (implementado)

Reabertura do LIB-004: um bug funcional real em produção (busca por "Rastro
de Cthulhu" retornava um livro de ficção completamente errado — ver
`docs/library/METADATA_PROVIDERS.md` para a causa raiz completa, reproduzida
contra a API real antes de qualquer mudança de código). Resumo do que muda:

- **`src/domain/rpg/search-relevance.ts`** (novo, puro): normalização de
  título para comparação (NFKD, remove diacríticos, stopwords curtas
  pt/en/es), scoring por sobreposição de tokens (Jaccard) + contenção
  textual, tiers `EXACT`/`HIGH`/`MEDIUM`/`LOW`. Abaixo de `MEDIUM` nunca é
  exibido. Sinal de assunto (`subject` da Open Library, ex.: "Fantasy
  games") amplifica `MEDIUM`→`HIGH`, nunca inventa relevância a partir do
  zero nem promove a `EXACT` — nunca é uma allowlist de editoras.
- **`BookMetadataResult` ganhou `origin`/`confidence`/`internalPublicationId`/
  `matchedAlias`** (`src/domain/rpg/metadata-provider.ts`) — todo resultado,
  de qualquer fonte, carrega uma confiança calculada localmente.
- **`GET /rpgs/search-external` virou um pipeline de duas fontes**:
  catálogo interno (`src/server/search/internal-catalog.ts` — título das
  Publications já cadastradas + aliases confirmados) sempre primeiro, depois
  Open Library (agora filtrada por confiança). Se a Open Library falhar mas o
  catálogo interno tiver resultado, a busca não falha inteira.
- **Migration `0019_publication_aliases.sql`** (aditiva, nova tabela): título
  alternativo/localizado de uma Publication (ex.: "Rastro de Cthulhu" →
  "Trail of Cthulhu"). Só aliases `confirmed=1` entram na busca — nunca
  influenciam resultado de outro usuário por engano. Sem UI de administração
  nesta tarefa (escrita fica para um fluxo de confirmação futuro); leitura
  testada de ponta a ponta.
- **`reusePublicationId`** (`rpgInputSchema`, `buildCreateLibraryEntryStatements`):
  prioridade máxima na resolução de identidade (acima de external
  ID/ISBN) — selecionar um resultado `INTERNAL` reaproveita a Publication
  existente por ID, revalidado no servidor, nunca reescreve provenance.
- **`POST /rpgs/import-url`** (novo): fallback "Importar de uma página
  oficial" — único fluxo do domínio de metadata em que o host vem do
  usuário. SSRF tratado à parte (`src/server/security/url-import.ts`, ver
  `docs/library/METADATA_PROVIDERS.md`), extração via `HTMLRewriter` nativo
  (JSON-LD > OpenGraph > meta comum), preview obrigatório, ISBN extraído
  revalidado pelo checksum real antes de aceitar.
- **Migration `0020_publication_metadata_source_open.sql`**: rebuild seguro
  de `publications` (SQLite não permite `ALTER` de `CHECK` — técnica oficial
  "nova tabela → copia linhas explicitamente por nome de coluna → drop →
  rename → recria índices", preserva 100% dos dados, `PRAGMA
  foreign_key_check` limpo antes de aplicar em produção) para aceitar
  `URL_IMPORT` como `metadata_source` sem fechar a porta para futuros
  providers com outra migration.
- **`build-info.ts` deixou de ser rastreado no Git** nesta mesma janela de
  trabalho (não é uma mudança do LIB-004A em si, mas afeta como qualquer
  release — incluindo este — se verifica): ver
  `docs/release/RELEASE_CHAIN_POLICY.md`.
