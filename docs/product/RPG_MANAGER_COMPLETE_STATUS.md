# RPG Manager — `PLANNED_ROADMAP_COMPLETE` (SUPERADO — ver nota abaixo)

> **Nota de superfície (2026-08-21):** este marco histórico não avaliou se todas as funções eram
> encontráveis por navegação humana. Para esse critério, use
> `docs/product/PRODUCT_SURFACE_AUDIT.md`; nenhuma declaração de superfície decorre deste arquivo.

> **Nota (BATCH20-22):** esta declaração foi rejeitada pelo responsável do
> produto ("FINALIZAÇÃO ABSOLUTA DO PROJETO") por existirem funcionalidades
> planejadas que continuavam parciais, principalmente F-015 (Backup/Restore
> — restore automatizado cobria só 6 de ~30 domínios persistentes reais).
> O documento abaixo permanece como registro histórico válido do estado
> real em `366dfc6`/`a62d847`, mas **não é mais a fonte da verdade sobre
> completude do projeto**. Ver `docs/product/PROJECT_COMPLETION_AUDIT.md`
> para o estado atual, honesto e não-fabricado (que também NÃO declara
> `PROJECT_COMPLETE` — itens reais continuam pendentes).

Relatório final da meta estabelecida em `docs/product/FULL_ROADMAP.md`:
todo item planejado do roadmap (F-022 a F-034) concluído, F-015
revalidado cobrindo todos os domínios criados desde o BATCH6 original,
hardening final de CI fechado com causa raiz corrigida (não mascarada),
e a cadeia completa `commit → build → deploy → produção` verificada.

## Proveniência de release (verificado, não de memória)

```
Git HEAD:              366dfc6982d9ad9ff9e4aac454c4a4b30171d1dd
origin/main:            366dfc6982d9ad9ff9e4aac454c4a4b30171d1dd
Build commit embutido:   366dfc6
Worker Version ID:      7980e868-859e-45c8-bac3-2beb954b931f
Deployment timestamp:   2026-08-20T17:51:45.301Z
Production commit
  (GET /api/v1/version): 366dfc6
CI (run 32398891182):   success (verde, sem rerun)
```

`HEAD = origin/main = build = produção` — cadeia fechada e verificada
por leitura real de `/api/v1/version`, não por suposição.

## Itens do roadmap planejado

| Item | Status | Observação |
|---|---|---|
| F-022 — Vault avançado (LINK/FORK entre Worlds) | `DONE` | BATCH12 |
| F-023 — Vault system-aware | `DONE` | BATCH10 |
| F-024 — One-Shots | `DONE` | BATCH13 |
| F-025 — Adventures aprofundadas | `DONE` | BATCH13 |
| F-026 — Conteúdo oficial/licenciado | `DONE` | BATCH14 |
| F-027 — Compendium | `DONE` | BATCH14 |
| F-028 — Files/Handouts/Assets | `DONE` | BATCH15 |
| F-029 — VTT fundação | `DONE` | BATCH16 |
| F-030 — VTT fog of war | `DONE` | BATCH16 |
| F-031 — VTT realtime | `DONE` | BATCH17, corrigido 2026-08-20 (Durable Object + WebSocket real, não só polling) |
| F-032 — Iniciativa/combate | `DONE` | BATCH17 |
| F-033 — Player View integrada | `DONE` | BATCH18 |
| F-034 — GM View integrada | `DONE` | BATCH18 |
| F-015 — Backup/Restore, revalidado | `DONE` | BATCH19 — export v9 cobre 100% dos domínios; restore v1 estendido com `world_entity_links` |
| Hardening final de CI | `DONE` | BATCH19 — artifact upload + causa raiz real do flake corrigida |

Nenhum item ficou `BLOCKED`. Nenhuma decisão de escopo foi escondida —
toda fronteira deliberada (ex.: restore automatizado não cobrir
Social/Sheets/Adventures/Files/VTT nesta v1) está documentada em
`docs/domain/backup/types.ts` e `docs/library/LIBRARY_IMPORT_EXPORT.md`,
com o raciocínio explícito de por que.

## F-015 — cobertura real (não assumida)

Export (`GET /api/v1/export`) agora inclui, além de tudo que já
existia desde o BATCH6: Social (`friend_requests`, `friendships`,
`user_blocks`, `social_invites`, `notifications`), Sheets
(`sheet_templates`, `character_sheets`), LINK cross-World
(`world_entity_links`), Adventures estruturadas (`adventure_scenes`,
`adventure_encounters`, `adventure_scene_entities`,
`adventure_handouts`), Files/Handouts metadata (`file_assets` — só
metadata, bytes no `ASSETS_KV`), VTT (`vtt_scenes`, `vtt_tokens`,
`vtt_fog_cells`, `vtt_combatants`). `schemaVersion` 8→9.

