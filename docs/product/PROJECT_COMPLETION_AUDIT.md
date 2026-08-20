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

### F-015 — Backup/Restore completo — `DONE`

Fechamento semântico final (Seção 24 do pedido de finalização) concluído
nesta rodada: Revision History e Notifications, os dois únicos domínios
que ainda estavam com decisão de restore implícita/não classificada
formalmente, agora têm categoria explícita (`ARCHIVAL_HISTORY` /
`EPHEMERAL_USER_ACTIVITY`) surfaced no preview, com teste dedicado. Todo
o restante do escopo v1 do restore automatizado já estava `DONE` de
rodadas anteriores (tabela abaixo).

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
| Revision History (entity_revisions) | `DONE` (decisão semântica formal — `ARCHIVAL_HISTORY`) | Export completo; restore NUNCA reinjeta como histórico operacional (produziria uma timeline falsa). Preview emite aviso explícito com `category:'ARCHIVAL_HISTORY'` sempre que o backup contém `entity_revisions` — testado em `tests/integration/backup-restore.test.ts` ("F-015 Seção 24"). |
| Notifications | `DONE` (decisão semântica formal — `EPHEMERAL_USER_ACTIVITY`) | payload_json referencia IDs sempre regenerados no restore — restaurar geraria notificações quebradas. Preview emite aviso explícito com `category:'EPHEMERAL_USER_ACTIVITY'` sempre que o backup contém `notifications`. Mesmo teste acima cobre os dois. |

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
nunca o conteúdo do handout. Testado com WebSocket real (mesmo padrão de
`vtt-realtime.test.ts`).

**Seções 7-9 do pedido de finalização (WebSocket-first, sem duplicar
sockets, cleanup) — fechadas nesta rodada:**

- Novo hook compartilhado `src/client/api/campaign-realtime.ts`
  (`useCampaignRealtime`) — extrai connect/reconnect com backoff/
  ping-keepalive/RESYNC/sequence-guard/cleanup do que antes só existia
  duplicado dentro de `VttLivePage`. Usado por `VttLivePage`,
  `PlayerCampaignHomePage` e `VttPage` (console do GM).
- `PlayerCampaignHomePage`: WebSocket é o canal PRIMÁRIO agora — ao
  receber `HANDOUT_REVEALED`/`HANDOUT_HIDDEN` a UI atualiza
  imediatamente; o poll de 8s virou fallback puro, só ativo quando
  `!wsConnected` (nunca mais o caminho normal).
- Achado real corrigido nesta rodada: `VttPage` (console do GM) tinha
  ZERO assinatura de realtime — construída sob premissa explícita de
  único GM ("já vê suas próprias mudanças via estado local"), premissa
  que ficou falsa com o Multi-GM (Owner não via as mudanças ao vivo de
  um Co-GM sem recarregar a página manualmente, e vice-versa). Agora usa
  o mesmo `useCampaignRealtime`: qualquer `STATE` recarrega a lista de
  cenas e o detalhe da cena expandida.
- Cleanup do socket (unmount/reconnect sem acumular listeners) é
  garantido pelo próprio `useEffect` de retorno do hook (mesmo padrão já
  provado em `VttLivePage`); teste de integração DEDICADO provando
  ausência de acúmulo de listeners ainda não foi escrito (pendência
  genuína, Seção 9).

---

## 2. O que ainda falta (genuíno, não escondido)

