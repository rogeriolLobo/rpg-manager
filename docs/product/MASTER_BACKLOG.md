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

## F-015 — Backup/Restore completo — `DONE` (RPG-1.0-BATCH6, revalidado BATCH19, expandido BATCH20-22 — ver seção "BATCH20-23" mais abaixo neste arquivo para o fechamento completo)

BATCH20 (pedido de finalização absoluta): reclassificado de `DONE` para
`IN_PROGRESS` — "Backup/Restore completo" só é aceito quando o restore
automatizado cobre todos os domínios persistentes relevantes, não apenas
o export. Restore agora também cobre Library (rpgs/publications/
game_systems, via a mesma camada canônica de `library-writes.ts`),
Groups/GroupMembers, Campaigns/CampaignMembers/Sessions/Attendance —
com deduplicação de título (`rpgs.title` UNIQUE) e nome de grupo
(`play_groups.name` UNIQUE) resolvida ao vivo no confirm (mesmo padrão
do slug de World), e a regra "nunca recriar outra pessoa" para
`user_id` de Group/Campaign Member (só preserva o vínculo se a conta
ainda existir; caso contrário `EXTERNAL_DEPENDENCY` no preview, membro
restaurado sem o vínculo). Wiki/Relations/Cartografia/External
Resources/Timeline/Revision History/Social/Sheets/Adventures
estruturadas/Files/VTT continuam export-only — próximo incremento.

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
- Próximo item da ordem de execução do roadmap: BATCH10 — F-023 (Vault
  system-aware), reaproveitando `sheet_templates`/`character_sheets`.
  F-021 (PDF) foi separado para seu próprio batch por ser feature grande
  e sensível a licenciamento.

## F-023 — Vault system-aware (Game System em sheet_templates) — `DONE` (RPG-1.0-BATCH10)

Generaliza o motor de F-020 para reconhecer Game System, sem tabela de
campos por RPG.

- **Migration `0030_sheet_templates_game_system.sql`** (aditiva):
  `sheet_templates.game_system_id` (nullable, `ON DELETE SET NULL`),
  mutuamente exclusivo com `world_id` — validado no schema Zod
  (`sheetTemplateInputSchema.refine`), não via CHECK de SQL (evita
  depender de um recurso de `ALTER TABLE ADD COLUMN` com CHECK
  multi-coluna cujo suporte no SQLite do D1 não estava confirmado; a
  mesma exclusividade já é aplicada só na camada de app em outros
  campos do produto, ex.: `groupId` só é obrigatório quando
  `visibility=GROUP`).
- **Decisão central:** o Game System de uma entidade é derivado, nunca
  armazenado — `worlds.default_rpg_id → rpgs.publication_id →
  publications.game_system_id` (cadeia 100% já existente desde a
  migration 0005/0016; nenhuma coluna nova em `vault_entities`). Um
  modelo escopado a um Game System passa a valer para qualquer entidade
  cujo World tenha um Rpg padrão daquele sistema — exatamente "sem
  tabela por RPG" do enunciado do roadmap, porque o mesmo Game System
  pode ter várias Publications/edições no catálogo compartilhado
  (`game_systems`, sem dono, ver LIB-002) e todas continuam valendo
  para o mesmo modelo.
- **`GET /sheets/entities/:id/templates`** (nova rota) é a única fonte
  de verdade de compatibilidade (global OU World OU Game System
  resolvido) — o `PUT /sheets/entities/:id` de vínculo reaproveita a
  mesma função (`templateCompatible`/`resolveEntityContext`) para nunca
  divergir entre "o que a UI sugere" e "o que o servidor aceita". Código
  de erro do PUT trocado de `TEMPLATE_WORLD_MISMATCH` para o mais geral
  `TEMPLATE_INCOMPATIBLE` (nenhum teste dependia do código antigo).
- **`GET /sheets/game-systems`** (nova rota) devolve só os Game Systems
  já usados na Biblioteca do próprio usuário (não o catálogo
  compartilhado inteiro) — suficiente para o formulário de modelo, sem
  precisar de uma tela de busca no catálogo global que o produto ainda
  não tem em lugar nenhum.
- **UI:** formulário de modelo (`/app/sheets`) ganhou o seletor "Game
  System (opcional)", desabilitado enquanto um World estiver
  selecionado (e vice-versa, escolher World limpa o Game System);
  `SheetEditorPage` passou a buscar `/sheets/entities/:id/templates` em
  vez de filtrar a lista completa no cliente.
- **Testes:** 2 novos casos em `tests/integration/character-sheets.test.ts`
  (compatibilidade cross-World via Game System resolvido do Rpg padrão,
  incluindo o caso "entidade sem World nunca vê modelo de sistema"; e
  exclusividade mútua World/Game System + `INVALID_GAME_SYSTEM`) — 7
  casos no total no arquivo. `tests/e2e/character-sheets.spec.ts`
  estendido com a asserção do seletor "Game System" no formulário.
- Próximo item da ordem de execução do roadmap: BATCH11 — F-021 (PDF
  Character Sheets), agora como batch próprio.

## F-021 — PDF Character Sheets — `DONE` (RPG-1.0-BATCH11)

Fichas em PDF, reaproveitando por completo o motor de F-020/F-023.
Dependência nova: `pdf-lib` (MIT, gratuita — pré-autorizada por
CLAUDE.md §7).

- **Migration `0031_sheet_pdf_mapping.sql`** (aditiva):
  `sheet_templates.pdf_url` + `pdf_mapping_json`.
- **Decisão central de licenciamento/Zero Cost:** o PDF em si NUNCA
  passa pelo servidor do RPG Manager — nem busca, nem armazena, nem
  redistribui. O servidor só guarda a URL (validada como https pública
  via `isPublicHttpsUrl`, a mesma função já usada por `coverUrl` — "o
  servidor nunca busca essa URL") e o mapeamento (metadata de posição/
  nome de campo). Toda a leitura, detecção de campos, preenchimento e
  geração do PDF final acontecem no NAVEGADOR do usuário, a cada
  exportação, via `pdf-lib` — mesma responsabilidade de licenciamento
  que já vale para `coverUrl`/External Resources (o usuário só deve
  linkar conteúdo que tem direito de usar).
- **Dois modos de mapeamento por campo** (`src/domain/sheets.ts`,
  `PdfFieldMapping`, `validatePdfMapping`): `ACROFORM` (nome de um
  campo de formulário preenchível já existente no PDF — detectável no
  navegador via "Detectar campos do PDF", sem o usuário precisar abrir
  o PDF num editor para descobrir o nome interno do campo) e `OVERLAY`
  (página/x/y/tamanho de fonte — desenha o valor como texto, para PDFs
  digitalizados/sem AcroForm). `fillSheetPdf` detecta o tipo real do
  campo AcroForm (`PDFCheckBox`/`PDFDropdown`/`PDFRadioGroup`/
  `PDFTextField`) e aplica a operação certa, com aviso (não erro fatal)
  por campo que falhar, para uma exportação nunca travar por causa de
  um único mapeamento desatualizado.
- **CSP:** `connect-src` ampliado de `'self'` para também aceitar
  `https:` (mesma política já aplicada a `img-src` para `coverUrl`) —
  necessário porque o preenchimento busca o PDF externo via `fetch()`
  do navegador. `public/_headers` e `tests/unit/security.test.ts`
  atualizados juntos (há um teste que trava os dois alinhados).
- **Performance:** `pdf-lib` é importado dinamicamente dentro de
  `src/client/pdf/sheet-pdf.ts` (nunca no topo do arquivo) — um import
  estático quase dobrava o bundle principal (chunk carregado em toda
  navegação); com import dinâmico, cai num chunk separado, buscado só
  quando `/app/sheets` ou o painel de ficha com PDF são realmente
  usados.
- **Gap do F-020 corrigido de passagem:** o modelo de ficha nunca tinha
  UI de edição (só criar/excluir) mesmo já existindo `PATCH
  /sheets/templates/:id` no backend desde o F-020 — corrigido aqui
  porque o mapeamento de PDF precisa ser ajustável depois de criado
  (acertar posição x/y na prática exige tentativa e erro). `/app/sheets`
  ganhou "Editar" por modelo, reaproveitando o mesmo formulário.
