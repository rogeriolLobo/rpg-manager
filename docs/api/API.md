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

O body de entidade aceita apenas `entityType`, `name`, `summary`, `description`, `visibility`, `worldId`, `groupId`, `parentEntityId` e `adventure`. `ownerUserId`, roles, timestamps e metadados de segurança são rejeitados.

## Campanhas

- `adventureEntityId` é opcional no create/update de campanha.
- `POST /campaigns/:campaignId/entities/:entityId` cria ou atualiza vínculo com `usageType=REFERENCE|ACTIVE`.
- `DELETE /campaigns/:campaignId/entities/:entityId` remove vínculo, exceto Adventure principal.
- `GET /campaigns/:id` inclui `entities` e a Adventure principal, sem alterar campanhas V1.

## Visibilidade

O predicado de autorização é aplicado antes de `COUNT`, `LIMIT` e `OFFSET`. Assim, paginação e contagens não revelam entidades inacessíveis. O contrato completo está no [ADR-005](../architecture/ADR-005-content-permissions.md).
