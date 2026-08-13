CREATE TABLE play_groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 5000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, name)
);
CREATE INDEX idx_play_groups_user ON play_groups(user_id, name);

CREATE TABLE play_group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES play_groups(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL CHECK(length(player_name) BETWEEN 1 AND 100),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 2000),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(group_id, player_name)
);
CREATE INDEX idx_play_group_members_group ON play_group_members(group_id, active);

ALTER TABLE rpgs ADD COLUMN play_group_id TEXT REFERENCES play_groups(id) ON DELETE SET NULL;
CREATE INDEX idx_rpgs_play_group ON rpgs(play_group_id);

ALTER TABLE campaigns ADD COLUMN play_group_id TEXT REFERENCES play_groups(id) ON DELETE SET NULL;
ALTER TABLE campaigns ADD COLUMN legacy_characters_text TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN legacy_sessions_completed INTEGER NOT NULL DEFAULT 0 CHECK(legacy_sessions_completed >= 0);
CREATE INDEX idx_campaigns_play_group ON campaigns(play_group_id);

ALTER TABLE campaign_members ADD COLUMN group_member_id TEXT REFERENCES play_group_members(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_campaign_members_group_member ON campaign_members(campaign_id, group_member_id) WHERE group_member_id IS NOT NULL;

ALTER TABLE import_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'RPG_CATALOG' CHECK(kind IN ('RPG_CATALOG','CAMPAIGNS'));
