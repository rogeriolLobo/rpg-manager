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
- aplicação remota: pendente do gate de CI deste branch.

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

Pendentes do push, CI remoto verde, backup lógico e migration remota segura.

## Riscos e limitações

- o layout do grafo é calculado no cliente e não persiste posições;
- a genealogia valida contradições imediatas, mas não interpreta regras culturais ou biológicas específicas de cenário;
- limite defensivo atual: 500 nós e 500 relações por carregamento de World.

## Próximo passo

Publicar a Fase C após os gates remotos e então iniciar Timeline/Calendar com migrations aditivas próprias.
