import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

interface FolderRow {
  id: string;
  owner_user_id: string;
  parent_folder_id: string | null;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface PageRow {
  id: string;
  owner_user_id: string;
  folder_id: string | null;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

const databases: DatabaseSync[] = [];

function migrationFilesThrough0041(): string[] {
  return readdirSync('migrations')
    .filter((fileName) => /^(?:00(?:[0-3][0-9]|4[01]))_.*\.sql$/u.test(fileName))
    .sort();
}

function allRows<T extends object>(database: DatabaseSync, query: string): T[] {
  return database.prepare(query).all() as T[];
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('migration 0042 - Journal User-First', () => {
  it('preserva o Journal legado e converte World ownership em links N:N sem órfãos', () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    database.exec('PRAGMA foreign_keys = ON;');

    for (const fileName of migrationFilesThrough0041()) {
      database.exec(readFileSync(`migrations/${fileName}`, 'utf8'));
    }
    database.exec(readFileSync('scripts/seed-legacy-journal.sql', 'utf8'));

    const foldersBefore = allRows<Omit<FolderRow, 'owner_user_id'>>(
      database,
      'SELECT id,parent_folder_id,name,sort_order,created_at,updated_at FROM journal_folders ORDER BY id',
    );
    const pagesBefore = allRows<Omit<PageRow, 'owner_user_id'>>(
      database,
      'SELECT id,folder_id,title,content,created_at,updated_at FROM journal_pages ORDER BY id',
    );

    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(readFileSync('migrations/0042_journal_user_first.sql', 'utf8'));
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }

    const foldersAfter = allRows<FolderRow>(
      database,
      'SELECT id,owner_user_id,parent_folder_id,name,sort_order,created_at,updated_at FROM journal_folders ORDER BY id',
    );
    const pagesAfter = allRows<PageRow>(
      database,
      'SELECT id,owner_user_id,folder_id,title,content,created_at,updated_at FROM journal_pages ORDER BY id',
    );
    const links = allRows<{ journal_page_id: string; world_id: string; created_at: string }>(
      database,
      'SELECT journal_page_id,world_id,created_at FROM journal_page_world_links ORDER BY journal_page_id',
    );

    expect(foldersAfter.map(({ owner_user_id: _ownerUserId, ...folder }) => folder)).toEqual(foldersBefore);
    expect(pagesAfter.map(({ owner_user_id: _ownerUserId, ...page }) => page)).toEqual(pagesBefore);
    expect(foldersAfter.every((folder) => folder.owner_user_id === 'legacy_user')).toBe(true);
    expect(pagesAfter.every((page) => page.owner_user_id === 'legacy_user')).toBe(true);
    expect(links).toEqual([
      { journal_page_id: 'legacy_page_1', world_id: 'legacy_world_1', created_at: '2025-06-01T10:00:00.000Z' },
      { journal_page_id: 'legacy_page_2', world_id: 'legacy_world_2', created_at: '2025-07-01T10:00:00.000Z' },
    ]);

    const orphanCounts = database.prepare(`SELECT
      (SELECT count(*) FROM journal_folders f LEFT JOIN users u ON u.id=f.owner_user_id WHERE u.id IS NULL) +
      (SELECT count(*) FROM journal_folders f LEFT JOIN journal_folders parent ON parent.id=f.parent_folder_id WHERE f.parent_folder_id IS NOT NULL AND parent.id IS NULL) +
      (SELECT count(*) FROM journal_pages p LEFT JOIN users u ON u.id=p.owner_user_id WHERE u.id IS NULL) +
      (SELECT count(*) FROM journal_pages p LEFT JOIN journal_folders f ON f.id=p.folder_id WHERE p.folder_id IS NOT NULL AND f.id IS NULL) +
      (SELECT count(*) FROM journal_page_world_links l LEFT JOIN journal_pages p ON p.id=l.journal_page_id LEFT JOIN worlds w ON w.id=l.world_id WHERE p.id IS NULL OR w.id IS NULL)
      AS count`).get() as { count: number };
    expect(orphanCounts.count).toBe(0);
    expect(allRows(database, 'PRAGMA foreign_key_check')).toEqual([]);
  });
});
