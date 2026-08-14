# RPG Manager 1.0 — Escopo

Fonte: auditoria real em `docs/audit/RPG_MANAGER_1_0_MATRIX.md` e
`docs/audit/WORLDCRAFT_GAP_MATRIX.md` (2026-08-14).

## Dentro do 1.0 (auditado como COMPLETE ou PARTIAL com plano de fechamento)

CORE: Dashboard, Library, Groups, Campaigns, Sessions.
WORLD: Worlds, Active World (contexto), Vault (Characters/NPCs/Creatures/
Locations/Factions/Items/Lore/Adventures), Events (Timeline).
KNOWLEDGE: Wiki, Journal, Global Search, Command Palette.
RELATIONS: Relations, Graph, Genealogy (mesmo motor de Relations).
TIME: Timeline, World Calendar.
CONTENT: Bestiary, campos especializados por tipo de entidade.
COLLAB: Invites, Player Portal.
SYSTEM: Autenticação, Permissões (PRIVATE/GROUP/CAMPAIGN/PLAYERS/GM_ONLY,
aplicadas no servidor), Tema (Light/Dark/System), Desktop/Mobile.

## Deliberadamente fora do 1.0 (`OUT_OF_SCOPE_1_0`)

- **VTT** — realtime/WebSocket incompatível com Zero Cost neste estágio.
- **Sheets (motor de ficha completo)** — evitar ficha genérica ruim só
  para marcar como implementada; o Vault já cobre campos especializados
  simples.
- **Social/Amizades** — decisão explícita do responsável do produto,
  próxima fase.
- **GM Tools** (dice roller, timer, quick notes) — não obrigatório;
  candidato de baixo risco para uma sessão futura pequena e isolada.
- **Cartography** (mapas/pins) — desenho zero-cost viável e documentado
  em `WORLDCRAFT_GAP_MATRIX.md`, mas não implementado nesta sessão:
  requer migration + rotas + autorização + UI + testes novos, e merece
  uma sessão dedicada com o mesmo rigor do restante do produto.
- **External Resources / Files** — mesma razão que Cartography.
- **Revision History** (`entity_revisions`) — mesma razão; nenhuma
  migration, rota ou UI existe hoje.
- **Ideas / Quick Capture** — o Journal já cobre o domínio; não criar
  módulo novo, só um atalho de UX futuro.
- **Compendium** (view agregada read-only) — Vault + Bestiary já
  navegam por tipo de entidade; ganho incerto de uma tela agregada nova.

## Política de custo

Ver `docs/architecture/ZERO_COST_POLICY.md`. Nenhuma feature do 1.0 usa
R2, Workers Paid, storage pago, API paga ou qualquer serviço com
cobrança automática.

## Gaps de qualidade identificados e ação

1. Convites de World não tinham teste de integração dedicado — corrigido
   nesta sessão (`tests/integration/vault-and-worlds.test.ts`, cobre
   aceite, idempotência, limite de usos, expiração e revogação).
2. Global Search sem teste de integração dedicado — permanece como
   ação futura (P2, não bloqueador).
3. Auditoria de UX tela-a-tela (light/dark, mobile, empty states,
   confirmação de exclusão) não foi feita em profundidade nesta sessão
   — as telas reutilizam componentes/tokens já theme-aware e
   responsivos por padrão, mas uma passada manual dedicada não foi
   executada.