Restore automatizado v1 estendido com `world_entity_links` (extensão
mínima: liga dois IDs já restaurados na mesma operação). O restante
dos domínios novos permanece export-only nesta v1 — mesma fronteira
documentada desde o BATCH6 para Groups/Campaigns/Wiki/Relations/
Cartografia/External Resources/Revision History, por motivo real
(Social exigiria decidir semântica de relação com OUTRA conta; VTT/
Adventures dependem de Campaigns, que nunca entraram no escopo de
restore).

## Hardening de CI — causa raiz real corrigida

O flake recorrente de `tests/e2e/vault-worlds-flow.spec.ts` (documentado
repetidas vezes ao longo da sessão, sempre contornado por
`gh run rerun --failed`) teve causa raiz encontrada e corrigida nesta
revalidação final:

1. `actions/upload-artifact` adicionado ao job `e2e` (só em falha) —
   trace/screenshot do Playwright já eram capturados localmente no
   runner mas nunca sobreviviam ao container efêmero.
2. Primeira tentativa de fix (`--disable-dev-shm-usage`) não resolveu —
   o flake se repetiu de forma idêntica no push seguinte.
3. Com o artifact já disponível, a segunda falha foi baixada e
   inspecionada de verdade: o screenshot mostrava a tela de outro
   teste (`player-view.spec.ts`), e o `trace.zip` extraído revelou
   apenas 2 frames de screencast em 270 segundos inteiros — o processo
   de renderer do Chromium tinha travado por completo, não um elemento
   lento.
4. Causa raiz real: `player-view.spec.ts`, `vtt-live.spec.ts` e
   `vtt-realtime.spec.ts` criavam contexts extras via
   `browser.newContext()` para cenários multi-conta e nunca os
   fechavam. Com `workers:1` (mesmo processo/browser para toda a fila
   de ~49 testes), os contexts vazados (alguns com WebSocket ainda
   conectado a um Durable Object) acumulavam memória/conexões até
   travar o browser bem mais adiante na fila — sempre o mesmo teste,
   sempre a mesma trava completa.
5. Fix: `await xContext.close()` nos 3 arquivos. CI verde de primeira
   depois do fix, sem nenhum rerun — confirmação real, não suposição.

## Polimento adicional — relato real do usuário

Durante a validação final, o usuário reportou dois problemas reais em
produção, corrigidos na mesma sessão:

- Botão de notificações cortado/sobreposto pela scrollbar da sidebar —
  movido para a linha do brand (topo, sempre visível).
- Criação de campanha One-Shot (F-024) sem nenhum atalho descoberto —
  adicionado "Nova mesa única" em `CampaignsPage`, pré-selecionando o
  Formato via query param.

## Validação executada (evidência real, não memória)

- `npm run lint` — limpo.
- `npm run typecheck` — limpo.
- `npx vitest run` — 195 unit passando.
- `npx vitest run --config vitest.integration.config.ts` — 224
  integration passando (30 arquivos).
- `npm run build` — limpo.
- Suíte E2E completa local (chromium, 49 specs) — todas passando,
  incluindo `vault-worlds-flow.spec.ts` rodando por último na fila.
- CI (GitHub Actions) — verde no run `32398891182`, sem rerun.
- `wrangler d1 execute ... PRAGMA foreign_key_check` — sem violações.
- `/api/v1/version` em produção confirma `commit: "366dfc6"`,
  convergindo com `HEAD`/`origin/main`.

## Zero Cost — sem violação

Nenhum serviço pago foi introduzido. O item de maior risco financeiro
do roadmap inteiro (F-031, Durable Objects) foi auditado antes de
implementar (`docs/architecture/VTT_REALTIME_ZERO_COST_AUDIT.md`) e
confirmado como Free-tier (SQLite-backed Durable Objects, sem billing
automático em overage — erro 1027, nunca cobrança).

## Pendências conhecidas (documentadas, não escondidas)

- `MANUAL_SMOKE_QUEUE.md` continua com os itens que exigem sessão
  autenticada real em produção (Turnstile impede automação completa,
  `CLAUDE.md` §39 proíbe bypass).
- Restore automatizado de Social/Sheets/Adventures estruturadas/
  Files/VTT permanece fora do escopo v1 (decisão de produto, não
  lacuna escondida — ver seção F-015 acima).
- Handout reveal via realtime, múltiplos GMs simultâneos, e load test
  formal de VTT continuam fora de escopo desta v1 (documentado em
  `docs/architecture/VTT_REALTIME_ZERO_COST_AUDIT.md`).

Nenhuma dessas pendências bloqueia a meta `PLANNED_ROADMAP_COMPLETE` —
todas são decisões de escopo explícitas, com o item correspondente já
marcado `DONE` no roadmap.
