# RPG Manager — Master Backlog

Metodologia: uma funcionalidade por vez, `AUDIT → PLAN → IMPLEMENT →
TEST → FIX → TEST AGAIN → CI → DEPLOY → PRODUCTION SMOKE → DOCUMENT →
DONE`. `DONE` exige validação de produção — nunca só código/testes/build.

Status possíveis: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `DONE`.

## P0-001 — Edição de RPG com capa legada

- **Priority:** P0
- **Status:** `DONE` (código, causa raiz arquitetural eliminada — ver
  LIB-001), `MANUAL_SMOKE_REQUIRED` (clique autenticado real, bloqueado
  por Turnstile/CAPTCHA — não contornado)
- **Dependencies:** nenhuma
- **Definition of Done:**
  - [x] Editar RPG com capa histórica sem alterar → sucesso
  - [x] Alterar campo não relacionado → sucesso, capa preservada
  - [x] Trocar para URL nova insegura → rejeitada, erro no campo
  - [x] Remover capa → sucesso
  - [x] RPG com capa já aceita, sem alteração → sucesso
  - [x] CREATE com capa de qualquer host HTTPS → sucesso (LIB-001:
        causa raiz eliminada, não só contornada no PATCH)
  - [x] Todos os cenários verificados via TEST FIRST no formulário
        React real (não só API), com a URL real `devir.com.br` do
        relato de produção
  - [x] Nenhuma allowlist de host — política é sintática (LIB-001)
  - [x] Proteção SSRF preservada (IP privado/loopback, protocolo
        perigoso continuam rejeitados)
  - [x] lint, typecheck, unit, integration, E2E (desktop+mobile), build
  - [x] CI verde
  - [x] Deploy — Version `77696b49-0204-47c9-92da-1cebea49c4d7`
  - [x] `GET /api/v1/version` confirma HEAD == origin/main == build ==
        produção (`ec51077`)
  - [ ] Smoke autenticado por clique real — `MANUAL_SMOKE_REQUIRED`
        (checklist em `docs/library/LIBRARY_DEFINITION_OF_DONE.md`)
- **Commit:** `d5b0d70`, `ebff759`, `eedc96a`, `d23ba05`, `ec51077` (ver
  `docs/bugs/RPG_EDIT_INVALID_DATA.md` e `docs/library/COVER_STORAGE.md`)
- **Production version:** `77696b49-0204-47c9-92da-1cebea49c4d7`

## LIB-001 — Biblioteca: bug de coverUrl

- **Priority:** P0
- **Status:** `DONE` (bug funcional) — ver LIB-002 para a evolução de
  arquitetura que era P2 dentro deste item e virou item próprio.
- **Dependencies:** nenhuma
- **Definition of Done:** ver `docs/library/LIBRARY_DEFINITION_OF_DONE.md`
- **Commit:** `ec51077`
- **Production version:** `77696b49-0204-47c9-92da-1cebea49c4d7`
- **Docs:** `docs/library/LIBRARY_CURRENT_STATE.md`,
  `docs/library/LIBRARY_ARCHITECTURE.md`,
  `docs/library/COVER_STORAGE.md`,
  `docs/library/METADATA_PROVIDERS.md`,
  `docs/library/LIBRARY_DEFINITION_OF_DONE.md`

## LIB-002 — Biblioteca: normalização de domínio (Game System + Publication + User Library Entry)

- **Priority:** P1
- **Status:** `DONE` (código + migration remota + deploy + smoke
  read-only confirmados; ver `docs/library/LIBRARY_DEFINITION_OF_DONE.md`
  para o checklist completo), `MANUAL_SMOKE_REQUIRED` (clique
  autenticado real pós-migration, bloqueado por Turnstile/CAPTCHA, não
  contornado — mesma situação de LIB-001)
- **Dependencies:** LIB-001 (`DONE`)
- **Definition of Done:** ver `docs/library/LIBRARY_DEFINITION_OF_DONE.md`
- **Migration:** `migrations/0016_library_domain_normalization.sql`
  (aditiva — `CREATE TABLE game_systems`, `CREATE TABLE publications`,
  `ALTER TABLE rpgs ADD COLUMN publication_id`,
  `ALTER TABLE rpgs ADD COLUMN archived_at`, backfill idempotente) —
  aplicada em produção: 30→30 rpgs, 30 publications, 30 game_systems,
  0 mismatches campo a campo
- **Commit:** `762550d`
- **Production version:** `7bcd3ce4-cb53-432f-a0eb-e215d0b7aeef`
- **Docs:** `docs/library/LIBRARY_ARCHITECTURE.md` (seção "LIB-002 —
  Implementado"), `docs/library/LIBRARY_CURRENT_STATE.md` (seção
  "Atualização — LIB-002"), `docs/library/LIBRARY_DEFINITION_OF_DONE.md`
- **Fora de escopo (deliberado, ver docs acima):** F-008 (upload+KV),
  F-009 (Open Library), F-010 (dedup real por ISBN), F-011 (archive de
  RPG), mover `category_id`/`subgenre_id` para `game_systems`.

## LIB-003 — Biblioteca: identidade de Publication, ISBN, provenance e deduplicação segura

- **Priority:** P1
- **Status:** `DONE` (código + migration remota + deploy + smoke
  read-only confirmados; ver `docs/library/LIBRARY_DEFINITION_OF_DONE.md`
  para o checklist completo), `MANUAL_SMOKE_REQUIRED` (clique
  autenticado real, bloqueado por Turnstile/CAPTCHA, não contornado —
  mesma situação de LIB-001/LIB-002)
- **Dependencies:** LIB-002 (`DONE`)
- **Definition of Done:** ver `docs/library/LIBRARY_DEFINITION_OF_DONE.md`
- **Migration:** `migrations/0017_publication_identity.sql` (aditiva —
  `CREATE TABLE publication_external_ids`, backfill de `isbn13`/`isbn10`
  a partir do `isbn` legado, índices únicos parciais
  `idx_publications_isbn13_unique`/`idx_publications_isbn10_unique`/
  `idx_rpgs_user_publication_unique`) — aplicada em produção: 30→30
  rpgs, 30 publications, 20 com `isbn13` (100% das ISBNs reais não
  vazias), 0 mismatches
- **Commit:** `387cb86` (feature), `da12019` (fix de infra E2E no CI)
- **Production version:** `7d9f7daf-d608-4257-9793-be056dbea660`
- **Docs:** `docs/library/PUBLICATION_IDENTITY.md` (novo),
  `docs/library/LIBRARY_ARCHITECTURE.md` (seção "LIB-003"),
  `docs/library/LIBRARY_CURRENT_STATE.md` (seção "Atualização — LIB-003"),
  `docs/library/LIBRARY_DEFINITION_OF_DONE.md`
- **O que muda de comportamento:** ISBN validado por checksum real
  (não só forma); cadastrar/importar ISBN já existente no catálogo
  reaproveita a Publication entre contas (antes: sempre 1:1, decisão
  do LIB-002 revista aqui com política de segurança); metadata
  compartilhada (2+ referências) fica protegida contra edição cruzada
  (`422 SHARED_PUBLICATION_METADATA_LOCKED`).
- **Fora de escopo (deliberado, ver docs acima):** F-008 (upload+KV),
  F-009 (Open Library/Google Books — nenhuma chamada externa), F-011
  (archive de RPG), merge automático de Game System por nome
  semelhante, reatribuição de `publication_id` no PATCH (só CREATE/import
  resolvem identidade).

## LIB-004 — Biblioteca: busca online de publicações (Open Library)

- **Priority:** P2
- **Status:** `DONE`
- **Dependencies:** LIB-003 (`DONE`)
- **Definition of Done:** ver `docs/library/LIBRARY_DEFINITION_OF_DONE.md`
- **Migration:** `migrations/0018_publication_authors.sql` (aditiva —
  `ALTER TABLE publications ADD COLUMN authors`) — aplicada em produção,
  30/30 rpgs/publications preservados (pré e pós-contagem).
- **Commit (feature, CI verde):** `4dde623`
- **CI:** run `31928174310` — `success`
- **Commit (HEAD = origin/main = produção, verificado):** `2c5646f`
  — nota: o deploy inicial foi feito em `4dde623`; a documentação de
  release seguinte (`2c5646f`) foi commitada sem redeploy, quebrando
  a cadeia HEAD=produção por um período. Corrigido com um segundo
  deploy sobre `2c5646f` antes de fechar LIB-004 como `DONE`.
- **Worker Version ID (final):** `ad007d91-2266-408e-9a9f-76e1366d950f`
- **Production commit** (`/api/v1/version`): `2c5646f`,
  build `2026-08-16T11:45:17.544Z`, `environment: production`
