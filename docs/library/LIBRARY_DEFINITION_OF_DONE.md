# Biblioteca — Definition of Done (LIB-001)

Status por escopo. `DONE` exige produção validada, não só código.

## Bug de coverUrl (escopo concreto do incidente) — `DONE`

- [x] RPG existente com coverUrl histórica → Editar → não mudar nada →
      Salvar → sucesso.
- [x] RPG existente → alterar apenas Quero jogar → Salvar → sucesso →
      capa histórica preservada.
- [x] RPG existente → alterar coverUrl para URL nova insegura → rejeitar,
      erro junto ao campo (não existe mais "host proibido" — é sobre a
      URL ser sintaticamente segura).
- [x] RPG existente → remover capa → salvar → comportamento correto.
- [x] RPG existente com URL atualmente aceita → editar sem alteração →
      sucesso.
- [x] CREATE com uma URL HTTPS pública de qualquer host → sucesso (não
      apenas PATCH — o bug também afetava criação de RPGs novos com
      capas de editoras não listadas).
- [x] Import CSV usa a mesma regra (canonical normalization
      compartilhada entre create/edit/import).
- [x] SSRF: URLs inseguras (IP privado/loopback, protocolo perigoso,
      não-HTTPS) continuam rejeitadas — testado explicitamente.
- [x] CSP (`img-src`) ajustada para não bloquear no navegador o que o
      servidor aceita.
- [x] lint, typecheck, unit (102), integration (35), E2E
      (desktop+mobile), build — todos verdes.
- [x] Commit `ec51077`, CI verde, deploy Version
      `77696b49-0204-47c9-92da-1cebea49c4d7`.
- [x] `/api/v1/version` confirma HEAD local == origin/main == build ==
      produção.
- [x] Smoke read-only em produção: 30 RPGs, nenhuma escrita feita.
- [ ] Smoke autenticado por clique real — `MANUAL_SMOKE_REQUIRED`
      (Turnstile/CAPTCHA, não contornado). Checklist:
      1. Login manual.
      2. Abrir um RPG existente → Editar → não alterar nada → Salvar →
         deve funcionar.
      3. Alterar "Quero jogar" → Salvar → capa preservada.
      4. Trocar a capa para uma URL de um editor **novo**, nunca usado
         antes no catálogo (ex.: qualquer loja HTTPS pública real) →
         deve salvar com sucesso (comportamento **novo**: antes desta
         sessão isso teria sido rejeitado se o host não estivesse na
         allowlist).

## Vertical slice completo (upload, providers, split de domínio) — `IN_PROGRESS`

- [x] `docs/library/LIBRARY_ARCHITECTURE.md` — decisão de domínio
      (Opção A) — **implementada** (LIB-002, migration
      `0016_library_domain_normalization.sql`).
- [ ] `docs/library/COVER_STORAGE.md` — upload real + KV — **desenhado,
      não implementado** (F-008, fora de escopo do LIB-002).
- [ ] `docs/library/METADATA_PROVIDERS.md` — Open Library — **desenhado,
      não implementado** (F-009/LIB-003, fora de escopo do LIB-002).
- [ ] Dedup por ISBN (hoje é por título exato) — schema pronto
      (`publications.isbn`/`isbn10`/`isbn13`), lógica de dedup não
      implementada (F-010).
- [ ] Archive de RPG (hoje só existe delete físico) — schema pronto
      (`rpgs.archived_at`), endpoint/UI não implementados (F-011).
- [ ] Preview antes de salvar metadata externa (depende de F-009).

## LIB-002 — Normalização do domínio (Game System + Publication + User Library Entry) — `DONE`

- [x] `game_systems`/`publications` criadas, `rpgs.publication_id`
      (aditivo, nullable) — nenhuma tabela/coluna existente removida.
- [x] Backfill idempotente migra todos os registros existentes sem
      perda de dado (contagem pré == pós, verificado em produção — ver
      seção de release abaixo).
- [x] `title`/`coverUrl`/`isbn`/`coverSourceUrl`/`coverSourceNote`
      passam a ser lidos de `publications` (fonte de verdade); colunas
      legadas em `rpgs` preservadas fisicamente, não mais escritas.
- [x] CREATE, PATCH, import CSV usam a mesma camada canônica de escrita
      (`src/server/routes/library-writes.ts`) — sem caminho paralelo.
- [x] PATCH separa metadata (Publication/Game System) de estado pessoal
      (User Library Entry) na mesma transação (`db.batch`).
- [x] `/export` inclui `publications`/`gameSystems` (versão 6) — backup
      continua 100% completo.
