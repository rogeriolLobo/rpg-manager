# RPG Manager — Roadmap Completo Planejado

Auditoria de todo o roadmap real (não inventado) a partir de:
`docs/product/MASTER_BACKLOG.md`, `docs/product/RPG_MANAGER_FINAL_STATUS.md`,
`docs/audit/RPG_MANAGER_1_0_MATRIX.md`, `docs/audit/WORLDCRAFT_GAP_MATRIX.md`,
`.claude/CLAUDE.md` (seções 25–33), migrations e código atual.

Correção de direção do responsável do produto (2026-08-19): o congelamento
pós-1.0 está revogado. Meta agora: `RPG MANAGER — PLANNED_ROADMAP_COMPLETE`.
Itens abaixo que estavam listados como `OUT_OF_SCOPE_1_0` (Social, Sheets,
VTT) eram deliberadamente adiados **até a estabilização do 1.0** — não
cancelados. O 1.0 está estabilizado (`RPG_MANAGER_FINAL_STATUS.md`), então
esses itens voltam ao backlog ativo aqui.

IDs seguem a sequência já usada em `MASTER_BACKLOG.md` (F-001..F-015).

## Já concluído (F-001 a F-015, não refazer)

| ID | Feature | Status |
|---|---|---|
| F-001 | Revision History (Vault/Journal/Worlds) | `DONE` (BATCH5) |
| F-002 | Cartografia zero-cost (mapas/pins) | `DONE` (BATCH3) |
| F-003 | External Resources | `DONE` (BATCH2) |
| F-004 | GM Tools (dados, timer) | `DONE` (BATCH3) |
| F-005 | Ideas / Quick Capture | `DONE` (BATCH2) |
| F-006 a F-014 | (busca, invites, quests/handouts via Vault, compendium via Vault, split de domínio Library, capa+KV, Open Library, dedup ISBN, archive) | `DONE` |
| F-015 | Backup/Restore JSON completo | `DONE` (BATCH6) — export v8 completo; restore v1 cobre Worlds/Creature Stat Templates/Vault/Journal, resto exportado sem restore automatizado ainda |

## Roadmap planejado ainda não iniciado

