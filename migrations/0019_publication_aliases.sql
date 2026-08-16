-- LIB-004A: títulos alternativos/localizados de uma Publication (ex.: "Rastro
-- de Cthulhu" -> "Trail of Cthulhu"). Aditiva: nova tabela, nada existente é
-- alterado. Ver docs/library/METADATA_PROVIDERS.md ("Aliases e catálogo
-- interno") e src/server/search/internal-catalog.ts.
--
-- `confirmed`: aliases não confirmados existem no schema para uso futuro
-- (ex.: sugestão automática a partir de um import por URL) mas NUNCA
-- influenciam busca nesta tarefa — só aliases com confirmed=1 entram no
-- pipeline de busca interna, evitando que um alias mal extraído polua
-- resultados de outros usuários (Publication é catálogo compartilhado).
CREATE TABLE publication_aliases (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  language TEXT NOT NULL DEFAULT '' CHECK(length(language) <= 40),
  source TEXT NOT NULL DEFAULT 'MANUAL' CHECK(source IN ('MANUAL', 'OPEN_LIBRARY', 'URL_IMPORT')),
  confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_publication_aliases_publication ON publication_aliases(publication_id);
