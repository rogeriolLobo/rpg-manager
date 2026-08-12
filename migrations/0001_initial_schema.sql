PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 80),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  password_changed_at TEXT NOT NULL,
  disabled_at TEXT,
  deleted_at TEXT
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);

CREATE TABLE account_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX idx_recovery_codes_user ON account_recovery_codes(user_id);

CREATE TABLE security_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  request_id TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_security_events_user_date ON security_events(user_id, occurred_at DESC);

CREATE TABLE auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK(failed_attempts >= 0),
  window_started_at TEXT NOT NULL,
  blocked_until TEXT
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE subgenres (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  UNIQUE(category_id, name)
);
CREATE INDEX idx_subgenres_category ON subgenres(category_id);

CREATE TABLE rpgs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  subgenre_id TEXT REFERENCES subgenres(id) ON DELETE RESTRICT,
  reading_status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(reading_status IN ('NOT_STARTED','READING','READ')),
  has_played INTEGER NOT NULL DEFAULT 0 CHECK(has_played IN (0,1)),
  wants_to_play INTEGER NOT NULL DEFAULT 0 CHECK(wants_to_play IN (0,1)),
  priority TEXT NOT NULL DEFAULT 'NONE' CHECK(priority IN ('NONE','LOW','MEDIUM','HIGH')),
  play_group_notes TEXT NOT NULL DEFAULT '' CHECK(length(play_group_notes) <= 1000),
  planned_play_date TEXT,
  table_status TEXT NOT NULL DEFAULT 'IDEA' CHECK(table_status IN ('IDEA','PREPARING','SCHEDULED','PLAYING','COMPLETED')),
  game_master TEXT NOT NULL DEFAULT '' CHECK(length(game_master) <= 100),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 10000),
  cover_url TEXT CHECK(cover_url IS NULL OR length(cover_url) <= 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, title)
);
CREATE INDEX idx_rpgs_user_reading ON rpgs(user_id, reading_status);
CREATE INDEX idx_rpgs_user_wants ON rpgs(user_id, wants_to_play);
CREATE INDEX idx_rpgs_user_created ON rpgs(user_id, created_at DESC);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rpg_id TEXT NOT NULL REFERENCES rpgs(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  status TEXT NOT NULL DEFAULT 'PLANNING' CHECK(status IN ('PLANNING','SESSION_ZERO','PREPARING','IN_PROGRESS','PAUSED','COMPLETED')),
  game_master TEXT NOT NULL DEFAULT '' CHECK(length(game_master) <= 100),
  session_zero_date TEXT,
  first_session_date TEXT,
  frequency TEXT CHECK(frequency IS NULL OR frequency IN ('WEEKLY','BIWEEKLY','MONTHLY','BIMONTHLY','IRREGULAR')),
  next_session_date TEXT,
  last_session_date TEXT,
  session_goal INTEGER CHECK(session_goal IS NULL OR session_goal > 0),
  legacy_members_text TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 10000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_campaigns_user ON campaigns(user_id, status);
CREATE INDEX idx_campaigns_rpg ON campaigns(rpg_id);

CREATE TABLE campaign_members (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL CHECK(length(player_name) BETWEEN 1 AND 100),
  character_name TEXT NOT NULL DEFAULT '' CHECK(length(character_name) <= 100),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 2000),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_campaign_members_campaign ON campaign_members(campaign_id, active);

CREATE TABLE campaign_sessions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_number INTEGER NOT NULL CHECK(session_number > 0),
  title TEXT NOT NULL DEFAULT '' CHECK(length(title) <= 160),
  played_at TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '' CHECK(length(summary) <= 10000),
  gm_notes TEXT NOT NULL DEFAULT '' CHECK(length(gm_notes) <= 10000),
  next_hooks TEXT NOT NULL DEFAULT '' CHECK(length(next_hooks) <= 5000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(campaign_id, session_number)
);
CREATE INDEX idx_campaign_sessions_campaign_date ON campaign_sessions(campaign_id, played_at DESC);

CREATE TABLE campaign_session_attendance (
  session_id TEXT NOT NULL REFERENCES campaign_sessions(id) ON DELETE CASCADE,
  campaign_member_id TEXT NOT NULL REFERENCES campaign_members(id) ON DELETE CASCADE,
  PRIMARY KEY(session_id, campaign_member_id)
);

CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  library_view TEXT NOT NULL DEFAULT 'CARDS' CHECK(library_view IN ('CARDS','TABLE')),
  updated_at TEXT NOT NULL
);

CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload_hash TEXT NOT NULL,
  normalized_payload TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  UNIQUE(user_id, payload_hash)
);