- [x] API pública (`GET/POST/PATCH /rpgs`) mantém o mesmo formato
      achatado — frontend não precisou mudar.
- [x] `category_id`/`subgenre_id` — decisão de manter em `rpgs`
      documentada (não movidos nesta sessão).
- [x] Sem endpoints novos (`/game-systems`, `/publications`) — não
      necessários nesta fase.
- [x] Sem reuso/dedup entre criações (decisão deliberada, documentada
      em `LIBRARY_ARCHITECTURE.md`) — sem nova superfície de edição
      cruzada entre contas.
- [x] Testes: unit (`library-domain.test.ts`), integration
      (`library-domain.test.ts` — create/patch/import/export/backfill),
      regressão de `auth-and-isolation.test.ts` e `rpg-cover-edit.spec.ts`
      atualizados para a nova fonte de verdade.
- [x] lint, typecheck, unit, integration, E2E, build — ver seção de
      release.
- [x] Migration remota aplicada em produção com contagem pré/pós:
      30 → 30 rpgs, 30 publications, 30 game_systems, 0 divergências
      campo a campo (título/capa/ISBN) nas 30 linhas reais.

## Release — LIB-002

- Commit: `762550d`
- CI: verde (run re-executada após 1ª tentativa falhar por
  `RATE_LIMIT` no rate limiter de registro sob 2 workers Playwright em
  paralelo — em `core-flow.spec.ts`/`navigation-invariants.spec.ts`,
  arquivos não tocados por este commit; `rpg-cover-edit.spec.ts`, o
  único arquivo E2E alterado, passou de primeira em ambos os projetos)
- Migration remota: `0016_library_domain_normalization.sql` aplicada
  em produção — contagem pré 30 rpgs, pós 30 rpgs/30 publications/30
  game_systems/30 com publication_id, 0 mismatches campo a campo
- Deploy: Worker Version `7bcd3ce4-cb53-432f-a0eb-e215d0b7aeef`
- `/api/v1/version`: `{"commit":"762550d",...}` — HEAD local ==
  origin/main == produção
- Smoke: `/api/v1/health` 200 com headers de segurança íntegros,
  `/` 200, contagem de RPGs em produção confirmada em 30 antes e
  depois do smoke (somente leitura)
- `MANUAL_SMOKE_REQUIRED`: clique autenticado real (editar RPG
  existente pós-migration, confirmar capa/estado pessoal) continua
  bloqueado por Turnstile/CAPTCHA, não contornado — mesma situação já
  registrada para LIB-001

## Por que só o domínio (não upload/providers/dedup/archive) foi declarado DONE

Mesmo raciocínio da sessão anterior: "uma funcionalidade por vez", "não
faça rewrite automaticamente". O LIB-002 entrega a fundação física
(Game System + Publication + User Library Entry) com o mesmo rigor
(audit → plan → implement → test first → CI → deploy → smoke) — upload
de capa, provider externo, dedup real e archive são construídos sobre
essa fundação em sessões dedicadas futuras (F-008/F-009/F-010/F-011),
não half-implementados aqui.

## LIB-003 — Identidade, ISBN, provenance e deduplicação segura — `DONE`

Ver `docs/library/PUBLICATION_IDENTITY.md` para o desenho completo.

- [x] ISBN normalizado (`src/domain/rpg/isbn.ts`) — hífens/espaços
      removidos, forma canônica persistida.
- [x] Checksum validado (ISO 2108 ISBN-10, EAN-13 ISBN-13) — não aceita
      qualquer sequência de 10/13 dígitos, só as matematicamente corretas.
- [x] Identidade de Publication definida — ISBN-13 (direto ou derivado
      de ISBN-10) como chave canônica; sem fuzzy match; título nunca é
      usado para decidir reuso.
- [x] Provenance definida — `metadata_source` (já existia desde LIB-002,
      decisão documentada de não expandir o `CHECK` para `IMPORT`
      distinto, ver `PUBLICATION_IDENTITY.md`).
- [x] External ID architecture pronta — `publication_external_ids`,
      schema-ready, sem provider chamado.
- [x] Dedup seguro implementado — ISBN já existente no catálogo (de
      qualquer conta) reaproveita a Publication; sem ISBN, sempre
      Publication distinta.
- [x] Duplicate in same library bloqueado — `409 ALREADY_IN_LIBRARY` +
      índice único `idx_rpgs_user_publication_unique` (defesa em
      profundidade, não só aplicação).
- [x] Estados pessoais isolados — cobertos por teste dedicado
      (`tests/integration/publication-identity.test.ts`).
