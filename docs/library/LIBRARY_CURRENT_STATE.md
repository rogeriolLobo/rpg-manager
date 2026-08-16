# Biblioteca — Estado Atual (Auditoria LIB-001)

Data: 2026-08-14. Auditoria de código real (não de memória/relatórios
anteriores).

## Modelo atual

Uma única tabela `rpgs` (migration `0001_initial_schema.sql`, colunas
de capa adicionadas em `0008_rpg_cover_metadata.sql`) mistura três
responsabilidades conceitualmente distintas:

1. **Identidade do sistema de jogo** — `title`, `category_id`,
   `subgenre_id`.
2. **Metadata editorial** — `cover_url`, `isbn`, `cover_source_url`,
   `cover_source_note`.
3. **Estado pessoal do usuário** — `reading_status`, `has_played`,
   `wants_to_play`, `priority`, `play_group_notes`, `play_group_id`,
   `planned_play_date`, `table_status`, `game_master`, `notes`.

```sql
CREATE TABLE rpgs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  subgenre_id TEXT REFERENCES subgenres(id) ON DELETE RESTRICT,
  reading_status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(...),
  has_played INTEGER NOT NULL DEFAULT 0,
  wants_to_play INTEGER NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'NONE' CHECK(...),
  play_group_notes TEXT NOT NULL DEFAULT '',
  planned_play_date TEXT,
  table_status TEXT NOT NULL DEFAULT 'IDEA' CHECK(...),
  game_master TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  cover_url TEXT,               -- 0008
  isbn TEXT,                    -- 0008
  cover_source_url TEXT,        -- 0008
  cover_source_note TEXT,       -- 0008
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, title)
);
```

Não existe hoje: `game_system_id`, `publication_type`, `edition`,
`publisher`, `publication_year`, `language`, `isbn10`/`isbn13`
separados, `authors`, `metadata_source`/`metadata_source_id`/
`metadata_fetched_at`, cover binário/upload, tabela de duplicatas.

`UNIQUE(user_id, title)` é a única defesa contra duplicata hoje — por
**título exato**, não por ISBN. Título sozinho não é uma chave segura
(seção 22 do pedido) — isso é dívida real.

## Responsabilidades das tabelas envolvidas

- `categories`/`subgenres`: taxonomia fixa, seedada (`0002_seed_categories.sql`),
  RESTRICT em delete — não editável pelo usuário hoje.
- `play_groups`/`play_group_members`: grupo de jogo, referenciado por
  `rpgs.play_group_id` (nullable) — não é dado da publicação.
- `import_jobs`: staging de preview de importação CSV (payload_hash +
  normalized_payload, expira em 30min).

## Create flow

`POST /rpgs` (`src/server/routes/rpgs.ts`): valida taxonomia (categoria/
subgênero), valida grupo de jogo, insere via schema único
(`rpgInputSchema`, `src/shared/validation/schemas.ts`) que mistura os
três domínios (título+capa+estado pessoal) num único payload
obrigatório. `UNIQUE(user_id, title)` retorna 409 em duplicata exata de
título.

## Read flow

`GET /rpgs` (paginado, filtros por categoria/subgênero/status/prioridade/
mesa, busca por título com `LIKE` escapado) e `GET /rpgs/:id` (com
campanhas vinculadas). `present()` calcula campos derivados
(`recommendationScore`, `readiness`, `nextAction`) a partir do domínio
`src/domain/rpg/recommendation.ts` — lógica de recomendação já
separada do modelo de dados, boa prática existente.

## Update flow

`PATCH /rpgs/:id` — **PUT semântico**: exige o payload completo (não
parcial), reescreve todos os campos. Este era o núcleo do incidente
`RPG_EDIT_INVALID_DATA` (ver `docs/bugs/RPG_EDIT_INVALID_DATA.md` e
`docs/release/PRODUCTION_DEPLOY_INCIDENT.md`) — corrigido nesta sessão
na parte de `coverUrl` (política agora puramente sintática, igual para
CREATE/PATCH/import, sem allowlist de hosts nem fetch do servidor).

## Archive/delete flow

Não existe archive para RPG (existe para Vault Entities e Worlds, mas
não para `rpgs`). `DELETE /rpgs/:id` é exclusão física, bloqueada por
FK se houver campanhas vinculadas (`409 RPG_HAS_CAMPAIGNS`).

## Import flow

