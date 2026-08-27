-- Migration 0043: Map Studio User-First Foundation
-- Classification: ADDITIVE_SCHEMA
-- Map Studio belongs to the user. Worlds are optional N:N context links only.

CREATE TABLE map_documents (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 4000),
  map_type TEXT NOT NULL DEFAULT 'GENERIC' CHECK(map_type IN ('GENERIC','GEOGRAPHIC','SETTLEMENT','INTERIOR','TACTICAL','HEX','SPACE','NETWORK','ABSTRACT','IMPORTED')),
  width INTEGER NOT NULL DEFAULT 1920 CHECK(width BETWEEN 64 AND 32768),
  height INTEGER NOT NULL DEFAULT 1080 CHECK(height BETWEEN 64 AND 32768),
  grid_type TEXT NOT NULL DEFAULT 'NONE' CHECK(grid_type IN ('NONE','SQUARE','HEX_POINTY','HEX_FLAT')),
  grid_size INTEGER NOT NULL DEFAULT 50 CHECK(grid_size BETWEEN 4 AND 512),
  document_json TEXT NOT NULL DEFAULT '{"version":1,"backgroundColor":"#f5f1e8","layers":[]}' CHECK(length(document_json) <= 750000),
  document_version INTEGER NOT NULL DEFAULT 0 CHECK(document_version >= 0),
  background_asset_id TEXT REFERENCES file_assets(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX idx_map_documents_owner_updated ON map_documents(owner_user_id, archived_at, updated_at DESC);

CREATE TABLE map_document_world_links (
  map_document_id TEXT NOT NULL REFERENCES map_documents(id) ON DELETE CASCADE,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (map_document_id, world_id)
);
CREATE INDEX idx_map_document_world_links_world ON map_document_world_links(world_id, map_document_id);
