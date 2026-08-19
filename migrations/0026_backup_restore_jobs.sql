-- F-015: Backup/Restore completo. Puramente aditiva.
--
-- Nova tabela dedicada em vez de reaproveitar `import_jobs` (que já tem
-- `kind CHECK(kind IN ('RPG_CATALOG','CAMPAIGNS'))` — relaxar esse CHECK
-- exigiria reconstruir a tabela, exatamente o padrão de risco documentado
-- em docs/architecture/DATABASE_MIGRATION_SAFETY.md a partir do incidente
-- real do LIB-004B). Mesmo padrão de preview/confirm com TTL de
-- import_jobs, mas para o payload normalizado (plano de restore já
-- validado e com IDs remapeados), nunca o JSON bruto enviado pelo usuário.
CREATE TABLE backup_restore_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload_hash TEXT NOT NULL,
  normalized_payload TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  row_count INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_backup_restore_jobs_user ON backup_restore_jobs(user_id, expires_at);
