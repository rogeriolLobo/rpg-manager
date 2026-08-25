-- Migration 0042: Journal User-First Refactor (World-Optional)
-- Classification: DATA_MIGRATION_HIGH_ATTENTION

PRAGMA defer_foreign_keys = ON;

-- 1. Create new table for journal folders
CREATE TABLE journal_folders_new (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_folder_id TEXT REFERENCES journal_folders_new(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 2. Create new table for journal pages
CREATE TABLE journal_pages_new (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES journal_folders_new(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  content TEXT NOT NULL DEFAULT '' CHECK(length(content) <= 100000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 3. Create the links table
CREATE TABLE journal_page_world_links (
  journal_page_id TEXT NOT NULL REFERENCES journal_pages_new(id) ON DELETE CASCADE,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (journal_page_id, world_id)
);

-- 4. Backfill folders
INSERT INTO journal_folders_new (id, owner_user_id, parent_folder_id, name, sort_order, created_at, updated_at)
SELECT j.id, w.owner_user_id, j.parent_folder_id, j.name, j.sort_order, j.created_at, j.updated_at
FROM journal_folders j
JOIN worlds w ON w.id = j.world_id;

-- 5. Backfill pages
INSERT INTO journal_pages_new (id, owner_user_id, folder_id, title, content, created_at, updated_at)
SELECT p.id, w.owner_user_id, p.folder_id, p.title, p.content, p.created_at, p.updated_at
FROM journal_pages p
JOIN worlds w ON w.id = p.world_id;

-- 6. Backfill links
INSERT INTO journal_page_world_links (journal_page_id, world_id, created_at)
SELECT p.id, p.world_id, p.created_at
FROM journal_pages p;

-- 7. Drop old tables
DROP TABLE journal_pages;
DROP TABLE journal_folders;

-- 8. Rename new tables to final names
ALTER TABLE journal_folders_new RENAME TO journal_folders;
ALTER TABLE journal_pages_new RENAME TO journal_pages;

-- 9. Recreate Indexes
CREATE INDEX idx_journal_folders_owner_parent ON journal_folders(owner_user_id, parent_folder_id, sort_order, name);
CREATE INDEX idx_journal_pages_owner_folder ON journal_pages(owner_user_id, folder_id, updated_at DESC);
CREATE INDEX idx_journal_page_links_world ON journal_page_world_links(world_id);
