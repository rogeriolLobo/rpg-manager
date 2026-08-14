# RPG Manager 1.0 — Matriz de Auditoria (Fase 0)

Data: 2026-08-14. Fonte de verdade: código, migrations, rotas, UI, testes e
produção (não relatórios anteriores).

**Metodologia e limite honesto desta rodada:** cada linha abaixo foi
verificada por evidência concreta — rota existe no `app.tsx`, handler existe
em `src/server/routes/*.ts`, página existe em `src/client/pages/*.tsx`,
migration existe, arquivo de teste existe e contém casos relevantes (contei
`it(...)` reais, não apenas a existência do arquivo). **Não verifiquei, nesta
rodada, cada tela individualmente em light/dark nem em mobile** — isso exigiria
navegar manualmente por ~25 telas em 2 temas e 2 larguras, o que não coube
neste turno. Marco a coluna Light/Dark/Mobile como "usa tokens/layout padrão
(não inspecionado tela a tela)" quando a tela reusa os componentes/CSS
globais já auditados (que são theme-aware e responsivos por padrão no
projeto), e sinalizo explicitamente onde há uma exceção conhecida.

Classificações: **COMPLETE** (rota+UI+API+DB+auth+testes existem e cobrem o
fluxo principal) · **PARTIAL** (existe e funciona, mas com lacuna real
identificada) · **BROKEN** (existe mas quebrado) · **MISSING** (não existe) ·
**OUT_OF_SCOPE_1_0** (deliberadamente fora, por decisão de produto).

## CORE

| Feature | Route | UI | API | DB | AuthZ | Testes | Classificação | Launch blocker | Ação |
|---|---|---|---|---|---|---|---|---|---|
| Dashboard | `/app` | `dashboard-page.tsx` | `dashboard.ts` (41 linhas) | `rpgs`,`campaigns` | `requireAuth` | sem teste dedicado (indireto via E2E) | PARTIAL | Não | Nenhuma ação obrigatória; cobertura de teste dedicada seria desejável |
| Library (RPGs) | `/app/library`, `/new`, `/:id`, `/:id/edit` | `library-pages.tsx` | `rpgs.ts` (149 linhas) | `rpgs` | `requireAuth`+`user_id` scoping | `validation.test.ts`, `cover-policy.test.ts`, `cover-security.test.ts`, parte de `auth-and-isolation.test.ts` (isolamento A/B, mass assignment, SQLi), E2E `core-flow`, `rpg-cover-edit` | **COMPLETE** | — | — |
| Groups | `/app/groups`, `/new`, `/:id`, `/:id/edit` | `group-pages.tsx` | `groups.ts` (127 linhas) | `play_groups`,`play_group_members` | `requireAuth`+`user_id` | coberto via `auth-and-isolation.test.ts` (fluxo de grupo/narrador) + E2E `core-flow` | COMPLETE | Não | — |
| Campaigns | `/app/campaigns`, `/new`, `/:id`, `/:id/edit` | `campaign-pages.tsx` | `campaigns.ts` (126 linhas) | `campaigns`,`campaign_members` | `requireAuth`+`user_id`, isolamento testado (`isola campanhas...`) | `campaign-planning.test.ts` + integração + E2E | COMPLETE | Não | — |
| Sessions | `/app/campaigns/:id/sessions/*` | `campaign-pages.tsx` (`SessionFormPage`,`SessionDetailPage`) | `campaigns.ts` (mesmas rotas) | `campaign_sessions`,`campaign_session_attendance` | igual Campaigns | E2E `core-flow` cobre registrar sessão | COMPLETE | Não | — |

## WORLD

