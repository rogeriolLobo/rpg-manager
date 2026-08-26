import type { Context } from 'hono';
import { Hono } from 'hono';
import { journalFolderInputSchema, journalPageCreateInputSchema, journalPageInputSchema, type JournalPageInput } from '../../shared/validation/schemas';
import { authorizedWorld, ownedWorld } from '../content/authorization';
import { getRevision, listRevisions, parseRevisionNumber, parseSnapshot, recordRevisionStatement } from '../content/revisions';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

interface JournalPageRow {
  id: string;
  folderId: string | null;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  worldIdsJson: string;
}

export const journalRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

async function validateJournalFolder(env: Env, ownerUserId: string, folderId: string | null, parentFolderId: string | null): Promise<void> {
  if (!parentFolderId) return;
  if (parentFolderId === folderId) throw new ApiError(422, 'INVALID_FOLDER_PARENT', 'Uma pasta não pode ser pai de si mesma.');
  const parent = await env.DB.prepare('SELECT id FROM journal_folders WHERE id=? AND owner_user_id=?').bind(parentFolderId, ownerUserId).first();
  if (!parent) throw new ApiError(422, 'INVALID_FOLDER_PARENT', 'Pasta pai inválida.');
  if (!folderId) return;
  const cycle = await env.DB.prepare(`WITH RECURSIVE tree(id) AS (
    SELECT id FROM journal_folders WHERE parent_folder_id=? AND owner_user_id=?
    UNION ALL
    SELECT f.id FROM journal_folders f JOIN tree ON f.parent_folder_id=tree.id WHERE f.owner_user_id=?
  ) SELECT id FROM tree WHERE id=?`).bind(folderId, ownerUserId, ownerUserId, parentFolderId).first();
  if (cycle) throw new ApiError(422, 'INVALID_FOLDER_PARENT', 'A hierarquia de pastas não pode ser cíclica.');
}

async function validatePageFolder(env: Env, ownerUserId: string, folderId: string | null): Promise<void> {
  if (!folderId) return;
  const folder = await env.DB.prepare('SELECT id FROM journal_folders WHERE id=? AND owner_user_id=?').bind(folderId, ownerUserId).first();
  if (!folder) throw new ApiError(422, 'INVALID_JOURNAL_FOLDER', 'Pasta do Diário inválida.');
}

async function requireOwnedPage(env: Env, ownerUserId: string, pageId: string): Promise<void> {
  const page = await env.DB.prepare('SELECT id FROM journal_pages WHERE id=? AND owner_user_id=?').bind(pageId, ownerUserId).first();
  if (!page) throw new ApiError(404, 'NOT_FOUND', 'Página não encontrada.');
}

async function requireLinkedOwnedPage(env: Env, ownerUserId: string, pageId: string, worldId: string): Promise<void> {
  const page = await env.DB.prepare(`SELECT p.id FROM journal_pages p
    JOIN journal_page_world_links l ON l.journal_page_id=p.id
    WHERE p.id=? AND p.owner_user_id=? AND l.world_id=?`).bind(pageId, ownerUserId, worldId).first();
  if (!page) throw new ApiError(404, 'NOT_FOUND', 'Página não encontrada.');
}

async function listJournal(env: Env, ownerUserId: string, worldId?: string) {
  const worldPredicate = worldId
    ? 'AND EXISTS(SELECT 1 FROM journal_page_world_links filter_link WHERE filter_link.journal_page_id=p.id AND filter_link.world_id=?)'
    : '';
  const pageStatement = env.DB.prepare(`SELECT p.id,p.folder_id folderId,p.title,p.content,p.created_at createdAt,p.updated_at updatedAt,
    (SELECT json_group_array(world_id) FROM journal_page_world_links WHERE journal_page_id=p.id) worldIdsJson
    FROM journal_pages p WHERE p.owner_user_id=? ${worldPredicate} ORDER BY p.updated_at DESC`)
    .bind(ownerUserId, ...(worldId ? [worldId] : []));
  const [folders, pages] = await env.DB.batch([
    env.DB.prepare('SELECT id,parent_folder_id parentFolderId,name,sort_order sortOrder FROM journal_folders WHERE owner_user_id=? ORDER BY sort_order,name COLLATE NOCASE').bind(ownerUserId),
    pageStatement,
  ]);
  const pageRows = pages.results as unknown as JournalPageRow[];
  return {
    folders: folders.results,
    pages: pageRows.map(({ worldIdsJson, ...page }) => ({ ...page, worldIds: JSON.parse(worldIdsJson || '[]') as string[] })),
  };
}

