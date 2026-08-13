CREATE TABLE world_eras (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  name_normalized TEXT NOT NULL CHECK(length(name_normalized) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 2000),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN -9999 AND 9999),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE UNIQUE INDEX uq_world_eras_active_name ON world_eras(world_id, name_normalized) WHERE archived_at IS NULL;
CREATE INDEX idx_world_eras_order ON world_eras(world_id, archived_at, sort_order, name);

CREATE TABLE world_calendars (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL UNIQUE REFERENCES worlds(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  months_json TEXT NOT NULL CHECK(length(months_json) BETWEEN 2 AND 20000),
  weekdays_json TEXT NOT NULL CHECK(length(weekdays_json) BETWEEN 2 AND 5000),
  cycles_json TEXT NOT NULL DEFAULT '[]' CHECK(length(cycles_json) BETWEEN 2 AND 20000),
  holidays_json TEXT NOT NULL DEFAULT '[]' CHECK(length(holidays_json) BETWEEN 2 AND 100000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE event_temporal_details (
  entity_id TEXT PRIMARY KEY REFERENCES vault_entities(id) ON DELETE CASCADE,
  era_id TEXT REFERENCES world_eras(id) ON DELETE RESTRICT,
  historical_date TEXT NOT NULL DEFAULT '' CHECK(length(historical_date) <= 160),
  sort_key INTEGER CHECK(sort_key IS NULL OR sort_key BETWEEN -9000000000 AND 9000000000),
  precision TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(precision IN ('EXACT','DAY','MONTH','YEAR','ERA','APPROXIMATE','UNKNOWN')),
  calendar_id TEXT REFERENCES world_calendars(id) ON DELETE RESTRICT,
  calendar_year INTEGER CHECK(calendar_year IS NULL OR calendar_year BETWEEN -1000000 AND 1000000),
  calendar_month_index INTEGER CHECK(calendar_month_index IS NULL OR calendar_month_index BETWEEN 0 AND 35),
  calendar_day INTEGER CHECK(calendar_day IS NULL OR calendar_day BETWEEN 1 AND 1000),
  display_text TEXT NOT NULL DEFAULT '' CHECK(length(display_text) <= 160),
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_event_temporal_era_sort ON event_temporal_details(era_id, sort_key);
CREATE INDEX idx_event_temporal_calendar_sort ON event_temporal_details(calendar_id, sort_key);