- **Smoke:** read-only automatizado ok (homepage `200`, `/login` `200`,
  `search-external` sem sessão → `401`); fluxo autenticado completo é
  `MANUAL_SMOKE_REQUIRED` (Turnstile bloqueia registro/login
  automatizado) — checklist em
  `docs/library/LIBRARY_DEFINITION_OF_DONE.md`.
- **Docs:** `docs/library/METADATA_PROVIDERS.md` (implementado),
  `docs/library/LIBRARY_ARCHITECTURE.md` (seção "LIB-004"),
  `docs/library/LIBRARY_CURRENT_STATE.md` (seção "Atualização — LIB-004"),
  `docs/library/LIBRARY_DEFINITION_OF_DONE.md`
- **O que muda de comportamento:** novo endpoint `GET
  /rpgs/search-external` (Open Library, autenticado, rate-limited,
  timeout, sem SSRF — host fixo); `/app/library/new` ganha "Buscar
  online" (cadastro manual continua sendo o padrão); identidade de
  Publication ganha uma 3ª prioridade de resolução (Edition/Work ID
  externo, antes do ISBN); provenance (`metadata_source`/
  `metadata_source_id`/etc.) e `publication_external_ids` passam a ser
  efetivamente populados (schema já existia desde LIB-002/003).
- **Fora de escopo (deliberado, ver docs acima):** F-008 (upload+KV,
  capas continuam só por URL externa), F-011 (archive de RPG), Google
  Books (preparado na interface, não implementado), merge/reatribuição
  automática de identidade fora do fluxo de CREATE.

## LIB-004A — Qualidade da busca online / RPG-aware search

- **Priority:** P0 (regressão funcional real em produção — busca
  retornava um resultado incorreto)
- **Status:** `DONE` — CI verde, migration remota + deploy + production
  proof confirmados. Reaberto brevemente como `IN_PROGRESS` pelo manual
  smoke ter encontrado uma regressão real (LIB-004B, causada pela própria
  migration 0020 desta tarefa) — corrigido e fechado, ver LIB-004B abaixo.
- **Dependencies:** LIB-004 (`DONE`)
- **Definition of Done:** ver `docs/library/LIBRARY_DEFINITION_OF_DONE.md`
- **Bug relatado:** busca por "Rastro de Cthulhu" (RPG de Kenneth Hite/
  Pelgrane Press) retornava "The Trail of Cthulhu", antologia de ficção de
  August Derleth de 1945 — causa raiz reproduzida contra a API real e
  documentada em `docs/library/METADATA_PROVIDERS.md`.
- **Migrations:** `migrations/0019_publication_aliases.sql` (aditiva,
  nova tabela), `migrations/0020_publication_metadata_source_open.sql`
  (rebuild seguro de `publications` — relaxa `CHECK` de `metadata_source`,
  preserva 100% dos dados, validado local com `PRAGMA foreign_key_check`).
- **Docs:** `docs/library/METADATA_PROVIDERS.md` (reescrito — causa raiz +
  pipeline completo), `docs/library/LIBRARY_ARCHITECTURE.md` (seção
  "LIB-004A"), `docs/library/LIBRARY_CURRENT_STATE.md` (seção "Atualização
  — LIB-004A"), `docs/library/PUBLICATION_IDENTITY.md` (seção
  "Atualização — LIB-004A"), `docs/library/LIBRARY_DEFINITION_OF_DONE.md`
- **O que muda de comportamento:** busca ganha confiança/relevância
  calculada localmente (`src/domain/rpg/search-relevance.ts`) — resultados
  fracamente relacionados nunca mais aparecem como match; catálogo interno
  (título + aliases confirmados) consultado antes da Open Library; novo
  fallback `POST /rpgs/import-url` (importar de página oficial, com
  proteção SSRF dedicada); `reusePublicationId` como identidade de maior
  prioridade no create.
- **Fora de escopo (deliberado):** UI de administração/confirmação de
  aliases (schema pronto, escrita fica para um fluxo futuro), tradução
  automática de títulos, upload/KV, archive, friends, maps, VTT.

## LIB-004B — Regressão de capas na listagem da Biblioteca (reparo)

- **Priority:** P0 (regressão de dados real em produção, causada pela
  própria migration 0020 do LIB-004A)
- **Status:** `DONE` — CI verde (`31952566395`), migration `0021`
  confirmada aplicada em produção (`wrangler d1 migrations list
  --remote` → "No migrations to apply", `SELECT` direto: 0/30 linhas de
  `rpgs` com `publication_id` nulo), deploy publicado (Version
  `d43a16de-a2a4-4447-841f-d318ed6a2ebf`) e `GET /api/v1/version`
  confirmando `commit: "44f9105"` — HEAD local == origin/main == build
  == produção, verificado nesta análise (o commit em si não alterava
  `src/`, só migration+testes+docs; a lacuna era só o Worker publicado
  ainda estar na versão anterior — fechada agora).
- **Dependencies:** LIB-004A
- **Definition of Done:** ver `docs/library/LIBRARY_DEFINITION_OF_DONE.md`
- **Causa raiz:** `migrations/0020_publication_metadata_source_open.sql`
  usava `DROP TABLE publications` para trocar um `CHECK` constraint.
  `rpgs.publication_id` tem `ON DELETE SET NULL` (migration 0016);
  `PRAGMA foreign_keys = OFF` no topo do arquivo é no-op dentro da
  transação implícita do D1 — o `DROP TABLE` disparou o `SET NULL` em
  toda linha de `rpgs` já existente em produção. `publications` nunca
  perdeu dado; só o ponteiro `rpgs.publication_id` foi apagado. Local/CI
  nunca reproduziram porque sempre migram um banco vazio. Mecanismo
  reproduzido e comprovado — ver `docs/library/LIBRARY_ARCHITECTURE.md`,
  seção "LIB-004B".
- **"28 vs 30" investigado:** não é perda de dados — "30" é o total
  GLOBAL de `rpgs` (multi-tenant, 3 contas); a conta principal auditada
  tem 28, as outras 2 linhas são de 2 outras contas reais registradas
  antes desta sessão.
- **Migration:** `migrations/0021_repair_rpgs_publication_link.sql`
  (aditiva, idempotente) — restaura `rpgs.publication_id` a partir do
  padrão determinístico `pub_<rpg.id>` do backfill original (LIB-002),
  verificado 30/30 em produção antes de aplicar.
- **Docs:** `docs/library/LIBRARY_ARCHITECTURE.md` (seção "LIB-004B" —
  causa raiz completa + lição para migrations futuras de rebuild de
  tabela), `docs/library/LIBRARY_CURRENT_STATE.md`,
  `docs/library/LIBRARY_DEFINITION_OF_DONE.md`, este arquivo.
- **O que muda de comportamento:** nenhuma mudança de comportamento
  além do reparo do dado — a query da Biblioteca já estava correta
  desde LIB-002/004 (lê `publications` via JOIN); o problema era 100%
  de dado corrompido, não de código.
- **Fora de escopo (deliberado):** qualquer mudança em LIB-001
  (external cover), LIB-003 (metadata compartilhada) ou LIB-004A
  (relevância/aliases/catálogo interno/Open Library/import por URL).

## LIB-004C — Enriquecimento da importação por URL oficial

- **Priority:** P1 (deficiência funcional real, não regressão de dados)
- **Status:** `DONE` — código+testes+docs no commit final, CI verde,
  deploy publicado, `GET /api/v1/version` confirmando produção antes de
  parar (ver relatório da sessão).
- **Dependencies:** LIB-004A (`DONE`)
- **Definition of Done:** ver `docs/library/METADATA_PROVIDERS.md`,
  seção "LIB-004C" (reprodução factual, causa raiz, o que foi e o que
  deliberadamente não foi implementado, com evidência real).
- **Reproduzido antes de qualquer mudança:** página real
  (`retropunk.com.br`) buscada e auditada campo a campo — sem nó
  Book/Product em JSON-LD, `og:description` vazio (não ausente),
  `meta[name=author]` apontando para o autor do post do blog (não do
  RPG), sem nenhum sinal semântico de capa.
- **Bugs corrigidos:** mesclagem de metadata por campo (era fallback de
  documento inteiro — JSON-LD parcial descartava OpenGraph útil); string
  vazia (`""`) tratada como valor presente em vez de ausente;
  `WebPage.inLanguage` (JSON-LD) nunca extraído; `twitter:image` como
  fallback adicional de capa.
- **Deliberadamente não implementado, com evidência real:**
  `meta[name=author]`→autor, `og:site_name`/`WebSite.name`→editora,
  `datePublished`→ano de publicação, parsing de prosa livre para autor,
  mineração heurística de `<img>` para capa — todos comprovadamente
  errados ou inseguros na própria página real usada como reprodução.
- **UX:** aviso explícito quando um import por URL traz poucos campos
  ("Encontramos apenas parte dos dados desta página..."); tela renomeada
  de "Busca pública na Open Library" para "Buscar publicação".