`POST /import/preview` + `/import/confirm` (`src/server/routes/transfer.ts`):
CSV → normalização → dedup por **título normalizado** (`normalizeTitle`,
NFKC + lowercase pt-BR) — mesma limitação de "título não é chave segura".
Capas: `IGNORADO` se o RPG já tem capa própria (preserva), `ATUALIZACAO`
se não tem. Após esta sessão, usa a mesma validação sintática de
`coverUrl` do create/edit (sem regra divergente).

## Cover flow

Antes desta sessão: `coverUrl` exigia host allowlist fixo
(`COVER_IMAGE_HOSTS`) **e** um fetch do servidor verificando
Content-Type real (`validateRemoteCoverImage`), tanto no create quanto
(condicionalmente) no edit. Isso não escalava para hosts fora da
allowlist (causa raiz do incidente Devir) e duplicava a política de CSP
`img-src` sem garantia de sincronia entre as duas allowlists.

Depois: `coverUrl` é só uma URL HTTPS pública validada sintaticamente
(sem allowlist, sem fetch do servidor) — o navegador carrega `<img>`
diretamente, com fallback (`onError`) já implementado no frontend
(`CoverImage` em `library-pages.tsx`) mostrando um placeholder com
iniciais quando a imagem falha, sem loop de requisição.

Não existe hoje: upload de arquivo, storage binário (KV/R2), busca de
metadata externa (Open Library/Google Books), preview antes de salvar,
provenance de metadata.

## Validação

Schema único `rpgInputSchema` (Zod, `strictObject`) mistura os três
domínios. Erros de campo (`fields`) agora chegam ao frontend para
`coverUrl`/`title`/`isbn`/`coverSourceUrl`/`coverSourceNote`/
`plannedPlayDate` (trabalho desta sessão, incidente anterior).

## Testes (evidência real, contada)

- `tests/unit/validation.test.ts`, `cover-security.test.ts`: schema e
  URL de capa.
- `tests/integration/auth-and-isolation.test.ts`: create/edit/isolamento/
  IDOR/mass-assignment/rate-limit/convites, incluindo o novo teste de
  política de `coverUrl`.
- `tests/e2e/core-flow.spec.ts`, `rpg-cover-edit.spec.ts`: fluxo completo
  pela UI real, incluindo os 5 cenários DoD do incidente de capa.
- Nenhum teste cobre hoje: upload de imagem, metadata provider, dedup
  por ISBN, archive de RPG — porque essas features não existem.

## Problemas encontrados / dívida arquitetural

1. **Modelo misto** (Game System + Publication + estado pessoal numa
   tabela só) — funciona para o volume atual, mas não representa
   "System → Publications" nem suporta múltiplos usuários com o mesmo
   RPG na biblioteca sem duplicar metadata editorial.
2. **Dedup por título, não por ISBN** — falso-negativo (duas edições
   diferentes com título igual colidem) e falso-positivo silencioso
   (grafias diferentes do mesmo livro não são detectadas).
3. **PATCH é PUT semântico** — funcional, mas exige o cliente reenviar
   o objeto inteiro; combinado com um formulário mal cuidado (como no
   incidente anterior), aumenta a superfície de bugs de "campo que eu
   não editei mudou sozinho".
4. **Sem archive** para RPG (existe em Worlds/Vault) — delete é a única
   opção reversível apenas via FK-bloqueio (indireto, não é archive de
   verdade).
5. **Sem upload de capa** — depende inteiramente de URL externa.
6. **Sem metadata provider** — cadastro é 100% manual.
7. **Sem provenance** — não há como saber se um campo foi preenchido
   manualmente ou importado de algum lugar.

Nenhum desses é `BROKEN` hoje — são gaps funcionais reais (`MISSING`),
não regressões. O único bug funcional real (`coverUrl` rejeitando URLs
HTTPS válidas) está corrigido e em produção.

---

## Atualização — LIB-002 implementado (`migrations/0016_library_domain_normalization.sql`)