async function createFolder(c: AppContext) {
  const ownerUserId = c.get('user').id;
  const input = await readJson(c, journalFolderInputSchema);
  await validateJournalFolder(c.env, ownerUserId, null, input.parentFolderId);
  const id = crypto.randomUUID();
  const now = nowIso();
  await c.env.DB.prepare('INSERT INTO journal_folders (id,owner_user_id,parent_folder_id,name,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .bind(id, ownerUserId, input.parentFolderId, input.name, now, now).run();
  return { id, name: input.name, parentFolderId: input.parentFolderId };
}

async function updateFolder(c: AppContext, folderId: string): Promise<void> {
  const ownerUserId = c.get('user').id;
  const input = await readJson(c, journalFolderInputSchema);
  await requireOwnedFolder(c.env, ownerUserId, folderId);
  await validateJournalFolder(c.env, ownerUserId, folderId, input.parentFolderId);
  await c.env.DB.prepare('UPDATE journal_folders SET parent_folder_id=?,name=?,updated_at=? WHERE id=? AND owner_user_id=?')
    .bind(input.parentFolderId, input.name, nowIso(), folderId, ownerUserId).run();
}

async function requireOwnedFolder(env: Env, ownerUserId: string, folderId: string): Promise<void> {
  const folder = await env.DB.prepare('SELECT id FROM journal_folders WHERE id=? AND owner_user_id=?').bind(folderId, ownerUserId).first();
  if (!folder) throw new ApiError(404, 'NOT_FOUND', 'Pasta não encontrada.');
}

async function deleteFolder(c: AppContext, folderId: string): Promise<void> {
  const ownerUserId = c.get('user').id;
  await requireOwnedFolder(c.env, ownerUserId, folderId);
  const child = await c.env.DB.prepare('SELECT id FROM journal_folders WHERE parent_folder_id=? AND owner_user_id=? LIMIT 1').bind(folderId, ownerUserId).first();
  if (child) throw new ApiError(409, 'FOLDER_HAS_CHILDREN', 'Mova ou exclua as subpastas primeiro.');
  await c.env.DB.prepare('DELETE FROM journal_folders WHERE id=? AND owner_user_id=?').bind(folderId, ownerUserId).run();
}

async function createPage(c: AppContext, legacyWorldId?: string) {
  const ownerUserId = c.get('user').id;
  const input = await readJson(c, journalPageCreateInputSchema);
  if (legacyWorldId && input.worldId && input.worldId !== legacyWorldId) {
    throw new ApiError(422, 'JOURNAL_WORLD_MISMATCH', 'O World do payload não corresponde à rota legada.');
  }
  const worldId = legacyWorldId ?? input.worldId;
  const pageInput: JournalPageInput = { title: input.title, content: input.content, folderId: input.folderId };
  await validatePageFolder(c.env, ownerUserId, pageInput.folderId);
  if (worldId) await authorizedWorld(c, worldId);
  const id = crypto.randomUUID();
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare('INSERT INTO journal_pages (id,owner_user_id,folder_id,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, ownerUserId, pageInput.folderId, pageInput.title, pageInput.content, now, now),
    recordRevisionStatement(c.env.DB, { resourceType: 'JOURNAL_PAGE', resourceId: id, ownerUserId, actorUserId: ownerUserId, action: 'CREATE', snapshot: pageInput, now }),
  ];
  if (worldId) {
    statements.push(c.env.DB.prepare('INSERT INTO journal_page_world_links (journal_page_id,world_id,created_at) VALUES (?,?,?)').bind(id, worldId, now));
  }
  await c.env.DB.batch(statements);
  return { id, ...pageInput, createdAt: now, updatedAt: now, worldIds: worldId ? [worldId] : [] };
}

async function updatePage(c: AppContext, pageId: string): Promise<void> {
  const ownerUserId = c.get('user').id;
  const input = await readJson(c, journalPageInputSchema);
  await requireOwnedPage(c.env, ownerUserId, pageId);
  await validatePageFolder(c.env, ownerUserId, input.folderId);
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE journal_pages SET folder_id=?,title=?,content=?,updated_at=? WHERE id=? AND owner_user_id=?')
      .bind(input.folderId, input.title, input.content, now, pageId, ownerUserId),
    recordRevisionStatement(c.env.DB, { resourceType: 'JOURNAL_PAGE', resourceId: pageId, ownerUserId, actorUserId: ownerUserId, action: 'UPDATE', snapshot: input, now }),
  ]);
}