| Feature | Route | UI | API | DB | AuthZ | Testes | Classificação | Launch blocker | Ação |
|---|---|---|---|---|---|---|---|---|---|
| Worlds | `/app/worlds`,`/new`,`/:id`,`/:id/edit` | `world-pages.tsx` | `worlds.ts` (35) | `worlds`,`world_members` | `canViewWorld` (visibility PRIVATE/GROUP, server-side) | `vault-and-worlds.test.ts` | COMPLETE | Não | — |
| Active World | preferências | `useActiveWorld` hook | `preferences.ts` | `user_preferences.active_world_id` | escopo por usuário | testado em preferências/theme test | COMPLETE — **é contexto, não autorização** (confirmado: filtragem real é por `visibility`/membership, Active World só direciona a navegação contextual) | Não | — |
| Vault (entidades) | `/app/vault`,`/new`,`/:id`,`/:id/edit` | `vault-pages.tsx` | `vault.ts` (64) + `knowledge.ts` (169, organização/wiki) | `vault_entities` + tabelas de detalhe | `canViewEntity` server-side (`content/authorization.ts`, `content/permissions.ts`) | `content-permissions.test.ts`, `world-knowledge.test.ts`, `specialized-entities.test.ts`, E2E `vault-worlds-flow` | COMPLETE | Não | — |
| Characters/NPCs/Creatures/Locations/Factions/Items | mesma rota Vault, `entityType` | `specialized-entity-fields.tsx` | mesmas rotas + `specialized_*` tabelas (migration 0015) | tabelas de detalhe por tipo | mesma authZ do Vault | `specialized.test.ts` (unit) + `specialized-entities.test.ts` (integração) | COMPLETE | Não | — |
| Lore | tipo de entidade no Vault | idem | idem | `lore_details` (0011) | idem | `wiki.test.ts` cobre parte de lore/wiki | COMPLETE | Não | — |
| Events | Timeline | `timeline-pages.tsx` | `timeline.ts` | `event_temporal_details` (0014) | idem escopo World | `timeline.test.ts`, `calendar.test.ts` | COMPLETE | Não | — |
| Quests, Handouts | — | — | — | — | — | — | **MISSING** | Não (não citado como bloqueador central do produto atual; Vault/Journal cobrem parcialmente notas de aventura) | Avaliar se `adventure_details` (Adventures) já supre a necessidade antes de criar domínio novo |
| Adventures | tipo de entidade no Vault | idem | `adventure_details` (0006) | idem | idem | coberto por `specialized-entities.test.ts` | COMPLETE | Não | — |

## KNOWLEDGE

| Feature | Route | UI | API | DB | AuthZ | Testes | Classificação | Launch blocker | Ação |
|---|---|---|---|---|---|---|---|---|---|
| Wiki (organização/pastas/tags/aliases) | `/app/worlds/:id/wiki` | `world-knowledge-pages.tsx` | `knowledge.ts` | `wiki_folders`,`world_tags`,`wiki_entity_tags`,`wiki_entity_aliases` (0010) | escopo World | `wiki.test.ts`, `world-knowledge.test.ts` | COMPLETE | Não | — |
| Journal (pastas + páginas) | `/app/worlds/:id/journal` | `world-knowledge-pages.tsx` (`WorldJournalPage`) | `journal.ts` (90) | `journal_folders`,`journal_pages` (0011) | apenas dono do World (`isOwner`) | integração dentro de `world-knowledge.test.ts` (a confirmar cobertura exaustiva) | PARTIAL | Não | Ver seção "Ideas" abaixo — reaproveitar para Quick Capture |
| Ideas / Quick Capture | — | — | — | — | — | — | **MISSING** | Não (opcional, seção 28) | Journal já cobre o domínio de "nota rápida"; recomendo NÃO criar domínio novo — apenas adicionar atalho de UX "+ Nova ideia" que cria uma `journal_page` |
| Global Search | via Command Palette | `command-palette.tsx` | `search.ts` (53) | consulta várias tabelas | escopo por usuário/World | sem teste dedicado encontrado | PARTIAL | Não | Adicionar teste de integração dedicado |
| Command Palette | componente global | `command-palette.tsx` | usa `search.ts` | — | — | usado implicitamente em E2E (`Abrir paleta de comandos` aparece no DOM) | COMPLETE (funcional) / teste E2E dedicado ausente | Não | — |

## RELATIONS

