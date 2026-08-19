-- F-020 (BATCH9): Character Sheet Engine base — motor de fichas genérico por sistema.
-- Generaliza o padrão já validado por creature_stat_templates/creature_stat_blocks
-- (migration 0015): modelo declarativo (JSON de campos tipados) + valores por entidade,
-- validados no servidor contra o modelo (src/domain/sheets.ts). Diferenças deliberadas:
--   - world_id é OPCIONAL: Personagem/NPC não exigem World (Vault-first, CLAUDE.md §2/§24).
--     Um modelo com world_id NULL é "pessoal" (utilizável em qualquer entidade do dono,
--     com ou sem World).
--   - `version` no modelo: quando os campos do modelo mudam, o servidor incrementa a versão
--     (src/server/routes/sheets.ts); cada ficha grava a versão do modelo usada no momento em
--     que foi vinculada/salva, para permitir detectar fichas desatualizadas no futuro (F-021)
--     sem invalidar retroativamente o que já existe.
--   - aplica-se a CHARACTER e NPC (CREATURE mantém seu próprio motor de bestiário).
-- Migration puramente aditiva — sem DROP/rebuild de tabela existente, ver
-- docs/architecture/DATABASE_MIGRATION_SAFETY.md.

CREATE TABLE sheet_templates (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  world_id TEXT REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 2000),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  field_definitions TEXT NOT NULL DEFAULT '[]' CHECK(length(field_definitions) <= 40000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_sheet_templates_owner ON sheet_templates(owner_user_id, updated_at DESC);
CREATE INDEX idx_sheet_templates_world ON sheet_templates(world_id);

CREATE TABLE character_sheets (
  entity_id TEXT PRIMARY KEY REFERENCES vault_entities(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES sheet_templates(id) ON DELETE RESTRICT,
  template_version INTEGER NOT NULL,
  values_json TEXT NOT NULL DEFAULT '{}' CHECK(length(values_json) <= 40000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_character_sheets_template ON character_sheets(template_id);