async function revisionList(c: AppContext, pageId: string) {
  const query = c.req.query();
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(query.pageSize ?? '20', 10) || 20));
  const result = await listRevisions(c.env.DB, 'JOURNAL_PAGE', pageId, page, pageSize);
  return { items: result.items, pagination: { page, pageSize, total: result.total } };
}

async function revisionDetails(c: AppContext, pageId: string, revisionNumber: number) {
  const row = await getRevision(c.env.DB, 'JOURNAL_PAGE', pageId, revisionNumber);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Revisão não encontrada.');
  return { ...row, snapshot: JSON.parse(row.snapshotRaw) as JournalPageInput };
}

async function restoreRevision(c: AppContext, pageId: string, revisionNumber: number): Promise<void> {
  const ownerUserId = c.get('user').id;
  const revisionRow = await getRevision(c.env.DB, 'JOURNAL_PAGE', pageId, revisionNumber);
  if (!revisionRow) throw new ApiError(404, 'NOT_FOUND', 'Revisão não encontrada.');
  const input = parseSnapshot(journalPageInputSchema, revisionRow.snapshotRaw);
  await validatePageFolder(c.env, ownerUserId, input.folderId);
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE journal_pages SET folder_id=?,title=?,content=?,updated_at=? WHERE id=? AND owner_user_id=?')
      .bind(input.folderId, input.title, input.content, now, pageId, ownerUserId),
    recordRevisionStatement(c.env.DB, { resourceType: 'JOURNAL_PAGE', resourceId: pageId, ownerUserId, actorUserId: ownerUserId, action: 'RESTORE', snapshot: input, restoredFromRevisionNumber: revisionNumber, now }),
  ]);
}

journalRoutes.get('/', async (c) => c.json(await listJournal(c.env, c.get('user').id)));

journalRoutes.post('/folders', async (c) => c.json({ item: await createFolder(c) }, 201));

journalRoutes.patch('/folders/:folderId', async (c) => {
  await updateFolder(c, c.req.param('folderId'));
  return c.json({ success: true });
});

journalRoutes.delete('/folders/:folderId', async (c) => {
  await deleteFolder(c, c.req.param('folderId'));
  return c.body(null, 204);
});

journalRoutes.post('/pages', async (c) => c.json({ item: await createPage(c) }, 201));

journalRoutes.patch('/pages/:pageId', async (c) => {
  await updatePage(c, c.req.param('pageId'));
  return c.json({ success: true });
});

journalRoutes.delete('/pages/:pageId', async (c) => {
  const ownerUserId = c.get('user').id;
  const result = await c.env.DB.prepare('DELETE FROM journal_pages WHERE id=? AND owner_user_id=?').bind(c.req.param('pageId'), ownerUserId).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Página não encontrada.');
  return c.body(null, 204);
});

journalRoutes.get('/pages/:pageId/revisions', async (c) => {
  const pageId = c.req.param('pageId');
  await requireOwnedPage(c.env, c.get('user').id, pageId);
  return c.json(await revisionList(c, pageId));
});

journalRoutes.get('/pages/:pageId/revisions/:number', async (c) => {
  const pageId = c.req.param('pageId');
  await requireOwnedPage(c.env, c.get('user').id, pageId);
  return c.json({ item: await revisionDetails(c, pageId, parseRevisionNumber(c.req.param('number'))) });
});

journalRoutes.post('/pages/:pageId/revisions/:number/restore', async (c) => {
  const pageId = c.req.param('pageId');
  await requireOwnedPage(c.env, c.get('user').id, pageId);
  await restoreRevision(c, pageId, parseRevisionNumber(c.req.param('number')));
  return c.json({ success: true });
});

