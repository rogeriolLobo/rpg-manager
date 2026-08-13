CREATE TABLE entity_relations (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE RESTRICT,
  source_entity_id TEXT NOT NULL REFERENCES vault_entities(id) ON DELETE RESTRICT,
  target_entity_id TEXT NOT NULL REFERENCES vault_entities(id) ON DELETE RESTRICT,
  relation_type TEXT NOT NULL CHECK(relation_type IN ('ALLY','ENEMY','RIVAL','FAMILY','PARENT','CHILD','SIBLING','PARTNER','ROMANCE','EMPLOYER','SUBORDINATE','MEMBER_OF','LEADER_OF','OWES','KNOWS','SECRET','CUSTOM')),
  label TEXT NOT NULL DEFAULT '' CHECK(length(label) <= 160),
  label_normalized TEXT NOT NULL DEFAULT '' CHECK(length(label_normalized) <= 160),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 4000),
  direction TEXT NOT NULL CHECK(direction IN ('DIRECTED','BIDIRECTIONAL')),
  visibility TEXT NOT NULL DEFAULT 'PRIVATE' CHECK(visibility IN ('PRIVATE','GROUP','CAMPAIGN','PLAYERS','GM_ONLY')),
  strength INTEGER CHECK(strength IS NULL OR strength BETWEEN 1 AND 5),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK(source_entity_id <> target_entity_id)
);

CREATE UNIQUE INDEX uq_entity_relations_active
  ON entity_relations(world_id, source_entity_id, target_entity_id, relation_type, direction, label_normalized)
  WHERE archived_at IS NULL;
CREATE INDEX idx_entity_relations_world_active ON entity_relations(world_id, archived_at, updated_at DESC);
CREATE INDEX idx_entity_relations_source ON entity_relations(source_entity_id, archived_at);
CREATE INDEX idx_entity_relations_target ON entity_relations(target_entity_id, archived_at);
CREATE INDEX idx_entity_relations_visibility ON entity_relations(world_id, visibility, archived_at);
