# Auditoria arquitetural para a V2.0

## Status e linha de base

Auditoria concluída em 13 de agosto de 2026 antes de qualquer alteração funcional da V2. O repositório estava limpo em `main`, sincronizado com `origin/main`, no commit `02fb076`.

Gates observados na linha de base:

- `npm run lint`: aprovado;
- `npm run typecheck`: aprovado;
- `npm test`: 4 arquivos e 29 testes aprovados, cobertura global dos módulos incluídos acima dos thresholds;
- `npm run test:integration`: 1 arquivo e 12 testes aprovados no runtime Workers com D1 local;
- `npm run test:e2e`: 2 fluxos aprovados, Chromium desktop e Pixel 7;
- `npm run build`: aprovado para Worker e SPA.

Esses resultados formam o gate de regressão obrigatório durante toda a V2.0.

## Topologia e dependências encontradas

O sistema é um monólito full-stack pequeno em TypeScript:

```text
Navegador
  -> React 19 + React Router 7 + CSS próprio
  -> /api/v1 na mesma origem
  -> Hono 4 em Cloudflare Worker
  -> Cloudflare D1
  -> bindings nativos de Rate Limiting e Turnstile
```

Vite usa os plugins React e Cloudflare. O deploy utiliza Workers + Static Assets, não Pages. Não há backend separado, ORM, query builder, repository framework, service container ou biblioteca externa de autorização.

Dependências de runtime atuais: Hono, React, React DOM, React Router, Zod e Lucide. A V2 não precisa adicionar dependências nem serviços pagos.

## Estrutura real do repositório

- `src/client`: SPA, contexto de autenticação, cliente HTTP, layout, páginas e CSS;
- `src/server`: composição Hono, autenticação, middleware de segurança, rotas e SQL D1;
- `src/domain`: somente regras puras de planejamento de campanha e recomendação de RPG;
- `src/shared/validation`: schemas Zod usados pela API;
- `migrations`: migrations D1 append-only `0001` a `0004`;
- `tests/unit`: domínio, validação e segurança pura;
- `tests/integration`: Worker real com D1 migrado antes de cada teste;
- `tests/e2e`: um fluxo completo executado em desktop e mobile;
- `docs`: ADRs, banco, segurança, importação, referência e deploy;
- `.github/workflows/ci.yml`: lint, typecheck, unitários, integração, build e E2E.

Não existem diretórios de repositories, services ou fixtures formais. As rotas Hono validam, autorizam, orquestram e executam prepared statements diretamente. Essa é uma diferença explícita entre o PRD conceitual e a implementação real.

## Domínio atual

### Identidade e segurança

`users` representa a conta. A autenticação usa sessão opaca server-side, cookie HttpOnly e token CSRF separado. Recovery codes substituem recuperação por e-mail. Senhas usam PBKDF2-HMAC-SHA-256 no limite aceito pelo Workers, salt único e pepper remoto.

Todas as entradas mutáveis usam schemas Zod estritos e mapeamento explícito. O Worker aplica CSP, HSTS em HTTPS, `nosniff`, proteção contra frame e política de origem. A API devolve request ID sem stack trace.

### Biblioteca

`rpgs` pertence a um usuário e aponta para taxonomia global `categories/subgenres`. A listagem já possui busca, filtros, allowlist de ordenação e paginação server-side. Recomendação e prontidão ficam em `src/domain/rpg`.

### Grupos e identidades de mesa

`play_groups` pertence a um usuário. `play_group_members` pode representar convidado por nome ou conta vinculada por `user_id`. Um índice parcial garante um narrador principal por grupo. O diretório autenticado pesquisa contas sem retornar e-mail.

### Campanhas e histórico

`campaigns` pertence ao usuário e exige um RPG da mesma conta. Membros ativos do grupo são copiados para `campaign_members`, preservando personagem, notas e presença específicos da execução. `campaign_sessions` e `campaign_session_attendance` mantêm o histórico. Regras de etapa, próxima ação e progresso ficam em `src/domain/campaign`.

`Campaign Member`, `User` e o texto `character_name` já são conceitos diferentes no banco, mas não existe ainda uma entidade persistente `Character` reutilizável. A V2 criará `CHARACTER` no Vault sem converter nem apagar os snapshots históricos atuais.

## Modelo atual de autorização

A política observada é 404 para recurso alheio:

- RPG: `WHERE id=? AND user_id=?`;
- grupo: `WHERE id=? AND user_id=?` antes de acessar filhos;
- campanha: helper `ownedCampaign()` antes de membros e sessões;
- referências recebidas são validadas contra o proprietário autenticado;
- testes A/B cobrem IDOR de RPG, campanha, sessão e grupo.

Esse modelo suporta apenas ownership. Ele não consegue expressar acesso de leitura por World, grupo, campanha, papel de jogador ou narrador. A V2 precisa centralizar essa decisão; duplicar condicionais nas rotas seria inseguro.