- **Testes:** `tests/unit/sheets.test.ts` (novo, `validatePdfMapping`)
  + 2 casos novos em `tests/integration/character-sheets.test.ts` (8 no
  total: PDF persistido/refletido na ficha da entidade + URL insegura
  rejeitada + mapeamento para chave inexistente rejeitado + PATCH não
  altera version) + `tests/e2e/character-sheets.spec.ts` estendido com
  um cenário completo (desktop+mobile): gera um PDF com AcroForm em
  memória, intercepta o fetch do navegador (`page.route`), detecta o
  campo, mapeia, vincula à ficha de um Personagem e baixa o PDF
  preenchido de verdade.
- Próximo item da ordem de execução do roadmap: BATCH12 — F-022 (Vault
  avançado).

## F-022 — Vault avançado (LINK/FORK entre Worlds) — `DONE` (RPG-1.0-BATCH12)

- **Achado 1 — reuso entre Campaigns/Adventures já estava satisfeito**:
  `campaign_entities` (migration 0007) já é many-to-many
  campaign↔entity desde a base do produto — uma Adventure (ou
  qualquer outra entidade) já pode ser `REFERENCE`/`ACTIVE` em várias
  Campaigns simultaneamente, sem duplicação. Não era um gap real.
- **Achado 2 — o gap real era reuso entre Worlds**: `vault_entities.world_id`
  é uma coluna única (0 ou 1 World).
- **Migration `0032_world_entity_links.sql`** (aditiva): `world_entity_links
  (world_id, entity_id, created_at)` — LINK many-to-many. `worldEntityDiscoveryPredicate`
  (`src/server/content/authorization.ts`) é o único ponto que sabe resolver
  "esta entidade pertence a este World OU foi linkada nele" — sempre
  combinado com `entityAuthorizationPredicate` na mesma query, nunca
  usado sozinho (LINK é só descoberta, nunca autorização). Aplicado em:
  `GET /vault?worldId=`, Wiki (`knowledge.ts`: listagem, tags, aliases,
  backlinks), busca escopada por World (`search.ts`), nós do Grafo
  (`relations.ts` — relações em si continuam presas ao World onde foram
  criadas, só o NÓ da entidade passa a poder aparecer via link).
  **Timeline deliberadamente excluída** e documentada em código: a data
  de um EVENT é interpretada sob o calendário/eras de UM World
  específico — linkar mudaria a interpretação da data sem reprojeção,
  o que seria semanticamente incorreto; fica para um redesenho futuro
  se necessário.
- **`POST /vault/:id/fork`** (COPY explícito, nunca automático — a regra
  de "não duplicar NPC/Location/etc." do `CLAUDE.md` §17/25 é sobre
  duplicação IMPLÍCITA, não sobre um fork pedido deliberadamente pelo
  usuário): reaproveita `buildEntityCreateStatements`/`validateReferences`
  (extraídos do `POST /` original — um fork É um create normal, nunca
  um caminho paralelo). Aceita overrides opcionais (nome/World/
  visibilidade/grupo); nunca copia `parentEntityId` (hierarquia de
  Location fica presa ao World de origem) nem o vínculo de ficha de
  criatura (`statBlock` referencia um template de um World específico).
- **Autorização:** LINK e FORK são owner-only (`ownedEntity`/`ownedWorld`),
  mesmo limite de "sem co-edição" do resto do domínio Vault — nunca
  cross-account. Testado explicitamente que LINK nunca amplia quem vê
  uma entidade (Player membro de um World não ganha acesso a uma
  entidade GM_ONLY só por ela estar linkada lá).
- **UI:** painel "Worlds vinculados" na página de detalhe do Vault
  (vincular/desvincular, só para o dono) e botão "Duplicar" (fork
  rápido com valores padrão — overrides ficam disponíveis via API para
  uma futura UI mais rica, sem bloquear o v1).
- **Achado de infraestrutura de CI corrigido nesta rodada (não é do
  F-022, mas bloqueava o push dele):** `npx playwright install
  --with-deps chromium` travou 4 vezes nesta sessão (às vezes 15-20+
  minutos) no `apt-get` do mirror `azure.archive.ubuntu.com`, sempre
  parado em `Get: .../noble-security InRelease`. Corrigido de raiz:
  `.github/workflows/ci.yml` passou a rodar o job `validate` dentro do
  container oficial `mcr.microsoft.com/playwright:v1.62.1-noble`
  (Chromium + dependências de SO + Node já inclusos), eliminando o
  `apt-get` do job inteiro em vez de só re-tentar a cada vez que travava.
- **Testes:** `tests/integration/vault-links-fork.test.ts` (6 casos: link
  não move a entidade + aparece/some da Wiki do World B ao
  vincular/desvincular sem nunca remover a entidade + busca respeita o
  link; outsider/IDOR/duplicado idempotente/`ALREADY_OWNING_WORLD`;
  LINK nunca amplia autorização — GM_ONLY continua invisível para
  Player mesmo linkado; fork gera ID novo e edição do fork nunca altera
  o original; fork aceita overrides e nunca copia parentEntityId; fork
  IDOR + World de destino inválido rejeitado) + `tests/e2e/vault-links-fork.spec.ts`
  (1 cenário completo, desktop+mobile).
- Próximo item da ordem de execução do roadmap: BATCH13 — F-024
  (One-Shots) + F-025 (Adventures aprofundadas).

## F-024 — One-Shots como conceito explícito — `DONE` (RPG-1.0-BATCH13)

Confirmado como especialização segura de Campaign (mesmo padrão de
F-013/F-014) — não é domínio novo.

- **Migration `0033_campaign_session_mode.sql`** (aditiva):
  `campaigns.session_mode` (`CAMPAIGN`\|`ONE_SHOT`, default `CAMPAIGN`).
  Antes, um One-Shot só existia "por convenção" (Campaign com
  `session_goal=1`), sem nenhum marcador explícito — não dava para
  filtrar/comunicar a intenção de mesa única e autocontida.
- `GET /campaigns?sessionMode=` filtra a visão "Meus One-Shots" (mesmo
  padrão do filtro `worldId` já existente).
- **UI:** campo "Formato" no formulário de criar/editar campanha, badge
  "One-Shot" na listagem (só aparece quando `ONE_SHOT` — Campaign
  continua sendo o padrão silencioso), linha "Formato" no resumo da
  campanha.
- **Testes:** `tests/integration/campaign-session-mode.test.ts` (2
  casos: default/aceite/refletido no GET, `INVALID_SESSION_MODE`
  rejeitado, filtro só retorna o formato pedido, PATCH atualiza) + E2E
  (`core-flow.spec.ts` estendido com asserção do default "Formato").
- Próximo: F-025 (Adventures aprofundadas), mesmo BATCH13.

## F-025 — Adventures aprofundadas (acts/scenes/encounters/handouts) — `DONE` (RPG-1.0-BATCH13)

- **Migration `0034_adventure_structure.sql`** (aditiva): `adventure_scenes`
  (act/título/resumo/texto para ler em voz alta/notas do mestre/concluída),
  `adventure_encounters` (por cena), `adventure_scene_entities` (many-to-many
  cena↔Vault Entity, mesmo princípio de `campaign_entities` — nunca
  duplica NPC/Location/Item já cadastrado), `adventure_handouts` (texto
  livre e/ou referência a um External Resource do mesmo World, `revealed_at`
  nulo até o GM revelar).
- **Decisão de escopo v1:** ferramenta de preparação do GM — leitura e
  escrita de scenes/encounters/handouts são owned-only (mesmo modelo do
  Diário/Journal), nunca expostas a Players ainda. Expor handouts
  revelados/cenas na visão do jogador é responsabilidade de F-033
  (Player View), que já lista F-025 como dependência no roadmap —
  `revealed_at` já existe no schema preparado para isso, sem construir a
  superfície de jogador agora.
- **`src/server/routes/adventures.ts`**: `GET /adventures/:id` devolve
  a estrutura agregada (cenas com encontros e entidades aninhados +
  handouts) numa única chamada. `entity_type` é validado — só entidades
  `ADVENTURE` têm estrutura. Vincular uma entidade a uma cena exige
  `ownedEntity` na entidade alvo (nunca cross-account, mesmo dono da
  Adventure).
- **UI:** `/app/vault/:id/adventure` (link "Preparar aventura" na
  entidade Adventure) — cenas expansíveis com encontros/entidades
  aninhados, seção de handouts com toggle revelado/oculto.
- **Testes:** `tests/integration/adventures.test.ts` (5 casos: cena+
  encontro+vínculo de entidade sem duplicar + GET agregado; owner-only/
  IDOR + `entity_type` inválido; DELETE de cena cascade sem afetar a
  entidade vinculada; handout com toggle revelado; validação de cena/
  recurso externo inválidos) + `tests/e2e/adventure-prep.spec.ts` (1
  cenário completo, desktop+mobile).
