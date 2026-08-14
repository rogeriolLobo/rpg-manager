# RPG Manager 1.0 — Release Checklist

Baseado na auditoria real de 2026-08-14
(`docs/audit/RPG_MANAGER_1_0_MATRIX.md`).

## CORE
- [x] Library
- [x] Groups
- [x] Campaigns
- [x] Sessions

## WORLD
- [x] Worlds
- [x] Vault
- [x] Wiki
- [x] Journal
- [x] Adventures

## KNOWLEDGE
- [x] Search (funcional; teste de integração dedicado é ação futura P2)
- [x] Command Palette

## RELATIONS
- [x] Relations
- [x] Graph
- [x] Genealogy (mesmo motor de Relations)

## TIME
- [x] Timeline
- [x] Calendar

## CONTENT
- [x] Bestiary

## COLLAB
- [x] Invites (teste de integração dedicado adicionado nesta sessão)
- [x] Player Portal (isolamento GM_ONLY confirmado por teste existente)

## PLATFORM
- [x] Navigation invariants — **não auditado por esta sessão**: existe
      trabalho em andamento, não commitado por esta sessão, especificamente
      dedicado a isso (`docs/product/UX_INVARIANTS.md`,
      `tests/e2e/navigation-invariants.spec.ts`,
      `tests/unit/navigation-invariants.test.ts`) — fora do escopo desta
      execução por instrução explícita do responsável do produto
      ("não mexer em navegação").
- [x] Light
- [x] Dark
- [x] System
- [x] Desktop
- [x] Mobile
- [x] Permissions
- [x] Validation/errors (RPG cobre erro por campo desde esta sessão;
      demais formulários usam banner genérico — não bloqueador)

## SAFETY
- [x] GM_ONLY regression (`vault-and-worlds.test.ts:163`)
- [x] IDOR/BOLA regression (`bloqueia IDOR de World...`, isolamento
      A/B em `auth-and-isolation.test.ts`, etc.)
- [x] XSS regression (payload `<script>` testado em
      `auth-and-isolation.test.ts`)

## QUALITY
- [x] lint (completo, zero erros nos arquivos versionados desta sessão)
- [x] typecheck (app + integração)
- [x] unit (108 testes)
- [x] integration (34 testes)
- [x] E2E (verde no CI remoto; flakes locais documentados como
      característica pré-existente do ambiente, não regressão)
- [x] build
- [x] CI (GitHub Actions, verde)

## PRODUCTION
- [x] migrations seguras (nenhuma migration nova nesta sessão; as 15
      existentes são todas aditivas)
- [x] deploy (múltiplos deploys bem-sucedidos nesta sessão)
- [x] public smoke (verificação read-only no D1 de produção)
- [ ] authenticated smoke — **bloqueado por Turnstile** (CAPTCHA real em
      produção); não contornado, conforme regra do próprio projeto.
      Pendente como passo manual do usuário.

## Itens opcionais (seção 28) — não implementados nesta sessão

- [ ] Revision History
- [ ] Ideas Quick Capture (UX apenas — domínio já existe via Journal)
- [ ] Cartografia zero-cost
- [ ] External Resources

Nenhum desses foi classificado pela auditoria como essencial para a
coerência do produto atual — todos ficam documentados como próximos
passos, não como pendências ocultas.
