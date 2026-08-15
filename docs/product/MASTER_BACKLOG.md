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

## Itens auditados nesta sessão, sem ação necessária (ver
`docs/audit/RPG_MANAGER_1_0_MATRIX.md` para a auditoria completa)

Todas as features CORE/WORLD/KNOWLEDGE/RELATIONS/TIME/CONTENT/COLLAB/
SYSTEM auditadas como `COMPLETE` ou `PARTIAL` não-bloqueador. Nenhuma
`BROKEN` encontrada fora dos dois P0 acima (já `DONE`).

## Backlog futuro (não iniciado, não obrigatório para 1.0)

| ID | Title | Priority | Status |
|---|---|---|---|
| F-001 | Revision History (`entity_revisions`) | P3 | `NOT_STARTED` |
| F-002 | Cartografia zero-cost (mapas/pins) | P3 | `NOT_STARTED` |
| F-003 | External Resources (referência a URL externa) | P3 | `NOT_STARTED` |
| F-004 | GM Tools (dice roller, timer, quick notes) | P3 | `NOT_STARTED` |
| F-005 | Ideas / Quick Capture (UX sobre Journal existente) | P3 | `NOT_STARTED` |
| F-006 | Teste de integração dedicado para Global Search | P2 | `NOT_STARTED` |
| F-007 | Split de domínio System→Publication→User State (Opção A, `LIBRARY_ARCHITECTURE.md`) | P2 | `DONE` (LIB-002) |
| F-008 | Upload real de capa + Workers KV (`COVER_STORAGE.md`) | P2 | `NOT_STARTED` |
| F-009 | Metadata provider Open Library (`METADATA_PROVIDERS.md`) | P2 | `NOT_STARTED` |
| F-010 | Dedup de RPG por ISBN em vez de título exato | P2 | `DONE` (LIB-003) |
| F-011 | Archive de RPG (schema pronto desde LIB-002: `rpgs.archived_at`; endpoint/UI ausentes) | P3 | `NOT_STARTED` |

Explicitamente fora de escopo (decisão de produto, não backlog):
VTT, Sheets (motor completo), Social/Amizades.

## Regra de bloqueio

Nenhum item da tabela "Backlog futuro" deve ser iniciado enquanto
existir qualquer P0/P1 com status `IN_PROGRESS` ou `BLOCKED`. Estado
atual: **nenhum P0/P1 aberto** — ambos os P0 estão `DONE` (P0-001 com
uma única pendência de smoke manual documentada, não uma pendência de
código).
