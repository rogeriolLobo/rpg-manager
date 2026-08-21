# RPG Manager — Auditoria de Superfície e Descoberta do Produto

**Status:** implementado na branch `feature/product-surface-discoverability`; a declaração
`RPG MANAGER — PRODUCT_SURFACE_COMPLETE` depende de CI, merge, deploy e smoke de produção.

Esta é a fonte da verdade para descoberta humana das rotas autenticadas. Uma rota é
`descobrível` quando existe um caminho visível e coerente a partir da aplicação, sem depender de
URL digitada, conhecimento interno ou documentação técnica. A contagem considera desktop; no
mobile, o primeiro toque abre o menu sem alterar a hierarquia.

## Inventário de rotas protegidas

| Funcionalidade | Rota protegida | Classe | Entrada humana principal | Contexto exigido | Cliques | Descobrível | Evidência E2E | Observação |
|---|---|---|---|---|---:|---|---|---|
| Painel | `/app` | global | Logo / Painel | nenhum | 1 | sim | `product-discoverability.spec.ts` | Hub inicial e acesso rápido |
| Biblioteca | `/app/library` | global | Sidebar / acesso rápido / Ctrl+K | nenhum | 1 | sim | `product-discoverability.spec.ts` | RPGs do usuário |
| Novo RPG | `/app/library/new` | interna | CTA da Biblioteca | Biblioteca | 2 | sim | `library-crud.spec.ts` | Fluxo de criação |
| RPG | `/app/library/:id` | contextual | Card da Biblioteca | RPG | 2 | sim | `library-crud.spec.ts` | Detalhe |
| Editar RPG | `/app/library/:id/edit` | interna | Ação do detalhe | RPG | 3 | sim | `library-crud.spec.ts` | Edição |
| Grupos | `/app/groups` | global | Sidebar / Ctrl+K | nenhum | 1 | sim | `social-groups.spec.ts` | Organização social |
| Novo grupo | `/app/groups/new` | interna | CTA de Grupos | Grupos | 2 | sim | `social-groups.spec.ts` | Criação |
| Grupo | `/app/groups/:id` | contextual | Card de Grupos | grupo | 2 | sim | `social-groups.spec.ts` | Detalhe |
| Editar grupo | `/app/groups/:id/edit` | interna | Ação do detalhe | grupo | 3 | sim | `social-groups.spec.ts` | Edição |
| Mundos | `/app/worlds` | global | Sidebar / acesso rápido / Ctrl+K | nenhum | 1 | sim | `product-discoverability.spec.ts` | Seletor de contexto |
| Novo mundo | `/app/worlds/new` | interna | CTA de Mundos | Mundos | 2 | sim | `worlds.spec.ts` | Criação |
| Mundo | `/app/worlds/:id` | contextual | Card de Mundos | mundo | 2 | sim | `product-discoverability.spec.ts` | Ativa a navegação do mundo |
| Editar mundo | `/app/worlds/:id/edit` | interna | Ação do detalhe | mundo | 3 | sim | `worlds.spec.ts` | Edição |
| Wiki | `/app/worlds/:id/wiki` | contextual | Sidebar do mundo / Ctrl+K | mundo ativo | 1 | sim | `product-discoverability.spec.ts` | Conteúdo principal do mundo |
| Diário | `/app/worlds/:id/journal` | contextual | Sidebar do mundo / Ctrl+K | mundo proprietário | 1 | sim | `world-journal.spec.ts` | Restrito ao proprietário |
| Recursos externos | `/app/worlds/:id/resources` | contextual | Sidebar do mundo / Ctrl+K | mundo ativo | 1 | sim | `world-resources.spec.ts` | Links e referências |
| Cartografia | `/app/worlds/:id/cartography` | contextual | Sidebar do mundo / Ctrl+K | mundo ativo | 1 | sim | `product-discoverability.spec.ts` | Mapas do mundo |
| Mapa | `/app/worlds/:id/cartography/:mapId` | interna | Card de Cartografia | mapa | 2 | sim | `world-cartography.spec.ts` | Detalhe do mapa |
| Portal público | `/app/worlds/:id/portal` | contextual | Sidebar do mundo / Ctrl+K | mundo ativo | 1 | sim | `world-portal.spec.ts` | Prévia autenticada do portal |
| Relações | `/app/worlds/:id/relations` | contextual | Sidebar do mundo / Ctrl+K | mundo ativo | 1 | sim | `product-discoverability.spec.ts` | Grafo de relações |
| Linha do tempo | `/app/worlds/:id/timeline` | contextual | Sidebar do mundo / Ctrl+K | mundo ativo | 1 | sim | `product-discoverability.spec.ts` | Cronologia |
| Bestiário | `/app/worlds/:id/bestiary` | contextual | Sidebar do mundo / Ctrl+K | mundo ativo | 1 | sim | `product-discoverability.spec.ts` | Criaturas |
| Vault | `/app/vault` | global | Sidebar / acesso rápido / Ctrl+K | nenhum | 1 | sim | `product-discoverability.spec.ts` | Fonte canônica de conteúdo |
| Nova entidade | `/app/vault/new` | interna | CTA do Vault ou Compêndio | Vault | 2 | sim | `vault-crud.spec.ts` | Aceita retorno ao Campaign Hub |
| Entidade | `/app/vault/:id` | contextual | Card do Vault | entidade | 2 | sim | `vault-crud.spec.ts` | Detalhe |
| Editar entidade | `/app/vault/:id/edit` | interna | Ação do detalhe | entidade | 3 | sim | `vault-crud.spec.ts` | Edição |
| Ficha da entidade | `/app/vault/:id/sheet` | contextual | Ação do detalhe / mesa do jogador | entidade | 3 | sim | `product-discoverability.spec.ts` | Ficha preenchida |
| Fichas | `/app/sheets` | global | Sidebar / acesso rápido / Ctrl+K | nenhum | 1 | sim | `product-discoverability.spec.ts` | Modelos globais, com empty state |
| Preparar Adventure | `/app/vault/:id/adventure` | contextual | Entidade Adventure / Campaign Hub | Adventure | 2 | sim | `adventure-flow.spec.ts` | Preparação sem segundo sistema |
| Compêndio | `/app/compendium` | global | Sidebar / acesso rápido / Ctrl+K | nenhum | 1 | sim | `product-discoverability.spec.ts` | Projeção de leitura do Vault |
| Campanhas | `/app/campaigns` | global | Sidebar / acesso rápido / Ctrl+K | nenhum | 1 | sim | `product-discoverability.spec.ts` | Cards expõem campanha e Mesa do Mestre |
| Nova campanha | `/app/campaigns/new` | interna | CTA de Campanhas | RPG | 2 | sim | `campaigns.spec.ts` | Criação |
| Campaign Hub | `/app/campaigns/:id` | contextual | Card de Campanhas | campanha | 2 | sim | `product-discoverability.spec.ts` | Preparação, mesa, jogadores e histórico |
| Editar campanha | `/app/campaigns/:id/edit` | interna | Ação do Campaign Hub | campanha | 3 | sim | `product-discoverability.spec.ts` | Vincula Adventure criada ou existente |
| Nova sessão | `/app/campaigns/:id/sessions/new` | interna | CTA do Campaign Hub | campanha | 3 | sim | `campaigns.spec.ts` | Planejamento |
| Sessão | `/app/campaigns/:id/sessions/:sessionId` | contextual | Histórico do Campaign Hub | sessão | 3 | sim | `campaigns.spec.ts` | Detalhe |
| Editar sessão | `/app/campaigns/:id/sessions/:sessionId/edit` | interna | Ação da sessão | sessão | 4 | sim | `campaigns.spec.ts` | Edição |
| Mesa do Mestre | `/app/campaigns/:id/vtt` | contextual | Card / Campaign Hub / Dashboard | campanha | 2 | sim | `product-discoverability.spec.ts` | Nome de produto; VTT é descritor secundário |
| Mesa ao vivo | `/app/campaigns/:id/vtt/live` | contextual | CTA da Mesa do Mestre | cena ativa | 3 | sim | `vtt-multigm.spec.ts` | Experiência em tempo real |
| Minhas Mesas | `/app/my-tables` | global | Sidebar / acesso rápido / Ctrl+K | nenhum | 1 | sim | `product-discoverability.spec.ts` | Visão do jogador |
| Mesa do jogador | `/app/my-tables/:id` | contextual | Card de Minhas Mesas | participação | 2 | sim | `product-discoverability.spec.ts` | Personagem, ficha, handouts e entrada na mesa |
| Ferramentas do Mestre | `/app/gm-tools` | global | Sidebar / Ctrl+K | nenhum | 1 | sim | `gm-tools.spec.ts` | Dados, timer e utilitários |
| Amigos | `/app/friends` | global | Sidebar / Ctrl+K | nenhum | 1 | sim | `social-groups.spec.ts` | Rede social |
| Biblioteca de amigo | `/app/friends/:userId/library` | contextual | Perfil na lista de Amigos | amigo | 2 | sim | `social-groups.spec.ts` | Conteúdo compartilhado |
| Configurações | `/app/settings` | sistema | Sidebar / Ctrl+K | nenhum | 1 | sim | `product-discoverability.spec.ts` | Backup, restore e anexos |
| Importação | `/app/settings/import` | interna | Ação de Configurações | arquivo | 2 | sim | `settings-import.spec.ts` | Reutiliza a superfície de configurações |
| Segurança | `/app/security` | sistema | Sidebar | nenhum | 1 | sim | `security.spec.ts` | Sessões e conta |
| Perfil | `/app/profile` | sistema | Sidebar | nenhum | 1 | sim | `profile.spec.ts` | Identidade do usuário |

## Decisões de IA e nomenclatura

- `Biblioteca e conteúdo` reúne Biblioteca, Vault, Compêndio e Fichas.
- `Mesas` reúne Campanhas, Minhas Mesas, Grupos e Amigos.
- `Mundos` ativa uma segunda navegação contextual para as ferramentas do mundo selecionado.
- `Mesa do Mestre` é o nome humano; `VTT` aparece apenas como descritor técnico secundário.
- `Adventure` continua sendo uma entidade do Vault. O Campaign Hub cria e vincula a mesma entidade,
  sem duplicar modelo, contrato ou persistência.
- Detalhes, formulários e rotas com identificador são contextuais ou internas; não poluem a sidebar,
  mas possuem CTA visível a partir da lista ou do hub correspondente.

## Critério de conclusão

Esta auditoria só autoriza a declaração final depois de: gates locais verdes, E2E de descoberta
verde, CI remoto verde, merge em `main`, deploy e `/api/v1/version` confirmando o commit publicado.