- **Testes:** 5 novos (integração) — RetroPunk reduzido, merge por
  campo, JSON-LD `Product`, JSON-LD malformado, `twitter:image`.
  Confirmado TEST FIRST (3 das 5 asserções falhavam no código anterior,
  via `git stash` temporário).
- **Commit:** ver relatório da sessão (RELEASE_CHAIN_POLICY: commit
  final único, code+tests+docs, antes do deploy).
- **Fora de escopo (deliberado):** upload/KV, archive, friends, maps,
  VTT (LIB-005 continua não iniciado).

## LIB-005 — Cover assets / upload de capa (Zero Cost)

- **Priority:** P2 (evolução funcional da Biblioteca, não regressão)
- **Status:** `DONE` — código+testes+docs nos commits `261fb85` (feature)
  e `82714ee` (investigação/reteste do smoke), CI verde, deploy
  publicado, `GET /api/v1/version` confirmado.
- **MANUAL_SMOKE = PASS** — validação humana em produção (RPG real,
  conta principal) confirmou: upload de capa funciona; imagem permanece
  após reload completo; trocar capa funciona; remover capa funciona;
  quando existe `coverUrl` externa, remover o asset volta corretamente
  para a `coverUrl` original; `coverUrl` externa permanece preservada
  durante todo o ciclo. Um primeiro relato de "controles ausentes"
  (Blue Rose) foi diagnosticado como sessão do navegador com o bundle
  antigo em memória (aba aberta antes do deploy), não defeito de código
  — bundle de produção confirmado byte-idêntico (SHA-256) ao build
  testado, e um teste E2E dedicado reproduzindo o cenário real (`coverUrl`
  externa + `coverAssetId` nulo) passa em desktop e mobile.
- **Dependencies:** LIB-001 (capa por URL externa), LIB-002 (domínio
  `publications`), LIB-003 (`SHARED_PUBLICATION_METADATA_LOCKED`)
- **Definition of Done:** ver `docs/library/COVER_STORAGE.md` (design
  completo, incluindo comparação de storage gratuito).
- **Storage:** Workers KV Free, escolhido após comparação explícita com
  D1, R2 (proibido por política independente de custo), Durable Objects
  e Cache API — ver `docs/library/COVER_STORAGE.md`, seção "Por que
  Workers KV Free". Namespace `COVERS_KV` provisionado
  (`wrangler kv namespace create`), binding em `wrangler.jsonc`.
- **D1:** migration aditiva `0022_publication_cover_asset.sql`
  (`publications.cover_asset_id`, nullable, sem `CHECK` — nunca precisa
  de rebuild de tabela).
- **Backend:** `POST`/`DELETE /api/v1/rpgs/:id/cover` (upload/remoção,
  multipart, magic-bytes real validado no servidor — nunca confia no
  Content-Type do cliente), `GET /api/v1/media/covers/:id` (leitura
  autenticada, `Cache-Control` imutável). Reutiliza a trava
  `SHARED_PUBLICATION_METADATA_LOCKED` do LIB-003
  (`assertSharedPublicationEditable`, extraída para função comum).
- **Frontend:** processamento da imagem no navegador antes do upload
  (`createImageBitmap` + `<canvas>` → WebP/JPEG, redimensionado),
  controles "Enviar capa"/"Trocar capa"/"Remover capa" na página de
  detalhe do RPG — ação independente do formulário principal de edição
  (não toca em `coverUrl`, sem risco de regressão no fluxo já corrigido
  do LIB-001).
- **Segurança:** validação de bytes reais (magic bytes JPEG/PNG/WebP) no
  servidor, limite de tamanho (2 MB) reforçado no servidor mesmo com
  compressão no cliente, IDOR coberto (upload/remoção exigem posse do
  RPG), `:id` de leitura validado como UUID (404 uniforme, sem vazar
  existência).
- **Documentação adicional:** `docs/architecture/DATABASE_MIGRATION_SAFETY.md`
  (novo — regra de segurança para rebuild de tabelas D1/SQLite
  referenciadas por FK, extraída do incidente real LIB-004B, referenciada
  também em `CLAUDE.md` §15).
- **Testes:** unit (`tests/unit/cover-asset.test.ts` — magic bytes,
  validação de ID, path traversal), integração
  (`tests/integration/cover-upload.test.ts` — upload/leitura/remoção,
  IDOR, formato inválido, tamanho excedido, troca remove asset anterior
  do KV, `SHARED_PUBLICATION_METADATA_LOCKED`, preservação de capa
  externa), E2E (`tests/e2e/rpg-cover-upload.spec.ts` — fluxo real de
  upload/troca/remoção pela UI, independência do formulário de edição;
  reteste do smoke reportado adicionado — RPG criado já com `coverUrl`
  externa persistida e `coverAssetId` nulo precisa mostrar "Enviar
  capa"; remover o asset depois de enviado precisa voltar para a
  `coverUrl` externa original, não para o placeholder — desktop e
  mobile).
- **Commit:** ver relatório da sessão (RELEASE_CHAIN_POLICY: commit
  final único, code+tests+docs, antes do deploy). Commit de
  investigação do smoke: ver relatório desta rodada.
- **Fora de escopo (deliberado):** archive, friends, maps, VTT,
  processamento de imagem no servidor (fica só no navegador),
  redimensionamento configurável pelo usuário.

## LIB-006 — Archive e Restore da Biblioteca (F-011)

- **Priority:** P3 (backlog original), promovido a vertical única desta
  rodada.
- **Status:** `DONE` — código+testes+docs no commit final, CI verde,
  deploy publicado, `GET /api/v1/version` confirmado.
- **MANUAL_SMOKE = PASS** — validação humana real em produção confirmou:
  Arquivar RPG funciona; item sai de Ativos; aparece em Arquivados; dados
  e capa permanecem preservados; Restaurar funciona; item retorna para
  Ativos.
- **Dependencies:** `rpgs.archived_at` (coluna e índice `(user_id,
  archived_at)` já existiam desde migration 0016/LIB-002 — nenhuma
  migration nova nesta tarefa), LIB-003 (`SHARED_PUBLICATION_METADATA_LOCKED`),
  LIB-005 (`coverAssetId`).
- **Definition of Done:** ver `docs/library/LIBRARY_ARCHIVE.md` (semântica
  completa, decisões de escopo, hard delete).
- **Domínio:** archive atua sobre a User Library Entry (`rpgs`), nunca
  sobre `publications`/`game_systems` — uma entry arquivada continua
  contando como referência para `SHARED_PUBLICATION_METADATA_LOCKED`
  (testado explicitamente).
- **Backend:** `POST /api/v1/rpgs/:id/archive` e `.../restore`
  (idempotentes via `UPDATE ... WHERE id=? AND user_id=?`, `meta.changes`
  prova posse+existência), `GET /rpgs` com filtro padrão
  `archived_at IS NULL` (`?archived=true` inverte), `GET /rpgs/:id` nunca
  404 só por estar arquivado. Dashboard/recomendações/contagem por grupo
  passam a excluir arquivados. `campaigns` expõe `rpgArchived` sem nunca
  deixar de carregar. Dedup (CREATE/CSV import/busca externa) distingue
  `NOT_IN_LIBRARY`/`ACTIVE_IN_LIBRARY`/`ARCHIVED_IN_LIBRARY`
  (`src/domain/rpg/library-entry-state.ts`) — nunca duplica uma entry
  arquivada, sempre oferece "Restaurar".
- **Frontend:** abas "Ativos"/"Arquivados" na Biblioteca (mesma
  `LibraryPage`, reaproveitando a querystring existente — sem componente
  duplicado); botão "Arquivar RPG"/"Restaurar RPG" na página de detalhe
  substitui "Excluir RPG" como ação normal; indicação "Arquivado" nos
  cards e na campanha vinculada; busca externa e import CSV mostram
  "Arquivado na sua Biblioteca" com ação Restaurar em vez de deixar o
  usuário tentar duplicar.
- **Hard delete:** endpoint `DELETE /rpgs/:id` preservado por
  compatibilidade, mas não é mais chamado por nenhuma ação normal da UI —
  nenhuma nova interface de "excluir permanentemente" foi criada (decisão
  documentada em `docs/library/LIBRARY_ARCHIVE.md`, fora de escopo).
- **Achado factual fora de escopo (não corrigido nesta tarefa):**
  `EXISTING_PUBLICATION` no import CSV já era aprovável no servidor desde
  LIB-003, mas a UI de preview (`settings-pages.tsx`) nunca marcava essa
  linha como `actionable` — checkbox sempre desabilitado. Bug pré-existente,
  não introduzido aqui; **corrigido em LIB-007** (ver seção abaixo).
