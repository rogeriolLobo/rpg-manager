-- F-032 (BATCH17): iniciativa/combate system-neutral, sobre a fundação do VTT (F-029/F-030).
-- Puramente aditiva — ver docs/architecture/DATABASE_MIGRATION_SAFETY.md.
--
-- Combatente pode ou não estar ligado a um vtt_token (permite iniciativa de algo que ainda
-- não tem token na cena, ex. um grupo de mooks resumido numa linha). `visible_to_players` é
-- independente do token (nem todo combatente tem um) — mesmo princípio de segurança de
-- vtt_tokens.visible_to_players: barreira sempre no servidor. HP é deliberadamente GM-only
-- nesta v1 (nunca enviado à visão do jogador em /live) — reduz risco de meta-gaming e mantém
-- o v1 simples; visibilidade de HP ao jogador fica para uma iteração futura se houver demanda
-- real (documentado, não escondido).
CREATE TABLE vtt_combatants (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES vtt_scenes(id) ON DELETE CASCADE,
  token_id TEXT REFERENCES vtt_tokens(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  initiative REAL NOT NULL,
  hp_current INTEGER,
  hp_max INTEGER,
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 2000),
  visible_to_players INTEGER NOT NULL DEFAULT 0 CHECK(visible_to_players IN (0,1)),
  is_current_turn INTEGER NOT NULL DEFAULT 0 CHECK(is_current_turn IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_vtt_combatants_scene_order ON vtt_combatants(scene_id, initiative DESC, created_at);
-- Só um combatente com o turno atual por cena.
CREATE UNIQUE INDEX idx_vtt_combatants_current_turn ON vtt_combatants(scene_id) WHERE is_current_turn=1;

ALTER TABLE vtt_scenes ADD COLUMN combat_active INTEGER NOT NULL DEFAULT 0 CHECK(combat_active IN (0,1));
ALTER TABLE vtt_scenes ADD COLUMN combat_round INTEGER NOT NULL DEFAULT 0 CHECK(combat_round >= 0);
