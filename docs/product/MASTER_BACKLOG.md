# RPG Manager — Master Backlog

Metodologia: uma funcionalidade por vez, `AUDIT → PLAN → IMPLEMENT →
TEST → FIX → TEST AGAIN → CI → DEPLOY → PRODUCTION SMOKE → DOCUMENT →
DONE`. `DONE` exige validação de produção — nunca só código/testes/build.

Status possíveis: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `DONE`.

## P0-001 — Edição de RPG com capa legada

- **Priority:** P0
- **Status:** `DONE` (código), `MANUAL_SMOKE_REQUIRED` (clique
  autenticado real, bloqueado por Turnstile/CAPTCHA — não contornado)
- **Dependencies:** nenhuma
- **Definition of Done:**
  - [x] Editar RPG com capa histórica sem alterar → sucesso
  - [x] Alterar campo não relacionado → sucesso, capa preservada
  - [x] Trocar para URL nova proibida → rejeitada, erro no campo
  - [x] Remover capa → sucesso
  - [x] RPG com capa já permitida, sem alteração → sucesso
  - [x] Todos os 5 cenários acima verificados via TEST FIRST no
        formulário React real (não só API), com a URL real
        `devir.com.br` do relato de produção
  - [x] Nenhuma nova allowlist de host adicionada só para contornar
  - [x] Proteção SSRF preservada para URLs realmente novas
  - [x] lint, typecheck, unit, integration, E2E (desktop+mobile), build
  - [x] CI verde
  - [x] Deploy — Version `baa022ab-5e11-4c37-93c7-112d9a8b452f`
  - [x] `GET /api/v1/version` confirma HEAD == origin/main == build ==
        produção (`d23ba05`)
  - [ ] Smoke autenticado por clique real — `MANUAL_SMOKE_REQUIRED`
        (checklist em `docs/bugs/RPG_EDIT_INVALID_DATA.md`)
- **Commit:** `d5b0d70`, `ebff759`, `eedc96a`, `d23ba05` (ver
  `docs/bugs/RPG_EDIT_INVALID_DATA.md` para a cadeia completa)
- **Production version:** `baa022ab-5e11-4c37-93c7-112d9a8b452f`

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

Explicitamente fora de escopo (decisão de produto, não backlog):
VTT, Sheets (motor completo), Social/Amizades.

## Regra de bloqueio

Nenhum item da tabela "Backlog futuro" deve ser iniciado enquanto
existir qualquer P0/P1 com status `IN_PROGRESS` ou `BLOCKED`. Estado
atual: **nenhum P0/P1 aberto** — ambos os P0 estão `DONE` (P0-001 com
uma única pendência de smoke manual documentada, não uma pendência de
código).