| Feature | Route | UI | API | DB | AuthZ | Testes | Classificação | Launch blocker | Ação |
|---|---|---|---|---|---|---|---|---|---|
| Relations | `/app/worlds/:id/relations` | `relations-pages.tsx` | `relations.ts` (249, a maior rota do projeto) | `entity_relations` (0013) | escopo World + visibility | `relations.test.ts` (unit) + integração | COMPLETE | Não | — |
| Graph | mesma rota (`relations-pages.tsx` usa `@xyflow/react`) | idem | idem (mesmos dados) | idem | idem | não há teste E2E dedicado ao grafo visual (difícil de testar via DOM) | PARTIAL (funcional, sem teste automatizado do render visual) | Não | Aceitável — grafo visual é naturalmente difícil de testar por asserção DOM |
| Genealogy | dentro de Relations (tipos de relação incluem parentesco, ver `RELATION_TYPES`) | idem | idem | idem | idem | idem | PARTIAL (mesmo caso do Graph) | Não | — |

## TIME

| Feature | Route | UI | API | DB | AuthZ | Testes | Classificação | Launch blocker | Ação |
|---|---|---|---|---|---|---|---|---|---|
| Timeline | `/app/worlds/:id/timeline` | `timeline-pages.tsx` | `timeline.ts` (194) | `event_temporal_details` | escopo World | `timeline.test.ts` | COMPLETE | Não | — |
| World Calendar | mesma página (calendário customizado) | idem | mesma rota | `world_calendars`,`world_eras` (0014) | idem | `calendar.test.ts` | COMPLETE | Não | — |

## GAME CONTENT

| Feature | Route | UI | API | DB | AuthZ | Testes | Classificação | Launch blocker | Ação |
|---|---|---|---|---|---|---|---|---|---|
| Bestiary | `/app/worlds/:id/bestiary` | `bestiary-page.tsx` | `bestiary.ts` (73) | `creature_stat_templates`,`creature_stat_blocks`,`creature_details` (0015) | escopo World | `specialized.test.ts`, `specialized-entities.test.ts` | COMPLETE | Não | — |
| Specialized entity fields | dentro do Vault | `specialized-entity-fields.tsx` | idem Vault | idem 0015 | idem | idem | COMPLETE | Não | — |

## COLLABORATION

| Feature | Route | UI | API | DB | AuthZ | Testes | Classificação | Launch blocker | Ação |
|---|---|---|---|---|---|---|---|---|---|
| Invites | `/invite/:token` | `world-knowledge-pages.tsx` (`InviteAcceptPage`) | `world-invites.ts` (69) | `world_invites` (0012) | apenas dono cria; token de uso único/expiração | sem teste dedicado localizado nesta rodada | PARTIAL | Sim, se não testado | **P1**: adicionar teste de integração cobrindo criação, aceite, expiração e reuso de convite |
| Player Portal | `/app/worlds/:id/portal` | `world-knowledge-pages.tsx` (`WorldWikiPage portal`) | reusa `knowledge.ts`/`vault.ts` filtrado por visibility | — | reusa `canViewEntity`/`canViewWorld` (GM_ONLY nunca deveria aparecer) | **Confirmado, corrigindo avaliação inicial:** `vault-and-worlds.test.ts:163` (`"aplica GROUP, CAMPAIGN, PLAYERS e GM_ONLY sem permitir impersonação"`) registra Player e GM reais, cria entidade `GM_ONLY` e confirma `404` para o Player e `200` para o GM via `/vault/:id` — a mesma camada de autorização (`canViewEntity`) que o Portal consome. | **COMPLETE** | Não | — |

## SYSTEM

