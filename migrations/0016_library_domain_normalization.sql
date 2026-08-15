-- LIB-002: normalização do domínio da Biblioteca (Game System + Publication +
-- User Library Entry). Aditiva: nenhuma tabela/coluna existente é removida ou
-- reescrita destrutivamente. `rpgs` continua fisicamente com esse nome (renomear
-- seria destrutivo demais para uma migration aditiva — ver
-- docs/library/LIBRARY_ARCHITECTURE.md) mas passa a representar, junto com o
-- restante deste arquivo, o "User Library Entry" da arquitetura: estado pessoal
-- do usuário sobre uma Publication, referenciada por `publication_id`.
--
-- category_id/subgenre_id permanecem em `rpgs` nesta migration (decisão
-- documentada em docs/library/LIBRARY_ARCHITECTURE.md — mover exigiria reescrever
-- todas as queries de filtro/busca numa segunda mudança de schema não
-- relacionada, fora do escopo desta fundação).
--
-- cover_url/isbn/cover_source_url/cover_source_note em `rpgs` NÃO são mais
-- escritos pela aplicação após esta migration (a fonte de verdade passa a ser
-- `publications`) mas permanecem fisicamente na tabela — não são apagados nem
-- alterados por este arquivo — como registro histórico e rede de segurança para
-- rollback lógico.

PRAGMA foreign_keys = ON;

CREATE TABLE game_systems (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  normalized_name TEXT NOT NULL,
  publisher TEXT NOT NULL DEFAULT '' CHECK(length(publisher) <= 160),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 10000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Sem UNIQUE(name)/UNIQUE(normalized_name): nesta fase cada Publication (e
-- portanto cada Game System) pertence a um único User Library Entry (ver
-- LIBRARY_ARCHITECTURE.md, seção "Escopo de criação") — dois usuários que
-- cataloguem "Alien RPG" hoje geram duas linhas distintas, de propósito, para
-- não introduzir edição cruzada entre contas sem revisão de segurança dedicada
-- (compartilhamento real fica para uma sessão futura).
CREATE INDEX idx_game_systems_normalized_name ON game_systems(normalized_name);

CREATE TABLE publications (
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
  metadata_source TEXT NOT NULL DEFAULT 'MANUAL' CHECK(metadata_source IN ('MANUAL','OPEN_LIBRARY','GOOGLE_BOOKS')),
  metadata_source_id TEXT,
  metadata_source_url TEXT,
  metadata_fetched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_publications_game_system ON publications(game_system_id);
-- isbn10/isbn13 não são populados nesta migration (nenhum parser é introduzido
-- para não reclassificar dado legado arbitrariamente — ver seção 15 do pedido);
-- os índices já existem prontos para quando LIB-003+ passar a preenchê-los.
CREATE INDEX idx_publications_isbn13 ON publications(isbn13) WHERE isbn13 IS NOT NULL;
CREATE INDEX idx_publications_isbn10 ON publications(isbn10) WHERE isbn10 IS NOT NULL;

ALTER TABLE rpgs ADD COLUMN publication_id TEXT REFERENCES publications(id) ON DELETE SET NULL;
CREATE INDEX idx_rpgs_publication ON rpgs(publication_id);

-- Pronto para arquitetura de archive (seção 16 do pedido) — não implementado
-- nesta sessão (F-011 continua NOT_STARTED); apenas a coluna aditiva, nunca
-- definida por nenhum código nesta migration.
ALTER TABLE rpgs ADD COLUMN archived_at TEXT;
CREATE INDEX idx_rpgs_user_archived ON rpgs(user_id, archived_at);

-- Backfill idempotente: cada rpg existente sem publication_id ganha seu próprio
-- game_system + publication (1:1, sem dedup entre linhas — ver nota acima).
-- IDs derivados deterministicamente de rpgs.id (em vez de aleatório em SQL puro)
-- para correlacionar as 3 tabelas dentro do mesmo INSERT...SELECT sem depender
-- de RETURNING encadeado. O guard `WHERE r.publication_id IS NULL` torna esta
-- migration segura para reexecução (não duplica nem sobrescreve linhas já
-- migradas). `normalized_name` usa `lower()` puro (aproximado — sem NFKC/locale
-- pt-BR do runtime JS) porque aqui é só um índice de apoio, não uma constraint;
-- toda criação nova a partir do app usa o normalizador real
-- (src/domain/rpg/library-domain.ts).
INSERT INTO game_systems (id, name, normalized_name, publisher, description, created_at, updated_at)
SELECT 'gs_' || r.id, r.title, lower(r.title), '', '', r.created_at, r.updated_at
FROM rpgs r WHERE r.publication_id IS NULL;

INSERT INTO publications (id, game_system_id, publication_type, title, subtitle, edition, publisher, publication_year, language, isbn, isbn10, isbn13, description, cover_url, cover_source_url, cover_source_note, metadata_source, created_at, updated_at)
SELECT 'pub_' || r.id, 'gs_' || r.id, 'CORE_RULEBOOK', r.title, '', '', '', NULL, '', r.isbn, NULL, NULL, '', r.cover_url, r.cover_source_url, r.cover_source_note, 'MANUAL', r.created_at, r.updated_at
FROM rpgs r WHERE r.publication_id IS NULL;

UPDATE rpgs SET publication_id = 'pub_' || id WHERE publication_id IS NULL;