- [x] Metadata compartilhada protegida — `422
      SHARED_PUBLICATION_METADATA_LOCKED` quando Publication tem 2+
      referências; estado pessoal nunca bloqueado.
- [x] Importer usa a mesma regra — `EXISTING_PUBLICATION`/
      `ALREADY_IN_LIBRARY` resolvidos pela mesma camada canônica
      (`buildCreateLibraryEntryStatements`), sem caminho paralelo.
- [x] Export atualizado — `publicationExternalIds` incluído, versão 7.
- [x] Dados existentes preservados — auditoria prévia (30 registros, 20
      ISBNs não vazios, todos válidos e únicos, 0 duplicatas) + migration
      só populou colunas até então vazias, nenhum merge necessário.
- [x] unit (`isbn.test.ts` + `validation.test.ts` atualizado) verde.
- [x] integration (`publication-identity.test.ts` + regressão de
      `library-domain.test.ts`) verde.
- [x] E2E, lint, typecheck, build, CI — ver seção de release.
- [x] Migration produção aplicada, deploy, `/api/v1/version`, production
      proof — ver seção de release.
- [x] Documentação atualizada (este arquivo + `LIBRARY_ARCHITECTURE.md`
      + `LIBRARY_CURRENT_STATE.md` + `MASTER_BACKLOG.md` +
      `PUBLICATION_IDENTITY.md` novo).

### Release — LIB-003

- Commit: `387cb86` (feature) + `da12019` (fix de infra de CI, ver abaixo)
- CI: 1ª tentativa falhou por dois flakes com a mesma causa raiz
  (`RATE_LIMIT` no registro + `SQLITE_BUSY` no D1 local, ambos por
  2 workers do Playwright em paralelo) — corrigido na raiz
  (`playwright.config.ts`: `workers:1` só no CI), não por rerun cego;
  2ª tentativa verde sem retries.
- Migration remota: `0017_publication_identity.sql` aplicada em
  produção — contagem pré/pós: 30 rpgs (inalterado), 30 publications
  (inalterado), 20 publications com `isbn13` populado (exatamente as
  20 ISBNs reais não vazias, auditadas antes da migration), 0 com
  `isbn10` (nenhuma no dataset real), `publication_external_ids` vazia,
  0 mismatches campo a campo entre `isbn` legado e `isbn13` backfillado.
- Deploy: Worker Version `7d9f7daf-d608-4257-9793-be056dbea660`
- `/api/v1/version`: `{"commit":"da12019",...}` — HEAD local ==
  origin/main == produção
- Smoke: `/api/v1/health` 200, `/` 200, contagem de RPGs em produção
  confirmada em 30 antes e depois (somente leitura)
- `MANUAL_SMOKE_REQUIRED`: clique autenticado real (cadastrar/editar
  ISBN, confirmar dedup) continua bloqueado por Turnstile/CAPTCHA, não
  contornado — mesma situação já registrada para LIB-001/LIB-002

## LIB-004 — Busca online de publicações / Open Library — `DONE`

Ver `docs/library/METADATA_PROVIDERS.md` para o desenho completo.

- [x] `BookMetadataProvider` existe (`src/domain/rpg/metadata-provider.ts`).
- [x] `OpenLibraryProvider` implementado (`src/server/providers/open-library.ts`).
- [x] Busca por ISBN (lookup exato via `/isbn/{isbn}.json`).
- [x] Busca por título (via `/search.json?q=...`).
- [x] Busca por autor — mesmo endpoint de busca textual da Open Library
      (não há endpoint dedicado "só autor" na API pública; `author_name`
      vem nos resultados quando a query bate).
- [x] Resultados limitados (10, sem paginação profunda).
- [x] Preview — reaproveita o formulário do cadastro manual, pré-preenchido
      + aviso de origem, antes de qualquer escrita.
- [x] Confirmação manual — "Salvar RPG" é o único gatilho de escrita.
- [x] Work/Edition corretamente separados (`workId`/`editionId`
      distintos, `publication_external_ids.external_type`).
- [x] External IDs salvos (`publication_external_ids`, `INSERT OR IGNORE`).
- [x] Provenance salva (`metadata_source`/`metadata_source_id`/
      `metadata_source_url`/`metadata_fetched_at`).
- [x] Dedup LIB-003 utilizada — mesma `buildCreateLibraryEntryStatements`,
      com Edition/Work ID como prioridade extra sobre ISBN.
- [x] Cadastro manual preservado — "manual" é o modo padrão/imediatamente
      visível; teste E2E dedicado de regressão.
