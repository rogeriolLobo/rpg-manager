-- LIB-004: campo para autores (texto simples, separado por vírgula — mesma
-- convenção de play_group_notes, sem JSON) — usado por resultados de busca
-- externa (Open Library retorna author_name/by_statement) e disponível
-- também para cadastro manual. Aditiva, nullable-safe via DEFAULT ''.
ALTER TABLE publications ADD COLUMN authors TEXT NOT NULL DEFAULT '' CHECK(length(authors) <= 500);