- **Testes:** unit (`tests/unit/library-entry-state.test.ts`), integration
  (`tests/integration/library-archive.test.ts` — archive/restore/idempotência/
  IDOR, listagem ativos/arquivados, detalhe arquivado, dashboard exclui
  arquivados, dedup CREATE/CSV/busca externa entende arquivado, SHARED_LOCK
  continua contando arquivada, preservação de coverUrl/coverAssetId/campanha,
  export preserva `archived_at`), E2E
  (`tests/e2e/rpg-archive-restore.spec.ts` — fluxo completo pela UI,
  desktop e mobile, incluindo busca reconhecendo arquivado sem duplicar).
- **Produção (diagnóstico read-only antes do deploy):** ver relatório da
  sessão — total/por-usuário/ativos/arquivados na conta principal, nenhum
  dado real alterado durante a validação.
- **Commit:** ver relatório da sessão (RELEASE_CHAIN_POLICY: commit final
  único, code+tests+docs, antes do deploy).
- **Fora de escopo (deliberado):** hard delete/UI de exclusão permanente,
  friends, social, maps, VTT, sheets, Vault/Campaign enhancements além do
  mínimo para preservar funcionamento (`rpgArchived` no vínculo).

## LIB-007 — Hardening de Import/Export da Biblioteca

- **Priority:** P2 (fecha os fluxos de entrada/saída antes da auditoria
  final da Library 1.0).
- **Status:** `DONE` — código+testes+docs no commit final, CI verde,
  deploy publicado, `GET /api/v1/version` confirmando produção antes de
  parar (ver relatório da sessão).
- **Dependencies:** LIB-003 (`EXISTING_PUBLICATION`/`ALREADY_IN_LIBRARY`),
  LIB-006 (`ARCHIVED_IN_LIBRARY`).
- **Definition of Done:** ver `docs/library/LIBRARY_IMPORT_EXPORT.md`
  (semântica completa do preview, distinção CSV operacional vs backup
  completo, limites, cobertura do backup).
- **Bug real corrigido (encontrado durante LIB-006, reproduzido antes do
  patch):** `EXISTING_PUBLICATION` já era processável pelo backend desde
  LIB-003, mas a UI de preview do import CSV nunca marcava essa linha
  como `actionable` — checkbox sempre desabilitado, nunca pré-selecionada.
  Reproduzido pela primeira vez com um teste E2E real (nenhum teste E2E
  de import CSV existia antes desta tarefa), confirmado falhando no
  código anterior, corrigido em `settings-pages.tsx` (2 linhas — mesmo
  critério de `NOVO`/`ATUALIZACAO`).
- **Outro bug real encontrado e corrigido:** ISBN duplicado dentro do
  mesmo arquivo CSV (nenhuma pré-existente) resolvia como `NOVO` em
  ambas as linhas independentemente; se aprovadas juntas, o
  `/import/confirm` violaria o índice único de `publications.isbn13` no
  mesmo batch e revertia a transação inteira. Corrigido no preview (nova
  classificação `ERRO` para ISBN repetido, mesmo padrão já usado para
  título repetido) + tratamento defensivo no confirm (`409 DUPLICATE_ISBN`
  em vez de `500` genérico numa corrida real).
- **Segurança:** export CSV agora neutraliza spreadsheet formula
  injection (CWE-1236) — campos começando com `=`, `+`, `-`, `@` ganham
  um apóstrofo líder (mitigação OWASP) antes de qualquer necessidade de
  aspas. IDOR em import job confirmado protegido (`404` para outra
  conta). Estado pessoal nunca vaza ao reaproveitar uma Publication
  (`EXISTING_PUBLICATION`) — testado explicitamente.
- **Auditado e confirmado correto, sem mudança necessária:** BOM UTF-8 no
  início do CSV (`String.prototype.trim()` já remove — WhiteSpace do
  ECMAScript inclui `U+FEFF`), aspas/vírgulas em campos (`parseCsv`),
  linhas vazias, ISBN formatado com hífen/espaço, capa insegura, limites
  de tamanho/linhas (500 KB, 40 linhas — adequados ao Workers/D1 Free).
- **Documentado, não corrigido (decisão de escopo):** o CSV de
  `GET /export?format=csv` usa cabeçalhos em inglês, diferentes dos que
  `/import/preview` exige em português — não existe round-trip automático
  "exportar → reimportar" via CSV hoje. Texto da UI corrigido para não
  prometer isso; unificar os dois esquemas é decisão de produto separada.
  Backup completo (JSON) já preserva `archived_at`, `cover_url` e a
  referência `cover_asset_id` (não os bytes do KV) — comportamento
  documentado e testado via round-trip.
- **Testes:** integration
  (`tests/integration/library-import-export.test.ts` — ISBN duplicado no
  CSV, formula injection no export, IDOR em import job, isolamento de
  estado pessoal, round-trip do backup completo), E2E
  (`tests/e2e/library-import-existing-publication.spec.ts` — desktop e
  mobile). Suíte pré-existente de CSV (`auth-and-isolation.test.ts`,
  `publication-identity.test.ts`) revalidada sem regressão.
- **Commit:** ver relatório da sessão (RELEASE_CHAIN_POLICY: commit final
  único, code+tests+docs, antes do deploy).
- **Fora de escopo (deliberado):** LIB-008, unificação dos esquemas de
  CSV export/import, download em massa de bytes do KV para dentro do
  backup, suporte a delimitador `;`.

## RPG-1.0-BATCH2 — Fechamento de P1/P2 + Ideas + External Resources + revalidação de Quests/Handouts/Compendium

Modo "finalização acelerada 1.0" — reauditoria factual do estado atual
(`docs/audit/RPG_MANAGER_1_0_MATRIX.md`, 2026-08-14) antes de assumir
qualquer gap, execução contínua sem parar entre itens.

- **Status:** `DONE` — código+testes+docs no commit final, CI verde,
  deploy publicado, `GET /api/v1/version` confirmando produção.
- **F-012 (Invites, P1 da auditoria original) — revalidado, não
  reimplementado:** `vault-and-worlds.test.ts` já cobria create (só
  owner), accept, reuse (código já usado → 404), token inválido,
  expiração e revogação desde antes desta sessão — a auditoria de
  14/08 não tinha localizado esse teste (estava dentro de um arquivo
  mais amplo, não num arquivo dedicado a Invites). Nenhum código novo;
  só a confirmação factual + atualização da matriz de auditoria.
- **F-006 (Global Search, P2 da auditoria original) — bug real não
  encontrado, cobertura real adicionada:** só existia uma asserção
  incidental dentro de `world-knowledge.test.ts`. Novo arquivo
  `tests/integration/global-search.test.ts` (6 casos: query curta,
  isolamento entre contas, RPG arquivado do próprio usuário continua
  buscável — decisão deliberada do LIB-006 — World PRIVATE/GROUP,
  entidade GM_ONLY via `canViewEntity`, filtro por `worldId`) — todos
  passam sem nenhuma mudança de código, confirmando que o isolamento
  multi-tenant e as permissões já estavam corretas.
- **F-013 (Quests/Handouts) e F-014 (Compendium) — `SATISFIED_BY_EXISTING_DOMAIN`:**
  a auditoria de 14/08 listava ambos como `MISSING`. Revalidação
  factual: `QUEST` e `HANDOUT` já são valores válidos de `ENTITY_TYPES`
  (`src/domain/content/types.ts`), sem nenhum caso especial em
  `vault.ts` que os exclua — funcionam hoje como entidades base do
  Vault (mesmo modelo de LOCATION/EVENT), já oferecidos no seletor de
  tipo do formulário. Compendium: o Vault já é uma listagem filtrável
  por tipo/World/visibilidade/busca — o mesmo conceito, sem view
  agregada nova. Nenhum código novo; teste de round-trip real adicionado
  em `tests/integration/specialized-entities.test.ts` para QUEST/HANDOUT
  (não existia antes).
- **F-005 (Ideas / Quick Capture) — implementado, sem domínio novo:**
  botão "Nova ideia" no Dashboard (`QuickIdeaButton`,
  `dashboard-page.tsx`) abre um modal curto (Título + Anotação opcional
  + seletor de World) e grava via `POST /journal/:worldId/pages`
  (endpoint já existente desde LIB-002/journal — nenhuma rota nova).
  Só aparece para quem já é dono de pelo menos um World. **Decisão de
  escopo documentada:** "World opcional" (mencionado no pedido) não foi
  implementado — `journal_pages.world_id` é `NOT NULL` desde a migration
  0011, e relaxar isso exigiria um rebuild de tabela
  (`docs/architecture/DATABASE_MIGRATION_SAFETY.md`) desproporcional
  para esta feature; o seletor de World no modal cobre o caso de uso
  real sem esse risco.