O modelo misto descrito acima (problema #1) foi endereçado nesta sessão.
Estado físico atual:

- `game_systems` e `publications` existem como tabelas próprias (ver
  `docs/library/LIBRARY_ARCHITECTURE.md`, seção "LIB-002 —
  Implementado"), populadas por um backfill idempotente para os
  registros pré-existentes e por toda criação nova (manual ou import)
  a partir de `src/server/routes/library-writes.ts`.
- `rpgs.publication_id` (nullable, aditivo) liga cada linha à sua
  Publication. `rpgs` passa a representar o User Library Entry
  (estado pessoal), mantendo o nome físico da tabela por ser a única
  forma aditiva de fazer essa transição (renomear exigiria reescrever a
  FK de `campaigns.rpg_id`, que continua apontando para `rpgs.id` sem
  qualquer mudança).
- `title`/`coverUrl`/`isbn`/`coverSourceUrl`/`coverSourceNote` agora são
  lidos de `publications` (fonte de verdade); as colunas homônimas em
  `rpgs` continuam fisicamente presentes mas congeladas (não escritas
  pelo app, exceto `title`, mantido em dual-write pela constraint
  `UNIQUE(user_id, title)`).
- `category_id`/`subgenre_id` **permanecem em `rpgs`** — decisão
  documentada (não movidos nesta sessão; ver
  `LIBRARY_ARCHITECTURE.md`).
- Dedup por ISBN e compartilhamento de Publication entre contas
  **foram implementados no LIB-003** (ver atualização abaixo) — não
  ficaram no estado "física pronta, comportamento 1:1" descrito acima
  (esse era o estado após LIB-002, já superado).
- `rpgs.archived_at` (nullable, aditivo) — arquitetura pronta para
  F-011, não implementado.

O problema #2 (dedup por título) foi resolvido no LIB-003 — não por
título (nunca confiável), mas pela identidade correta (ISBN). Ver
atualização abaixo.

---

## Atualização — LIB-003 implementado (`migrations/0017_publication_identity.sql`)

Ver `docs/library/PUBLICATION_IDENTITY.md` para o desenho completo.
Resumo do estado físico atual:

- `publications.isbn13`/`isbn10` agora são preenchidos (validados por
  checksum real — ISO 2108/EAN-13, não só forma) em toda escrita nova, e
  têm índice único parcial (`idx_publications_isbn13_unique`/
  `idx_publications_isbn10_unique`) — identidade real de catálogo.
- **Dedup por ISBN funciona entre contas**: cadastrar/importar um ISBN já
  existente no catálogo (de qualquer conta) reaproveita a Publication —
  não cria duplicata, não deduplica por título.
- `rpgs.user_id + publication_id` é único (`idx_rpgs_user_publication_unique`)
  — uma biblioteca não pode ter duas entries para a mesma Publication;
  tentativa retorna `409 ALREADY_IN_LIBRARY`.
- **Metadata compartilhada é protegida**: editar título/ISBN/capa de uma
  Publication com 2+ referências é bloqueado
  (`422 SHARED_PUBLICATION_METADATA_LOCKED`) — estado pessoal nunca é
  afetado por essa trava.
- `publication_external_ids` existe (schema pronto para providers
  futuros), vazia — nenhum provider chamado ainda.
- Import CSV ganhou `EXISTING_PUBLICATION`/`ALREADY_IN_LIBRARY` como
  classificações adicionais (além de `NOVO`/`ATUALIZACAO`/`IGNORADO`/`ERRO`).
- `/export` inclui `publicationExternalIds` (versão 7).

Upload de capa, Open Library/Google Books e archive de RPG continuam
`MISSING` — fora de escopo do LIB-003 (F-008/F-009/F-011).

---

## Atualização — LIB-004 implementado (`migrations/0018_publication_authors.sql`)

Ver `docs/library/METADATA_PROVIDERS.md` para o desenho completo. Open
Library deixa de ser `MISSING` — agora `COMPLETE` no escopo desta tarefa
(busca, preview, confirmação, provenance, dedup por identidade externa).

- `GET /api/v1/rpgs/search-external` — busca autenticada, rate-limited,
  com timeout e fallback amigável. Host fixo (`openlibrary.org`), nunca
  aceita destino vindo do cliente.
- `publications.authors` (nova coluna, migration 0018) — único campo
  físico que faltava; todo o resto (`subtitle`/`publisher`/
  `publication_year`/`language`/`publication_type`/`metadata_source*`)
  já existia desde a migration 0016 (LIB-002), só não era populado.
- Criar a partir de um resultado de busca reaproveita a mesma
  `buildCreateLibraryEntryStatements` do cadastro manual/import — resolve
  identidade por Edition ID externo → Work ID externo → ISBN (LIB-003) →
  nova Publication. `publication_external_ids` deixa de estar
  permanentemente vazia.
- UI: `/app/library/new` ganha um botão "Buscar online" (cadastro manual
  continua sendo o padrão/imediatamente visível — sem regressão).
  Selecionar um resultado preenche o mesmo formulário do cadastro manual
  (preview obrigatório embutido, não uma tela separada).
- Upload de capa (Workers KV) e archive de RPG continuam `MISSING` — fora
  de escopo do LIB-004 (F-008/F-011).