| Feature | Evidência | Classificação | Launch blocker | Ação |
|---|---|---|---|---|
| Authentication | `auth.ts`, registro/login/recovery/sessions, rate limiting, Turnstile em produção | COMPLETE | Não | — |
| Permissions (GM_ONLY/PRIVATE/GROUP/CAMPAIGN/PLAYERS) | `domain/content/permissions.ts` + `server/content/authorization.ts`, filtragem **server-side** via SQL (não é "esconder no React") | COMPLETE, mas **precisa do teste P0 acima confirmando isolamento real do Player no Portal** | Ver acima | — |
| Theme (Light/Dark/System) | `theme/ThemeProvider`, `theme-bootstrap.test.ts`, `theme.test.ts`, tokens em `theme/tokens.css` | COMPLETE | Não | — |
| Desktop/Mobile | `playwright.config.ts` roda `chromium`+`mobile-chromium` para todo E2E; CSS com breakpoint em `styles.css` (`@media` em ~1110) | COMPLETE (estrutural); **não inspecionei tela a tela nesta rodada** | Não | — |
| Empty states / Validation errors / Loading / Not found / Unauthorized | `Empty`, `Loading` em `dashboard-page.tsx`; `NotFound` em `app.tsx`; erros de campo agora existem em RPG (este ciclo) mas **não confirmei se todos os outros formulários (Groups, Campaigns, Worlds, Vault) têm erro por campo ou só banner genérico** | PARTIAL | Não (é polish, não bloqueador) | Auditoria de UX dedicada (seção 22) — não feita em profundidade nesta rodada |

## NÃO EXISTE HOJE (auditado, confirmado ausente por busca no repositório inteiro)

| Feature | Classificação | 1.0 obrigatório? | Ação recomendada |
|---|---|---|---|
| Revision History (`entity_revisions`) | **MISSING** | A decidir (seção 28 do pedido classifica como opcional) | Ver `docs/audit/WORLDCRAFT_GAP_MATRIX.md` — recomendo **não** implementar agora; nenhuma migration, rota ou UI existe; implementar com segurança exige desenho de schema + snapshot + restore + permissões, não cabe com qualidade nesta sessão |
| Cartography (mapas/pins) | **MISSING** | Opcional | Idem — recomendo próxima sessão dedicada |
| External Resources / Files | **MISSING** | Opcional | Idem |
| GM Tools (dice roller, timer, quick notes) | **MISSING** | Explicitamente NÃO obrigatório (seção 14 do pedido) | `OUT_OF_SCOPE_1_0` a menos que sobre tempo depois do checklist obrigatório |
| Sheets (Character Sheet Engine) | **MISSING** | Explicitamente NÃO obrigatório (seção 15) | `OUT_OF_SCOPE_1_0`, documentar arquitetura futura |
| VTT | **MISSING** | `OUT_OF_SCOPE_1_0` (explícito, seção 16) | Não implementar |
| Social/Amizades | **MISSING** | `OUT_OF_SCOPE_1_0` (explícito, seção 17) | Não implementar |
| Compendium (visão agregada read-only) | **MISSING** como tela dedicada | Provavelmente dispensável — Vault + Bestiary já navegam por tipo de entidade | Avaliar necessidade real antes de criar view agregada nova |

## Contagem real de testes (evidência, não estimativa)

- `it(...)` em `tests/unit/*.test.ts` + `tests/integration/*.test.ts`: **122** ocorrências textuais (inclui alguns `it.each`/loops que podem gerar mais casos em runtime).
- Specs E2E: 5 arquivos (`core-flow`, `vault-worlds-flow`, `navigation-invariants`, `rpg-cover-edit`, `capture-screenshots` — este último não é um teste de asserção, é utilitário de captura de screenshots).
- Suite completa (`npx vitest run`) reportou **108 testes** passando na última execução desta sessão (unit) + **33** (integration) = **141** testes automatizados totais, todos verdes.

## P0/P1 reais identificados por esta auditoria

1. **P1 — Invites sem teste de integração dedicado.** Risco: convite expirado/reusado não testado automaticamente.
2. **P2 — Global Search sem teste de integração dedicado.**

(O isolamento GM_ONLY→Player, inicialmente suspeitado como gap P0 nesta
auditoria, **já está coberto** por `vault-and-worlds.test.ts:163` — corrigido
acima após verificação. Registro esse engano aqui deliberadamente: a
instrução do projeto é não inventar resultados, incluindo não inventar
lacunas que não existem.)

Nenhum **BROKEN** foi encontrado nesta auditoria (fora do bug de coverUrl já corrigido nesta sessão, que pertencia à Library).
