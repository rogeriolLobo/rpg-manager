-- LIB-004A: `publications.metadata_source` tinha CHECK(IN ('MANUAL',
-- 'OPEN_LIBRARY','GOOGLE_BOOKS')) — precisa aceitar 'URL_IMPORT' (importação
-- por URL oficial, seção 10 do pedido). SQLite não suporta ALTER de CHECK
-- constraint diretamente (só RENAME/ADD COLUMN/DROP COLUMN via ALTER TABLE),
-- então este é um rebuild seguro: nova tabela -> copia 100% das linhas
-- (colunas explícitas, nunca `SELECT *`) -> DROP da antiga -> RENAME -> recria
-- os mesmos índices. Nenhuma linha é perdida ou modificada; só a constraint
-- muda. Técnica documentada oficialmente pela SQLite ("Making Other Kinds Of
-- Table Schema Changes"). Validado localmente (contagem antes/depois) antes
-- de tocar produção; produção também terá contagem auditada antes/depois.
--
-- Decisão de desenho: em vez de adicionar só 'URL_IMPORT' ao enum (o que
-- exigiria este mesmo rebuild de novo no futuro a cada novo provider), a
-- constraint passa a validar só o formato (comprimento 1-40), não uma lista
-- fechada de valores. A validação de negócio (quais fontes são realmente
-- aceitas) já é feita no Zod (`shared/validation/schemas.ts`) e é a
-- autoridade real na fronteira da API — a constraint do banco vira defesa em
-- profundidade (nunca vazio, nunca um texto absurdamente longo), não a lista
-- canônica de fontes válidas.

PRAGMA foreign_keys = OFF;

CREATE TABLE publications_new (
  id TEXT PRIMARY KEY,
  game_system_id TEXT REFERENCES game_systems(id) ON DELETE RESTRICT,
  publication_type TEXT NOT NULL DEFAULT 'CORE_RULEBOOK' CHECK(publication_type IN (
    'CORE_RULEBOOK','PLAYER_GUIDE','GM_GUIDE','SUPPLEMENT','SETTING',
    'ADVENTURE','ONE_SHOT','CAMPAIGN','BESTIARY','SCREEN','OTHER')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  subtitle TEXT NOT NULL DEFAULT '' CHECK(length(subtitle) <= 160),
  edition TEXT NOT NULL DEFAULT '' CHECK(length(edition) <= 80),
  publisher TEXT NOT NULL DEFAULT '' CHECK(length(publisher) <= 160),
  publication_year INTEGER,
  language TEXT NOT NULL DEFAULT '' CHECK(length(language) <= 40),
  isbn TEXT CHECK(isbn IS NULL OR length(isbn) <= 32),
  isbn10 TEXT,
  isbn13 TEXT,
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 20000),
  cover_url TEXT CHECK(cover_url IS NULL OR length(cover_url) <= 1000),
  cover_source_url TEXT CHECK(cover_source_url IS NULL OR length(cover_source_url) <= 1000),
  cover_source_note TEXT CHECK(cover_source_note IS NULL OR length(cover_source_note) <= 1000),
  metadata_source TEXT NOT NULL DEFAULT 'MANUAL' CHECK(length(metadata_source) BETWEEN 1 AND 40),
  metadata_source_id TEXT,
  metadata_source_url TEXT,
  metadata_fetched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  authors TEXT NOT NULL DEFAULT '' CHECK(length(authors) <= 500)
);

INSERT INTO publications_new (
  id, game_system_id, publication_type, title, subtitle, edition, publisher, publication_year, language,
  isbn, isbn10, isbn13, description, cover_url, cover_source_url, cover_source_note,
  metadata_source, metadata_source_id, metadata_source_url, metadata_fetched_at, created_at, updated_at, authors
)
SELECT
  id, game_system_id, publication_type, title, subtitle, edition, publisher, publication_year, language,
  isbn, isbn10, isbn13, description, cover_url, cover_source_url, cover_source_note,
  metadata_source, metadata_source_id, metadata_source_url, metadata_fetched_at, created_at, updated_at, authors
FROM publications;

DROP TABLE publications;
ALTER TABLE publications_new RENAME TO publications;

CREATE INDEX idx_publications_game_system ON publications(game_system_id);
CREATE INDEX idx_publications_isbn13 ON publications(isbn13) WHERE isbn13 IS NOT NULL;
CREATE INDEX idx_publications_isbn10 ON publications(isbn10) WHERE isbn10 IS NOT NULL;
CREATE UNIQUE INDEX idx_publications_isbn13_unique ON publications(isbn13) WHERE isbn13 IS NOT NULL;
CREATE UNIQUE INDEX idx_publications_isbn10_unique ON publications(isbn10) WHERE isbn10 IS NOT NULL;

PRAGMA foreign_keys = ON;
