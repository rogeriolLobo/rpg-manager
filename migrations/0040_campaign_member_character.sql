-- F-033 (Player View integrada): liga um campaign_member a um Vault Entity CHARACTER —
-- "Meu Personagem" na visão do jogador. Aditiva, nullable, ON DELETE SET NULL (nunca perde o
-- membro se a entidade for removida). A autorização de leitura pelo jogador reaproveita
-- authorizedEntity()/entityAuthorizationPredicate já existentes (visibility PLAYERS/CAMPAIGN +
-- campaign_entities) — nenhuma rota de leitura nova é necessária, só o vínculo.
ALTER TABLE campaign_members ADD COLUMN character_entity_id TEXT REFERENCES vault_entities(id) ON DELETE SET NULL;
