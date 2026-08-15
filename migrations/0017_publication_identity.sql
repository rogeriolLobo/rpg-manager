-- LIB-003: identidade confiável de Publication (ISBN normalizado + checksum),
-- provider external IDs (schema-ready) e índices únicos parciais para dedup
-- seguro. Aditiva: nenhuma tabela/coluna/linha existente é removida ou
-- reescrita destrutivamente. Ver docs/library/PUBLICATION_IDENTITY.md.

PRAGMA foreign_keys = ON;

-- Identidade externa por provider (Open Library, Google Books, editora...).
-- Schema-ready — nenhum provider é chamado nesta tarefa (LIB-003 é só a
-- fundação de identidade; busca externa fica para uma sessão futura).
CREATE TABLE publication_external_ids (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('OPEN_LIBRARY','GOOGLE_BOOKS','PUBLISHER','OTHER')),
  external_id TEXT NOT NULL CHECK(length(external_id) BETWEEN 1 AND 200),
  external_type TEXT NOT NULL DEFAULT 'EDITION' CHECK(external_type IN ('EDITION','WORK')),
  created_at TEXT NOT NULL,
  UNIQUE(provider, external_id)
);
CREATE INDEX idx_publication_external_ids_publication ON publication_external_ids(publication_id);

-- Backfill: popula isbn13/isbn10 (colunas já existentes desde a migration 0016,
-- até aqui sempre NULL) a partir do valor já persistido em `isbn`, só quando a
-- forma já bate no formato esperado (13 dígitos = EAN-13; 10 dígitos/X = ISO
-- 2108). Auditoria manual antes desta migration confirmou que as 20 linhas de
-- produção com ISBN não vazio são todas EAN-13 de 13 dígitos com checksum
-- válido (nenhuma correção nem invenção de valor foi necessária). Este backfill
-- não recalcula checksum em SQL puro (custo/benefício não compensa para uma
-- carga única de ~30 linhas já auditada) — toda escrita nova a partir desta
-- migration passa pelo validador real (src/domain/rpg/isbn.ts).
-- GLOB por classe-de-caractere posicional (13/10 tokens `[0-9]`) excede o limite
-- de complexidade de padrão do SQLite usado pelo D1 ("LIKE or GLOB pattern too
-- complex") — descoberto na validação local desta migration antes de tocar
-- produção. Forma equivalente e mais simples: nega a presença de qualquer
-- caractere fora do conjunto permitido.
UPDATE publications SET isbn13 = isbn
WHERE isbn13 IS NULL AND isbn IS NOT NULL
  AND length(isbn) = 13 AND isbn NOT GLOB '*[^0-9]*';

UPDATE publications SET isbn10 = isbn
WHERE isbn10 IS NULL AND isbn13 IS NULL AND isbn IS NOT NULL
  AND length(isbn) = 10 AND isbn NOT GLOB '*[^0-9X]*';

-- Índices únicos parciais: identidade real de Publication a partir de agora.
-- Auditoria prévia confirmou 0 colisões nos dados existentes (20 ISBNs não
-- vazios, todos distintos) — seguro criar como UNIQUE sem quebrar histórico.
-- Os índices não-únicos criados na migration 0016 (idx_publications_isbn13/10)
-- permanecem intactos (sem DROP) — redundância mínima aceita em troca de zero
-- risco de destruir um índice em uso.
CREATE UNIQUE INDEX idx_publications_isbn13_unique ON publications(isbn13) WHERE isbn13 IS NOT NULL;
CREATE UNIQUE INDEX idx_publications_isbn10_unique ON publications(isbn10) WHERE isbn10 IS NOT NULL;

-- Uma biblioteca (user_id) não pode ter duas User Library Entries para a mesma
-- Publication (seção 16 do pedido). Auditoria prévia confirmou que cada rpg
-- migrado em LIB-002 tem publication_id único (backfill 1:1) — sem colisão
-- possível nos dados existentes.
CREATE UNIQUE INDEX idx_rpgs_user_publication_unique ON rpgs(user_id, publication_id) WHERE publication_id IS NOT NULL;
