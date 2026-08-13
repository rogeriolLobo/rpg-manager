CREATE TABLE vault_entities (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  world_id TEXT REFERENCES worlds(id) ON DELETE RESTRICT,
  group_id TEXT REFERENCES play_groups(id) ON DELETE SET NULL,
  parent_entity_id TEXT REFERENCES vault_entities(id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('CHARACTER','NPC','CREATURE','LOCATION','FACTION','ITEM','LORE','EVENT','QUEST','HANDOUT','ADVENTURE')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  summary TEXT NOT NULL DEFAULT '' CHECK(length(summary) <= 1000),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 20000),
  visibility TEXT NOT NULL DEFAULT 'PRIVATE' CHECK(visibility IN ('PRIVATE','GROUP','CAMPAIGN','PLAYERS','GM_ONLY')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX idx_vault_owner_archive_updated ON vault_entities(owner_user_id, archived_at, updated_at DESC);
CREATE INDEX idx_vault_owner_type_archive ON vault_entities(owner_user_id, entity_type, archived_at);
CREATE INDEX idx_vault_world_type_archive ON vault_entities(world_id, entity_type, archived_at);
CREATE INDEX idx_vault_group ON vault_entities(group_id, visibility);
CREATE INDEX idx_vault_parent ON vault_entities(parent_entity_id);

CREATE TABLE adventure_details (
  entity_id TEXT PRIMARY KEY REFERENCES vault_entities(id) ON DELETE CASCADE,
  adventure_type TEXT NOT NULL CHECK(adventure_type IN ('ONE_SHOT','SHORT_CAMPAIGN','LONG_CAMPAIGN','SANDBOX','MODULE','CUSTOM')),
  recommended_sessions INTEGER CHECK(recommended_sessions IS NULL OR (recommended_sessions > 0 AND recommended_sessions <= 999)),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 10000)
);
