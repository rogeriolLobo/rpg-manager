ALTER TABLE user_preferences
  ADD COLUMN active_world_id TEXT REFERENCES worlds(id) ON DELETE SET NULL;

CREATE TABLE wiki_folders (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  parent_folder_id TEXT REFERENCES wiki_folders(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_wiki_folders_world_parent ON wiki_folders(world_id, parent_folder_id, sort_order, name);

CREATE TABLE wiki_entity_metadata (
  entity_id TEXT PRIMARY KEY REFERENCES vault_entities(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES wiki_folders(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_wiki_metadata_folder ON wiki_entity_metadata(folder_id, sort_order);

CREATE TABLE world_tags (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
  normalized_name TEXT NOT NULL CHECK(length(normalized_name) BETWEEN 1 AND 60),
  created_at TEXT NOT NULL,
  UNIQUE(world_id, normalized_name)
);
CREATE INDEX idx_world_tags_world_name ON world_tags(world_id, normalized_name);

CREATE TABLE wiki_entity_tags (
  entity_id TEXT NOT NULL REFERENCES vault_entities(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES world_tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(entity_id, tag_id)
);
CREATE INDEX idx_wiki_entity_tags_tag ON wiki_entity_tags(tag_id, entity_id);

CREATE TABLE wiki_entity_aliases (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES vault_entities(id) ON DELETE CASCADE,
  alias TEXT NOT NULL CHECK(length(alias) BETWEEN 1 AND 160),
  normalized_alias TEXT NOT NULL CHECK(length(normalized_alias) BETWEEN 1 AND 160),
  created_at TEXT NOT NULL,
  UNIQUE(entity_id, normalized_alias)
);
CREATE INDEX idx_wiki_aliases_lookup ON wiki_entity_aliases(normalized_alias, entity_id);
