-- F-030 (BATCH16): VTT — fog of war / visibilidade por grade, sobre a fundação do F-029
-- (migrations/0037_vtt_foundation.sql). fog_enabled/grid_cols/grid_rows são aditivos em
-- vtt_scenes (default preserva o comportamento anterior: fog desligado, grade 20x20). Só
-- células reveladas são armazenadas (esparso) — mais barato no D1 Free do que materializar a
-- grade inteira, e mais simples de resetar (apagar tudo = re-enevoar a cena inteira).
ALTER TABLE vtt_scenes ADD COLUMN fog_enabled INTEGER NOT NULL DEFAULT 0 CHECK(fog_enabled IN (0,1));
ALTER TABLE vtt_scenes ADD COLUMN grid_cols INTEGER NOT NULL DEFAULT 20 CHECK(grid_cols BETWEEN 1 AND 100);
ALTER TABLE vtt_scenes ADD COLUMN grid_rows INTEGER NOT NULL DEFAULT 20 CHECK(grid_rows BETWEEN 1 AND 100);

CREATE TABLE vtt_fog_cells (
  scene_id TEXT NOT NULL REFERENCES vtt_scenes(id) ON DELETE CASCADE,
  col INTEGER NOT NULL CHECK(col >= 0),
  row INTEGER NOT NULL CHECK(row >= 0),
  revealed_at TEXT NOT NULL,
  PRIMARY KEY (scene_id, col, row)
);