| ID | FEATURE | STATUS_ATUAL | PLANEJADA? | DEPENDÊNCIAS | RISCO | MIGRATION? | BACKEND | FRONTEND | TESTES | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|
| F-015 | Backup/Restore completo, versionado (`schemaVersion`) | Export v8 cobre 100% dos domínios; restore v1 cobre Worlds/Creature Stat Templates/Vault (+especializados)/Journal — Groups/Campaigns/Library/Wiki/Relations/Cartografia/External Resources/Revision History exportados, restore automatizado pendente | Sim — `CLAUDE.md` §22 do pedido original de finalização | Nenhuma (todos os domínios já existem) | Médio — mitigado: restore sempre cria registros novos, nunca sobrescreve | Não (`backup_restore_jobs`, migration 0026, aditiva) | `DONE` | `DONE` | `DONE` | `DONE` (v1 — restore do restante é item futuro, não bloqueante) |
| F-016 | Social — amizades (busca, pedido, aceitar, recusar, cancelar, remover, bloquear) | Implementado: `friend_requests`+`friendships`+`user_blocks` (migration 0027), busca reaproveita `GET /directory/users` existente (nunca expõe e-mail), pedido cruzado auto-aceita, bloquear remove amizade/pedido nos dois sentidos e impede novo pedido | Sim — `CLAUDE.md` §32 | F-015 (backup deve cobrir dados sociais desde o início — ver nota BATCH7 abaixo) | Alto — superfície de IDOR/privacidade nova, mitigada com testes dedicados | Sim — `friend_requests`,`friendships`,`user_blocks` (0027, aditiva) | `DONE` | `DONE` | `DONE` (6 integration + 2 E2E desktop/mobile) | `DONE` (BATCH7) |
| F-017 | Social + Biblioteca (visão parcial da Library de amigos, RPGs em comum, interesse social ≠ campo pessoal "Quero jogar") | Ausente | Sim — `CLAUDE.md` §32 | F-016 (`DONE`) | Alto — vazamento de notas/prioridade privadas se a política de visibilidade não for explícita | Sim — coluna/tabela de interesse social separada do campo pessoal existente | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` |
| F-018 | Social + Grupos/Campanhas (convidar amigo, propostas de mesa, guests) | Ausente | Sim — `CLAUDE.md` §32 | F-016 (`DONE`) | Médio — remoção de membro não pode apagar histórico (sessions/attendance já são append-only) | Sim — tabela de convites/propostas | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` |
| F-019 | Notificações in-app (D1, zero-cost) | Implementado para os eventos de F-016 (pedido recebido, pedido aceito); `notifications` com `kind CHECK` fechado — adicionar eventos de F-018 é migration aditiva | Sim — decorre diretamente de F-016/F-018 | F-016 (`DONE`), F-018 (pendente — eventos de convite de grupo/campanha entram quando F-018 existir) | Baixo — CRUD simples, sem realtime obrigatório | Sim — `notifications` (0027, aditiva) | `DONE` (eventos de F-016) | `DONE` (sino na sidebar + dropdown) | `DONE` | `DONE` (v1 — eventos de F-018 chegam junto com F-018) |
| F-020 | Character Sheet Engine — motor genérico + templates por sistema | Vault já cobre campos especializados simples (`specialized-entity-fields.tsx`, `creature_stat_templates`) — não é uma ficha completa | Sim — `CLAUDE.md` §31 (domínio próprio: template + campos tipados + browser renderer), adiado explicitamente, nunca cancelado | Nenhuma técnica; depende de decisão de produto sobre escopo v1 (genérica vs. templates por sistema) | Alto — "não criar ficha genérica ruim só para marcar como pronta" é regra explícita | Sim — `sheet_templates`, `sheet_fields`, `character_sheets` | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` |
| F-021 | PDF Character Sheets (AcroForm/overlay, editor de template) | Ausente | Sim — `CLAUDE.md` §31 | F-020 | Alto — risco de licenciamento (nunca redistribuir PDF oficial protegido); processamento de PDF client-side por custo zero | Não (usa tabelas de F-020 + metadata de arquivo) | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` |
| F-022 | Vault avançado — reutilização entre Worlds/Campaigns/Adventures (LINK vs COPY/FORK explícito) | Vault já é global do usuário; não tem semântica de link/fork entre contextos | Sim — `CLAUDE.md` §25 (Vault é reutilizável, entidades não morrem com a Campaign) | Nenhuma | Médio — sincronização implícita mal desenhada pode corromper dados | Provável — tabela de vínculo/fork | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` |
| F-023 | Vault system-aware (campos customizados por Game System sem tabela por RPG) | `specialized_*` tables cobrem tipos fixos (NPC/Creature/etc.), não por sistema | Sim — decorre de F-020 (mesma necessidade de campos declarativos) | F-020 (reaproveitar o motor de templates) | Médio | Provável | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` |
| F-024 | One-Shots como conceito explícito | Hoje um One-Shot só existe como Campaign com 1 sessão — sem status/campos próprios | A confirmar na auditoria de implementação — pode ser `SATISFIED_BY_EXISTING_DOMAIN` (especialização seguro de Campaign) como F-013/F-014 já foram | Nenhuma | Baixo se especialização de Campaign; médio se domínio novo | Talvez (coluna `campaigns.session_mode` em vez de tabela nova) | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` |
| F-025 | Adventures aprofundadas (acts/scenes/encounters/handouts estruturados) | Adventure já existe como Vault Entity (`adventure_details`: premise/hooks/keyScenes/rewards/notes, texto livre) | Sim — `CLAUDE.md` §26, pedido explícito de estruturar em acts/scenes/encounters | Nenhuma técnica | Médio — risco de duplicar Vault Entities (NPCs/Locations já linkáveis) se mal desenhado | Sim — tabelas de scene/encounter ligadas a `adventure_details` | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` |
| F-026 | Conteúdo oficial/licenciado (provenance, publisher, edition, read-only) | `publications` já tem provenance para catálogo (não para conteúdo de Adventure/Sheet) | Sim | F-020, F-025 | Alto — jurídico/licenciamento, nunca copiar texto protegido | Sim — colunas de provenance nas tabelas de conteúdo | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` |
| F-027 | Compendium (view agregada Creatures/Items/Lore/Spells/Adventures) | `SATISFIED_BY_EXISTING_DOMAIN` para o Vault hoje (F-014) — reavaliar só depois de F-020/F-025 adicionarem domínios novos (Sheets, Adventures estruturadas) | Condicional — só cria valor real depois de F-020/F-025 existirem | F-020, F-025 | Baixo | Não (view sobre dados existentes) | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `BLOCKED` (aguarda F-020/F-025) |
| F-028 | Files/Handouts/Assets zero-cost | External Resources (F-003) já cobre link externo; falta upload próprio pequeno (ex.: handout gerado no app) | Sim — `CLAUDE.md` §30 (nunca R2; usar KV como em `COVER_STORAGE.md`) | Nenhuma (reaproveita o padrão do KV de capas) | Médio — quota/cleanup de KV Free | Sim — tabela de metadata de asset | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` |
| F-029 | VTT — fundação (Scene/Map/tokens/permissions, sem realtime) | Cartografia (F-002) já tem `world_maps`/`map_pins` estáticos — VTT precisa de estado de sessão ao vivo, não só pins fixos | Sim — `CLAUDE.md` §29 explicitamente adiado, nunca cancelado | F-002 (reaproveitar mapas), Campaign/Session | Alto | Sim — `vtt_scenes`, `vtt_tokens` | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` |
| F-030 | VTT — fog of war / visibilidade | Ausente | Sim | F-029 | Alto — igual GM_ONLY, nunca por CSS | Sim | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` |
| F-031 | VTT — realtime (posições, iniciativa, cena) | Ausente | Sim, condicionado a arquitetura Zero Cost (ver auditoria obrigatória antes de implementar — Workers Free não tem WebSocket persistente barato em escala, ver `WORLDCRAFT_GAP_MATRIX.md`) | F-029, F-030 | Alto — é o item de maior risco técnico e de custo do roadmap inteiro | Sim | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `BLOCKED` até a auditoria de arquitetura zero-cost concluir |
| F-032 | Iniciativa/combate system-neutral | Ausente | Sim | F-029 | Médio | Sim (pode ser parte de `vtt_scenes`) | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` |
| F-033 | Player View integrada (character+sheet+handouts+VTT+notificações) | Player Portal (`WorldWikiPage portal`) já existe para Wiki; falta integrar Sheet/VTT/Notifications quando existirem | Sim — decorre de F-020/F-029/F-019 | F-019, F-020, F-029 | Médio | Não (agrega domínios existentes) | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `BLOCKED` (aguarda dependências) |
| F-034 | GM View integrada (prep de scene/mapa/tokens/fog/handout/iniciativa numa tela) | Ausente | Sim — decorre de F-029/F-030/F-032 | F-029, F-030, F-032 | Médio | Não | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `BLOCKED` (aguarda dependências) |

## Explicitamente fora do roadmap planejado (não confundir com adiamento)

Nada nesta categoria — diferente da fase 1.0, não há mais itens
"explicitamente fora do produto" além dos que já são impossíveis por
licenciamento (nunca redistribuir conteúdo oficial protegido) ou por
Zero Cost (nunca serviço pago). Esses limites não são features adiadas,
são restrições permanentes do projeto (`CLAUDE.md` §9, §18).

## Ordem de execução (dependência técnica real, não preferência)

BATCH6 F-015 (protege dados antes do resto) → BATCH7 F-016+F-017+F-018+F-019
(Social) → BATCH8 F-020 (Sheet Engine base) → BATCH9 F-021+F-023 (PDF +
system-aware) → BATCH10 F-022 (Vault avançado) → BATCH11 F-024+F-025
(One-Shots + Adventures) → BATCH12 F-026+F-027 (conteúdo oficial +
Compendium) → BATCH13 F-028 (Files/Handouts) → BATCH14 F-029+F-030
(VTT fundação + fog) → BATCH15 F-031+F-032 (realtime + combate) →
BATCH16 F-033+F-034 (Player/GM view integrada) → BATCH17 hardening final
+ F-015 revalidado cobrindo todos os domínios novos.

## Critério de conclusão

`RPG MANAGER — PLANNED_ROADMAP_COMPLETE` só quando todo item acima
estiver `DONE` ou `BLOCKED` com motivo técnico/legal/financeiro
documentado — nunca `OUT_OF_SCOPE` para itens desta lista.
