# RPG Manager — Auditoria de Completude do Projeto

Documento criado em resposta ao pedido de finalização absoluta
("RPG MANAGER — FINALIZAÇÃO ABSOLUTA DO PROJETO"), que rejeitou a
declaração anterior `PLANNED_ROADMAP_COMPLETE` e exigiu uma prova mais
rigorosa antes de qualquer declaração de conclusão.

**Este documento NÃO declara `RPG MANAGER — PROJECT_COMPLETE`.**

Itens reais e substanciais do pedido de finalização continuam
genuinamente pendentes (Seção "O que ainda falta" abaixo). Declarar
conclusão agora seria a fabricação que o próprio pedido proíbe
explicitamente (Seção 34/37 do pedido original).

Fonte da verdade: código real, migrations, testes executados localmente e
em CI, não relatórios anteriores.

---

## 1. O que foi entregue nesta rodada (BATCH20-22)

### F-015 — Backup/Restore completo — `IN_PROGRESS` (era `DONE`, reclassificado)

O restore automatizado (`POST /import/backup/preview` + `/confirm`) foi
expandido de 6 domínios (Worlds/Creature Stat Templates/Vault/Journal/
world_entity_links) para cobrir também:

| Domínio | Status restore | Observação |
|---|---|---|
| Library (rpgs/publications/game_systems) | `DONE` | via `buildCreateLibraryEntryStatements`, título único ao vivo |
| Groups/Group Members | `DONE` | nome único ao vivo, 1 GM/grupo, user_id externo validado |
| Campaigns/Campaign Members/Sessions/Attendance | `DONE` | precisa de RPG restaurado na mesma operação |
| Sheet Templates/Character Sheets | `DONE` | revalidado via `validateSheet()` |
| Wiki (pastas/tags/aliases) | `DONE` | normalizeEditorialLabel reaproveitada |
| Relations | `DONE` | normalizeLabel reaproveitada |
| Cartografia (mapas/pins) | `DONE` | |
| External Resources | `DONE` | |
| Timeline (eras/calendário/datas de eventos) | `DONE` | |
| Adventures estruturadas (scenes/encounters/scene entities/handouts) | `DONE` | |
| VTT (scenes/tokens/fog/combatants) | `DONE` | estado ao vivo SEMPRE restaurado inativo (decisão de produto documentada) |
| Social (friendships/blocks/invites) | `DONE` | regra própria: só restaura quando quem restaura é uma das partes reais |
| Social Library Interest | `DONE` | achado real: nunca esteve no export; corrigido (export+restore juntos) |
| Assets (bytes reais, não só metadata) | `DONE` | bundle separado `GET/POST /api/v1/files/backup` |
| Revision History (entity_revisions) | `NOT_STARTED` (restore) | export completo; restaurar o histórico como uma timeline artificial não foi julgado de valor real — toda entidade restaurada já ganha uma revisão CREATE própria |
| Notifications | `NOT_STARTED` (restore, decisão) | payload_json referencia IDs sempre regenerados no restore — restaurar geraria notificações "quebradas". Decisão documentada, não lacuna. |

**Preview categorizado (Seção 6 do pedido):** `BackupRestoreWarning.category`
(`SKIP`/`CONFLICT`/`EXTERNAL_DEPENDENCY`/`MISSING_ASSET`) implementado e
usado consistentemente em todos os domínios novos. CREATE/LINK continuam
implícitos nos contadores de `summary`/`restored` (não têm uma categoria
textual própria por linha) — categorização parcial, não 100% literal ao
pedido, mas o preview já é auditável e granular por domínio.

**Testes:** 8 arquivos de teste de round-trip cobrindo cadeias de
dependência profundas reais (Group→Campaign→Member→Session,
World→defaultRpgId, Adventure→Scene→Encounter→Handout+External Resource,
Campaign→VTTScene→Token→VaultEntity — todos os round-trips explicitamente
pedidos na Seção 5 foram exercitados), incluindo 2 testes de segurança
dedicados (IDOR de restore entre contas; forjar grafo social entre
contas).

### F-015 Seção 8 — Backup real de assets — `DONE`

`GET/POST /api/v1/files/backup` — bundle separado do JSON principal
(bytes não cabem no armazenamento de job em D1), cap de 15MB brutos,
content-type sempre resniffado (nunca confiado do bundle), testado
com o asset original DELETADO antes do restore (prova de
autocontenção genuína) e bytes verificados byte a byte. UI em
Configurações → "Arquivos anexados".

### F-035 — Handout reveal via realtime — `DONE`

`PATCH/POST/DELETE /adventures/:adventureId/handouts` notifica a(s)
Campaign(s) que usam a Adventure via o Durable Object já usado pelo
realtime de VTT (F-031) — eventos `HANDOUT_REVEALED`/`HANDOUT_HIDDEN`,
nunca o conteúdo do handout. Player Campaign Home ganhou poll leve (8s)
para refletir sem reload manual. Testado com WebSocket real (mesmo padrão
de `vtt-realtime.test.ts`).

---

## 2. O que ainda falta (genuíno, não escondido)