- **Bug real encontrado e corrigido durante o teste E2E do Quick Capture:**
  `.dashboard-grid`/`.settings-grid`/`.detail-grid` no breakpoint mobile
  usavam `grid-template-columns: 1fr` (sem `minmax(0, 1fr)`) — um único
  track `1fr` ainda respeita `min-width:auto` (o min-content do item),
  então uma tabela larga (ex.: "O que jogar agora?" no Dashboard) forçava
  overflow horizontal na PÁGINA inteira em viewports estreitos. Isso
  desalinhava qualquer overlay `position:fixed`/`100vw` (mobile Chrome
  amplia o layout viewport para caber o conteúdo, descolando do visual
  viewport) — encontrado porque o modal de "Nova ideia" aparecia fora do
  lugar em `mobile-chromium`. Corrigido (`minmax(0, 1fr)`) — afeta
  positivamente qualquer overlay futuro nessas três grids, não só o
  Quick Capture.
- **F-003 (External Resources) — implementado como tabela própria, não
  como Vault Entity:** `vault_entities.entity_type` tem
  `CHECK(entity_type IN (...))` fechado (migration 0006) — adicionar um
  tipo novo exigiria rebuild da tabela mais referenciada por FK do
  produto (mesma classe de risco do incidente LIB-004B). Em vez disso,
  `external_resources` (migration `0023_external_resources.sql`) —
  tabela nova, aditiva, sem nenhuma FK de entrada. Escopada por World
  (`world_id NOT NULL`), visibilidade reaproveita o modelo do próprio
  World (leitura para quem `canViewWorld`, escrita só pelo owner — mesmo
  padrão do Diário), URL validada com a mesma política zero-fetch do
  `coverUrl` (LIB-001, sem allowlist, só sintática). Nova página
  `/app/worlds/:id/resources`, link "Recursos externos" na navegação
  contextual do World.
- **Testes:** integration (`global-search.test.ts` 6 casos,
  `external-resources.test.ts` 2 casos, +1 caso QUEST/HANDOUT em
  `specialized-entities.test.ts`), E2E (`dashboard-quick-idea.spec.ts`,
  `external-resources.spec.ts`, desktop+mobile). Suíte completa (unit
  185, integration 132, E2E — ver relatório) revalidada sem regressão.
- **Commit:** ver relatório da sessão (RELEASE_CHAIN_POLICY: commit
  final único, code+tests+docs, antes do deploy).
- **Fora de escopo desta rodada (deliberado, não é BLOCKED — planejado
  para o próximo batch):** Cartografia (F-002), Revision History (F-001)
  e GM Tools (F-004) — os três exigem desenho próprio (schema, UI,
  decisões de risco) maior que o restante deste batch; adiados para
  manter o tamanho do commit revisável, não por bloqueio real. VTT,
  Character Sheet Engine completo e Social/Amizades continuam
  explicitamente fora do 1.0.

## RPG-1.0-BATCH3 — GM Tools + Cartografia zero-cost

- **Status:** `DONE` — código+testes+docs no commit final, CI verde,
  deploy publicado, `GET /api/v1/version` confirmado.
- **F-004 (GM Tools) — implementado 100% client-side, sem backend:**
  rolador de dados (notação `NdM`/`NdM±K`, N≤20, M≤1000) e timer de
  mesa (start/pausa/zerar), acessíveis globalmente em `/app/gm-tools`
  (link "Ferramentas do Mestre" na navegação, seção Sistema — não é
  contextual a nenhum World). "Quick note" não foi duplicado: já
  satisfeito pelo botão "Nova ideia" do Dashboard (F-005, BATCH2).
  Lógica pura extraída para `src/domain/tools/dice.ts` (testável sem
  DOM/D1) — gerador de aleatoriedade injetável só para determinismo em
  teste, nunca usado para nada sensível a segurança.
- **F-002 (Cartografia) — v1.0 deliberadamente simples, não é VTT:**
  mapas (imagem externa, mesma política zero-fetch do `coverUrl`) com
  pins em coordenadas normalizadas (0-100%, sem depender da resolução
  real da imagem). Sem drag-and-drop nesta versão — clicar na imagem
  preenche X/Y automaticamente como conveniência, mas o valor continua
  editável nos campos numéricos. Pin pode se vincular opcionalmente a
  uma entidade do Vault (validado: só entidades do próprio usuário,
  não arquivadas). Explicitamente **não implementado** (fora de escopo
  do 1.0): tokens em tempo real, fog of war, movimento, WebSockets.
  - **Decisão de arquitetura:** duas tabelas novas (`world_maps`,
    `map_pins`, migration `0024_cartography.sql`), aditivas, sem
    nenhuma alteração em `vault_entities` — `map_pins.entity_id` é só
    uma FK de ENTRADA para um pai já existente e inalterado (diferente
    do caso do External Resources, que evitou deliberadamente ser um
    Vault Entity pelo mesmo motivo).
  - Mesmo padrão de autorização do Diário/External Resources: leitura
    para quem `canViewWorld`, escrita só pelo owner do World.
- **Testes:** unit (`tests/unit/dice.test.ts`, 7 casos), integration
  (`tests/integration/cartography.test.ts`, 3 casos — CRUD, authZ
  owner/membro/outsider, validação de coordenadas/URL insegura/IDOR em
  entidade vinculada), E2E (`tests/e2e/gm-tools.spec.ts`,
  `tests/e2e/cartography.spec.ts`, desktop+mobile). Suíte completa
  (unit 192, integration 135, E2E — ver relatório) revalidada sem
  regressão.
- **Commit:** ver relatório da sessão (RELEASE_CHAIN_POLICY: commit
  final único, code+tests+docs, antes do deploy).