- [x] Cover Open Library funciona (URL construída a partir do Cover ID,
      carregada pelo navegador — mesma política de LIB-001).
- [x] Fallback funciona (placeholder H&M quando sem capa/capa falha,
      componente `CoverImage` já existente, reaproveitado sem mudança).
- [x] Provider error funciona (`502 PROVIDER_UNAVAILABLE`, mensagem
      amigável, cadastro manual continua acessível).
- [x] Timeout (`AbortSignal.timeout(5000)` em todo fetch ao provider).
- [x] Rate limit (`DIRECTORY_RATE_LIMITER` reaproveitado, chave própria).
- [x] unit (14 casos, `open-library.test.ts`, mapping/erros/timeout com
      fixtures de uma consulta real única — seção 32 do pedido).
- [x] integration (12 casos, `metadata-search.test.ts`, upstream mockado
      via `mockImplementation` — nunca depende da Open Library real).
- [x] E2E desktop/mobile (`rpg-online-search.spec.ts` — fluxo completo,
      sem resultados, provider indisponível, ALREADY_IN_LIBRARY,
      regressão do cadastro manual; seam determinístico server-side
      travado atrás de `ENVIRONMENT !== production`, já que Playwright
      não intercepta fetch server-side).
- [x] lint, typecheck, build — ver seção de release.
- [x] CI, deploy, `/api/v1/version` — ver seção de release.
- [x] production smoke possível (read-only; smoke autenticado real
      continua `MANUAL_SMOKE_REQUIRED`, mesma situação de sempre).
- [x] docs atualizadas (`METADATA_PROVIDERS.md`, `LIBRARY_ARCHITECTURE.md`,
      `LIBRARY_CURRENT_STATE.md`, este arquivo, `MASTER_BACKLOG.md`).

### Release — LIB-004

- Migration `0018_publication_authors.sql` aplicada em produção
  (`rpg-manager-production`, remote) — aditiva, `ALTER TABLE
  publications ADD COLUMN authors`. Pré-contagem 30/30/30
  (rpgs/publications/game_systems) preservada, pós-contagem 30/30 —
  nenhum dado perdido.
- CI: run `31928174310` — `success` (`validate` em 3m32s), referente ao
  commit de feature `4dde623` (código: provider + rota + dedup +
  frontend + testes, mais os dois fixes de causa raiz do CI de colisão
  de seletor e do `AUTH_REGISTRATION_RATE_LIMITER` global-por-IP).
- **Correção de proveniência de deploy**: o primeiro deploy desta
  sessão (Worker Version `fcef1f72-4a17-4ae4-be20-37c78b36790e`) foi
  feito no commit de feature `4dde623`, mas em seguida foi commitada
  documentação de release (`2c5646f`) **sem redeploy** — quebrando a
  cadeia HEAD = origin/main = produção (relatado incorretamente como
  fechado). Corrigido: deploy refeito em cima de `2c5646f` (HEAD real
  no momento da correção).
- Git HEAD = `origin/main` = **`2c5646f`**.
- Deploy final: `wrangler deploy` — Worker Version ID
  `ad007d91-2266-408e-9a9f-76e1366d950f`.
- Produção via `/api/v1/version`: `{"commit":"2c5646f","build":"2026-08-16T11:45:17.544Z","environment":"production"}`
  — bate exatamente com Git HEAD e `origin/main` no momento da
  verificação.
- Smoke read-only (após o redeploy): homepage `200`, `/login` `200`,
  contagem de `rpgs` em produção inalterada (30) — nenhuma migration
  neste segundo deploy, só sincronização de build.
- Smoke read-only (verificação original, mesmos resultados):
  homepage `200`, `/login` `200`,
  `GET /api/v1/rpgs/search-external` sem sessão → `401` (rota nova
  existe e exige autenticação, como esperado).
- Smoke autenticado (Buscar online → selecionar → preview → salvar):
  `MANUAL_SMOKE_REQUIRED` — Turnstile bloqueia registro/login
  automatizado em produção. Checklist para o responsável:
  1. Login em produção.
  2. Biblioteca → Novo RPG → "Buscar online".
  3. Buscar um livro real (ex.: título ou ISBN de um RPG existente).
  4. Selecionar um resultado → conferir tela de preview (dados +
     aviso "Dados de: Open Library").
  5. Editar um campo do preview (ex.: notas pessoais) antes de salvar.
  6. Salvar → conferir card na Biblioteca e "Origem do cadastro:
     Open Library" na página de detalhe.
  7. Editar esse RPG depois (PATCH) → confirmar que o cadastro manual
     de outro RPG continua funcionando normalmente (regressão zero).
