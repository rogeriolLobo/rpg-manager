# RPG Manager — Status Final (RPG-1.0-BATCH5)

Documento único de fechamento, exigido pela sessão de finalização total do
site. Não repete a auditoria completa — essa vive em
`docs/audit/RPG_MANAGER_1_0_MATRIX.md` (fonte de verdade tela-a-tela,
revalidada em BATCH2/3/4/5). Este documento é o resumo executivo final:
o que está `COMPLETE`, o que é deliberadamente `FUTURE`, e a prova de
release.

## F-001 — Revision History (o trabalho novo desta sessão)

**Status: `DONE`, produção validada (ver seção "Prova de release" abaixo).**

### Por que foi reaberto

Sessões anteriores classificaram F-001 como `OUT_OF_SCOPE_1_0` — P3,
maior risco de schema da lista de `MISSING`, decisão consciente de não
apressar sob prazo (`CLAUDE.md` §40). Com o restante do backlog 1.0 já
`DONE` e tempo hábil para auditar antes de escrever código, o item foi
reaberto deliberadamente nesta sessão — não por pressa, mas porque a
condição que justificava adiar (falta de tempo para fazer com
qualidade) deixou de existir.

### Arquitetura (decisões e porquês)

- **Escopo:** Vault entities, Journal pages, Worlds — os três tipos de
  conteúdo autoral editável priorizados pela auditoria (seção 5 do
  pedido original). Timeline Events, Relations, Maps, External
  Resources ficam de fora: nenhum tem hoje um fluxo de edição rico o
  bastante para justificar o custo de manter histórico agora — podem
  entrar num ciclo futuro se a necessidade real aparecer.
- **Snapshot, não diff:** cada revisão grava um JSON completo do
  payload validado (`VaultEntityInput`/`JournalPageInput`/`WorldInput`).
  Um diff campo-a-campo seria mais compacto, mas exigiria uma segunda
  representação dos dados (lógica de merge, lógica de exibição de
  diff) só para economizar espaço num volume que, no Free Tier do D1
  (limite generoso de storage), não justifica a complexidade. Decisão
  registrada e não escondida: se o volume real crescer a ponto de doer,
  compactar/podar revisões antigas é um ajuste aditivo futuro, não uma
  migration destrutiva.
- **Tabela nova, puramente aditiva:** `migrations/0025_entity_revisions.sql`
  — `CREATE TABLE` + índices, nenhum `DROP`/`RENAME`/`ALTER` em tabela
  existente. Segue `docs/architecture/DATABASE_MIGRATION_SAFETY.md`
  (o mesmo documento criado depois do incidente real do LIB-004B).
- **Autorização — a decisão mais importante:** histórico é **owner-only**,
  tanto para visualizar quanto para restaurar. Isso não é uma
  simplificação arriscada: é o mesmo limite que **já** vale para EDITAR
  Vault entities, Journal pages e Worlds neste produto hoje — não existe
  co-edição em lugar nenhum (edição sempre passa por `ownedEntity`/
  `ownedWorld`, nunca pelo `authorizedEntity`/`authorizedWorld` mais
  amplo usado só para leitura por membros/jogadores). Histórico só
  existe por causa de edições, então herda o MESMO limite de quem pode
  editar — nunca abre um canal de acesso mais largo que o que já existia.
  Isso elimina de raiz o vetor "a visibilidade mudou entre revisões, o
  que o Player consegue ver retroativamente?": a resposta é sempre
  "nada, Player nunca teve acesso a histórico, só o dono tem".
- **Restore nunca apaga, sempre cria:** restaurar uma revisão salva o
  estado atual como uma nova revisão `RESTORE` antes/durante a escrita —
  nunca "volta o ponteiro" e nunca deleta revisões antigas. A escrita de
  restore reusa a MESMA função (`buildEntityUpdateStatements`, extraída
  do handler de PATCH) e a MESMA validação (`validateReferences`) de uma
  edição manual — não existe um caminho de escrita paralelo que possa
  divergir silenciosamente do comportamento normal.
- **`revision_number`** calculado via subquery escalar
  (`MAX(revision_number)+1`) dentro do próprio `INSERT`, no mesmo
  `D1.batch()` da escrita principal — sem read-then-write separado, sem
  janela de corrida.
- **UI:** ação contextual "Histórico" na própria tela do recurso (Vault
  detail, World detail, Journal editor) — nunca item de navegação
  global, para não violar a invariante de navegação do produto
  (`CLAUDE.md` §23). Modal mostra data/hora, autor, ação, resumo, ver
  revisão, restaurar quando permitido — nunca depende só de cor para
  indicar o tipo de ação (badge sempre tem texto).

