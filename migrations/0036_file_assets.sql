-- F-028 (BATCH15): Files/Handouts/Assets — anexos genéricos (imagem/PDF), opcionalmente
-- ligados a uma Vault Entity. Bytes vivem no KV (ASSETS_KV, Zero Cost — ver
-- src/domain/content/file-asset.ts e docs/library/COVER_STORAGE.md); esta tabela é só
-- metadata/ownership/quota — nunca base64 em coluna.
-- Migration puramente aditiva — ver docs/architecture/DATABASE_MIGRATION_SAFETY.md.

CREATE TABLE file_assets (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id TEXT REFERENCES vault_entities(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK(content_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  byte_length INTEGER NOT NULL CHECK(byte_length > 0),
  filename TEXT NOT NULL DEFAULT '' CHECK(length(filename) <= 200),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_file_assets_owner ON file_assets(owner_user_id, created_at DESC);
CREATE INDEX idx_file_assets_entity ON file_assets(entity_id);