- **Nota de processo:** o `npm run deploy` deste batch foi disparado
  acidentalmente com o código do F-025 já na working tree mas ainda não
  commitado (build local reflete o working tree, não HEAD) — corrigido
  aplicando a migration 0034 e fechando o commit/push imediatamente em
  seguida, para que HEAD=origin=produção convirjam para o mesmo
  conteúdo já validado, sem deixar rota nova quebrada em produção no
  meio do caminho.
- Próximo item da ordem de execução do roadmap: BATCH14 — F-026
  (conteúdo oficial/licenciado) + F-027 (Compendium).

## F-026 — Conteúdo oficial/licenciado — `DONE` (RPG-1.0-BATCH14)

Arquitetura de proveniência para qualquer Vault Entity — nunca copia
conteúdo protegido, só marca a origem declarada pelo usuário.

- **Migration `0035_vault_entity_provenance.sql`** (aditiva):
  `vault_entities.content_source` (`USER_CREATED` padrão\|`LICENSED`\|
  `OFFICIAL_REFERENCE`), `publisher`, `edition`, `license_note`,
  `content_locked`.
- **Decisão central:** `OFFICIAL_REFERENCE` é deliberadamente um
  PONTEIRO ao material oficial (ex.: "Ver Livro X, p.34"), nunca um
  lugar para colar o texto integral — a UI reforça isso com uma nota
  explícita no formulário. Se um item específico exigisse bloqueio
  jurídico, ele seria marcado individualmente — não haveria motivo para
  bloquear a feature inteira (nenhum caso real disso apareceu).
- **`content_locked` tem aplicação real, não é só rótulo de UI:**
  `PATCH /vault/:id` rejeita (409 `CONTENT_LOCKED`) alterar a
  descrição enquanto travado — protege contra edição acidental de
  conteúdo oficial/licenciado já registrado. Destravar
  (`contentLocked:false`) e editar a descrição na MESMA chamada é
  permitido (o dono está explicitamente assumindo a responsabilidade).
- **Integração com F-022 (fork):** a cópia preserva a proveniência
  (origem/publisher/edition/nota — a cópia ainda descreve o mesmo
  conteúdo de origem) mas NUNCA herda `content_locked` — o usuário
  forkou justamente para ter uma cópia editável.