- **Fora de escopo (deliberado, adiado para próximo batch — não é
  BLOCKED):** Revision History (F-001), a única funcionalidade da lista
  original ainda pendente. A própria auditoria de 14/08 já recomendava
  cautela ("não cabe com qualidade nesta sessão... exige desenho de
  schema + snapshot + restore + permissões") — decisão mantida
  deliberadamente para não entregar uma versão apressada e de baixa
  qualidade sob pressão de prazo.

## RPG-1.0-BATCH4 — UX error handling estrutural (obrigatório para 1.0)

- **Status:** `DONE`. Puramente frontend — sem migration, sem mudança
  de contrato de API.
- **Causa/objetivo:** achado do BATCH3 (não deveria ficar para depois,
  conforme correção de direção do usuário): ≥14 páginas carregavam
  dados iniciais sem tratar falha — um 404/401/5xx deixava a página
  presa em "Carregando…" para sempre.
- **Arquitetura (auditada antes de implementar, não foi aplicado
  `unhandledrejection` global por conveniência):**
  - `src/client/api/use-resource.ts` — hook `useResource<T>(path,
    fetcher?)`, estado `loading | success | error` derivado (loading
    só na carga inicial ou quando `path` muda de recurso — nunca
    forçado a cada `reload()`, ver bug 2 abaixo), `mutate()` para
    atualização local otimista pós-mutação (substitui os antigos
    `setData((current) => ...)`).
  - `src/client/components/resource-state.tsx` —
    `ResourceFallback`/`ErrorState`: 404 ("Não encontrado", mesma
    mensagem para inexistente OU não autorizado — deliberado, não
    vaza existência, ver Seção 17 do CLAUDE.md), 403 (tratado por
    completude, backend não emite hoje), 401 (ponte visual — quem
    resolve de verdade é o mecanismo de sessão abaixo), 5xx/rede
    (mensagem genérica + "Tentar novamente", nunca expõe o erro cru).
  - 401/sessão expirada é tratado à parte, não pelo `useResource`:
    `src/client/api/client.ts` dispara um evento só quando
    `code==='UNAUTHENTICATED'` (nunca por `status` sozinho — login e
    troca de senha também usam 401 com `code=INVALID_CREDENTIALS`, que
    nunca pode derrubar a sessão de quem já está logado).
    `AuthProvider` escuta e desloga; `<Protected/>` já redireciona
    para `/login`.
- **TEST FIRST:** `tests/e2e/error-states.spec.ts` (3 cenários) escrito
  e confirmado FALHANDO contra o código anterior antes de qualquer
  correção.
- **Dois bugs de corrida introduzidos e corrigidos na própria
  implementação (achados via E2E antes de qualquer deploy — nunca
  chegaram a produção):**
  1. `src/client/api/session-epoch.ts` — uma checagem de sessão antiga
     (ex.: anônima, feita ao carregar `/login`/`/register`) podia
     resolver DEPOIS do login/registro e deslogar o usuário
     incorretamente. Corrigido com um "epoch" de sessão: só reage ao
     401 se nada mudou a identidade da sessão entre o envio da
     requisição e a resposta.
  2. `reload()` resetava para "loading" a cada chamada, desmontando a
     página inteira a cada mutação — `core-flow.spec.ts` (teste já
     existente, não novo) pegou isso: texto digitado num formulário
     vizinho era apagado no meio da digitação. Corrigido para
     stale-while-revalidate (mantém dados antigos visíveis até a
     resposta nova chegar).
- **Migração:** ~20 pontos de carregamento em 13 páginas
  (`dashboard-page.tsx`, `library-pages.tsx`, `cartography-pages.tsx`,
  `external-resources-pages.tsx`, `group-pages.tsx`,
  `relations-pages.tsx`, `vault-pages.tsx`, `world-knowledge-pages.tsx`,
  `world-pages.tsx`, `campaign-pages.tsx`, `timeline-pages.tsx`,
  `bestiary-page.tsx`). Formulários de edição que só pré-preenchem
  campos (sem gate de carregamento) ganharam apenas `.catch` com
  mensagem de erro — risco proporcional ao problema real, sem reescrita
  desnecessária.
- **Testes:** `tests/e2e/error-states.spec.ts` (3 cenários novos) +
  suíte completa revalidada em estado limpo: 50 E2E (desktop+mobile),
  192 unit, 135 integration — todos verdes, sem regressão.
- **Auditoria complementar deste batch (itens 4 do pedido de
  finalização acelerada):** varredura de links/rotas mortos
  (`grep` de todos os `to="..."` contra as rotas definidas em
  `app.tsx`) — nenhum link morto encontrado.

## P0-002 — Falhas em GitHub Actions

- **Priority:** P0
- **Status:** `DONE`
- **Dependencies:** nenhuma
- **Definition of Done:**
  - [x] Auditar todas as runs falhas do histórico visível
  - [x] Classificar cada uma (nenhuma foi `REAL_REGRESSION` de produto;
        1 foi bug real de teste — seletor frágil; 1 foi `TIMEOUT`/
        contenção de runner compartilhado)
  - [x] Corrigir causa raiz, não usar rerun como solução:
        - seletor frágil (`getByRole('heading')` sem nome) → escopado
          para o heading correto
        - timeout ocasional → `retries: CI?1:0` (1 retry barato no
          próprio Playwright, não workflow inteiro) +
          `expect.timeout: 10s`
  - [x] Custo R$ 0 mantido — `concurrency` cancela runs supersedidos,
        `paths-ignore` pula o pipeline em commits só de docs
  - [x] Nenhuma falha aberta no histórico atual (`gh run list --status
        failure` só mostra runs já corrigidas por commits subsequentes
        verdes)
- **Commit:** `b1f97df` (concurrency/paths-ignore), `d356ca9` (seletor),
  `f0498ac` (retry/timeout)
- **Production version:** N/A (mudança de CI, não de app)

## F-001 — Revision History — `DONE` (RPG-1.0-BATCH5)

**Histórico da decisão** (preservado, não é omissão silenciosa): nas
sessões anteriores este item foi classificado `OUT_OF_SCOPE_1_0` porque
era P3, o item de maior risco de schema da lista de `MISSING`, e
implementar apressado sob pressão de prazo violaria a Seção 40 do
`CLAUDE.md`. Com o restante do backlog 1.0 já `DONE` e período adicional
disponível, o item foi reaberto deliberadamente (não por pressa) para
esta sessão, com auditoria completa antes de qualquer código — ver
`docs/product/RPG_MANAGER_FINAL_STATUS.md`, seção F-001, para o desenho
completo (arquitetura, decisão snapshot-vs-diff, autorização, testes).

- **Escopo:** Vault entities, Journal pages e Worlds (conteúdo autoral
  editável priorizado, seção 5 do pedido). Timeline/Relations/Maps/
  External Resources ficam deliberadamente fora — nenhum tem histórico
  de edição rico o suficiente para justificar o custo agora.
- **Modelo:** um snapshot JSON por revisão (não diff) — mais simples,
  mais barato de restaurar, decisão registrada e comparada com diff em
  `RPG_MANAGER_FINAL_STATUS.md`.
- **Migration:** `migrations/0025_entity_revisions.sql` — puramente
  aditiva (nova tabela `entity_revisions`, nenhum `DROP`/`RENAME` de
  tabela existente, ver `docs/architecture/DATABASE_MIGRATION_SAFETY.md`).
- **Autorização:** histórico é owner-only — mesmo limite que já existe
  para EDITAR esses três recursos neste produto (não existe co-edição
  hoje). Nunca um canal de acesso mais amplo que a edição já é.
- **Restore:** sempre cria uma NOVA revisão (nunca "volta o ponteiro"),
  revalida os dados com a MESMA função de validação de um update normal
  (nunca um caminho de escrita paralelo).
- **Testes:** `tests/integration/revision-history.test.ts` (16 casos:
  criação/edição/restore, isolamento entre contas, 404 sem vazar
  existência, número de revisão inválido, snapshot sem campos proibidos,
  recurso arquivado bloqueia restore) + `tests/e2e/revision-history.spec.ts`
  (fluxo completo Vault + World, desktop/mobile via projects do CI).

## F-015 — Backup/Restore completo — `DONE` (RPG-1.0-BATCH6)

Primeiro item do roadmap pós-1.0 (correção de direção do responsável do
produto: congelamento revogado, ver `docs/product/FULL_ROADMAP.md`) —
executado primeiro porque protege dados antes dos módulos maiores
seguintes.

- **Export `GET /api/v1/export` v8** (`schemaVersion`, era `version`):
  cobertura completa de todo dado autoral — os campos especializados de
  Vault, Journal, Wiki, Relations, Cartografia, External Resources,
  Timeline/Calendar e Revision History que faltavam desde a v7 (achado
  real do BATCH5) agora estão todos presentes.
- **Restore `POST /api/v1/import/backup/preview` + `/confirm`**
  (`src/server/routes/backup-restore.ts`), mesmo padrão preview/confirm
  com TTL de 30min já usado pelo import de CSV, numa tabela dedicada
  (`backup_restore_jobs`, migration `0026`, aditiva — evita relaxar o
  `CHECK(kind IN (...))` de `import_jobs`, mesma lição do incidente
  LIB-004B).
- **Decisão de segurança central:** restore sempre cria registros
  NOVOS (IDs gerados no servidor) — nunca sobrescreve nada por ID.
  Elimina o vetor de IDOR mais óbvio (JSON manipulado tentando
  assumir/sobrescrever dado de outro dono) e o risco de destruir dado
  real silenciosamente; `owner_user_id`/`user_id` do JSON enviado é
  **sempre** ignorado — o dono do dado restaurado é sempre quem está
  autenticado (testado explicitamente: restaurar o backup de outra
  conta não reatribui nada a ela).
- Toda linha reconstruída é revalidada pelos MESMOS schemas Zod do
  create normal — nunca confia no shape do JSON além do que esses
  schemas aceitam.
- **Escopo v1 do restore automatizado:** Worlds, Creature Stat
  Templates, Vault entities (+ todos os campos especializados), Journal
  (pastas+páginas). Groups/Campaigns/Library, Wiki (organização),
  Relations, Cartografia, External Resources e Revision History
  continuam cobertos pelo EXPORT (nada é perdido no backup) mas ainda
  não têm restore automatizado — documentado como próxima iteração
  natural, não escondido.
- Testes: `tests/integration/backup-restore.test.ts` (7 casos —
  export v8 completo, round-trip com hierarquia de Location + ficha de
  criatura + pastas de Diário aninhadas, IDOR entre contas, job
  owner-only, versão incompatível, JSON malformado, linha inválida não
  trava o resto do restore) + `tests/e2e/backup-restore.spec.ts` (fluxo
  completo pela tela de Configurações).

## F-016/F-019 — Social: amizades, bloqueios e notificações — `DONE` (RPG-1.0-BATCH7)

Segundo item do roadmap pós-1.0 (`docs/product/FULL_ROADMAP.md`), na
ordem de dependência técnica real: F-017 (Biblioteca social) e F-018
(convites de Grupo/Campanha via amigo) dependem de F-016 existir, então
esta rodada entrega a base (F-016) e o que decorre diretamente dela sem
depender de mais nada (F-019 — notificação de pedido/aceite).

- **Migration `0027_social_friendships.sql`** (aditiva): `friend_requests`
  (pedido pendente) e `friendships` (confirmada, par canônico
  `user_id_a < user_id_b` — impede duas linhas para o mesmo par sem
  precisar de índice de expressão) são tabelas separadas, não uma
  state-machine única — evita o estado ambíguo "quem pode aceitar isto?"
  exigir sempre checar qual lado é requester. `user_blocks` é
  independente de amizade (bloquear funciona mesmo sem nunca terem sido
  amigos). `notifications` com `kind CHECK` fechado (mesma lição do
  LIB-004B: adicionar valor depois é aditivo, remover não).
- **Busca reaproveita `GET /directory/users`** (já existia, nunca expõe
  e-mail, rate-limited) — o status de cada resultado (amigo/pendente/
  bloqueado) é calculado no cliente cruzando com as listas já
  carregadas, em vez de anotar um endpoint compartilhado com o fluxo de
  membros de Grupo/World.
- **Decisões de segurança/UX:**
  - Pedido cruzado (B já tinha pedido A) auto-aceita em vez de empilhar
    um segundo pedido pendente.
  - Bloquear remove amizade/pedido existente nos dois sentidos e
    impede novo pedido em qualquer direção enquanto durar.
  - Aceitar/recusar só pelo addressee, cancelar só pelo requester,
    remover amizade por qualquer um dos dois — sempre `404` (nunca
    `403`) para quem não participa, mesmo padrão de não vazar
    existência já usado no resto do produto.
  - Notificações são owner-only; `SOCIAL_RATE_LIMITER` novo (20/60s)
    limita criação de pedido e bloqueio.
- **UI:** página `/app/friends` (link global "Amigos", mesma seção de
  Biblioteca/Vault/Grupos/Campanhas/Mundos) e sino de notificações na
  sidebar (contagem de não lidas, dropdown, marcar lida/todas).
- **Bug real e sistêmico encontrado e corrigido durante esta rodada
  (não introduzido por ela — latente desde o BATCH5, achado ao rodar a
  suíte E2E completa após adicionar o sino de notificações à
  `AppShell`, presente em TODA página autenticada):** `VaultFormPage` e
  `WorldFormPage` ganharam um gate de `loading` no BATCH5 para o achado
  "digitar antes do GET resolver apagava a digitação" — mas o gate só
  protegia contra a digitação ocorrer ANTES de qualquer resposta
  chegar. O React StrictMode (`main.tsx`, só em dev) monta esses
  efeitos duas vezes de propósito, disparando dois GETs reais; sem um
  guard `active`, a resposta do primeiro GET (descartável) podia
  resolver DEPOIS do segundo e sobrescrever o formulário no meio da
  edição, revertendo silenciosamente uma segunda edição em sequência —
  reproduzido de forma determinística (100% em 3 execuções seguidas
  antes da correção, 100% estável em 3 execuções depois). Corrigido com
  o padrão `let active=true; ...; return () => { active=false }` — já
  usado corretamente em outras páginas do projeto (ex.: `WorldWikiPage`)
  — aplicado também em `GroupFormPage`, `CampaignFormPage` e
  `SessionFormPage`, que tinham a mesma lacuna latente (auditado
  sistematicamente, não só os dois casos que o teste pegou).
- **Testes:** `tests/integration/social.test.ts` (6 casos — fluxo
  completo, recusar/cancelar por quem não deveria poder, pedido
  cruzado, rejeições, bloquear/desbloquear, notificações owner-only) +
  `tests/e2e/social-friends.spec.ts` (2 cenários, desktop+mobile).
- **Fora desta rodada, dependência técnica real (não bloqueio):** F-017
  (Biblioteca social) e F-018 (convites de Grupo/Campanha via amigo)
  dependem de F-016 já existir — próxima iteração natural do roadmap,
  não uma omissão.

## F-017/F-018 — Social + Biblioteca/Grupos/Campanhas — `DONE` (RPG-1.0-BATCH8)

Fecha a vertical Social (F-016..F-019) por completo — F-017/F-018
dependiam de F-016 (`DONE` no BATCH7) e foram implementados no próximo
ponto tecnicamente apropriado, sem deixar a vertical parcialmente
concluída.

- **Migration `0028_social_library_invites.sql`** (aditiva): `ALTER
  TABLE user_preferences ADD COLUMN library_visible_to_friends`
  (`DEFAULT 0` — desligado por padrão, ninguém vê a Biblioteca de
  outra conta sem essa ação consciente do dono), `rpg_social_interest`
  (nova tabela, chave é `rpg_id`), `social_invites` (convite
  explícito de Grupo/Campanha). `notifications.kind` (fechado desde o
  BATCH7) foi ampliado via o procedimento de
  `docs/architecture/DATABASE_MIGRATION_SAFETY.md` — seguro aqui
  porque nada referencia `notifications.id` via FK e a tabela estava
  vazia em produção, mas seguido por disciplina/precedente.
- **F-017 — decisão de segurança central:** campos privados (notas,
  prioridade, grupo, mestre, data planejada) NUNCA entram no SELECT
  que alimenta a Biblioteca de amigos — não é uma filtragem que possa
  vazar por engano, o dado nunca sai do servidor para esses campos. O
  campo pessoal `wants_to_play` também nunca é exposto — o sinal
  social é `rpg_social_interest`, deliberadamente uma tabela/conceito
  separado (o pedido de roadmap exigia essa distinção explicitamente).
  RPGs arquivados nunca aparecem na visão do amigo.
- **F-018 — decisão de segurança central:** convite nunca cria membro
  diretamente — só a ação explícita de aceitar (pelo convidado) cria a
  linha em `play_group_members`/`campaign_members`, reaproveitando as
  MESMAS tabelas e a MESMA coluna `user_id` que o fluxo antigo de
  "adicionar conta cadastrada" já usava (nenhum sistema de membership
  paralelo). Só o dono do Grupo/Campanha pode convidar, só quem já é
  amigo do dono pode ser convidado. Papel GM continua exclusivo (mesma
  invariante do fluxo antigo, reaplicada no aceite do convite).
  Remoção de membro (funcionalidade já existente, não alterada) segue
  preservando histórico — `campaign_session_attendance` é append-only
  e não referencia `campaign_members` de forma que a remoção apague
  sessões passadas.
- **UI:** `/app/friends` ganhou link "Ver biblioteca" por amigo, nova
  página `/app/friends/:userId/library`, seção "Convites de Grupo/
  Campanha" (recebidos/enviados); Configurações ganhou o toggle
  "Compartilhar minha Biblioteca com amigos"; RPG detail ganhou
  "Marcar interesse social" (separado do checkbox "Quero jogar" do
  formulário de edição); GroupDetailPage/CampaignDetailPage ganharam o
  painel reutilizável "Convidar amigo" (`InviteFriendPanel`).
- **Bugs reais de TESTE (não de produto) corrigidos durante a
  escrita:** asserção `toBe(true)` contra um campo `EXISTS(...)` do
  SQLite (retorna `1`/`0`, não `true`/`false` — mesma convenção já
  usada em `hasPlayed`/`wantsToPlay` no resto do produto, corrigido
  para `toBeTruthy()`/`toBeFalsy()`); teste E2E clicando num link para
  a MESMA rota em que já estava (no-op de navegação do React Router —
  corrigido com reload explícito); locator ambíguo casando com uma
  `<option>` invisível de um dropdown e com um heading que continha o
  mesmo texto como substring (corrigido com locator mais específico e
  `exact:true`).
- **Testes:** `tests/integration/social-library-invites.test.ts` (5
  casos) + `tests/e2e/social-library-invites.spec.ts` (2 cenários,
  desktop+mobile).
- **Vertical Social (F-016..F-019) agora completa.** Próximo item da
  ordem de execução do roadmap: BATCH9 — Character Sheet Engine base
  (F-020).

## F-020 — Character Sheet Engine base — `DONE` (RPG-1.0-BATCH9)

Motor de fichas genérico e neutro em relação a sistema de jogo,
graduado de `src/domain/future/character-sheet.ts` (sketch já existia
com o contrato `validateSheet`/`SheetTemplate` travado por
`tests/unit/future-architecture.test.ts` — preservado sem alterar
assinatura, só movido para `src/domain/sheets.ts` e ligado a rotas
reais).

- **Migration `0029_character_sheets.sql`** (aditiva): `sheet_templates`
  (modelo declarativo — campos TEXT/NUMBER/BOOLEAN/CHOICE, `world_id`
  OPCIONAL, `version`) + `character_sheets` (1:1 com `vault_entities`,
  `template_version` grava a versão do modelo no momento do
  preenchimento). Generaliza o padrão já comprovado por
  `creature_stat_templates`/`creature_stat_blocks` (migration 0015),
  com duas diferenças deliberadas:
  - `world_id` opcional — Personagem/NPC não exigem World
    (Vault-first, `CLAUDE.md` §2/§24); um modelo sem World serve
    qualquer entidade do dono.
  - versionamento — alterar os campos de um modelo incrementa
    `version`; fichas já preenchidas guardam a versão antiga
    (`template_version`) e passam a ser sinalizadas `outdated:true`
    sem invalidar retroativamente o que já existe.
- **Decisão de autorização:** leitura da ficha segue `authorizedEntity`
  (mesma visibilidade PRIVATE/GROUP/CAMPAIGN/PLAYERS/GM_ONLY da
  entidade — nunca vaza para quem não pode ver a entidade); escrita
  segue `ownedEntity` — o produto não tem co-edição de Vault Entity em
  lugar nenhum (mesmo limite já documentado em `vault.ts`), então a
  ficha de um Personagem controlado por um jogador continua editável
  apenas pelo dono/GM que criou a entidade, não pelo jogador vinculado.
  Isso é consistente com todo o resto do domínio Vault e evita
  introduzir um modelo de coedição novo sem desenho de conflito.
- **Decisão de escopo:** aplica-se a CHARACTER e NPC (não CREATURE, que
  mantém seu próprio motor de bestiário já existente). Guardado como
  recurso separado (`/api/v1/sheets/entities/:id`), não embutido no
  `SELECT`/`present()` gigante de `vault.ts` — reduz risco de
  regressão no fluxo de edição de entidade já estável, ao custo de uma
  chamada extra (mesmo princípio de "menor mudança seria segura").
- **Validações de servidor:** `TEMPLATE_FIELDS_IN_USE` bloqueia
  remover/renomear a chave de um campo com valor já salvo em alguma
  ficha; `TEMPLATE_IN_USE` bloqueia excluir modelo em uso;
  `INVALID_ENTITY_TYPE` bloqueia vincular ficha a entidade que não é
  CHARACTER/NPC; `TEMPLATE_WORLD_MISMATCH` bloqueia usar modelo de um
  World diferente do da entidade (ou modelo de World nenhum World
  quando a entidade pertence a um). Erros de valor por campo
  (`INVALID_SHEET_VALUES`) reaproveitam `validateSheet` e são
  convertidos para o formato `Record<string,string[]>` já usado pelo
  resto da API (`ClientApiError.fields`) na borda HTTP, sem alterar o
  contrato puro do domínio.
- **UI:** `/app/sheets` (gestão de modelos — criar/excluir, campo por
  campo, com World opcional); painel "Ficha de personagem" na página
  de detalhe do Vault (`EntitySheetPanel`, complementar — falha não
  bloqueia a página principal, mesmo princípio de metadata/backlinks
  já usado ali); `/app/vault/:id/sheet` (selecionar modelo, preencher
  campos tipados, erros por campo, remover ficha).
- **Bug real de TESTE (não de produto) corrigido durante a escrita da
  suíte de integração completa:** um teste pré-existente e pesado
  (`vault-and-worlds.test.ts` — 4 contas + ~12 entidades/vínculos em
  sequência) passou a estourar o timeout padrão de 5000ms do vitest de
  forma intermitente sob a suíte completa (contenção do pool de
  workers, mais pronunciada com a suíte maior), mesmo sempre passando
  isolado — corrigido com um timeout explícito de 15s nesse teste
  específico, sem alterar sua lógica.
- **Testes:** `tests/integration/character-sheets.test.ts` (5 casos:
  criação+vínculo+validação por campo, IDOR entre donos e restrição de
  tipo de entidade, compatibilidade de World, bloqueio de exclusão/
  edição de campo em uso + versionamento, remoção de ficha) +
  `tests/e2e/character-sheets.spec.ts` (1 cenário, desktop+mobile:
  criar modelo → vincular a um Personagem → erro de campo obrigatório
  → salvar → editar → remover).
- Próximo item da ordem de execução do roadmap: BATCH10 — F-021 (PDF
  Character Sheets) + F-023 (Vault system-aware), reaproveitando
  `sheet_templates`/`character_sheets`.

## Itens auditados nesta sessão, sem ação necessária (ver
`docs/audit/RPG_MANAGER_1_0_MATRIX.md` para a auditoria completa)

