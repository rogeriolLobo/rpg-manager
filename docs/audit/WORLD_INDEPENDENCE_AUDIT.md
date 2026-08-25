# World Independence Audit

## Visão Geral
Este documento mapeia os recursos que atualmente dependem do modelo `World` e categoriza se a dependência é intrínseca à natureza do recurso ou se é puramente um acoplamento acidental que deve ser desfeito, focando em uma arquitetura **User-First / World-Optional**.

## Tabela de Auditoria

| DOMAIN | RESOURCE | CURRENT_DEPENDENCY | INTRINSIC_OR_ACCIDENTAL | DESIRED_MODEL | DATABASE_CHANGE | BACKEND_CHANGE | FRONTEND_CHANGE | AUTH_CHANGE | BACKUP_CHANGE | TEST_CHANGE | RISK | STATUS |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Journal** | `journal_folders` | `world_id` FK (NOT NULL, CASCADE) | ACCIDENTAL_WORLD_DEPENDENCY | `owner_user_id` FK (NOT NULL), sem ownership por World | Rebuild com `owner_user_id`; IDs, hierarquia e timestamps preservados | API não exige `worldId`, usa UUID da pasta | Rotas independentes de `/app/worlds/:id` | Autorização por `owner_user_id` | Backup/restore independente de World | Migration real + integração/E2E | Low | IMPLEMENTADO |
| **Journal** | `journal_pages` | `world_id` FK (NOT NULL, CASCADE) | ACCIDENTAL_WORLD_DEPENDENCY | `owner_user_id` FK (NOT NULL) + N:N em `journal_page_world_links` | Rebuild + backfill de um link legado por página | API User-First; `POST/DELETE /journal/pages/:pageId/worlds/:worldId` gerencia contexto | UI global funciona sem active World e permite múltiplos links | Página por `owner_user_id`; link não amplia autorização | Round-trip cobre zero, um e dois Worlds | Migration real + integração/E2E | Low | IMPLEMENTADO |
| **Vault** | `entities` | `world_id` FK (NULLable) | INTRINSIC_WORLD_DEPENDENCY | Entities podem existir no sistema / library. | - | - | - | - | - | - | Low | PENDENTE |
| **Vault** | `creature_stat_templates` | `world_id` FK (NOT NULL, CASCADE) | INTRINSIC_WORLD_DEPENDENCY | Pertence primariamente ao World/System. | - | - | - | - | - | - | Low | PENDENTE |
| **Character** | Fichas (Sheets) | Depende de Campaign/World? | ACCIDENTAL_WORLD_DEPENDENCY | Pertence ao Jogador (`owner_user_id`). | Revisar FKs de Fichas. | API baseada no User. | Central de Fichas (Global). | Auth via `owner_user_id`. | - | - | Med | PENDENTE |

*(Esta tabela continuará a ser populada conforme a exploração de Track B avançar em novos vertical slices.)*