- **UI:** fieldset "Proveniência" no formulário de criar/editar
  entidade (só expande os campos extras quando a origem não é "Criado
  por mim"), exibição no painel "Contexto" do detalhe da entidade.
- **Testes:** `tests/integration/vault-provenance.test.ts` (3 casos:
  default/aceite de LICENSED-OFFICIAL_REFERENCE com metadata; trava
  bloqueia descrição mas não outros campos, destravar+editar na mesma
  chamada funciona; fork preserva proveniência sem herdar trava) +
  `tests/e2e/vault-provenance.spec.ts` (1 cenário, desktop+mobile).
- Próximo: F-027 (Compendium), mesmo BATCH14.

## F-027 — Compendium — `DONE` (RPG-1.0-BATCH14)

Reavaliação confirmada: com F-020 (fichas) e F-025 (Adventures
estruturadas) prontos, uma view agregada de consulta rápida passou a
ter valor real — implementada como VIEW PURA, zero domínio/tabela nova.

- `/app/compendium` (`src/client/pages/compendium-pages.tsx`) chama o
  MESMO `GET /vault` já usado pela página Vault (`?type=CREATURE`,
  `?type=ITEM`, `?type=LORE`, em paralelo), reorganizando a
  apresentação para consulta durante a mesa — nunca duplica dado.
  Criaturas mostram o stat block inline, reaproveitando
  `creature.statBlock` que a API já devolve (nada novo no backend).
  Filtro por World e busca por nome.
- Clicar num card abre a MESMA entidade do Vault — Compendium é
  deliberadamente uma lente, nunca uma segunda cópia de NPC/Creature/
  Item/Lore (`CLAUDE.md` §17/§25).
- **Testes:** `tests/e2e/compendium.spec.ts` (1 cenário, desktop/mobile
  — cria Criatura+Item, confirma agregação, busca filtrando as duas
  seções ao mesmo tempo, clique leva à mesma entidade). Sem teste de
  integration novo — não há rota de backend nova para testar (view
  pura sobre `GET /vault`, já coberto pelos testes existentes desse
  endpoint).
- Vertical F-026/F-027 (BATCH14) completa. Próximo item da ordem de
  execução do roadmap: BATCH15 — F-028 (Files/Handouts/Assets).

## F-028 — Files/Handouts/Assets — `DONE` (RPG-1.0-BATCH15)

Upload próprio pequeno (mapa, handout digitalizado, ficha em PDF)
anexado a uma Vault Entity, Zero Cost — generaliza o padrão já provado
por LIB-005/`COVERS_KV` (`docs/library/COVER_STORAGE.md`) em vez de
criar um mecanismo novo.

- **Novo namespace `ASSETS_KV`** (Workers KV Free, criado via
  `wrangler kv namespace create`) — separado de `COVERS_KV` porque a
  política de leitura é oposta: capa é catálogo público/compartilhável,
  anexo pode ser mapa/handout privado de mesa. Bytes ficam só no KV;
  D1 nunca guarda base64/binário.
- **Migration `0036_file_assets.sql`** (aditiva): tabela `file_assets`
  (`owner_user_id`, `entity_id` opcional `REFERENCES vault_entities`,
  `content_type`, `byte_length`, `filename`, `created_at`).
- **`src/domain/content/file-asset.ts`:** sniff real de magic bytes
  (JPEG/PNG/WebP/PDF) — nunca confia no `Content-Type` declarado pelo
  cliente, mesmo princípio de LIB-005. Limite de 5MB por arquivo e
  quota de 40 arquivos por conta (controla acúmulo dentro do 1GB total
  do KV Free).
- **`src/server/routes/files.ts`:** `POST /files` (multipart,
  valida magic bytes/tamanho/quota/dono da entidade opcional antes de
  gravar no KV; limpeza best-effort do KV se o D1 falhar depois —
  nunca deixa órfão), `GET /files` (lista, filtro opcional
  `?entityId=`), `GET /files/:id/content` (bytes brutos — **owner-only,
  sempre**, diferente de `COVERS_KV` que é servido publicamente — um
  anexo pode ser conteúdo privado de mesa), `DELETE /files/:id`
  (owner-only, remove D1+KV). ID inexistente/de outra conta sempre
  404 (nunca 403), mesmo padrão anti-enumeração do resto do produto.
- **Vínculo com Vault Entity é opcional e nunca duplica** — anexar só é
  permitido a uma entidade do próprio dono (`ownedEntity`); a lista
  pode existir "solta" (sem `entityId`) ou filtrada por entidade.
- **UI:** `EntityFilesPanel` (`src/client/pages/file-asset-pages.tsx`)
  no detalhe da Vault Entity, painel complementar (mesmo princípio de
  `EntitySheetPanel`: se falhar, não bloqueia a página principal).
  Botão de excluir ganhou `aria-label` (gap de acessibilidade
  encontrado e corrigido durante a escrita do teste, não só para o
  seletor do Playwright).
- **Testes:** `tests/integration/file-assets.test.ts` (3 casos: upload
  JPEG+PDF/leitura byte-a-byte/exclusão; rejeita magic bytes inválidos
  (422)/tamanho acima do limite (413)/IDOR de leitura e exclusão (404
  em ambos); anexo restrito ao próprio dono da entidade (404 para
  entidade de outra conta) + filtro `?entityId=`) +
  `tests/e2e/file-assets.spec.ts` (1 cenário completo — envia, lista,
  exclui — desktop e mobile).
- Vertical F-028 (BATCH15) completa. Próximo item da ordem de execução
  do roadmap: BATCH16 — F-029 (VTT fundação) + F-030 (fog of war).
- **Achado de hardening, resolvido antecipado do BATCH19 (RPG-1.0-BATCH17):**
  `tests/e2e/vault-worlds-flow.spec.ts` ("getByLabel('Nome')... element
  was detached from the DOM") escalou de "ocasional, resolvido por
  rerun" (2 ocorrências em sessões anteriores) para reprodução 100%
  consistente nesta sessão — 3 rodadas de CI seguidas, a última já com
  `gh run rerun --failed` limpo antes, ainda assim falhando nos dois
  projects (chromium + mobile-chromium). Sempre passa isolado
  localmente — nunca foi uma regressão de código, é degradação de
  recurso acumulada ao longo de uma fila sequencial longa (a suíte
  cresceu de ~56 para ~89 execuções entre BATCH5 e BATCH17). Como o
  sintoma deixou de ser esporádico, a causa raiz foi corrigida agora em
  vez de adiada de novo: `.github/workflows/ci.yml` divide o E2E em 2
  jobs paralelos (`--shard=1/2`/`--shard=2/2`), cada um seu próprio
  runner/container/`wrangler dev`/arquivo D1 local (nunca compartilham
  estado — a razão original do `workers:1` em `playwright.config.ts`,
  que evita 2 workers no MESMO arquivo D1 dentro de um job, continua
  válida dentro de cada shard). Reduz a fila sequencial de cada worker
  pela metade, atacando a causa raiz diretamente em vez de mais
  reruns ou timeout maior.

## F-029 — VTT — fundação (Scene/Map/tokens) — `DONE` (RPG-1.0-BATCH16)

Primeira metade do BATCH16. Ferramenta de mesa própria da Campaign
(não do World — diferente de Cartografia/F-002), deliberadamente SEM
realtime ainda (`CLAUDE.md` §29: adiado, nunca cancelado — F-031 fica
para depois de uma auditoria de arquitetura zero-cost).

- **Migration `0037_vtt_foundation.sql`** (aditiva): `vtt_scenes`
  (`campaign_id`, `map_id` opcional -> `world_maps` de F-002, `image_url`
  própria como alternativa, `is_active`, `notes` — `CHECK` garante pelo
  menos um fundo definido) e `vtt_tokens` (`scene_id`, `entity_id`
  opcional -> `vault_entities`, `label`, `x`/`y` normalizados 0-100
  como `map_pins`, `visible_to_players`). Índice único parcial garante
  só uma cena `is_active=1` por campanha por vez.
- **Escrita sempre owner-only** — mesmo modelo de todo o resto de
  `campaigns.ts`; membros com `is_game_master=1` continuam só-leitura
  em qualquer parte do produto (não é uma restrição nova).
- **`GET /vtt/:campaignId/live`** é o único ponto do produto onde um
  jogador (`campaign_members.user_id` ativo, incluindo co-mestres) lê
  diretamente um sub-recurso de Campaign — sempre filtrado no
  servidor, nunca por CSS: só a cena com `is_active=1` e só tokens com
  `visible_to_players=1`. **Decisão de segurança deliberada:** o
  payload do jogador NUNCA inclui `entityId`/`entityName`/`entityType`
  do token — só `id`/`label`/`x`/`y`. Um token vinculado (por engano ou
  não) a uma Vault Entity PRIVATE/GM_ONLY e marcado
  `visible_to_players=1` não pode vazar o nome/tipo dessa entidade;
  o jogador só vê o rótulo livre que o mestre digitou.
- A imagem de fundo (mapa da Cartografia ou `image_url` própria) é
  resolvida no servidor tanto no detalhe do GM quanto em `/live` — o
  cliente do jogador nunca precisa chamar `/cartography` diretamente
  (o World do mapa pode não ser um World ao qual esse jogador tenha
  acesso; Campaign e World são independentes por invariante de
  produto).
- **UI:** `/app/campaigns/:id/vtt` (link "Mesa Virtual" no detalhe da
  Campaign) — cenas expansíveis com a imagem de fundo, tokens
  posicionados por `x`/`y` (verde = visível aos jogadores, cinza =
  oculto), ativar/encerrar cena, criar cena com seletor opcional de
  World→Mapa da Cartografia ou URL de imagem direta.
- **Testes:** `tests/integration/vtt.test.ts` (6 casos: CRUD de
  cena+token com fundo obrigatório validado; só uma cena ativa por vez;
  IDOR de leitura/escrita + token não pode apontar para entidade de
  outro dono; mapa de outro dono rejeitado (422) + ID inexistente
  sempre 404; visão "ao vivo" filtrando corretamente, sem vazar
  entityId/entityName mesmo do token visível, `item:null` sem cena
  ativa, 404 para não-membro; exclusão de cena com cascade de tokens) +
  `tests/e2e/vtt.spec.ts` (1 cenário completo, desktop+mobile).
- Próximo: F-030 (fog of war), mesmo BATCH16.

## F-030 — VTT — fog of war / visibilidade — `DONE` (RPG-1.0-BATCH16)

Segunda metade do BATCH16, sobre a fundação do F-029.

- **Migration `0038_vtt_fog.sql`** (aditiva): `fog_enabled`/`grid_cols`/
  `grid_rows` em `vtt_scenes` (default preserva o comportamento
  anterior: fog desligado, grade 20x20) + `vtt_fog_cells` (PK
  composta `scene_id,col,row`) — só células REVELADAS são
  armazenadas (esparso), mais barato no D1 Free do que materializar a
  grade inteira e mais simples de resetar (apagar tudo = reencobrir a
  cena inteira).
- **A barreira real é sempre no servidor, nunca uma máscara CSS** —
  igual ao princípio de GM_ONLY do resto do produto: em
  `GET /vtt/:campaignId/live`, quando `fogEnabled`, um token só chega
  ao jogador se `visible_to_players=1` **E** a célula calculada a
  partir de `x`/`y` (proporcional ao tamanho da grade da cena) estiver
  entre as reveladas. Um token totalmente fora da névoa simplesmente
  não aparece no JSON — não é ocultado visualmente no cliente.
- **`POST /fog/reveal`** é idempotente (`INSERT OR IGNORE`),
  **`POST /fog/hide`** remove a célula, **`POST /fog/reset`** apaga
  todas as células da cena (reencobrir tudo) — as três owner-only,
  mesma disciplina de `campaigns.ts`. Célula fora da grade da cena
  (`col`/`row` >= `gridCols`/`gridRows`) é rejeitada com 422.
- **UI:** checkbox "Névoa da guerra" + colunas/linhas na criação da
  cena; no detalhe expandido, uma grade clicável sobreposta à imagem
  (célula escura = oculta, transparente = revelada) e um botão
  "Reencobrir tudo".
- **Testes:** `tests/integration/vtt.test.ts` (+3 casos: revelar
  idempotente/ocultar remove/célula fora da grade 422; IDOR em
  reveal/hide/reset; visão "ao vivo" só mostra token com célula
  revelada, e reset reencobre fazendo o token sumir de novo) +
  `tests/e2e/vtt-fog.spec.ts` (1 cenário, desktop+mobile).
- Vertical F-029/F-030 (BATCH16) completa. Próximo item da ordem de
  execução do roadmap: BATCH17 — F-031 (VTT realtime, auditoria
  zero-cost obrigatória primeiro) + F-032 (iniciativa/combate).

## F-032 — Iniciativa/combate system-neutral — `DONE` (RPG-1.0-BATCH17)

Primeira metade do BATCH17, sobre a fundação do F-029 — não depende de
F-031 (realtime), então não precisou esperar a auditoria zero-cost.

- **Migration `0039_vtt_combat.sql`** (aditiva): `vtt_combatants`
  (nome/iniciativa/PV atual+máximo opcionais/notas/`visible_to_players`/
  `is_current_turn`, `token_id` opcional para reaproveitar um token já
  posicionado na cena — nunca duplica) + `vtt_scenes.combat_active`/
  `combat_round`. Ordem de turno é sempre DERIVADA
  (`initiative DESC, created_at` como desempate), nunca uma coluna de
  posição própria para manter — reordenar é só um `UPDATE initiative`.
  Índice único parcial garante só um combatente com `is_current_turn=1`
  por cena.
- **HP é deliberadamente GM-only nesta v1** — nunca enviado à visão do
  jogador (`GET /vtt/:campaignId/live`), só nome + de quem é o turno +
  round. Reduz risco de meta-gaming e mantém o v1 simples; mostrar PV
  ao jogador (ex. barra de vida) fica para uma iteração futura se
  houver demanda real — documentado, não escondido.
- **`POST /combat/start`** cria os combatentes iniciais e marca o
  primeiro (maior iniciativa) com o turno; rejeita iniciar de novo
  sobre um combate já ativo (409). **`POST /combat/next`** avança para
  o próximo da ordem, incrementando `combat_round` quando dá a volta
  completa. **`POST /combat/end`** limpa os combatentes — combate é
  ferramenta de mesa efêmera (mesmo princípio do F-001 de nunca
  versionar dado de VTT a cada movimento/turno), não fica arquivado.
  Adicionar/editar/remover combatente funciona com o combate em
  andamento; remover o combatente do turno atual sempre passa o turno
  para quem sobrou (nunca deixa a cena "sem ninguém" no turno enquanto
  houver combatentes). `token_id` de um combatente é validado contra a
  própria cena — nunca aceita token de outra cena/campanha.
- **UI:** painel "Combate" na cena expandida — formulário para iniciar
  (primeiro combatente) ou, com combate ativo, lista ordenada por
  iniciativa com badge "Turno atual", ajuste rápido de PV (+1/-1),
  remover combatente, "Próximo turno"/"Encerrar combate", e formulário
  para adicionar reforços a qualquer momento.
- **Testes:** `tests/integration/vtt.test.ts` (+5 casos: inicia
  ordenado por iniciativa desc/avança turno/round incrementa ao voltar
  ao primeiro/encerra limpando combatentes; adiciona-edita-remove
  combatente mid-combate sem nunca deixar a cena sem turno atual; visão
  "ao vivo" só mostra combatente visível, nunca HP, mesmo o de maior
  iniciativa se estiver oculto; IDOR em start/next/end/combatentes;
  token de combatente precisa pertencer à mesma cena) +
  `tests/e2e/vtt.spec.ts` (+1 cenário: iniciar/adicionar/ajustar PV/
  avançar turno/encerrar, desktop+mobile).
- Vertical F-032 (BATCH17) completa. F-031 (realtime) segue `BLOCKED`
  até a auditoria de arquitetura zero-cost — próximo passo desta sessão.

## F-031 — VTT realtime, resolvido como polling Zero Cost — `DONE` (RPG-1.0-BATCH17)

Segunda metade do BATCH17. Auditoria obrigatória feita ANTES de
qualquer código — ver `docs/architecture/VTT_REALTIME_ZERO_COST_AUDIT.md`
para o raciocínio completo.

- **Conclusão da auditoria:** WebSocket broadcast verdadeiro (GM +
  vários jogadores vendo o mesmo estado instantaneamente) exige
  **Durable Objects** — o único primitivo da Cloudflare que coordena
  várias conexões simultâneas entre isolates. Durable Objects **não
  existem no plano Free** (exigem Workers Paid) — implementar isso
  violaria a Política Zero Cost (`CLAUDE.md` §9) diretamente. Decisão:
  **polling client-side de 3s** sobre `GET /vtt/:campaignId/live` (já
  existente desde F-029) — a "degradação controlada / sincronização
  alternativa gratuita" que o próprio pedido de roadmap previu como
  resultado possível. Adequado ao caso de uso real: mesa de RPG por
  turnos não exige latência sub-segundo.
- **`VttLivePage`** (`/app/campaigns/:id/vtt/live`): poll pausa
  automaticamente quando a aba não está em foco
  (`document.visibilitychange`) — sem custo desnecessário nem
  biblioteca nova. Reaproveita a MESMA barreira de segurança de
  `/live` — nunca um canal de leitura novo (nunca HP, nunca
  entityId/entityName de token oculto, mesmo filtro de fog já
  existente).
- **Sem rota de API nova** — `/live` já cobria tudo que a visão do
  jogador precisa desde F-029/F-030/F-032; F-031 é só a peça de
  frontend com polling.
- Não existe hoje uma tela "minhas campanhas" para o jogador navegar
  sozinho até o link — o GM compartilha a URL (mostrada em `VttPage`,
  campo somente-leitura pronto para copiar) por fora do produto (ex.
  Discord). Uma lista de campanhas do jogador é escopo do F-033
  (Player View integrada), que agora está desbloqueado (todas as
  dependências — F-019/F-020/F-029 — já são `DONE`).
- **Testes:** `tests/e2e/vtt-live.spec.ts` (1 cenário: setup de
  amizade/grupo/campanha via API para focar no comportamento sob
  teste; jogador acessa o link direto e vê a cena/token; mestre inicia
  combate DEPOIS do jogador já estar na tela — o combate só aparece
  quando o próximo poll busca de novo, provando que a visão realmente
  atualiza sozinha; não-membro recebe o mesmo estado "Não encontrado"
  já usado em outras regressões de segurança do produto, anti-
  enumeração).
- Vertical F-031/F-032 (BATCH17) completa. Próximo item da ordem de
  execução do roadmap: BATCH18 — F-033 (Player View integrada) +
  F-034 (GM View integrada), ambos desbloqueados.

## F-031 — correção: realtime real via Durable Object + WebSocket — `DONE` (2026-08-20)

A premissa da entrada acima estava **errada**: verificado diretamente
contra a documentação oficial da Cloudflare em vigor nesta data —
Durable Objects (SQLite-backed) **estão disponíveis no Workers Free**,
com suporte a WebSocket sem cobrança por mensagem, e overage no Free
falha (erro 1027) em vez de gerar cobrança automática — exatamente o
padrão "falhar/degradar em vez de cobrar" exigido por `CLAUDE.md` §9.
F-031 reaberto (`DONE`→`IN_PROGRESS`→`DONE` de novo) e reimplementado
com realtime real, sem descartar o polling — ver
`docs/architecture/VTT_REALTIME_ZERO_COST_AUDIT.md` para a arquitetura
completa e a correção registrada.

- **`VttRoomDO`** (`src/server/vtt-room-do.ts`): um Durable Object por
  Campaign (`env.VTT_ROOMS.idFromName(campaignId)`). Nunca duplica
  estado de domínio — D1 continua a única fonte de verdade (scenes/
  tokens/fog/combatants continuam só nas rotas REST já existentes de
  `vtt.ts`). O Durable Object só coordena: conexões WebSocket
  (Hibernatable WebSockets API, role/userId anexados via tags
  resolvidas no handshake, nunca informados pelo client) e um contador
  de sequência (`ctx.storage`).
- **Protocolo tipado** (`src/domain/vtt-realtime.ts`, compartilhado
  client/server): `HELLO`, `STATE` (sempre o snapshot COMPLETO atual,
  nunca um diff parcial — decisão deliberada, ver justificativa no
  audit doc), `RESYNC_REQUIRED`, `PONG` do servidor; `PING`/`RESYNC` do
  cliente.
- **`GET /api/v1/vtt/:campaignId/realtime`** (`src/server/routes/vtt.ts`):
  mesma authorization de `GET /live` (dono OU membro ativo, 404 para
  não-membro, anti-enumeração) feita ANTES de encaminhar o upgrade ao
  Durable Object; papel (GM/PLAYER) resolvido no servidor. Toda rota
  mutante de VTT (scene/token/fog/combat) chama `notifyRoom(...)` depois
  de escrever em D1 com sucesso, disparando um broadcast filtrado por
  papel de cada conexão — mesma barreira de segurança de `/live`, nunca
  uma nova (nunca HP, nunca entityId/entityName de token oculto, nunca
  fog não revelado).
- **`VttLivePage`**: WebSocket preferido; ao abrir, pede o snapshot
  ativamente via `RESYNC` (além do `HELLO`/`STATE` que o servidor já
  envia sem ser solicitado — resiliente a perda da primeira mensagem);
  cai no polling de 3s (preservado, não removido) sempre que o
  WebSocket não está conectado, tentando reconectar em segundo plano.
  Nunca os dois mecanismos ativos permanentemente ao mesmo tempo. Badge
  "● Tempo real"/"○ Polling de fallback" no cabeçalho.
- **`wrangler.jsonc`**: `durable_objects.bindings` (`VTT_ROOMS` →
  `VttRoomDO`) + `migrations` (`new_sqlite_classes`) — confirmado via
  `wrangler deploy --dry-run` que o binding resolve corretamente antes
  do deploy real.
- **Achados reais de implementação** (não óbvios do desenho original,
  ver audit doc para o detalhe completo): resposta 101 tem headers
  imutáveis (corrigido pulando a escrita de security headers nela);
  reconstruir a Request de upgrade com uma URL diferente travava o
  handshake em Chromium real, mesmo funcionando com um client WebSocket
  puro e nos testes de integração (corrigido preservando a URL
  original, metadados via headers); a conexão inicial é adiada
  (`setTimeout(connect,0)`) para nunca criar um WebSocket descartável
  durante o mount→cleanup→remount do React StrictMode.
- **Testes:** `tests/integration/vtt-realtime.test.ts` — 21 testes
  cobrindo GM/Player/Outsider conectando (outsider nunca faz upgrade,
  404); GM move token visível → Player recebe; GM move token oculto →
  Player nunca recebe; GM revela fog → Player recebe; GM avança turno →
  Player recebe sem HP; disconnect/reconnect → snapshot correto sem
  replay; sequência de broadcast cresce monotonicamente; RESYNC sempre
  devolve snapshot completo; dois jogadores simultâneos recebem o mesmo
  broadcast filtrado. `tests/e2e/vtt-realtime.spec.ts` (novo) prova, com
  dois contextos de browser reais, atualização automática sem reload e
  sem esperar o poll. `tests/e2e/vtt-live.spec.ts` (existente) continua
  cobrindo o fallback de polling e a authorization.
- Vertical F-031 concluída de verdade. Próximo item da ordem de
  execução do roadmap: BATCH18 — F-033 (Player View integrada) +
  F-034 (GM View integrada), ambos desbloqueados.

**Prova de release do BATCH17** (migration 0039 + hardening de CI):
`git rev-parse HEAD` = `origin/main` = `d1c577b`; `wrangler d1
migrations list --remote` → "No migrations to apply" (0039 aplicada,
`PRAGMA foreign_key_check` limpo, 30 rpgs intactos); Worker Version ID
`1b6a53c0-bfc9-4718-854c-cba1a09f65ec`; `GET /api/v1/version` em
produção confirma `commit: "d1c577b"` — cadeia HEAD = origin/main =
build = produção fechada. CI verde (job `validate` +
`e2e` em 2 shards paralelos).

## F-033 — Player View integrada — `DONE` (BATCH18, 2026-08-20)

"Minhas Mesas": o jogador descobre e entra em campanhas de que
participa sem depender de link enviado pelo GM (seção 15 da correção
de roadmap). Reaproveita ao máximo domínios já existentes em vez de
duplicar — a única peça de dado nova é o vínculo membro→personagem.

- **Migration `0040_campaign_member_character.sql`** (aditiva):
  `campaign_members.character_entity_id` (nullable, `ON DELETE SET
  NULL`) — liga um membro a um Vault Entity `CHARACTER` do GM. GM
  atribui via o mesmo formulário inline de membros já existente
  (`CampaignMemberEditor`), validado por `validateCharacterEntity`
  (mesmo padrão de `validateAdventure` — owner+entity_type, nunca
  cross-account) e auto-vinculado à campanha via `campaign_entities`
  (mesmo mecanismo de `adventureEntityId`) — sem esse vínculo, a
  barreira de `visibility` PLAYERS/CAMPAIGN de `authorizedEntity()`
  nunca deixaria o jogador ler a própria ficha.
- **`GET /campaigns/mine`**: campanhas onde `campaign_members.user_id`
  do usuário autenticado está `active=1` — nome, RPG, mestre, próxima
  sessão, personagem. Nunca expõe `legacyMembersText`/`notes` (privados
  do GM).
- **`GET /campaigns/:id/player-home`**: agregado de UMA campanha —
  authorization idêntica a `GET /vtt/:campaignId/live` (dono OU membro
  ativo, 404 anti-enumeração para quem não é nenhum dos dois);
  devolve resumo + `characterEntityId` (se atribuído) + handouts JÁ
  REVELADOS da Adventure ligada (`adventure_handouts.revealed_at IS
  NOT NULL`, nunca um não revelado) + `hasActiveScene` (para link para
  a Mesa Virtual).
- **"Meu Personagem" reaproveita `GET /vault/:id` e `GET
  /sheets/entities/:id` sem nenhuma rota de leitura nova** — as duas já
  usavam `authorizedEntity()`, que já cobre a visibility PLAYERS/
  CAMPAIGN via `campaign_entities`; a única coisa que faltava era o
  jogador saber QUAL entidade é a dele, resolvido pelo vínculo acima.
  Ficha de personagem reaproveita `EntitySheetPanel` (já existente,
  usado em `VaultDetailPage`), com `canEdit={false}` — jogador só lê e
  baixa o PDF preenchido, nunca edita (o GM continua sendo quem
  gerencia a ficha nesta v1).
- **Mesa Virtual reaproveita `VttLivePage` (F-031) direto** — link
  condicional a `hasActiveScene`, nenhuma segunda implementação de VTT
  (seção 18 da correção).
- **Nav global**: link "Minhas Mesas" adicionado à navegação geral
  (`app-shell.tsx`), sempre visível junto com Biblioteca/Vault/Grupos/
  Campanhas/Mundos — nunca escondido (`CLAUDE.md` §3).
- **Fora de escopo desta passada (registrado, não escondido):**
  notificações contextualizadas na mesa (seção 19 da correção) — não
  implementadas ainda, ficam como débito para BATCH19. Edição da
  própria ficha pelo jogador também não incluída (GM continua sendo
  quem gerencia).
- **Testes:** `tests/integration/player-view.test.ts` (5 testes:
  `/campaigns/mine` só lista membro ativo, nunca de outro usuário nem
  membro desativado; IDOR/anti-enumeração em `/player-home`; vínculo de
  personagem exige owner+CHARACTER, e leitura via `/vault/:id` só
  funciona se a `visibility` permitir — PRIVATE nunca vaza mesmo com o
  vínculo salvo; handouts só os revelados, nunca os ocultos; VTT
  reflete `hasActiveScene` corretamente). `tests/e2e/player-view.spec.ts`
  (novo, chromium + mobile-chromium): jogador navega pelo link global
  até a campanha sem receber nenhuma URL do GM, vê o personagem
  atribuído e o handout revelado, confirma ausência de cena ativa;
  outsider recebe "Não encontrado".
- Vertical F-033 concluída. Próximo item da ordem de execução do
  roadmap: F-034 (GM View integrada).
- **Nota de release:** `caa40f3` corrige um CI real encontrado no
  primeiro push do F-033 — `tests/e2e/player-view.spec.ts` clicava em
  "Minhas Mesas" sem abrir o menu mobile primeiro (link fora do
  viewport em `mobile-chromium`), corrigido com o mesmo padrão
  `openNav`/`isMobileViewport` já usado no resto da suíte. Migration
  0040 aplicada e deploy confirmado em produção
  (`GET /api/v1/version` → `commit: "caa40f3"`).

## F-034 — GM View integrada — `DONE` (BATCH18)

Fecha o BATCH18. `VttPage` já unia scene/mapa/tokens/fog/combate
(F-029/F-030/F-032); faltava ligar a preparação da Adventure (F-025) e
os anexos/handouts de arquivo (F-028) na MESMA tela, para o mestre não
precisar sair do VTT durante a mesa.

- **View pura, nenhuma rota nova** — a seção "Preparação da Adventure"
  reaproveita `GET /campaigns/:id` (para achar `adventureEntityId`) e
  `GET /adventures/:id` (F-025, já existente) só para montar um resumo
  (contagem de cenas/concluídas, handouts revelados/total). Sem
  Adventure vinculada, mostra um aviso com link para vincular uma em
  "Editar campanha" — nunca quebra.
- **`EntityFilesPanel` (F-028) embutido diretamente** na tela do VTT,
  apontando para a Adventure vinculada — o mestre anexa mapas/handouts
  digitalizados sem sair da tela onde está preparando a cena. Mesmo
  componente já usado no detalhe da Vault Entity, nenhuma duplicação.
- **"Abrir preparação completa"** continua linkando para
  `AdventurePrepPage` (`/app/vault/:id/adventure`) — o resumo nunca
  tenta reimplementar o editor completo de cenas/encontros/handouts,
  só reduz a navegação para o caso comum (conferir o que já foi
  preparado, anexar um arquivo).
- Corrigido de passagem: um comentário desatualizado em `vtt-pages.tsx`
  ainda dizia que "não existe hoje uma tela minhas campanhas" — F-033
  já resolveu isso nesta mesma sessão; comentário atualizado para
  refletir o estado real (WebSocket real preferido, link ao vivo como
  fallback/compartilhamento).
- **Testes:** `tests/e2e/vtt-gm-view.spec.ts` (novo, desktop+mobile) —
  cria Adventure com cena+handout revelado, campanha com essa Adventure
  como principal, confirma o resumo exato na tela do VTT, anexa um
  arquivo inline (prova que F-028 funciona embutido, sem navegação) e
  confirma que "Abrir preparação completa" leva ao editor real. Sem
  integration test novo — nenhuma rota de backend nova para testar
  (mesmo raciocínio já usado em F-027 Compendium).
- Vertical F-034 concluída — **BATCH18 (F-033+F-034) fechado**.
  Próximo item da ordem de execução do roadmap: BATCH19 — hardening
  final + F-015 revalidado cobrindo todos os domínios novos (Social,
  Sheets, Vault avançado, Adventures, Files, VTT).

## BATCH19 — Hardening final + F-015 revalidado — `DONE`

Último item do roadmap planejado. Duas frentes: (1) hardening real de
CI, (2) fechar a lacuna real encontrada na auditoria: o EXPORT completo
(F-015) não acompanhou nenhum dos domínios criados desde o BATCH6
original — Social, Sheets, `world_entity_links`, Adventures
estruturadas, Files/Handouts, VTT ficaram de fora do backup por 13
batches seguidos, um risco real de perda de dado silenciosa (não
teórico — confirmado lendo `transfer.ts` linha a linha antes de
escrever qualquer código).

**Hardening de CI:**
- `actions/upload-artifact` no job `e2e`, só em `failure()`, retenção
  de 7 dias — `playwright.config.ts` já capturava trace
  (`retain-on-failure`) e screenshot (`only-on-failure`), mas nada
  sobrevivia ao runner efêmero; toda investigação de flake até agora
  dependeu só de log de texto. Sem impacto em produção (mudança só de
  CI).
- **Achado real durante o próprio BATCH19, causa raiz encontrada e
  corrigida:** o push do F-034 (antes deste commit) expôs
  `tests/e2e/vault-worlds-flow.spec.ts` falhando de forma consistente,
  sempre no mesmo ponto (`getByLabel('Nome')` nunca resolve por até
  270s). Primeira tentativa (`--disable-dev-shm-usage`) não resolveu —
  o flake se repetiu de forma idêntica no push seguinte. Com o CI já
  subindo artifact (item acima), baixei o trace/screenshot real da
  segunda falha: o screenshot mostrava a tela de OUTRO teste
  (`player-view.spec.ts` — "Mesa de Valdren"/"Elyndra Lâmina de
  Prata"/"Fora PV.../Não encontrado"), e o `trace.zip` extraído revelou
  só 2 frames de screencast em 270 segundos inteiros (um no início, um
  no fim) — o processo de renderer do Chromium ficou completamente
  congelado, não um elemento lento. **Causa raiz real:**
  `player-view.spec.ts`, `vtt-live.spec.ts` e `vtt-realtime.spec.ts`
  criam contexts extras via `browser.newContext()` para os cenários
  multi-conta (jogador/outsider) e nunca os fechavam — só o fixture
  `page` padrão do Playwright tem teardown automático; um context
  criado manualmente é responsabilidade do teste. Com `workers:1`
  (mesmo processo/browser para a fila inteira), cada um desses 3
  testes deixava contexts abertos (alguns com WebSocket ainda
  conectado ao Durable Object) acumulando memória/conexões até o
  browser travar bem mais adiante na fila — sempre o mesmo teste,
  sempre a mesma trava completa, batendo exatamente com o padrão
  observado ao longo de toda a sessão. Fix: `await xContext.close()`
  nos 3 arquivos, mesmo padrão já usado corretamente em
  `social-friends.spec.ts`/`social-library-invites.spec.ts` (nunca
  vazavam). **CI verde de primeira depois do fix, sem rerun** — suíte
  local completa de 49 testes (chromium) também confirmada limpa,
  incluindo `vault-worlds-flow.spec.ts` rodando por último na fila.

**F-015 revalidado — export v9:**
- `schemaVersion` 8→9. Todas as tabelas dos domínios criados desde o
  BATCH6 original entraram no `GET /export`: `friend_requests`/
  `friendships`/`user_blocks`/`social_invites`/`notifications`
  (F-016/018/019 — escopadas pelos DOIS lados da relação, já que
  representam estado da CONTA, não só do que ela iniciou),
  `sheet_templates`/`character_sheets` (F-020/021), `world_entity_links`
  (F-022 — só existe quando entidade e World são do mesmo dono, ver
  `POST /vault/:id/links`, então escopar por qualquer um dos dois lados
  dá o mesmo resultado), `adventure_scenes`/`adventure_encounters`/
  `adventure_scene_entities`/`adventure_handouts` (F-025),
  `file_assets` (F-028 — só metadata; bytes vivem no `ASSETS_KV`, fora
  do escopo de um backup JSON, mesmo princípio já aplicado a
  coverUrl/mídia externa), `vtt_scenes`/`vtt_tokens`/`vtt_fog_cells`/
  `vtt_combatants` (F-029/030/032).
- **Restore v1 estendido com `world_entity_links`** — a extensão mais
  simples possível dentro da fronteira já estabelecida: liga dois IDs
  já restaurados na MESMA operação (World + entidade), sem domínio
  próprio nem parsing adicional. Vínculo cujo World ou entidade
  original não pôde ser restaurado vira aviso, nunca trava o restante
  do restore (mesmo padrão de toda referência cruzada já existente).
- **Decisão explícita de escopo (não omissão):** Social, Sheets,
  Adventures estruturadas, Files/Handouts e VTT continuam export-only
  nesta v1 — mesma fronteira documentada desde o BATCH6 original para
  Groups/Campaigns/Library/Wiki/Relations/Cartografia/External
  Resources/Revision History. Restaurar Social exigiria decidir o que
  fazer com relações apontando para OUTRA conta real (risco semântico
  real: reintroduzir uma amizade que a outra pessoa já desfez/bloqueou
  nesse meio-tempo); restaurar VTT/Adventures completos exigiria
  Campaigns/Adventures no mesmo escopo de restore primeiro (VTT depende
  de `campaign_id`, que nunca foi restaurável). Nenhuma dessas é uma
  lacuna escondida — todas seguem 100% cobertas pelo EXPORT, só sem
  automação de restore ainda.
- **Testes:** `tests/integration/backup-restore.test.ts` (+2 casos:
  export v9 cria uma linha em CADA tabela nova — Social/Sheets/LINK/
  Adventures completas/Files/VTT completo incluindo fog+combate — e
  confirma que todas aparecem no backup; round-trip de
  `world_entity_links` restaura o vínculo com os IDs NOVOS de World e
  entidade, e um vínculo injetado sem os dois lados no backup vira
  aviso sem travar o restore) + 3 asserções de `schemaVersion` 8→9
  atualizadas em `auth-and-isolation.test.ts`/`library-domain.test.ts`.
  Client (`settings-pages.tsx`) ganhou o label "Vínculos entre Worlds"
  no resumo do preview/restore (`summaryLabels`, já genérico — só a
  entrada nova).
- **Docs:** `docs/library/LIBRARY_IMPORT_EXPORT.md` e
  `docs/product/FULL_ROADMAP.md` atualizados com a cobertura v9 e a
  fronteira de escopo do restore.
- typecheck/lint/build limpos; 195 unit + 224 integration (30
  arquivos) sem flake.

**`RPG MANAGER — PLANNED_ROADMAP_COMPLETE` alcançado** — todo item de
F-022 a F-034 `DONE`, F-015 revalidado, CI verde (flake recorrente
corrigido na raiz, não mascarado), deploy real confirmado. Ver
`docs/product/RPG_MANAGER_COMPLETE_STATUS.md` para o relatório final
da meta original.

> **Nota (BATCH20-22):** declaração rejeitada pelo responsável do produto
> logo em seguida — F-015 reclassificado de `DONE` para `IN_PROGRESS`
> (restore automatizado cobria só 6 de ~30 domínios persistentes reais).
> Ver `docs/product/PROJECT_COMPLETION_AUDIT.md` para o estado atual.

## Polimento pós-roadmap — relato real do usuário (2026-08-20)

Dois achados reportados diretamente pelo usuário em produção, corrigidos
na sequência (fora do escopo original F-022..F-034, mas genuínos):

- **Botão de notificações desalinhado (2ª ocorrência):** vivia dentro
  de `.sidebar-toolbar`, ao lado do botão de busca (Comandos) —
  cortado/sobreposto pela scrollbar da sidebar em telas mais estreitas
  (achado real via screenshot do usuário; a correção anterior desta
  sessão só tinha ajustado a altura, não a posição). Movido para a
  linha do brand (topo da sidebar, `margin-left:auto` dentro do flex),
  sempre visível, nunca disputando espaço com outro controle.
- **"Ainda não conseguimos criar OneShot":** o mecanismo sempre existiu
  (F-024, BATCH13 — Formato dentro do mesmo formulário de campanha),
  confirmado funcionando via reprodução real em Playwright local, mas
  sem NENHUM atalho visível na tela de Campanhas ninguém descobria a
  opção — um gap real de descoberta, não um bug funcional. Adiciona
  "Nova mesa única" ao lado de "Nova campanha" em `CampaignsPage`,
  pré-selecionando o Formato via query param (`?sessionMode=ONE_SHOT`),
  mesmo padrão já usado por `worldId`/`playGroupId`. Nenhuma rota nova,
  nenhum domínio novo.
- Teste: `tests/e2e/campaign-one-shot-shortcut.spec.ts` (novo,
  desktop+mobile) — clica no atalho, confirma o Formato pré-selecionado,
  cria a mesa e confirma o badge "One-Shot" na listagem.
- typecheck/lint limpos; deploy confirmado em produção
  (`GET /api/v1/version` → `commit: "366dfc6"`).

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
| F-015 | Backup/Restore completo (export `schemaVersion:9` + restore com preview/confirm) | P2 | `IN_PROGRESS` (RPG-1.0-BATCH6, revalidado BATCH19, expandido BATCH20) — export cobre 100% dos domínios; restore automatizado cobre Worlds/Creature Stat Templates/Vault/Journal/world_entity_links/Library/Groups/GroupMembers/Campaigns/CampaignMembers/Sessions/Attendance; Wiki/Relations/Cartografia/External Resources/Revision History/Social/Sheets/Adventures/Files/VTT continuam exportados mas sem restore automatizado ainda (documentado, não silenciado) |

**Nota (2026-08-19, correção de direção do responsável do produto):** a
linha "Explicitamente fora de escopo: VTT, Sheets, Social/Amizades" que
existia aqui é da era 1.0 e está **desatualizada** — o congelamento
pós-1.0 foi revogado. Todos os três já têm itens `DONE` (F-016..F-029).
`docs/product/FULL_ROADMAP.md` é a fonte de verdade viva para F-016 em
diante (esta tabela para de ser atualizada em F-015); não repetir os
itens novos aqui para evitar duas fontes divergentes.

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

## BATCH20-23 — F-015 expandido, F-035, F-036, hardening final — `DONE`

Registro consolidado (este arquivo parou de ser atualizado entre
BATCH19 e o commit `7da6d37` — código/testes/`FULL_ROADMAP.md` estavam
corretos e à frente deste log; corrigido aqui na auditoria final
independente de 2026-08-21). Detalhe completo de cada item nas linhas
de `FULL_ROADMAP.md` (F-015/F-034/F-035/F-036) e em
`docs/product/PROJECT_COMPLETION_AUDIT.md`.

- **F-015 (BATCH20a-g)** — restore automatizado (`POST
  /import/backup/preview`+`/confirm`) expandido de 6 domínios (Worlds/
  Creature Stat Templates/Vault/Journal/world_entity_links) para
  cobrir também Library, Groups/GroupMembers, Campaigns/
  CampaignMembers/Sessions/Attendance, Sheet Templates/Character
  Sheets, Wiki (pastas/tags/aliases), Relations, Cartografia,
  External Resources, Timeline, Adventures estruturadas (scenes/
  encounters/scene entities/handouts), VTT (scenes/tokens/fog/
  combatants — estado ao vivo sempre restaurado inativo), Social
  (friendships/blocks/invites — só quando quem restaura é uma das
  partes reais) e Social Library Interest (achado real: nunca esteve
  no export antes desta rodada). `schemaVersion` 8→9.
- **F-015 Seção 8 (BATCH21)** — backup real de bytes de assets, não só
  metadata: `GET/POST /api/v1/files/backup`, bundle separado do JSON
  principal (bytes não cabem no armazenamento de job em D1), testado
  com o asset original deletado antes do restore (prova de
  autocontenção genuína) e bytes comparados byte a byte.
- **F-015 Seção 24 (BATCH22)** — fechamento semântico formal: Revision
  History (`entity_revisions`) e Notifications, os dois domínios que
  ficavam com decisão de restore implícita, ganharam categoria
  explícita no preview (`category:'ARCHIVAL_HISTORY'` /
  `'EPHEMERAL_USER_ACTIVITY'`) — nunca reinjetados como histórico
  operacional (produziria uma timeline falsa) nem como notificação
  quebrada (payload referenciaria IDs que não existem mais).
- **F-035 — Handout reveal via realtime (BATCH22-23)**: `PATCH/POST/
  DELETE /adventures/:adventureId/handouts` notifica, pelo MESMO
  Durable Object do realtime de VTT (F-031), toda Campaign que usa a
  Adventure — eventos `HANDOUT_REVEALED`/`HANDOUT_HIDDEN`, nunca o
  conteúdo do handout embutido no evento. Hook compartilhado novo
  (`src/client/api/campaign-realtime.ts`, `useCampaignRealtime`) usado
  por `VttLivePage`, `PlayerCampaignHomePage` e `VttPage` (console do
  GM) — extrai connect/reconnect/backoff/ping/RESYNC/sequence-guard/
  cleanup que antes só existia duplicado dentro de `VttLivePage`.
  Achado real corrigido: `VttPage` não tinha nenhuma assinatura de
  realtime (premissa de único GM que ficou falsa com Multi-GM) —
  agora qualquer `STATE` recarrega cenas/combate na tela do mestre
  também.
- **F-036 — Multi-GM (BATCH23)**: `campaign_co_gms` (migration 0041,
  aditiva — `campaigns.user_id` nunca muda, Owner continua único dono
  real). Autorização centralizada em `src/server/content/
  authorization.ts`: `authorizeCampaignManagement` (Owner∨Co-GM, usado
  por VTT/handout-reveal/membros/sessões), `authorizeCampaignOwnership`
  (Owner-only, excluir/editar configurações/vincular entidade de
  referência/revogar Co-GM), `authorizeCampaignParticipation` (resolve
  papel GM/PLAYER do realtime — Co-GM sempre `'GM'`). Convite
  reaproveita o fluxo social já existente (papel "Narrador" em
  `social_invites`). `GET /campaigns` passou a incluir campanhas
  co-administradas, não só próprias. 6 testes de integração cobrindo a
  matriz completa (Owner/Co-GM/Player/Outsider em VTT+handouts,
  bloqueio de ação sensível, IDOR cross-campaign, descoberta na
  listagem, realtime com 2 GMs simultâneos no mesmo Durable Object).
- **Hardening final (BATCH23)**: load test formal de VTT
  (`tests/integration/vtt-load-test.test.ts`, 3 cenários reais contra
  o Worker local) + rate limiting (`VTT_ACTION_RATE_LIMITER` 90/60s,
  `VTT_CONNECT_RATE_LIMITER` 20/60s, máximo 20 conexões WebSocket
  simultâneas por sala) + crawler não-destrutivo de botões/rotas
  mortas (`tests/e2e/dead-controls-crawler.spec.ts`) + suíte de
  responsivo/temas (`tests/e2e/responsive-themes.spec.ts`, 5
  breakpoints × 9 rotas, achado real corrigido: overflow horizontal em
  390px na Mesa do Mestre) + acessibilidade via axe-core
  (`tests/e2e/accessibility.spec.ts`, achado real corrigido: input
  sem label no link ao vivo da Mesa Virtual) + reauditoria de
  segurança completa (`docs/audit/SECURITY_REAUDIT_BATCH23.md`) +
  varredura de TODO/FIXME/parciais escondidos (zero achados reais) +
  fechamento real do flake de `vault-worlds-flow.spec.ts` (causa raiz:
  contexts de browser extras nunca fechados vazando pelo resto da
  fila do worker — corrigido com `close()`; auditoria final de
  2026-08-21 endureceu ainda mais trocando por `try/finally` em todos
  os 9 arquivos que usam `browser.newContext()`, já que `close()`
  solto no fim do corpo do teste ainda vazava se um `expect()` no meio
  lançasse).
- **Auditoria final independente cross-machine (2026-08-21, PC de
  casa)**: verificação factual de todas as declarações acima contra
  código/migrations/testes reais (não só os commits/documentos) —
  nenhuma contradição encontrada. Único gap real identificado e
  corrigido nesta rodada: o `try/finally` de context cleanup acima.
  Ver relatório final desta auditoria para a prova de release completa.