Todas as features CORE/WORLD/KNOWLEDGE/RELATIONS/TIME/CONTENT/COLLAB/
SYSTEM auditadas como `COMPLETE` ou `PARTIAL` não-bloqueador. Nenhuma
`BROKEN` encontrada fora dos dois P0 acima (já `DONE`).

## Backlog futuro (não iniciado, não obrigatório para 1.0)

| ID | Title | Priority | Status |
|---|---|---|---|
| F-001 | Revision History (`entity_revisions`) | P3 | `DONE` (RPG-1.0-BATCH5) |
| F-002 | Cartografia zero-cost (mapas/pins) | P3 | `DONE` (RPG-1.0-BATCH3) |
| F-003 | External Resources (referência a URL externa) | P3 | `DONE` (RPG-1.0-BATCH2) |
| F-004 | GM Tools (dice roller, timer, quick notes) | P3 | `DONE` (RPG-1.0-BATCH3) |
| F-005 | Ideas / Quick Capture (UX sobre Journal existente) | P3 | `DONE` (RPG-1.0-BATCH2) |
| F-006 | Teste de integração dedicado para Global Search | P2 | `DONE` (RPG-1.0-BATCH2) |
| F-012 | Teste de integração dedicado para Invites | P1 | `DONE` — revalidado, já coberto por `vault-and-worlds.test.ts` desde antes desta sessão (create/accept/reuse/invalid-token/expiry/revoke) |
| F-013 | Quests/Handouts | P2 | `DONE` — `SATISFIED_BY_EXISTING_DOMAIN` (entidades base do Vault, sem subsistema novo) |
| F-014 | Compendium (visão agregada) | P3 | `DONE` — `SATISFIED_BY_EXISTING_DOMAIN` (Vault já é a listagem filtrável por tipo/World/visibilidade) |
| F-007 | Split de domínio System→Publication→User State (Opção A, `LIBRARY_ARCHITECTURE.md`) | P2 | `DONE` (LIB-002) |
| F-008 | Upload real de capa + Workers KV (`COVER_STORAGE.md`) | P2 | `DONE` (LIB-005) |
| F-009 | Metadata provider Open Library (`METADATA_PROVIDERS.md`) | P2 | `DONE` (LIB-004) |
| F-010 | Dedup de RPG por ISBN em vez de título exato | P2 | `DONE` (LIB-003) |
| F-011 | Archive de RPG (schema pronto desde LIB-002: `rpgs.archived_at`; endpoint/UI ausentes) | P3 | `DONE` (LIB-006) |
| F-015 | Backup/Restore completo (export `schemaVersion:8` + restore com preview/confirm) | P2 | `DONE` (RPG-1.0-BATCH6) — export cobre 100% dos domínios; restore automatizado cobre Worlds/Creature Stat Templates/Vault/Journal (escopo v1, ver nota abaixo); Groups/Campaigns/Library/Wiki/Relations/Cartografia/External Resources/Revision History continuam exportados mas sem restore automatizado ainda (documentado, não silenciado) |

