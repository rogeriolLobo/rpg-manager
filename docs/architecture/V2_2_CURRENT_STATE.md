# RPG Manager V2.2 — Relations, Graph e Genealogy

Data da auditoria: 2026-08-13

## Problema identificado

O Vault armazena entidades reutilizáveis e a V2.1 as apresenta como conhecimento, mas ainda não registra relações semânticas explícitas. Backlinks `[[...]]` indicam menções editoriais e não substituem relações com direção, tipo, força e visibilidade.

## Diagnóstico arquitetural

- `vault_entities` continuará sendo a identidade canônica dos nós;
- `entity_relations` será a única fonte persistente de arestas e genealogia;
- relações pertencem obrigatoriamente a um World e as duas pontas precisam pertencer ao mesmo World;
- autorização de uma relação depende da visibilidade da própria relação **e** da autorização das duas entidades;
- o backend filtra antes de responder; o frontend nunca recebe arestas ou nós `GM_ONLY` não autorizados;
- mutações permanecem exclusivas do proprietário do World nesta versão;
- Graph e Genealogy são projeções da mesma API, não novos domínios persistentes.

## Menor implementação segura

1. migration aditiva com FKs restritivas, constraints e índices;
2. tipos, validação pura de direção/genealogia e testes unitários;
3. API de listagem e CRUD, com 404 para IDOR e validação cross-world/cross-user;
4. testes de integração para owner, player, GM, leakage e isolamento;
5. UI de gestão em lista;
6. visualização com React Flow 12 (`@xyflow/react`, licença MIT), usando somente os dados já filtrados pela API;
7. árvore genealógica derivada de `PARENT`, `CHILD`, `SIBLING` e `PARTNER`.

## Decisões de modelo

- tipos comuns serão controlados no domínio e `CUSTOM` exigirá label;
- `DIRECTED` e `BIDIRECTIONAL` serão explícitos;
- a visibilidade reutilizará `PRIVATE`, `GROUP`, `CAMPAIGN`, `PLAYERS` e `GM_ONLY`;
- `strength` será inteiro opcional de 1 a 5, sem semântica mecânica universal;
- exclusão será física apenas para a aresta, ação reversível por recriação e sem cascata sobre entidades;
- não serão inferidas relações por texto, NLP ou IA;
- ciclos familiares não serão proibidos genericamente; serão rejeitados auto-relacionamento, duplicidade e pares parentais inversos imediatamente inconsistentes.

## Riscos e controles

- **vazamento de segredo:** autorização SQL antes da serialização e testes com jogador;
- **IDOR nas pontas:** validação do proprietário, World e entidades em toda mutação;
- **grafo inconsistente:** constraints, transação em batch e validação de duplicidade;
- **dependência visual:** React Flow é isolado na página de grafo; o domínio e a API não dependem da biblioteca;
- **performance:** consultas limitadas ao World, índices por World/tipo/visibilidade e projeção enxuta.

## Fora deste incremento

Timeline, calendário, mapas, upload, R2, fichas, compêndios, compartilhamento público e VTT continuam fora da Fase C.