### Testes

- `tests/integration/revision-history.test.ts` — 16 casos, os três tipos
  de recurso: criação gera revisão inicial, múltiplas edições preservam
  histórico completo, snapshot é o estado NO MOMENTO da revisão (não o
  atual), restore cria nova revisão e nunca apaga as antigas, restore
  revalida com a mesma lógica de um update normal, conta estranha recebe
  404 (nunca 403 — não vaza existência), Player com visibilidade
  `PLAYERS` ainda recebe 404 (histórico é mais restrito que leitura),
  revisão inexistente → 404, número de revisão inválido → 422, snapshot
  nunca contém campo proibido, recurso arquivado bloqueia restore (409).
- `tests/e2e/revision-history.spec.ts` — fluxo completo (criar → editar
  → ver histórico → visualizar revisão antiga → restaurar → confirmar
  reversão → confirmar nova revisão RESTORE no topo, nada apagado) para
  Vault e World, mais uma regressão de segurança dedicada (requisição
  sem sessão → 401).
- Dois bugs reais achados pelo próprio processo de release (CI, não
  local) e corrigidos — detalhados em
  `docs/e2e/LOCAL_E2E_DIAGNOSTICS.md` (addendum RPG-1.0-BATCH5): um
  `PRODUCT_BUG` pré-existente de condição de corrida em
  `VaultFormPage`/`WorldFormPage` (digitar antes do GET assíncrono
  resolver podia ser apagado silenciosamente), e um `TEST_BUG` na
  própria suíte nova (confirm() nativo do restore sem handler
  registrado). Nenhum dos dois foi descartado como flake sem evidência.

### O que NÃO foi feito agora (decisão registrada, não omissão)

- Timeline/Relations/Maps/External Resources sem histórico — avaliar
  necessidade real num ciclo futuro, não implementar preventivamente.

## F-015 — Backup/Restore completo (RPG-1.0-BATCH6)

**Status: `DONE` (escopo v1 — ver limitação documentada abaixo), produção
validada.**

Primeiro item executado após a correção de direção do responsável do
produto (congelamento pós-1.0 revogado — ver `docs/product/FULL_ROADMAP.md`),
por proteger dados antes dos módulos maiores seguintes.

### Export — `GET /api/v1/export`, `schemaVersion: 8`

Cobertura completa de todo dado autoral do usuário — fechou a lacuna
real achada na auditoria de integridade do BATCH5 (v7 só tinha a
linha-base de Worlds/Vault). Ver `src/domain/backup/types.ts` e
`docs/library/LIBRARY_IMPORT_EXPORT.md` para a lista completa de
domínios.

### Restore — `POST /api/v1/import/backup/preview` + `/confirm`

- **Decisão de segurança central:** restore sempre cria registros
  **novos** (IDs gerados no servidor via `crypto.randomUUID()`), nunca
  sobrescreve uma linha existente por ID. Isso elimina de raiz o vetor
  de IDOR mais óbvio (um JSON manipulado tentando sobrescrever/assumir
  a linha de outro dono) e o risco de destruir dado real
  silenciosamente — "detectar conflito" na prática é "nunca há
  conflito possível", porque nada é sobrescrito.
  `owner_user_id`/`user_id` do JSON enviado é **sempre** ignorado — o
  dono do dado restaurado é sempre quem está autenticado (testado
  explicitamente: restaurar o backup de outra conta não reatribui nada
  a ela, e a conta original não é alterada).
- **Toda linha reconstruída é revalidada** pelos MESMOS schemas Zod
  usados pelo create normal (`vaultEntityInputSchema`,
  `worldInputSchema`, `journalPageInputSchema`,
  `creatureStatTemplateInputSchema`) — nunca se confia no shape do
  JSON enviado além do que esses schemas aceitam.
- **Referências cruzadas** (World de uma entidade, pai de Location,
  pasta de página, template de ficha de criatura) só são preservadas
  quando o alvo também está sendo restaurado na mesma operação — uma
  referência que aponta para algo fora do escopo do restore é
  removida (nunca causa erro fatal), com aviso explícito no preview.
- Preview/confirm com TTL de 30 minutos, tabela dedicada
  `backup_restore_jobs` (migration `0026`, puramente aditiva — evitou
  relaxar o `CHECK(kind IN (...))` de `import_jobs`, mesma lição do
  incidente LIB-004B documentada em
  `docs/architecture/DATABASE_MIGRATION_SAFETY.md`).
