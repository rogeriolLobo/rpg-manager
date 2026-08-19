-- F-029 (BATCH16): VTT — fundação (Scene/Map/tokens), deliberadamente SEM realtime ainda
-- (CLAUDE.md §29: adiado, nunca cancelado — F-031 trata sincronização ao vivo depois de uma
-- auditoria de arquitetura zero-cost, ver docs/product/MASTER_BACKLOG.md). Uma Vtt Scene
-- pertence a uma Campaign (ferramenta de mesa, não de conhecimento — diferente de World), com
-- fundo opcional reaproveitando Cartografia (world_maps, F-002) ou uma image_url própria
-- (mesma política zero-fetch do coverUrl/LIB-001: nunca upload, nunca fetch do servidor).
-- Tokens referenciam opcionalmente uma Vault Entity — nunca duplicam NPC/Creature/Character já
-- cadastrado, mesmo princípio de map_pins.entity_id (migrations/0024_cartography.sql).
CREATE TABLE vtt_scenes (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  map_id TEXT REFERENCES world_maps(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  image_url TEXT NOT NULL DEFAULT '' CHECK(length(image_url) <= 2000),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 2000),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(map_id IS NOT NULL OR length(image_url) > 0)
);
CREATE INDEX idx_vtt_scenes_campaign ON vtt_scenes(campaign_id, updated_at DESC);
-- Só uma cena "ao vivo" por campanha por vez — é o que a visão do jogador
-- (GET /vtt/:campaignId/live) expõe.
CREATE UNIQUE INDEX idx_vtt_scenes_single_active ON vtt_scenes(campaign_id) WHERE is_active=1;

-- x/y normalizados (0-100), mesmo princípio de map_pins — independente da resolução real da
-- imagem/mapa. visible_to_players é a barreira de GM_ONLY do token (F-030 soma fog of war por
-- cima disso).
CREATE TABLE vtt_tokens (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES vtt_scenes(id) ON DELETE CASCADE,
  entity_id TEXT REFERENCES vault_entities(id) ON DELETE SET NULL,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 160),
  x REAL NOT NULL CHECK(x >= 0 AND x <= 100),
  y REAL NOT NULL CHECK(y >= 0 AND y <= 100),
  visible_to_players INTEGER NOT NULL DEFAULT 0 CHECK(visible_to_players IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_vtt_tokens_scene ON vtt_tokens(scene_id);
