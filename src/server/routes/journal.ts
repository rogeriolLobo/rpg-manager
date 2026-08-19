import { Hono } from 'hono';
import { journalFolderInputSchema, journalPageInputSchema } from '../../shared/validation/schemas';
import { ownedWorld } from '../content/authorization';
import { getRevision, listRevisions, parseRevisionNumber, parseSnapshot, recordRevisionStatement } from '../content/revisions';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

export const journalRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

async function validateJournalFolder(env: Env, worldId: string, folderId: string | null, parentFolderId: string | null): Promise<void> {
  if (!parentFolderId) return;
  if (parentFolderId === folderId) throw new ApiError(422, 'INVALID_FOLDER_PARENT', 'Uma pasta não pode ser pai de si mesma.');
  const parent = await env.DB.prepare('SELECT id FROM journal_folders WHERE id=? AND world_id=?').bind(parentFolderId, worldId).first();
  if (!parent) throw new ApiError(422, 'INVALID_FOLDER_PARENT', 'Pasta pai inválida.');
  if (!folderId) return;
  const cycle = await env.DB.prepare(`WITH RECURSIVE tree(id) AS (
    SELECT id FROM journal_folders WHERE parent_folder_id=?
    UNION ALL SELECT f.id FROM journal_folders f JOIN tree ON f.parent_folder_id=tree.id
  ) SELECT id FROM tree WHERE id=?`).bind(folderId, parentFolderId).first();
  if (cycle) throw new ApiError(422, 'INVALID_FOLDER_PARENT', 'A hierarquia de pastas não pode ser cíclica.');
}

async function validatePageFolder(env: Env, worldId: string, folderId: string | null): Promise<void> {
  if (!folderId) return;
  const folder = await env.DB.prepare('SELECT id FROM journal_folders WHERE id=? AND world_id=?').bind(folderId, worldId).first();
  if (!folder) throw new ApiError(422, 'INVALID_JOURNAL_FOLDER', 'Pasta do Diário inválida.');
}

journalRoutes.get('/:worldId', async (c) => {
  const worldId = c.req.param('worldId');
  const world = await ownedWorld(c, worldId);
  const [folders, pages] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id,parent_folder_id parentFolderId,name,sort_order sortOrder FROM journal_folders WHERE world_id=? ORDER BY sort_order,name COLLATE NOCASE').bind(worldId),
    c.env.DB.prepare('SELECT id,folder_id folderId,title,content,created_at createdAt,updated_at updatedAt FROM journal_pages WHERE world_id=? ORDER BY updated_at DESC').bind(worldId),
  ]);
  return c.json({ world: { id: world.id, name: String(world.name) }, folders: folders.results, pages: pages.results });
});

journalRoutes.post('/:worldId/folders', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const input = await readJson(c, journalFolderInputSchema); await validateJournalFolder(c.env, worldId, null, input.parentFolderId);
  const id = crypto.randomUUID(), now = nowIso();
  await c.env.DB.prepare('INSERT INTO journal_folders (id,world_id,parent_folder_id,name,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .bind(id, worldId, input.parentFolderId, input.name, now, now).run();
  return c.json({ item: { id, name: input.name, parentFolderId: input.parentFolderId } }, 201);
});

journalRoutes.patch('/:worldId/folders/:folderId', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const folderId = c.req.param('folderId');
  const folder = await c.env.DB.prepare('SELECT id FROM journal_folders WHERE id=? AND world_id=?').bind(folderId, worldId).first();
  if (!folder) throw new ApiError(404, 'NOT_FOUND', 'Pasta não encontrada.');
  const input = await readJson(c, journalFolderInputSchema); await validateJournalFolder(c.env, worldId, folderId, input.parentFolderId);
  await c.env.DB.prepare('UPDATE journal_folders SET parent_folder_id=?,name=?,updated_at=? WHERE id=? AND world_id=?')
    .bind(input.parentFolderId, input.name, nowIso(), folderId, worldId).run();
  return c.json({ success: true });
});

journalRoutes.delete('/:worldId/folders/:folderId', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId); const folderId = c.req.param('folderId');
  const child = await c.env.DB.prepare('SELECT id FROM journal_folders WHERE parent_folder_id=? LIMIT 1').bind(folderId).first();
  if (child) throw new ApiError(409, 'FOLDER_HAS_CHILDREN', 'Mova ou exclua as subpastas primeiro.');
  const result = await c.env.DB.prepare('DELETE FROM journal_folders WHERE id=? AND world_id=?').bind(folderId, worldId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Pasta não encontrada.');
  return c.body(null, 204);
});

