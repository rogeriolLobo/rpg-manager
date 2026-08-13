CREATE TABLE world_invites (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  code_hint TEXT NOT NULL CHECK(length(code_hint) BETWEEN 4 AND 12),
  role TEXT NOT NULL DEFAULT 'VIEWER' CHECK(role='VIEWER'),
  expires_at TEXT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK(max_uses BETWEEN 1 AND 100),
  use_count INTEGER NOT NULL DEFAULT 0 CHECK(use_count BETWEEN 0 AND max_uses),
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_world_invites_world_active ON world_invites(world_id, revoked_at, expires_at);
