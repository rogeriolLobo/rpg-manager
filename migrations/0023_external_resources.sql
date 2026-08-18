-- F-003: External Resources — referência externa (link HTTPS) zero-cost, escopada por World.
-- Tabela nova, aditiva, sem nenhuma FK de entrada (nenhuma outra tabela referencia
-- external_resources.id) — nenhum risco de rebuild, ver
-- docs/architecture/DATABASE_MIGRATION_SAFETY.md e src/server/routes/external-resources.ts
-- para a justificativa de não ser um Vault Entity (vault_entities.entity_type tem CHECK
-- fechado, e é a tabela mais referenciada por FK do produto).
CREATE TABLE external_resources (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  url TEXT NOT NULL CHECK(length(url) <= 2000),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 2000),
  resource_type TEXT NOT NULL CHECK(resource_type IN ('ARTICLE','IMAGE','MAP','PDF','VIDEO','AUDIO','OTHER')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_external_resources_world ON external_resources(world_id, updated_at DESC);
