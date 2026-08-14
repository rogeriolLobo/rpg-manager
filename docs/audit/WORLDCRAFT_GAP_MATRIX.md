# Matriz de Gap Conceitual — RPG Manager vs. WorldCraft

Comparação **conceitual** apenas, a partir da lista de conceitos fornecida
pelo responsável do produto. Nenhum código, CSS, asset, texto ou design da
WorldCraft foi copiado, referenciado ou consultado para produzir este
documento — a coluna "RPG Manager Equivalent" reflete exclusivamente o que
foi encontrado por auditoria real do código deste repositório
(`docs/audit/RPG_MANAGER_1_0_MATRIX.md`).

| WorldCraft Concept | RPG Manager Equivalent | Status | Gap | 1.0 Required? | Action |
|---|---|---|---|---|---|
| Dashboard | Dashboard (`/app`) | Equivalente existe | Nenhum gap funcional identificado | Sim | — |
| Ideas | Journal (páginas/pastas) | Parcial — sem UX de "captura rápida" dedicada | Falta atalho "+ Nova ideia" com campos mínimos (título opcional, conteúdo, World opcional, tags opcional) | Não (opcional, seção 28/10 do pedido) | Reaproveitar Journal; **não criar domínio novo** |
| Files | — | Ausente | Sem armazenamento nem referência de arquivo externo | Não (Zero Cost proíbe upload/R2) | Se necessário, implementar como "External Resource" (referência a URL HTTPS, não upload) — ver seção "Fora do escopo" abaixo |
| Journal | Journal (`journal_folders`,`journal_pages`) | Equivalente existe | Nenhum gap funcional central identificado | Sim | — |
| Wiki | Wiki (pastas/tags/aliases sobre Vault) | Equivalente existe | Nenhum gap funcional central | Sim | — |
| Graph | Relations (visão em grafo via `@xyflow/react`) | Equivalente existe | Sem teste automatizado do render visual (aceitável — grafo é difícil de testar por asserção DOM) | Sim | — |
| Genealogy | Tipos de relação de parentesco dentro de Relations | Equivalente existe (mesmo motor, sem tela dedicada de árvore genealógica) | Não há uma visualização especializada em árvore (só grafo genérico) | Não | Avaliar em versão futura se o grafo genérico é suficiente para o caso de uso |
| Cartography | — | Ausente | Sem mapas nem pins | Não obrigatório — opcional (seção 28) | Ver seção "Fora do escopo" — desenho zero-cost documentado, não implementado nesta sessão |
| GM Tools | — | Ausente | Sem dice roller / timer / quick notes | Explicitamente não obrigatório (seção 14 do pedido) | `OUT_OF_SCOPE_1_0` |
| Timeline/Cronos | Timeline (`event_temporal_details`) | Equivalente existe | Nenhum gap funcional central | Sim | — |
| Calendar | World Calendar (`world_calendars`,`world_eras`) | Equivalente existe | Nenhum gap funcional central | Sim | — |
| Sheets | — | Ausente | Sem motor de ficha de personagem | Explicitamente não obrigatório (seção 15) | `OUT_OF_SCOPE_1_0`, documentar arquitetura futura |
| Guilds/Factions | Factions (tipo de entidade do Vault, `faction_details`) | Equivalente existe | Nenhum gap — **decisão confirmada de não duplicar**: Factions já resolve o conceito de Guilds | Sim | — |
| Compendium | Vault + Bestiary navegáveis por tipo | Parcial — sem view agregada read-only única | Falta uma tela que liste Creatures/Items/Lore juntos de forma agregada | Não | Avaliar necessidade real; Vault já filtra por `entityType`, o ganho de uma view agregada nova é incerto |
| Library | Library (RPGs, `rpgs.ts`) | Equivalente existe — e é o módulo mais testado do projeto após esta sessão | Nenhum gap | Sim | — |
| VTT | — | Ausente | Sem tabuleiro virtual, sem realtime | `OUT_OF_SCOPE_1_0` (explícito, seção 16) | Não implementar |

## Itens deliberadamente fora do escopo do 1.0 (com justificativa)

- **VTT**: exige realtime/WebSocket e complexidade de sincronização
  incompatível com o orçamento de tempo e com a política Zero Cost do
  projeto (Workers Free não tem WebSocket persistente barato em escala).
- **Sheets (motor de ficha completo)**: risco explícito do próprio pedido
  ("não criar ficha genérica ruim apenas para marcar como implementado").
  O Vault já suporta campos especializados por tipo de entidade
  (`specialized-entity-fields.tsx`), o que cobre parcialmente fichas
  simples de criatura/NPC via `creature_stat_templates`.
- **GM Tools**: não obrigatório; **candidato razoável para uma sessão
  futura pequena e isolada** (dice roller client-side é trivial, zero
  custo, zero risco) — mas não implementado agora para não competir por
  tempo/atenção com a auditoria e os P1 de segurança/testes já
  identificados.
- **Social/Amizades**: fora desta execução por decisão explícita do
  responsável do produto.
- **Cartography, External Resources**: desenho de schema está
  documentado no pedido original (tabelas `maps`/`pins`,
  `external_resources`) e é tecnicamente viável em Zero Cost (URL HTTPS
  externa, sem R2, sem upload). **Não implementado nesta sessão** — são
  subsistemas novos (migration + rotas + autorização + UI + testes) que
  merecem uma sessão dedicada com o mesmo rigor aplicado ao restante do
  projeto, não uma implementação apressada no fim de uma sessão já longa.

## Confirmação da regra de não duplicar domínios

Auditado explicitamente: **Guilds/Factions** → RPG Manager já tem
`factions` como tipo de entidade do Vault (`faction_details`, migration
0015) com `purpose`, `scope`, `status`, `publicDescription`, `gmNotes`.
Não há necessidade nem foi criado um domínio "Guilds" separado.
