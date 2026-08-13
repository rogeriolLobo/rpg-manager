CREATE TABLE lore_details (
  entity_id TEXT PRIMARY KEY REFERENCES vault_entities(id) ON DELETE CASCADE,
  lore_type TEXT NOT NULL CHECK(lore_type IN ('HISTORY','RELIGION','CULTURE','LEGEND','PROPHECY','SECRET','CUSTOM')),
  canon_status TEXT NOT NULL CHECK(canon_status IN ('DRAFT','CANON','RUMOR')),
  source TEXT NOT NULL DEFAULT '' CHECK(length(source) <= 1000)
);

ALTER TABLE adventure_details
  ADD COLUMN premise TEXT NOT NULL DEFAULT '' CHECK(length(premise) <= 5000);
ALTER TABLE adventure_details
  ADD COLUMN hooks TEXT NOT NULL DEFAULT '' CHECK(length(hooks) <= 10000);
ALTER TABLE adventure_details
  ADD COLUMN key_scenes TEXT NOT NULL DEFAULT '' CHECK(length(key_scenes) <= 20000);
ALTER TABLE adventure_details
  ADD COLUMN rewards TEXT NOT NULL DEFAULT '' CHECK(length(rewards) <= 10000);

CREATE TABLE journal_folders (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  parent_folder_id TEXT REFERENCES journal_folders(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_journal_folders_world_parent ON journal_folders(world_id, parent_folder_id, sort_order, name);

CREATE TABLE journal_pages (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES journal_folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  content TEXT NOT NULL DEFAULT '' CHECK(length(content) <= 100000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_journal_pages_world_folder ON journal_pages(world_id, folder_id, updated_at DESC);
