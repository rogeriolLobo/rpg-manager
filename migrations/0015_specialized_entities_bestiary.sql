CREATE TABLE creature_stat_templates (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 2000),
  field_definitions TEXT NOT NULL DEFAULT '[]' CHECK(length(field_definitions) <= 20000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(world_id, name)
);
CREATE INDEX idx_creature_stat_templates_world ON creature_stat_templates(world_id, name);

CREATE TABLE character_details (
  entity_id TEXT PRIMARY KEY REFERENCES vault_entities(id) ON DELETE CASCADE,
  player_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  pronouns TEXT NOT NULL DEFAULT '' CHECK(length(pronouns) <= 80),
  concept TEXT NOT NULL DEFAULT '' CHECK(length(concept) <= 1000),
  status TEXT NOT NULL DEFAULT '' CHECK(length(status) <= 80),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 10000)
);
CREATE INDEX idx_character_details_player ON character_details(player_user_id);

CREATE TABLE npc_details (
  entity_id TEXT PRIMARY KEY REFERENCES vault_entities(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT '' CHECK(length(role) <= 160),
  occupation TEXT NOT NULL DEFAULT '' CHECK(length(occupation) <= 160),
  motivation TEXT NOT NULL DEFAULT '' CHECK(length(motivation) <= 2000),
  public_notes TEXT NOT NULL DEFAULT '' CHECK(length(public_notes) <= 10000),
  gm_notes TEXT NOT NULL DEFAULT '' CHECK(length(gm_notes) <= 10000)
);

CREATE TABLE creature_details (
  entity_id TEXT PRIMARY KEY REFERENCES vault_entities(id) ON DELETE CASCADE,
  classification TEXT NOT NULL DEFAULT '' CHECK(length(classification) <= 160),
  habitat TEXT NOT NULL DEFAULT '' CHECK(length(habitat) <= 1000),
  behavior TEXT NOT NULL DEFAULT '' CHECK(length(behavior) <= 5000),
  danger_notes TEXT NOT NULL DEFAULT '' CHECK(length(danger_notes) <= 5000)
);

CREATE TABLE creature_stat_blocks (
  entity_id TEXT PRIMARY KEY REFERENCES vault_entities(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES creature_stat_templates(id) ON DELETE RESTRICT,
  values_json TEXT NOT NULL DEFAULT '{}' CHECK(length(values_json) <= 20000)
);
CREATE INDEX idx_creature_stat_blocks_template ON creature_stat_blocks(template_id);

CREATE TABLE faction_details (
  entity_id TEXT PRIMARY KEY REFERENCES vault_entities(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT '' CHECK(length(purpose) <= 2000),
  scope TEXT NOT NULL DEFAULT '' CHECK(length(scope) <= 160),
  status TEXT NOT NULL DEFAULT '' CHECK(length(status) <= 80),
  public_description TEXT NOT NULL DEFAULT '' CHECK(length(public_description) <= 10000),
  gm_notes TEXT NOT NULL DEFAULT '' CHECK(length(gm_notes) <= 10000)
);

CREATE TABLE item_details (
  entity_id TEXT PRIMARY KEY REFERENCES vault_entities(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL DEFAULT '' CHECK(length(item_type) <= 160),
  rarity TEXT NOT NULL DEFAULT '' CHECK(length(rarity) <= 80),
  public_description TEXT NOT NULL DEFAULT '' CHECK(length(public_description) <= 10000),
  gm_notes TEXT NOT NULL DEFAULT '' CHECK(length(gm_notes) <= 10000)
);
