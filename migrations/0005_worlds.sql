CREATE TABLE worlds (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  slug TEXT NOT NULL CHECK(length(slug) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 10000),
  default_rpg_id TEXT REFERENCES rpgs(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'PRIVATE' CHECK(visibility IN ('PRIVATE','GROUP')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE(owner_user_id, slug),
  CHECK((status='ACTIVE' AND archived_at IS NULL) OR (status='ARCHIVED' AND archived_at IS NOT NULL))
);
CREATE INDEX idx_worlds_owner_status ON worlds(owner_user_id, status, updated_at DESC);
CREATE INDEX idx_worlds_default_rpg ON worlds(default_rpg_id);

CREATE TABLE world_members (
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK(role IN ('OWNER','VIEWER')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, user_id)
);
CREATE INDEX idx_world_members_user ON world_members(user_id, world_id);