## Tabelas existentes relevantes

Existem 16 tabelas de aplicação:

- autenticação: `users`, `auth_sessions`, `account_recovery_codes`, `security_events`, `auth_rate_limits`;
- referência e biblioteca: `categories`, `subgenres`, `rpgs`;
- campanhas: `campaigns`, `campaign_members`, `campaign_sessions`, `campaign_session_attendance`;
- grupos: `play_groups`, `play_group_members`;
- operação: `user_preferences`, `import_jobs`.

As migrations já aplicadas não serão modificadas.

## Frontend e componentes reutilizáveis

O roteamento fica centralizado em `src/client/app.tsx`; `AppShell` fornece sidebar e layout responsivo. Os componentes reutilizáveis existentes são leves: `PageHeader`, `Badge`, `Empty`, `Loading`, botões, panels, grids, formulários e cliente HTTP genérico. Não há biblioteca de componentes, modal genérico, hooks de paginação ou cache de dados.

A V2 reutilizará layout, tokens de cor, cliente HTTP, estados vazios, badges e padrões de formulário. As páginas novas ficarão separadas por feature para não ampliar os arquivos já densos de campanha/biblioteca.

## Testes e CI

- unitários cobrem funções puras e schemas críticos;
- integração executa o Worker compilado e D1 real local, aplicando todas as migrations antes de cada teste;
- E2E cadastra uma conta real local e percorre grupos, biblioteca, campanha, sessão e dashboard em dois viewports;
- CI repete todos os gates em Node 22 e instala Chromium.

Não há fixtures compartilhadas. Para a suíte V2, helpers de integração reutilizáveis serão extraídos sem mudar o comportamento dos testes V1.

## Diferenças entre o PRD e a V1 real

1. Não existem repositories/services formais. A V2 não criará uma arquitetura paralela completa; adicionará domínio de autorização e helpers server-side apenas onde a complexidade exige.
2. `ADR-003` já pertence aos grupos reutilizáveis. O histórico não será reescrito: Vault será ADR-004 e permissões ADR-005.
3. Campanhas são visíveis somente ao proprietário, embora possuam membros com contas. A V2 usará esses membros exclusivamente para autorizar conteúdo Vault vinculado; não abrirá toda a UI histórica da campanha para participantes sem requisito explícito.
4. `game_master` é snapshot textual e `campaign_members.is_game_master` é o vínculo autenticado confiável. Permissões GM usarão o segundo, nunca o texto.
5. Exclusão de conta é hard delete com cascatas. Isso conflita com preservação histórica; será convertida em anonimização/soft delete, revogando credenciais e mantendo as FKs.
6. O backup JSON V4 passou a cobrir Worlds, memberships, Vault, detalhes de Adventure e vínculos. A infraestrutura de tema elevou o contrato para V5, incluindo `user_preferences.theme`.
7. O PRD admite adiar hierarquia de Location. Ela é segura no modelo atual e será implementada com `parent_entity_id`, FK restritiva e validação de ciclo.

## Decisões para a V2.0

### Modelo de persistência

- `worlds`: owner, nome, slug por owner, descrição, RPG padrão opcional, visibilidade `PRIVATE|GROUP`, status e arquivamento;
- `world_members`: membership explícita `OWNER|VIEWER`; owner também permanece em `worlds.owner_user_id`;
- `vault_entities`: entidade-base para os onze tipos do PRD, World e grupo opcionais, parent opcional somente para Locations, visibilidade e arquivamento;
- `adventure_details`: extensão 1:1 somente para `ADVENTURE`;
- `campaign_entities`: vínculo N:N sem cópia, com `REFERENCE|ACTIVE`;
- `campaigns.adventure_entity_id`: Adventure principal opcional e não destrutiva.

Não serão usados EAV, JSON arbitrário, tabela por tipo ou upload.

### Política central de conteúdo

Funções puras em `src/domain/content/permissions.ts` decidirão:

- `canViewEntity`;
- `canEditEntity`;
- `canArchiveEntity`;
- `canRestoreEntity`;
- `canDeleteEntity`;
- `canViewWorld`;
- `resolveEntityVisibility`.

Helpers server-side agregarão owner, membership de World/grupo/campanha, papel de jogador/narrador e estado de arquivo. As rotas receberão a decisão pronta e manterão política 404 para acesso negado.

Regras definidas:

- owner sempre visualiza e é o único que edita, arquiva, restaura ou exclui;
- `PRIVATE`: somente owner;
- `GROUP`: owner e contas ativas do grupo associado; convidados textuais não contam;
- `CAMPAIGN`: owner e membros autenticados vinculados a qualquer campanha ligada;
- `PLAYERS`: owner, jogadores ativos e narradores autenticados das campanhas ligadas;
- `GM_ONLY`: owner e narradores autenticados das campanhas ligadas;
- entidade compartilhada sem associação correspondente continua visível apenas ao owner;
- conteúdo arquivado sai das listagens por padrão e fica visível somente ao owner até restauração;
- World arquivado fica visível somente ao owner e não arquiva suas entidades.

