-- F-002: Cartografia zero-cost (mapas + pins), escopada por World. Versão 1.0 deliberadamente
-- simples: NÃO é um VTT (sem tokens em tempo real, sem fog of war, sem movimento, sem
-- WebSockets — ver docs/product/MASTER_BACKLOG.md). Imagem do mapa é sempre uma URL externa
-- (mesma política zero-fetch do coverUrl/LIB-001 — nunca upload, nunca fetch do servidor).
--
-- Duas tabelas novas, aditivas. `map_pins.entity_id` é uma FK de ENTRADA para vault_entities,
-- mas isso não exige nenhuma alteração na tabela vault_entities em si (só um novo filho
-- apontando para um pai já existente e inalterado) — sem nenhum risco de rebuild, diferente do
-- caso do EXTERNAL_RESOURCE (que precisaria alterar o CHECK de vault_entities.entity_type).
CREATE TABLE world_maps (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  image_url TEXT NOT NULL CHECK(length(image_url) <= 2000),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 2000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_world_maps_world ON world_maps(world_id, updated_at DESC);

-- x/y são coordenadas normalizadas (0-100, percentual da imagem) — independentes da resolução
-- real da imagem, coerente em qualquer tamanho de tela.
CREATE TABLE map_pins (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES world_maps(id) ON DELETE CASCADE,
  entity_id TEXT REFERENCES vault_entities(id) ON DELETE SET NULL,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 160),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 2000),
  x REAL NOT NULL CHECK(x >= 0 AND x <= 100),
  y REAL NOT NULL CHECK(y >= 0 AND y <= 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_map_pins_map ON map_pins(map_id);