| Item do pedido | Seção | Status | Observação |
|---|---|---|---|
| Multi-GM (Owner + Co-GM) | 10-11 | `NOT_STARTED` | Modelo de Campaign continua single-owner. Requer: coluna/tabela de Co-GM, extensão de toda authorization de VTT/Adventures/Sessions para aceitar Co-GM, teste de concorrência real com 2 GMs simultâneos. |
| QA funcional de Player View integrada | 12 | `NOT_RE-AUDITED` | F-033 permanece `DONE` da implementação original; nenhuma auditoria FRESCA foi rodada nesta rodada além do que os testes de restore tocam incidentalmente. |
| QA funcional de GM View integrada | 13 | `NOT_RE-AUDITED` | Idem, F-034. |
| One-Shot E2E completo (desktop+mobile) | 14 | `NOT_RE-VALIDATED` | Corrigido em rodada anterior (discoverability); não reexecutado nesta rodada. |
| Social E2E completo (jornada com 2 contas) | 15 | `PARTIAL` | Restore de Social testado; a jornada completa (pedido→aceite→biblioteca compartilhada→convite→aceite→notificação→bloqueio→remoção) não foi executada como E2E de UI nesta rodada. |
| Character Sheet E2E completo | 16 | `NOT_STARTED` (nesta rodada) | Restore de Sheets testado via integration; fluxo completo com PDF fixture não foi executado. |
| Adventure full flow E2E | 17 | `PARTIAL` | Restore testado via integration; fluxo completo via UI real (criar→revelar→Player recebe) não foi executado como E2E. |
| VTT full session multi-contexto (GM-A/GM-B/Player/Outsider) | 18 | `NOT_STARTED` | Multi-GM não existe ainda; teste de 2 GMs reais depende dele. |
| Load test formal Zero-Cost | 19 | `NOT_STARTED` | Nenhuma medição formal de WebSocket messages/DO requests/D1 writes/CPU/memória sob carga simulada foi feita. |
| Proteção de Free-tier (rate limits) | 20 | `PARTIAL` | `SOCIAL_RATE_LIMITER` já existe para Social; token movement/fog update/handout event/reconnect burst NÃO têm limite dedicado. |
| Busca de "parciais escondidos" (TODO/FIXME/etc.) | 22 | `NOT_STARTED` | Nenhuma varredura sistemática do repositório foi feita nesta rodada. |
| Auditoria de botões mortos (crawler Playwright) | 23 | `NOT_STARTED` | |
| Responsivo (1440/1024/768/390/375) | 24 | `NOT_RE-AUDITED` | UI nova desta rodada (Configurações → Arquivos anexados) usa os mesmos componentes/classes já responsivos do resto de Configurações, mas não foi verificada visualmente em cada breakpoint. |
| Temas (Light/Dark/System) | 25 | `NOT_RE-AUDITED` | Idem — sem tokens hardcoded novos, mas sem verificação visual dedicada. |
| Acessibilidade | 26 | `NOT_RE-AUDITED` | |
| Segurança — reauditoria completa | 27 | `PARTIAL` | Toda linha de código nova nesta rodada seguiu a disciplina de segurança do arquivo (nunca confia em ID/tipo declarado pelo cliente, sempre revalida owner, nunca cria conta, nunca recria pessoa/relação de outra conta) — mas uma auditoria FORMAL e sistemática (IDOR/CSRF/XSS/SQLi/mass assignment/SSRF/magic bytes) cobrindo TODA a superfície do produto não foi reexecutada como atividade dedicada. |

---

## 3. Por que a lista acima não foi fechada nesta rodada

O pedido de finalização absoluta descreve, de forma realista, várias
semanas de trabalho de engenharia (uma feature nova de arquitetura
(Multi-GM), seis suítes de E2E multi-contexto distintas, um load-test
formal, um crawler de UI, três auditorias de UX transversais e uma
reauditoria de segurança completa). Produzir cada um desses itens com o
mesmo padrão de qualidade já demonstrado nesta sessão (causa raiz real,
nunca `rerun` como solução, testes que provam o comportamento antes da
correção, nunca declarar sem evidência) exige tempo real que uma única
sessão contínua não teria como honrar sem degradar a qualidade — e
degradar qualidade para "terminar mais rápido" contraria diretamente o
padrão de engenharia que este mesmo projeto exige (CLAUDE.md, seção
"Contrato global de engenharia").

A decisão tomada foi: entregar o item mais concretamente especificado e
de maior alavancagem primeiro (F-015 completo — havia uma contradição
real e nomeada entre "DONE" e a limitação documentada), fechá-lo com
qualidade total (implementação + testes + documentação + release chain),
e então avançar para a próxima feature nomeada mais concreta (Handout
Realtime), em vez de tocar superficialmente em todos os 37 itens ao mesmo
tempo.

## 4. Próximos passos recomendados, em ordem de prioridade real

1. Multi-GM (Seções 10-11) — desbloqueia o teste multi-contexto de VTT
   (Seção 18) e é a maior peça de arquitetura ainda pendente.
2. Auditoria de botões mortos (Seção 23) — barato, alto valor (o próprio
   pedido cita o bug real do One-Shot como prova de que isso importa).
3. Load test formal (Seção 19) + proteção de Free-tier (Seção 20) —
   protege a operação real do produto.
4. E2E completos por vertical (Seções 14-18) — mais caro, mas cada um é
   isolado e pode ser feito em paralelo por diferentes sessões/agentes.
5. Reauditoria de segurança formal (Seção 27) e varredura de "parciais
   escondidos" (Seção 22) — fecham o produto antes de qualquer
   declaração de conclusão.
6. Responsivo/temas/acessibilidade (Seções 24-26) — última camada, sobre
   uma base já funcionalmente completa.

---

## 5. Prova de release desta rodada

Ver relatório final da sessão para: `git log`, CI, Worker Version ID,
`/api/v1/version` em produção — nunca declarados aqui até confirmados de
verdade no momento do deploy.