Com o modelo V1, `CAMPAIGN` inclui membros vinculados mesmo inativos; `PLAYERS` exige participante ativo e classificado como jogador, além do narrador ativo. Essa diferença mantém semântica útil sem inventar novos papéis de campanha.

### Integridade e exclusão

- exclusão de World será bloqueada enquanto houver entidades;
- exclusão de entidade será bloqueada enquanto houver campanha, Adventure principal ou Location filha dependente;
- excluir campanha remove somente links `campaign_entities`; a entidade sobrevive;
- arquivar campanha/World não altera Vault;
- conta excluída será anonimizada e desabilitada, com sessões/recovery removidos; os dados históricos permanecem vinculados ao UUID não autenticável.

## Plano de implementação em fases pequenas

### Fase 0 — auditoria

- criar este documento;
- manter gates V1 verdes;
- commit documental isolado.

### Fase 1 — domínio e permissões

- tipos de domínio, matriz de visibilidade e validações de World/Adventure/Location;
- testes unitários para todos os branches e estados arquivados;
- ADR-004 (modelo Vault) e ADR-005 (permissões).

### Fase 2 — migrations

- `0005_worlds.sql`: Worlds e memberships;
- `0006_vault_entities.sql`: entidade-base, Locations e Adventure;
- `0007_campaign_entities.sql`: vínculo N:N e Adventure principal;
- índices guiados pelas consultas e FKs não destrutivas;
- migration e schema local validados antes de API.

### Fase 3 — API e autorização server-side

- schemas Zod próprios da feature;
- rotas `/worlds` e `/vault` com busca, filtros, paginação e allowlist de sort;
- membership de World via diretório existente;
- archive/restore e delete restrito;
- anonimização de conta e backup JSON V5;
- testes de integração por nível de visibilidade e IDOR.

### Fase 4 — Worlds UI

- menu e rotas list/new/detail/edit;
- dashboard do World, membership e entidades recentes;
- estados vazios, archive/restore e responsive layout.

### Fase 5 — Vault UI

- listagem paginada, busca/filtros/sort server-side;
- criação simples, detalhe e edição para onze tipos;
- extensão de Adventure e parent de Location;
- archive/restore/delete com feedback acessível.

### Fase 6 — Campaign ↔ Entity

- endpoints de link/unlink;
- Adventure principal opcional;
- painel de entidades autorizadas no detalhe da campanha;
- nenhuma duplicação de entidade.

### Fase 7 — regressão de segurança

- IDOR de World/entity/link;
- mass assignment e manipulação de FK/papel;
- GM impersonation e ausência de payload `GM_ONLY`;
- busca/sort/payload/enum malformados;
- preservação após conclusão, arquivamento e exclusão de conta.

### Fase 8 — E2E

- preservar o fluxo V1 desktop/mobile;
- adicionar fluxo V2 desktop completo;
- cobrir Vault/World/create/edit/archive/restore no mobile.

### Fase 9 — documentação

- README, arquitetura, banco, segurança, API e migrations;
- `docs/vault/OVERVIEW.md` e `docs/worlds/OVERVIEW.md`;
- limitações e extensão futura de tipos sem implementar V2.1.

### Fase 10 — publicação

- todos os gates locais;
- inspeção do banco remoto e backup lógico antes das migrations;
- migrations remotas append-only;
- deploy no Worker existente;
- smoke público e autenticado quando possível;
- push dos commits lógicos e CI remoto verde.

## Fora de escopo deliberado

Não serão criados Relationship Graph, React Flow, mapas, Leaflet, pins, R2, uploads, PDFs, fichas, templates, timeline visual, calendário, marketplace, conteúdo público, comentários, realtime, WebSocket, chat, VTT, dados ou IA. Nenhuma dependência ou placeholder quebrado desses recursos será adicionado.

## Riscos de regressão e mitigação

- **Autorização complexa:** política pura central, contexto montado no servidor e testes por matriz.
- **Cascatas históricas:** soft delete de conta e FKs restritivas/SET NULL escolhidas explicitamente.
- **Vazamento GM_ONLY:** consultas autorizadas antes da apresentação; nenhum filtro apenas no React.
- **Compatibilidade V1:** migrations somente aditivas, `campaigns.adventure_entity_id` opcional e gates completos a cada fase.
- **Rotas densas:** módulos novos separados por feature, sem refatorar rotas V1 fora do necessário.
- **Performance D1:** paginação, índices compostos, subqueries agregadas e ausência de filtragem em memória no cliente.
- **Escopo futuro:** extensões somente para Adventure e Location; os demais tipos usam campos comuns.
