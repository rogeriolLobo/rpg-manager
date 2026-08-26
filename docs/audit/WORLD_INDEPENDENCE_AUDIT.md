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

## Evidência do vertical slice Journal

- **Migration test:** aplica migrations 0001–0041, insere um Journal legado real e executa 0042; compara IDs, pastas, páginas, conteúdo e timestamps, valida backfill de owner, links, zero órfãos e `PRAGMA foreign_key_check` vazio.
- **Integration:** cobre criação atômica, N:N, Player em World acessível, isolamento direto de owner, DELETE legado, exclusão de World preservando página, busca global/filtrada e backup/restore v9/v10.
- **E2E:** cobre criação sem World, pasta global, empty state, Quick Idea, um/dois links, unlink preservando página, navegação por busca e Revision History nos projetos desktop/mobile.
- **Backup test:** o round-trip v10 cobre Journal sem World, com um World e com dois Worlds; o fixture v9 normaliza `journal_pages.world_id`/`journal_folders.world_id` para owner + link v10.

## Release gate da migration 0042

`0042_journal_user_first.sql` é `DATA_MIGRATION_HIGH_ATTENTION`. Ela não deve ser executada em produção como parte desta PR e exige aprovação humana em uma release futura. O gate operacional obrigatório é:

1. gerar e verificar backup do D1;
2. registrar counts de `journal_folders`, `journal_pages` e vínculos antes da migration;
3. executar precheck de órfãos e foreign keys;
4. aplicar a migration 0042;
5. comparar counts depois da migration e confirmar um link por página legada;
6. exigir `PRAGMA foreign_key_check` com zero linhas;
7. fazer smoke do Journal legado, Journal global e links com Worlds.
