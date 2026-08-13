# API de Worlds e Vault

Todas as rotas usam o prefixo `/api/v1`, sessão válida e CSRF nos métodos mutáveis. IDs inacessíveis retornam `404`; validações retornam `422`; dependências que impedem exclusão retornam `409`.

## Worlds

- `GET /worlds`: `search`, `archive=active|archived|all`, `sort=recent|name|oldest`, `page`, `pageSize`.
- `POST /worlds`: cria World e membership `OWNER`.
- `GET /worlds/:id`: detalhe, contagens autorizadas, conteúdo recente e membros para owner.
- `GET /worlds/:id/entities`: lista paginada autorizada de entidades ativas.
- `PATCH /worlds/:id`: owner atualiza nome, descrição, RPG padrão e visibility.
- `POST /worlds/:id/archive` / `restore`: arquivamento não destrutivo.
- `DELETE /worlds/:id`: permitido apenas sem entidades.
- `POST /worlds/:id/members` / `DELETE /worlds/:id/members/:userId`: viewers explícitos.

## Vault

- `GET /vault`: busca paginada no servidor por `search`, `type`, `worldId`, `visibility`, `archive` e `sort`.
- `GET /vault/metadata`: opções do owner para formulários, sem conteúdo de entidades.
- `POST /vault`: cria um dos 11 tipos; `worldId` é opcional.
- `GET /vault/:id`: retorna somente quando `canViewEntity` autoriza.
- `PATCH /vault/:id`: owner atualiza campos permitidos; entidade arquivada deve ser restaurada antes.
- `POST /vault/:id/archive` / `restore`: somente owner.
- `GET /preferences`: retorna a preferência visual da conta.
- `PATCH /preferences`: persiste `LIGHT`, `DARK` ou `SYSTEM` com CSRF e isolamento por usuário.
- `DELETE /vault/:id`: bloqueia quando existem campanha principal, vínculo ou Location filha.

O body de entidade aceita apenas `entityType`, campos comuns e extensões compatíveis (`adventure`, `lore`, `character`, `npc`, `creature`, `faction` e `item`). `ownerUserId`, roles, timestamps e metadados de segurança são rejeitados. Campos de outro tipo também são rejeitados.

## Campos especializados e Bestiário

- `GET /bestiary/worlds/:worldId/templates`: lista modelos para leitores autorizados do World.
- `POST /bestiary/worlds/:worldId/templates`: owner cria modelo com campos tipados.
- `PATCH /bestiary/templates/:id`: owner altera nome, descrição e campos compatíveis com blocos existentes.
- `DELETE /bestiary/templates/:id`: owner remove somente modelo sem uso.

`creature.statBlock` contém `templateId` e valores por chave. O servidor valida World, owner, campos obrigatórios e tipos. Respostas de NPC, Faction e Item omitem `gmNotes` quando o leitor não é owner nem narrador autorizado.

## World ativo e conhecimento V2.1

- `GET /preferences/active-world`: retorna o World ativo somente se ele ainda estiver acessível e não arquivado.
- `PATCH /preferences/active-world`: troca ou limpa o World ativo após autorização no servidor.
- `GET /knowledge/:worldId`: Wiki paginada com filtros `search`, `type`, `folderId` e `tagId`. Retorna apenas entidades autorizadas.
- `POST|PATCH|DELETE /knowledge/:worldId/folders`: estrutura editorial gerenciada pelo owner.
- `POST|DELETE /knowledge/:worldId/tags`: vocabulário de tags do World gerenciado pelo owner.
- `PATCH /knowledge/:worldId/entities/:entityId`: associa pasta, tags e aliases à mesma entidade do Vault.
- `GET /knowledge/:worldId/entities/:entityId/backlinks`: menções editoriais derivadas de `[[nome ou alias]]`; não cria relações semânticas.
- `GET /journal/:worldId`: páginas e pastas privadas do narrador.
- `POST|PATCH|DELETE /journal/:worldId/folders`: organização privada; somente owner.
- `POST|PATCH|DELETE /journal/:worldId/pages`: preparação privada; somente owner.
- `GET|POST /world-invites/:worldId`: lista e cria convites como owner.
- `DELETE /world-invites/:worldId/:inviteId`: revoga convite.
- `POST /world-invites/accept/:token`: aceite autenticado e idempotente; o segredo é comparado pelo hash.
- `GET /search?q=...&worldId=...`: busca agrupada em entidades, Worlds, campanhas, grupos, RPGs e Diário; `worldId` é opcional.

Pastas, tags e aliases são metadados editoriais e nunca concedem acesso. O Portal do jogador usa `GET /knowledge/:worldId`, portanto não possui um caminho alternativo que ignore as permissões do Vault.

## Timeline e Calendar

- `GET /timeline/worlds/:worldId`: lista EVENTs autorizados, eras e calendário; aceita `search`, `eraId` e `precision`.
- `POST /timeline/worlds/:worldId/eras`: cria uma era ordenável do World.
- `PATCH /timeline/eras/:eraId`: atualiza nome, descrição e ordem.
- `DELETE /timeline/eras/:eraId`: arquiva uma era sem uso.
- `PUT /timeline/worlds/:worldId/calendar`: cria ou substitui a definição validada de meses, dias da semana, ciclos e feriados.
- `PATCH /timeline/events/:entityId`: associa ordem histórica, precisão, era e data fictícia a uma entidade EVENT existente.

`sortKey` é inteiro e não representa timestamp. Anos negativos, meses variáveis e eras não gregorianas são aceitos. O backend bloqueia dias inexistentes, referências cross-world e alterações do calendário que invalidariam eventos. Datas de sessão (`played_at`) permanecem independentes.

## Campanhas

- `adventureEntityId` é opcional no create/update de campanha.
- `POST /campaigns/:campaignId/entities/:entityId` cria ou atualiza vínculo com `usageType=REFERENCE|ACTIVE`.
- `DELETE /campaigns/:campaignId/entities/:entityId` remove vínculo, exceto Adventure principal.
- `GET /campaigns/:id` inclui `entities` e a Adventure principal, sem alterar campanhas V1.

## Relations e Graph V2.2

- `GET /relations/worlds/:worldId`: retorna nós e relações já filtrados no servidor. Aceita `search`, `type`, `archive` e `includeDisconnected`.
- `POST /relations/worlds/:worldId`: owner conecta duas entidades ativas do mesmo World e proprietário.
- `PATCH /relations/:relationId`: owner edita tipo, rótulo, descrição, direção, visibilidade e força.
- `DELETE /relations/:relationId`: arquivamento não destrutivo da relação.
- `POST /relations/:relationId/restore`: restaura quando não existe uma aresta ativa equivalente.
- `GET /relations/worlds/:worldId/genealogy`: projeção autorizada de `PARENT`, `CHILD`, `SIBLING` e `PARTNER`.

Relações bidirecionais têm as pontas canonizadas para impedir duplicidade invertida. `CUSTOM` exige rótulo. `PARENT`/`CHILD` são direcionadas; `SIBLING`/`PARTNER` são bidirecionais. A API bloqueia self-reference, cross-world, cross-user, duplicidade e pares parentais inconsistentes.

## Visibilidade

O predicado de autorização é aplicado antes de `COUNT`, `LIMIT` e `OFFSET`. Assim, paginação e contagens não revelam entidades inacessíveis. O contrato completo está no [ADR-005](../architecture/ADR-005-content-permissions.md).
