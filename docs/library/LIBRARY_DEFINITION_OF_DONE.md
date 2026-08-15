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
- [ ] Migration remota aplicada em produção com contagem pré/pós —
      preenchido na seção de release após a execução.

## Por que só o domínio (não upload/providers/dedup/archive) foi declarado DONE

Mesmo raciocínio da sessão anterior: "uma funcionalidade por vez", "não
faça rewrite automaticamente". O LIB-002 entrega a fundação física
(Game System + Publication + User Library Entry) com o mesmo rigor
(audit → plan → implement → test first → CI → deploy → smoke) — upload
de capa, provider externo, dedup real e archive são construídos sobre
essa fundação em sessões dedicadas futuras (F-008/F-009/F-010/F-011),
não half-implementados aqui.
