-- F-022 (BATCH12): Vault avançado — LINK explícito de uma Vault Entity num World
-- diferente do seu world_id "dono", sem nunca alterar esse world_id nem duplicar a
-- entidade (COPY/FORK é uma ação separada e explícita — ver POST /vault/:id/fork,
-- que cria uma entidade nova de verdade, sem tabela própria: é um INSERT normal em
-- vault_entities). Autorização de leitura continua 100% derivada da entidade
-- (owner/visibility/campaign/group) — o link só amplia EM QUAIS CONTEXTOS DE WORLD a
-- entidade é descoberta (Wiki/Vault filtrado por World/busca), nunca QUEM pode vê-la.
-- Migration puramente aditiva — ver docs/architecture/DATABASE_MIGRATION_SAFETY.md.

CREATE TABLE world_entity_links (
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES vault_entities(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, entity_id)
);
CREATE INDEX idx_world_entity_links_entity ON world_entity_links(entity_id);
