-- F-024 (BATCH13): One-Shots como conceito explícito — especialização segura de Campaign
-- (mesmo padrão já usado por F-013/F-014), sem tabela nova. Hoje um One-Shot só existia
-- como uma Campaign com session_goal=1 "por convenção", sem nenhum marcador explícito —
-- session_mode torna a intenção de "mesa única e autocontida" um campo de primeira classe
-- (filtro, badge na UI), sem duplicar nenhuma estrutura existente de Campaign/Adventure.
-- Migration puramente aditiva — ver docs/architecture/DATABASE_MIGRATION_SAFETY.md.

ALTER TABLE campaigns ADD COLUMN session_mode TEXT NOT NULL DEFAULT 'CAMPAIGN' CHECK(session_mode IN ('CAMPAIGN','ONE_SHOT'));
CREATE INDEX idx_campaigns_session_mode ON campaigns(user_id, session_mode);