| Item do pedido | Seção | Status | Observação |
|---|---|---|---|
| Multi-GM (Owner + Co-GM) | 10-11 (implementado como BATCH23/F-036) | `DONE` | `campaign_co_gms` + autorização centralizada (VTT completo, handout reveal/hide, membros, sessões) + convite via fluxo social existente + revogação Owner-only + descoberta na listagem de Campaigns + 6 testes (matriz de segurança completa + realtime com 2 GMs reais). Escopo NÃO coberto nesta rodada, documentado: edição da ESTRUTURA da Adventure (scenes/encounters/handout content, distinto de reveal/hide) continua Owner-only — estender exigiria mudar a semântica single-owner de Vault Entity, mudança arquitetural maior fora de escopo. |
| QA funcional de Player View integrada | 12 | `NOT_RE-AUDITED` | F-033 permanece `DONE` da implementação original; nenhuma auditoria FRESCA foi rodada nesta rodada além do que os testes de restore tocam incidentalmente. |
| QA funcional de GM View integrada | 13 | `NOT_RE-AUDITED` | Idem, F-034. |
| One-Shot E2E completo (desktop+mobile) | 14 | `NOT_RE-VALIDATED` | Corrigido em rodada anterior (discoverability); não reexecutado nesta rodada. |
| Social E2E completo (jornada com 2 contas) | 15 | `PARTIAL` | Restore de Social testado; a jornada completa (pedido→aceite→biblioteca compartilhada→convite→aceite→notificação→bloqueio→remoção) não foi executada como E2E de UI nesta rodada. |
| Character Sheet E2E completo | 16 | `NOT_STARTED` (nesta rodada) | Restore de Sheets testado via integration; fluxo completo com PDF fixture não foi executado. |
| Adventure full flow E2E | 17 | `PARTIAL` | Restore testado via integration; fluxo completo via UI real (criar→revelar→Player recebe) não foi executado como E2E. |
| VTT full session multi-contexto (GM-A/GM-B/Player/Outsider) | 18 | `PARTIAL` | Multi-GM já existe (F-036); `tests/integration/multi-gm.test.ts` já cobre 2 GMs reais + Player + Outsider em realtime (WebSocket real via Durable Object) no nível de integração/HTTP. Falta a versão Playwright E2E com 4 browser contexts reais de UI (fixture/mapa/tokens/fog/combate/handout/reconnect ponta a ponta). |
| Load test formal Zero-Cost | 19 | `DONE` | `tests/integration/vtt-load-test.test.ts` — 3 cenários reais (1 GM+4P, 1 GM+8P, 2 GMs+8P) contra o Worker local, contagens reais e determinísticas de HTTP/D1 writes/DO notifications/WS messages. CPU/memória não são instrumentáveis deste harness (limitação honesta, documentada — não medição fabricada). Projeção de capacidade conservadora em `docs/architecture/VTT_LOAD_TEST.md`. |
| Proteção de Free-tier (rate limits) | 20 | `DONE` | `VTT_ACTION_RATE_LIMITER` (90/60s, toda ação de VTT) + `VTT_CONNECT_RATE_LIMITER` (20/60s, reconnect burst) + máximo de 20 conexões WebSocket simultâneas por sala (Durable Object). Testado em `tests/integration/vtt-rate-limits.test.ts` (os 429 disparam de verdade, não é só configuração sem aplicação). |
| Busca de "parciais escondidos" (TODO/FIXME/etc.) | 22 | `DONE` | Varredura real em `src/` (regex TODO/FIXME/HACK/TEMP/PARTIAL/NOT_STARTED/coming soon/placeholder/stub, case-insensitive) — zero achados de categoria C (funcionalidade planejada incompleta). Todos os matches são categoria A: `placeholder` de formulário HTML, `Partial<T>` do TypeScript, `NOT_STARTED` como valor de enum legítimo (`ReadingStatus`), a palavra portuguesa "todo/toda" (= "every/all") capturada por coincidência léxica. `docs/audit/*` e `docs/product/RPG_MANAGER_1_0_SCOPE.md` têm `OUT_OF_SCOPE_1_0` — historicamente precisos (marcam a fronteira real da versão 1.0, hoje superada por F-020+; são registros datados, não afirmações de estado atual, então não são OBSOLETE_DOC). |
| Auditoria de botões mortos (crawler Playwright) | 23 | `NOT_STARTED` | |
| Responsivo (1440/1024/768/390/375) | 24 | `NOT_RE-AUDITED` | UI nova desta rodada (Configurações → Arquivos anexados) usa os mesmos componentes/classes já responsivos do resto de Configurações, mas não foi verificada visualmente em cada breakpoint. |
| Temas (Light/Dark/System) | 25 | `NOT_RE-AUDITED` | Idem — sem tokens hardcoded novos, mas sem verificação visual dedicada. |
| Acessibilidade | 26 | `NOT_RE-AUDITED` | |
| Segurança — reauditoria completa | 27 | `DONE` (escopo: superfície nova + invariantes sistêmicos) | `docs/audit/SECURITY_REAUDIT_BATCH23.md` — checklist executado (não só texto): SQLi (varredura de toda interpolação SQL do server), XSS (zero `dangerouslySetInnerHTML`), CSRF (middleware confirmado em toda rota nova), mass assignment, IDOR/multi-tenant, Player vs GM, Co-GM vs Owner, WebSocket auth/spoofing, fog/hidden tokens, handouts privados, social privacy, sheet/asset/backup ownership, SSRF, magic bytes, rate limiting — todos com teste de integração citado que já prova o comportamento. Não é uma auditoria de penetração linha a linha das ~90 rotas do produto inteiro — é a superfície NOVA desta rodada (onde uma regressão teria mais chance) + os invariantes centrais que sustentam o resto. |

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
