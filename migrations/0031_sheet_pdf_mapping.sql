-- F-021 (BATCH11): Fichas em PDF — reaproveita o motor de F-020/F-023 (sheet_templates).
-- Um modelo pode referenciar um PDF EXTERNO (pdf_url), nunca hospedado, copiado ou
-- redistribuído pelo RPG Manager: o servidor só guarda a URL e o mapeamento (metadata),
-- nunca busca nem armazena o conteúdo do PDF (mesma política de coverUrl — ver
-- src/shared/security/cover-url.ts, "o servidor nunca busca essa URL"). O preenchimento e
-- a geração do PDF final acontecem inteiramente no navegador do usuário (pdf-lib,
-- MIT/gratuito), a cada exportação, sem processamento nem armazenamento no servidor —
-- Zero Cost e sem risco de redistribuição de material protegido.
-- Migration puramente aditiva — ver docs/architecture/DATABASE_MIGRATION_SAFETY.md.

ALTER TABLE sheet_templates ADD COLUMN pdf_url TEXT;
ALTER TABLE sheet_templates ADD COLUMN pdf_mapping_json TEXT NOT NULL DEFAULT '{}' CHECK(length(pdf_mapping_json) <= 20000);