journalRoutes.post('/:worldId/pages', async (c) => {
  const worldId = c.req.param('worldId'); const world = await ownedWorld(c, worldId);
  const input = await readJson(c, journalPageInputSchema); await validatePageFolder(c.env, worldId, input.folderId);
  const id = crypto.randomUUID(), now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO journal_pages (id,world_id,folder_id,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, worldId, input.folderId, input.title, input.content, now, now),
    // F-001: revisão inicial, mesma transação do create.
    recordRevisionStatement(c.env.DB, { resourceType: 'JOURNAL_PAGE', resourceId: id, ownerUserId: world.owner_user_id, actorUserId: c.get('user').id, action: 'CREATE', snapshot: input, now }),
  ]);
  return c.json({ item: { id, ...input, createdAt: now, updatedAt: now } }, 201);
});

journalRoutes.patch('/:worldId/pages/:pageId', async (c) => {
  const worldId = c.req.param('worldId'); const world = await ownedWorld(c, worldId);
  const input = await readJson(c, journalPageInputSchema); await validatePageFolder(c.env, worldId, input.folderId);
  const pageId = c.req.param('pageId'); const now = nowIso();
  const [result] = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE journal_pages SET folder_id=?,title=?,content=?,updated_at=? WHERE id=? AND world_id=?')
      .bind(input.folderId, input.title, input.content, now, pageId, worldId),
    recordRevisionStatement(c.env.DB, { resourceType: 'JOURNAL_PAGE', resourceId: pageId, ownerUserId: world.owner_user_id, actorUserId: c.get('user').id, action: 'UPDATE', snapshot: input, now }),
  ]);
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Página não encontrada.');
  return c.json({ success: true });
});

journalRoutes.delete('/:worldId/pages/:pageId', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const result = await c.env.DB.prepare('DELETE FROM journal_pages WHERE id=? AND world_id=?').bind(c.req.param('pageId'), worldId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Página não encontrada.');
  return c.body(null, 204);
});

// F-001: histórico é owner-only — Journal já é inteiramente owner-only (nem GET de lista é
// compartilhado, ver `/:worldId` acima), então isso não amplia nem restringe nada além do que já
// existe.
journalRoutes.get('/:worldId/pages/:pageId/revisions', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const pageId = c.req.param('pageId');
  const page = await c.env.DB.prepare('SELECT id FROM journal_pages WHERE id=? AND world_id=?').bind(pageId, worldId).first();
  if (!page) throw new ApiError(404, 'NOT_FOUND', 'Página não encontrada.');
  const query = c.req.query();
  const pageNum = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(query.pageSize ?? '20', 10) || 20));
  const result = await listRevisions(c.env.DB, 'JOURNAL_PAGE', pageId, pageNum, pageSize);
  return c.json({ items: result.items, pagination: { page: pageNum, pageSize, total: result.total } });
});

journalRoutes.get('/:worldId/pages/:pageId/revisions/:number', async (c) => {
  const worldId = c.req.param('worldId'); await ownedWorld(c, worldId);
  const pageId = c.req.param('pageId'); const number = parseRevisionNumber(c.req.param('number'));
  const row = await getRevision(c.env.DB, 'JOURNAL_PAGE', pageId, number);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Revisão não encontrada.');
  return c.json({ item: { ...row, snapshot: JSON.parse(row.snapshotRaw) } });
});

journalRoutes.post('/:worldId/pages/:pageId/revisions/:number/restore', async (c) => {
  const worldId = c.req.param('worldId'); const world = await ownedWorld(c, worldId);
  const pageId = c.req.param('pageId'); const number = parseRevisionNumber(c.req.param('number'));
  const revisionRow = await getRevision(c.env.DB, 'JOURNAL_PAGE', pageId, number);
  if (!revisionRow) throw new ApiError(404, 'NOT_FOUND', 'Revisão não encontrada.');
  const input = parseSnapshot(journalPageInputSchema, revisionRow.snapshotRaw);
  await validatePageFolder(c.env, worldId, input.folderId);
  const now = nowIso();
  const [result] = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE journal_pages SET folder_id=?,title=?,content=?,updated_at=? WHERE id=? AND world_id=?')
      .bind(input.folderId, input.title, input.content, now, pageId, worldId),
    recordRevisionStatement(c.env.DB, { resourceType: 'JOURNAL_PAGE', resourceId: pageId, ownerUserId: world.owner_user_id, actorUserId: c.get('user').id, action: 'RESTORE', snapshot: input, restoredFromRevisionNumber: number, now }),
  ]);
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Página não encontrada.');
  return c.json({ success: true });
});
