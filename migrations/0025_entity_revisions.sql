-- F-001: Revision History. Puramente aditiva — nenhuma tabela existente é
-- alterada, nenhum DROP/RENAME (ver docs/architecture/DATABASE_MIGRATION_SAFETY.md).
--
-- Um snapshot por revisão (não diff): mais simples, mais barato de restaurar,
-- sem risco de acumular erro de reconstrução — decisão registrada em
-- docs/product/RPG_MANAGER_FINAL_STATUS.md (seção F-001). `resource_type`
-- cobre os três recursos de conteúdo autoral priorizados (vault_entities,
-- journal_pages, worlds); Timeline/Relations/Maps/External Resources ficam
-- deliberadamente fora do v1 (ver mesmo doc).
--
-- Sem FK física de resource_id -> tabela específica (resource_type varia
-- entre 3 tabelas — SQLite não suporta FK condicional). Autorização de
-- leitura/restore NUNCA confia em owner_user_id desta tabela: sempre
-- revalida contra o dono ATUAL do recurso vivo (mesmas funções
-- ownedEntity/ownedWorld já usadas por PATCH) — ver src/server/content/revisions.ts.
-- owner_user_id aqui é só desnormalizado para indexação/consulta.
CREATE TABLE entity_revisions (
  id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('VAULT_ENTITY','JOURNAL_PAGE','WORLD')),
  resource_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('CREATE','UPDATE','RESTORE')),
  revision_number INTEGER NOT NULL CHECK(revision_number > 0),
  -- Sempre o payload validado (mesmo shape do input de create/update) — nunca
  -- senha/token/segredo/dado de sessão (não existe campo desse tipo nesses
  -- três recursos; o schema de validação já rejeitaria campos extras por ser
  -- z.strictObject). 300000 é generoso o bastante para o maior conteúdo
  -- possível hoje (journal_pages.content, até 100000 chars) mais folga para
  -- escaping JSON.
  snapshot TEXT NOT NULL CHECK(length(snapshot) <= 300000),
  restored_from_revision_number INTEGER,
  created_at TEXT NOT NULL
);
-- Único por (resource, revision_number): a próxima revisão é sempre
-- MAX(revision_number)+1 calculado na mesma instrução de INSERT (sem
-- read-then-write, sem race).
CREATE UNIQUE INDEX idx_entity_revisions_resource_number ON entity_revisions(resource_type, resource_id, revision_number);
CREATE INDEX idx_entity_revisions_resource_recent ON entity_revisions(resource_type, resource_id, created_at DESC);
CREATE INDEX idx_entity_revisions_owner ON entity_revisions(owner_user_id, created_at DESC);
