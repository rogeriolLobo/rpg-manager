-- F-025 (BATCH13): Adventures aprofundadas — acts/scenes/encounters/handouts
-- estruturados, ligados ao Vault Entity ADVENTURE já existente (adventure_details).
-- v1 é uma ferramenta de preparação do GM: leitura/escrita exigem ownedEntity (mesmo
-- modelo do Diário/Journal) — expor conteúdo revelado a jogadores é responsabilidade de
-- uma feature futura (F-033, Player View), que já lista F-025 como dependência no roadmap.
-- Migration puramente aditiva — ver docs/architecture/DATABASE_MIGRATION_SAFETY.md.

CREATE TABLE adventure_scenes (
  id TEXT PRIMARY KEY,
  adventure_entity_id TEXT NOT NULL REFERENCES vault_entities(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  act TEXT NOT NULL DEFAULT '' CHECK(length(act) <= 120),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  summary TEXT NOT NULL DEFAULT '' CHECK(length(summary) <= 2000),
  read_aloud TEXT NOT NULL DEFAULT '' CHECK(length(read_aloud) <= 5000),
  gm_notes TEXT NOT NULL DEFAULT '' CHECK(length(gm_notes) <= 10000),
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_adventure_scenes_adventure ON adventure_scenes(adventure_entity_id, sort_order);

CREATE TABLE adventure_encounters (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES adventure_scenes(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  difficulty TEXT NOT NULL DEFAULT '' CHECK(length(difficulty) <= 80),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 5000),
  gm_notes TEXT NOT NULL DEFAULT '' CHECK(length(gm_notes) <= 10000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_adventure_encounters_scene ON adventure_encounters(scene_id, sort_order);

-- Reaproveita entidades do Vault já existentes (NPC/Creature/Location/Item/etc) — nunca
-- duplica, mesmo princípio de campaign_entities.
CREATE TABLE adventure_scene_entities (
  scene_id TEXT NOT NULL REFERENCES adventure_scenes(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES vault_entities(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT '' CHECK(length(role) <= 120),
  created_at TEXT NOT NULL,
  PRIMARY KEY(scene_id, entity_id)
);
CREATE INDEX idx_adventure_scene_entities_entity ON adventure_scene_entities(entity_id);

-- Handout: texto livre entregue aos jogadores e/ou referência a um External Resource já
-- existente (F-003) — nunca hospeda/duplica arquivo. revealed_at fica NULO até o GM
-- revelar (preparado para F-033, sem implementar a superfície de jogador ainda).
CREATE TABLE adventure_handouts (
  id TEXT PRIMARY KEY,
  adventure_entity_id TEXT NOT NULL REFERENCES vault_entities(id) ON DELETE CASCADE,
  scene_id TEXT REFERENCES adventure_scenes(id) ON DELETE SET NULL,
  external_resource_id TEXT REFERENCES external_resources(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  content TEXT NOT NULL DEFAULT '' CHECK(length(content) <= 10000),
  revealed_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_adventure_handouts_adventure ON adventure_handouts(adventure_entity_id, sort_order);
