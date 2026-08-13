ALTER TABLE rpgs ADD COLUMN isbn TEXT CHECK(isbn IS NULL OR length(isbn) <= 32);
ALTER TABLE rpgs ADD COLUMN cover_source_url TEXT CHECK(cover_source_url IS NULL OR length(cover_source_url) <= 1000);
ALTER TABLE rpgs ADD COLUMN cover_source_note TEXT CHECK(cover_source_note IS NULL OR length(cover_source_note) <= 1000);
