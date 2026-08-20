-- BATCH23 (Multi-GM, Seção 2 do pedido de finalização): Owner continua sendo o único dono real
-- da Campaign (campaigns.user_id, nunca alterado por este arquivo) — Co-GM é uma autorização
-- ADICIONAL, nunca uma segunda posse. Modelo mínimo, tabela própria (nunca sobrecarrega
-- campaign_members.is_game_master, que já tem um significado diferente e pré-existente: rótulo
-- de exibição "quem é o mestre" usado por GM_ONLY em entityAuthorizationPredicate — misturar os
-- dois seria uma mudança de significado arriscada de um campo já usado por segurança).
--
-- created_by (quem concedeu o acesso) é auditoria mínima — nunca usado para autorização, só
-- para saber depois "quem adicionou este Co-GM" se precisar investigar.
CREATE TABLE campaign_co_gms (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  PRIMARY KEY (campaign_id, user_id)
);
CREATE INDEX idx_campaign_co_gms_user ON campaign_co_gms(user_id);