- Limites explícitos: até 200 Worlds e 1000 entidades/páginas por
  operação (`422 BACKUP_TOO_LARGE` acima disso) — batch de escrita
  dentro do orçamento seguro do D1 Free.

**Escopo v1 do restore automatizado (limitação documentada, não
escondida):** Worlds, Creature Stat Templates, Vault entities (+ todos
os campos especializados), Journal (pastas+páginas). Groups/Campaigns/
Library, Wiki (organização), Relations, Cartografia, External
Resources e Revision History continuam cobertos pelo EXPORT — nenhum
dado é perdido no backup — mas ainda não têm restore automatizado
nesta v1. Registrado como próxima iteração natural do F-015, não como
`OUT_OF_SCOPE`.

### Testes

`tests/integration/backup-restore.test.ts` (7 casos: export v8
completo, round-trip com hierarquia de Location + ficha de criatura
com template + pastas de Diário aninhadas — tudo com IDs remapeados,
nunca reaproveitando os antigos —, restore de backup de outra conta
cria os dados sob posse de quem restaura sem alterar a conta original,
job de restore é owner-only [404, não 403], `schemaVersion`
incompatível rejeitado com 422, JSON malformado rejeitado com 422,
linha inválida é pulada com aviso sem travar o resto do restore) +
`tests/e2e/backup-restore.spec.ts` (fluxo completo pela tela de
Configurações: baixar → prévia → confirmar → conteúdo original
intacto + cópia restaurada).

## Matriz final

| Área | Status | Evidência | Futuro |
|---|---|---|---|
| Dashboard, Library, Groups, Campaigns, Sessions | COMPLETE | `docs/audit/RPG_MANAGER_1_0_MATRIX.md` §CORE | — |
| Worlds, Active World, Vault, Wiki, Journal | COMPLETE | idem §WORLD | — |
| Ideas/Quick Capture, External Resources, Global Search | COMPLETE (BATCH2) | idem §KNOWLEDGE | — |
| Relations, Graph, Genealogy | COMPLETE | idem §RELATIONS | — |
| Timeline, Calendar | COMPLETE | idem §TIME | — |
| Bestiary, campos especializados | COMPLETE | idem §GAME CONTENT | — |
| Invites, Player Portal | COMPLETE | idem §COLLABORATION | — |
| Cartografia (mapas/pins) | COMPLETE (BATCH3) | idem | — |
| GM Tools (dados, timer) | COMPLETE (BATCH3) | idem | — |
| Error handling estrutural (sem spinner infinito) | COMPLETE (BATCH4) | idem | — |
| **Revision History (F-001)** | **COMPLETE (BATCH5)** | migration 0025, 16 integration + E2E, ver seção acima | — |
| **Backup/Restore completo (F-015)** | **COMPLETE — v1 (BATCH6)** | migration 0026, 7 integration + E2E, ver seção acima | Restore automatizado de Groups/Campaigns/Wiki/Relations/Cartografia/External Resources/Revision History (documentado, não bloqueante) |
| Character Sheet Engine (F-020/F-021/F-023) | NOT_STARTED | `docs/product/FULL_ROADMAP.md` | Congelamento pós-1.0 revogado — voltou ao roadmap ativo, ver ordem de execução do roadmap |
| VTT (F-029..F-032) | NOT_STARTED | `docs/product/FULL_ROADMAP.md` | Idem — realtime (F-031) `BLOCKED` até auditoria de arquitetura zero-cost |
| Social/Amizades (F-016..F-019) | NOT_STARTED | `docs/product/FULL_ROADMAP.md` | Idem |

## Prova de release (cadeia HEAD = origin/main = build = produção)

Preenchida ao final do deploy desta sessão — ver relatório final da
sessão para os valores exatos de Worker Version ID, timestamp e
`/api/v1/version` pós-deploy. Local gates (lint/typecheck/unit/
integration/build) e CI (56 E2E desktop+mobile) verdes antes do deploy.

## Conclusão

F-001 Revision History (BATCH5) e F-015 Backup/Restore completo
(BATCH6): implementados, testados (unit+integration+E2E), documentados,
sem regressão nos domínios existentes, sem migration destrutiva,
autorização revisada e testada explicitamente (owner-only para
histórico; restore nunca sobrescreve, sempre cria registros novos sob
a posse de quem restaura). Bugs reais encontrados durante o próprio
processo de release foram corrigidos na causa raiz (não contornados).
Escopo v1 do restore automatizado (Worlds/Vault/Journal) e itens
futuros do roadmap (Social, Character Sheet Engine, VTT) seguem
rastreados em `docs/product/FULL_ROADMAP.md` — não são omissões
silenciosas.