// World é apenas contexto de descoberta. A página continua owned exclusivamente pelo usuário.
journalRoutes.post('/pages/:pageId/worlds/:worldId', async (c) => {
  const ownerUserId = c.get('user').id;
  const pageId = c.req.param('pageId');
  const worldId = c.req.param('worldId');
  await requireOwnedPage(c.env, ownerUserId, pageId);
  await authorizedWorld(c, worldId);
  await c.env.DB.prepare('INSERT OR IGNORE INTO journal_page_world_links (journal_page_id,world_id,created_at) VALUES (?,?,?)')
    .bind(pageId, worldId, nowIso()).run();
  return c.body(null, 204);
});

journalRoutes.delete('/pages/:pageId/worlds/:worldId', async (c) => {
  const ownerUserId = c.get('user').id;
  const pageId = c.req.param('pageId');
  await requireOwnedPage(c.env, ownerUserId, pageId);
  await c.env.DB.prepare('DELETE FROM journal_page_world_links WHERE journal_page_id=? AND world_id=?').bind(pageId, c.req.param('worldId')).run();
  return c.body(null, 204);
});

// Adapters temporários para clientes ainda publicados com rotas World-first.
journalRoutes.get('/:worldId', async (c) => {
  const world = await ownedWorld(c, c.req.param('worldId'));
  const journal = await listJournal(c.env, c.get('user').id, world.id);
  return c.json({ world: { id: world.id, name: String(world.name) }, ...journal });
});

journalRoutes.post('/:worldId/folders', async (c) => {
  await ownedWorld(c, c.req.param('worldId'));
  return c.json({ item: await createFolder(c) }, 201);
});

journalRoutes.patch('/:worldId/folders/:folderId', async (c) => {
  await ownedWorld(c, c.req.param('worldId'));
  await updateFolder(c, c.req.param('folderId'));
  return c.json({ success: true });
});

journalRoutes.delete('/:worldId/folders/:folderId', async (c) => {
  await ownedWorld(c, c.req.param('worldId'));
  await deleteFolder(c, c.req.param('folderId'));
  return c.body(null, 204);
});

journalRoutes.post('/:worldId/pages', async (c) => {
  const worldId = c.req.param('worldId');
  await ownedWorld(c, worldId);
  return c.json({ item: await createPage(c, worldId) }, 201);
});

journalRoutes.patch('/:worldId/pages/:pageId', async (c) => {
  const worldId = c.req.param('worldId');
  const pageId = c.req.param('pageId');
  await ownedWorld(c, worldId);
  await requireLinkedOwnedPage(c.env, c.get('user').id, pageId, worldId);
  await updatePage(c, pageId);
  return c.json({ success: true });
});

journalRoutes.delete('/:worldId/pages/:pageId', async (c) => {
  const worldId = c.req.param('worldId');
  const pageId = c.req.param('pageId');
  await ownedWorld(c, worldId);
  await requireLinkedOwnedPage(c.env, c.get('user').id, pageId, worldId);
  await c.env.DB.prepare('DELETE FROM journal_pages WHERE id=? AND owner_user_id=?').bind(pageId, c.get('user').id).run();
  return c.body(null, 204);
});

journalRoutes.get('/:worldId/pages/:pageId/revisions', async (c) => {
  const worldId = c.req.param('worldId');
  const pageId = c.req.param('pageId');
  await ownedWorld(c, worldId);
  await requireLinkedOwnedPage(c.env, c.get('user').id, pageId, worldId);
  return c.json(await revisionList(c, pageId));
});

journalRoutes.get('/:worldId/pages/:pageId/revisions/:number', async (c) => {
  const worldId = c.req.param('worldId');
  const pageId = c.req.param('pageId');
  await ownedWorld(c, worldId);
  await requireLinkedOwnedPage(c.env, c.get('user').id, pageId, worldId);
  return c.json({ item: await revisionDetails(c, pageId, parseRevisionNumber(c.req.param('number'))) });
});

journalRoutes.post('/:worldId/pages/:pageId/revisions/:number/restore', async (c) => {
  const worldId = c.req.param('worldId');
  const pageId = c.req.param('pageId');
  await ownedWorld(c, worldId);
  await requireLinkedOwnedPage(c.env, c.get('user').id, pageId, worldId);
  await restoreRevision(c, pageId, parseRevisionNumber(c.req.param('number')));
  return c.json({ success: true });
});
