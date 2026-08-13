# Checkpoint autônomo — Fase C

Data: 2026-08-13

## Entregas

- domínio `entity_relations` com 17 tipos comuns e `CUSTOM` extensível;
- direção explícita `DIRECTED` ou `BIDIRECTIONAL`;
- visibilidade `PRIVATE`, `GROUP`, `CAMPAIGN`, `PLAYERS` e `GM_ONLY`;
- validação de duas entidades ativas do mesmo World e proprietário;
- canonização de arestas bidirecionais e prevenção de duplicatas;
- criação, edição, arquivamento e restauração controlados;
- busca, filtro por tipo, arquivo e entidades desconectadas;
- grafo com pan, zoom, fit view, minimapa e destaque de vizinhança;
- genealogia derivada de `PARENT`, `CHILD`, `SIBLING` e `PARTNER`;
- Graph e Genealogy permission-aware, sem grafo paralelo.

## Migration

- `0013_entity_relations.sql`, aditiva, com FKs `RESTRICT`, checks e índices.
- aplicação local: aprovada;
- `PRAGMA foreign_key_check` local: sem violações;
- aplicação remota: aprovada;
- `PRAGMA foreign_key_check` remoto: sem violações;
- backup lógico pré-migration: 73.277 bytes, SHA-256 `65F3B2EB2C3C2148424FE7BA35EB593F8AB9EE2ED55A0E0A21730DD1FBEEF5F6`.

## Dependência

- `@xyflow/react` 12.11.2;
- licença MIT;
- carregamento lazy em chunk próprio, sem aumentar o bundle inicial do aplicativo.

## Segurança coberta

- IDOR de relação;
- cross-user e cross-world;
- autorização das duas pontas;
- relação `GM_ONLY` invisível ao jogador;
- papel de narrador em campanha comum;
- duplicidade invertida;
- inconsistência parental imediata;
- mass assignment por schema estrito;
- SQL parametrizado.

## Gates locais

- lint: aprovado;
- typecheck: aprovado;
- unitários: 54 aprovados;
- integração: 26 aprovados;
- E2E: 4 aprovados em Chromium desktop e Pixel 7;
- build: aprovado sem warning de chunk excessivo.

## Commits

- `492ffc3` — domínio, migration, APIs e regressão de segurança;
- `4b0f777` — Graph, lista, Genealogy e E2E.

## Deploy e smoke

- PR: `#4`, merge por squash no commit `899c2df`;
- CI do PR: aprovado;
- CI de `main`: aprovado no run `31748089878`;
- Worker: `e53dc724-7547-4ec9-8479-5712f59cd8f7`;
- health e `/app`: HTTP 200;
- chunk lazy do Graph: HTTP 200;
- API de relações sem sessão: HTTP 401;
- CSP e `nosniff`: presentes;
- sessão de produção existente, dashboard e Worlds: smoke autenticado aprovado;
- a conta não possuía Worlds; nenhum dado fictício foi criado para forçar um smoke de mutação.

## Riscos e limitações

- o layout do grafo é calculado no cliente e não persiste posições;
- a genealogia valida contradições imediatas, mas não interpreta regras culturais ou biológicas específicas de cenário;
- limite defensivo atual: 500 nós e 500 relações por carregamento de World.

## Próximo passo

Iniciar Timeline/Calendar com migrations aditivas próprias.
