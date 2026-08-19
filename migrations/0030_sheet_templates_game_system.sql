-- F-023 (BATCH10): Vault system-aware — um modelo de ficha (sheet_templates, F-020) pode
-- ser escopado a um Game System em vez de (ou além de) um World, sem precisar de uma
-- tabela de campos por RPG: o mesmo Game System pode ter várias Publications/edições no
-- catálogo compartilhado (`game_systems`, migration 0016), e todas passam a enxergar o
-- mesmo modelo. Um World fica "de um Game System" através de `worlds.default_rpg_id` →
-- `rpgs.publication_id` → `publications.game_system_id` — cadeia já existente, nenhuma
-- coluna nova em worlds/rpgs/publications. Mutuamente exclusivo com world_id (aplicado na
-- rota, não via CHECK — ver src/server/routes/sheets.ts) para manter o modelo mental
-- simples: um template é global, OU de um World, OU de um Game System.
-- Migration puramente aditiva — ver docs/architecture/DATABASE_MIGRATION_SAFETY.md.

ALTER TABLE sheet_templates ADD COLUMN game_system_id TEXT REFERENCES game_systems(id) ON DELETE SET NULL;
CREATE INDEX idx_sheet_templates_game_system ON sheet_templates(game_system_id);