Explicitamente fora de escopo (decisão de produto, não backlog):
VTT, Sheets (motor completo), Social/Amizades.

## Regra de bloqueio

Nenhum item da tabela "Backlog futuro" deve ser iniciado enquanto
existir qualquer P0/P1 com status `IN_PROGRESS` ou `BLOCKED`. Estado
atual: **nenhum P0/P1 aberto** — ambos os P0 estão `DONE` (P0-001 com
uma única pendência de smoke manual documentada, não uma pendência de
código).

## Teste final autônomo — smoke de release automatizado

Pedido explícito: transformar o máximo possível de
`MANUAL_SMOKE_QUEUE.md` em smoke automatizado, sem burlar Turnstile.

- **Suíte nova:** `tests/e2e/release-1.0-smoke.spec.ts` — jornada única
  cobrindo Ideas, External Resources, Global Search (Command Palette),
  Cartografia (mapa + pin + vínculo com Vault + posição persistida +
  remoção), GM Tools (4 notações de dado validadas por faixa
  matemática, timer start/pause/reset), navegação cruzada por todos os
  módulos do produto, Light/Dark/System, overflow horizontal, e
  revalidação leve do error handling do BATCH4. Roda em desktop e
  mobile (projects existentes). Captura console/network durante toda a
  execução — falha se aparecer erro real de aplicação, com dois
  filtros de ruído conhecido e documentados no próprio arquivo
  (checagem anônima de sessão antes do login, e `net::ERR_ABORTED` de
  requisição cancelada por navegação — padrão comum do Playwright, não
  falha de rede real).
- **Bugs reais de teste corrigidos durante a escrita** (não eram bugs
  de produto): `getByLabel('World', {exact:true})` dentro do modal de
  Nova Ideia travava indefinidamente por um motivo não totalmente
  identificado (possível particularidade do cálculo de nome acessível
  do Playwright para `<select>` dentro de `<label>` implícito
  aninhado em `role=dialog`) — contornado com um seletor estrutural
  (`ideaDialog.locator('select')`); um `openNavigation()` duplicado por
  iteração do loop de temas travava em mobile porque o botão "Abrir
  menu" vira "Fechar menu" enquanto o menu já está aberto.
- **Produção autenticada:** sem sessão legítima reutilizável disponível
  no ambiente de execução (sem storageState, sem perfil de navegador,
  sem cookie em variável de ambiente) — os 5 fluxos ficam
  `BLOCKED_BY_TURNSTILE` para produção autenticada especificamente;
  TODO o resto (local completo, produção read-only, integridade de
  dados, proteção de mídia) foi executado sem essa dependência. Ver
  relatório da sessão para o detalhamento completo.
- **`MANUAL_SMOKE_QUEUE.md`** permanece como está — os 5 itens
  continuam exigindo uma execução humana real em produção (Turnstile),
  mas agora com uma suíte E2E equivalente já provando o comportamento
  funcional correto localmente.
