import { Hono, type Context } from 'hono';
import { mapDocumentInputSchema, mapEditorDocumentSchema, mapEditorSaveSchema, type MapEditorDocumentInput } from '../../shared/validation/schemas';
import { authorizedWorld } from '../content/authorization';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

interface MapDocumentRow {
  id: string;
  owner_user_id: string;
  name: string;
  description: string;
  map_type: string;
  width: number;
  height: number;
  grid_type: string;
  grid_size: number;
  document_json: string;
  document_version: number;
  background_asset_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  world_ids?: string | null;
}

interface WorldLinkRow {
  world_id: string;
  name: string;
}

export const mapRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const EMPTY_MAP_DOCUMENT: MapEditorDocumentInput = {
  version: 1,
  backgroundColor: '#f5f1e8',
  layers: [],
};

function parseMapDocument(value: string): MapEditorDocumentInput {
  try {
    const parsed = mapEditorDocumentSchema.safeParse(JSON.parse(value));
    if (parsed.success) return parsed.data;
  } catch {
    // A fallback mantém o documento abrível caso um backup antigo não tenha conteúdo de editor.
  }
  return EMPTY_MAP_DOCUMENT;
}

function present(row: MapDocumentRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    mapType: row.map_type,
    width: row.width,
    height: row.height,
    gridType: row.grid_type,
    gridSize: row.grid_size,
    document: parseMapDocument(row.document_json),
    documentVersion: row.document_version,
    backgroundAssetId: row.background_asset_id,
    backgroundUrl: row.background_asset_id ? `/api/v1/files/${row.background_asset_id}/content` : null,
    worldIds: row.world_ids ? row.world_ids.split(',').filter(Boolean) : [],
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

async function ownedMap(c: AppContext, mapId: string): Promise<MapDocumentRow> {
  const row = await c.env.DB.prepare('SELECT * FROM map_documents WHERE id=? AND owner_user_id=?')
    .bind(mapId, c.get('user').id)
    .first<MapDocumentRow>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Mapa não encontrado.');
  return row;
}

async function editableMap(c: AppContext, mapId: string): Promise<MapDocumentRow> {
  const row = await ownedMap(c, mapId);
  if (row.archived_at) throw new ApiError(409, 'MAP_ARCHIVED', 'Restaure o mapa antes de editá-lo.');
  return row;
}

async function validateBackgroundAsset(c: AppContext, assetId: string | null): Promise<void> {
  if (!assetId) return;
  const asset = await c.env.DB.prepare(
    "SELECT id FROM file_assets WHERE id=? AND owner_user_id=? AND content_type IN ('image/jpeg','image/png','image/webp')",
  ).bind(assetId, c.get('user').id).first();
  if (!asset) {
    throw new ApiError(
      422,
      'INVALID_BACKGROUND_ASSET',
      'A imagem de fundo não pertence à sua conta ou não é um formato suportado.',
    );
  }
}

mapRoutes.get('/', async (c) => {
  const userId = c.get('user').id;
  const worldId = c.req.query('worldId')?.trim() || null;
  const q = c.req.query('q')?.trim().slice(0, 160) || null;
  const includeArchived = c.req.query('archived') === '1';

  if (worldId) await authorizedWorld(c, worldId);

  const conditions = ['d.owner_user_id=?', includeArchived ? '1=1' : 'd.archived_at IS NULL'];
  const filters: unknown[] = [userId];
  if (worldId) {
    conditions.push('EXISTS (SELECT 1 FROM map_document_world_links f WHERE f.map_document_id=d.id AND f.world_id=?)');
    filters.push(worldId);
  }
  if (q) {
    const search = `%${escapeLike(q)}%`;
    conditions.push("(d.name LIKE ? ESCAPE '\\' OR d.description LIKE ? ESCAPE '\\')");
    filters.push(search, search);
  }

  // Só devolve IDs de Worlds que continuam autorizados ao usuário. Um vínculo antigo não
  // pode vazar o ID de um World depois que a membership do usuário for removida.
  const rows = await c.env.DB.prepare(`
    SELECT d.*,
      (
        SELECT GROUP_CONCAT(l.world_id)
        FROM map_document_world_links l
        JOIN worlds w ON w.id=l.world_id
        WHERE l.map_document_id=d.id
          AND (
            w.owner_user_id=? OR
            (w.archived_at IS NULL AND w.visibility='GROUP' AND EXISTS(
              SELECT 1 FROM world_members wm WHERE wm.world_id=w.id AND wm.user_id=?
            ))
          )
      ) world_ids
    FROM map_documents d
    WHERE ${conditions.join(' AND ')}
    ORDER BY d.updated_at DESC
    LIMIT 200
  `).bind(userId, userId, ...filters).all<MapDocumentRow>();

  return c.json({ items: rows.results.map(present) });
});

mapRoutes.post('/', async (c) => {
  const input = await readJson(c, mapDocumentInputSchema);
  await validateBackgroundAsset(c, input.backgroundAssetId);
  const id = crypto.randomUUID();
  const now = nowIso();
  const userId = c.get('user').id;

  await c.env.DB.prepare(`
    INSERT INTO map_documents (
      id,owner_user_id,name,description,map_type,width,height,grid_type,grid_size,
      background_asset_id,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    id,
    userId,
    input.name,
    input.description,
    input.mapType,
    input.width,
    input.height,
    input.gridType,
    input.gridSize,
    input.backgroundAssetId,
    now,
    now,
  ).run();

  return c.json({
    item: present({
      id,
      owner_user_id: userId,
      name: input.name,
      description: input.description,
      map_type: input.mapType,
      width: input.width,
      height: input.height,
      grid_type: input.gridType,
      grid_size: input.gridSize,
      document_json: JSON.stringify(EMPTY_MAP_DOCUMENT),
      document_version: 0,
      background_asset_id: input.backgroundAssetId,
      created_at: now,
      updated_at: now,
      archived_at: null,
    }),
  }, 201);
});

mapRoutes.get('/:mapId', async (c) => {
  const row = await ownedMap(c, c.req.param('mapId'));
  const userId = c.get('user').id;
  const links = await c.env.DB.prepare(`
    SELECT l.world_id,w.name
    FROM map_document_world_links l
    JOIN worlds w ON w.id=l.world_id
    WHERE l.map_document_id=?
      AND (
        w.owner_user_id=? OR
        (w.archived_at IS NULL AND w.visibility='GROUP' AND EXISTS(
          SELECT 1 FROM world_members wm WHERE wm.world_id=w.id AND wm.user_id=?
        ))
      )
    ORDER BY w.name
  `).bind(row.id, userId, userId).all<WorldLinkRow>();

  return c.json({
    item: {
      ...present(row),
      worlds: links.results.map((link) => ({ id: link.world_id, name: link.name })),
    },
  });
});

mapRoutes.patch('/:mapId', async (c) => {
  const mapId = c.req.param('mapId');
  await editableMap(c, mapId);
  const input = await readJson(c, mapDocumentInputSchema);
  await validateBackgroundAsset(c, input.backgroundAssetId);

  await c.env.DB.prepare(`
    UPDATE map_documents
    SET name=?,description=?,map_type=?,width=?,height=?,grid_type=?,grid_size=?,background_asset_id=?,updated_at=?
    WHERE id=? AND owner_user_id=?
  `).bind(
    input.name,
    input.description,
    input.mapType,
    input.width,
    input.height,
    input.gridType,
    input.gridSize,
    input.backgroundAssetId,
    nowIso(),
    mapId,
    c.get('user').id,
  ).run();
  return c.json({ success: true });
});

mapRoutes.patch('/:mapId/content', async (c) => {
  const mapId = c.req.param('mapId');
  await editableMap(c, mapId);
  const input = await readJson(c, mapEditorSaveSchema);
  const nextVersion = input.expectedVersion + 1;
  const updatedAt = nowIso();
  const result = await c.env.DB.prepare(`
    UPDATE map_documents
    SET document_json=?,document_version=?,updated_at=?
    WHERE id=? AND owner_user_id=? AND document_version=? AND archived_at IS NULL
  `).bind(
    JSON.stringify(input.document),
    nextVersion,
    updatedAt,
    mapId,
    c.get('user').id,
    input.expectedVersion,
  ).run();
  if (!result.meta.changes) {
    throw new ApiError(409, 'MAP_VERSION_CONFLICT', 'O mapa foi alterado em outra aba. Recarregue antes de salvar novamente.');
  }
  return c.json({ success: true, version: nextVersion, updatedAt });
});

mapRoutes.delete('/:mapId', async (c) => {
  const mapId = c.req.param('mapId');
  await ownedMap(c, mapId);
  await c.env.DB.prepare('DELETE FROM map_documents WHERE id=? AND owner_user_id=?')
    .bind(mapId, c.get('user').id)
    .run();
  return c.body(null, 204);
});

mapRoutes.post('/:mapId/archive', async (c) => {
  const mapId = c.req.param('mapId');
  const row = await ownedMap(c, mapId);
  if (row.archived_at) throw new ApiError(409, 'ALREADY_ARCHIVED', 'O mapa já está arquivado.');
  const now = nowIso();
  await c.env.DB.prepare('UPDATE map_documents SET archived_at=?,updated_at=? WHERE id=? AND owner_user_id=?')
    .bind(now, now, mapId, c.get('user').id)
    .run();
  return c.json({ success: true });
});

mapRoutes.post('/:mapId/restore', async (c) => {
  const mapId = c.req.param('mapId');
  const row = await ownedMap(c, mapId);
  if (!row.archived_at) throw new ApiError(409, 'NOT_ARCHIVED', 'O mapa não está arquivado.');
  await c.env.DB.prepare('UPDATE map_documents SET archived_at=NULL,updated_at=? WHERE id=? AND owner_user_id=?')
    .bind(nowIso(), mapId, c.get('user').id)
    .run();
  return c.json({ success: true });
});

mapRoutes.post('/:mapId/duplicate', async (c) => {
  const source = await ownedMap(c, c.req.param('mapId'));
  const id = crypto.randomUUID();
  const now = nowIso();
  const copyName = `${source.name} — cópia`.slice(0, 160);
  const userId = c.get('user').id;
  const links = await c.env.DB.prepare(`
    SELECT l.world_id
    FROM map_document_world_links l
    JOIN worlds w ON w.id=l.world_id
    WHERE l.map_document_id=?
      AND (
        w.owner_user_id=? OR
        (w.archived_at IS NULL AND w.visibility='GROUP' AND EXISTS(
          SELECT 1 FROM world_members wm WHERE wm.world_id=w.id AND wm.user_id=?
        ))
      )
  `)
    .bind(source.id, userId, userId)
    .all<{ world_id: string }>();

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`
      INSERT INTO map_documents (
        id,owner_user_id,name,description,map_type,width,height,grid_type,grid_size,
        document_json,document_version,background_asset_id,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id,
      userId,
      copyName,
      source.description,
      source.map_type,
      source.width,
      source.height,
      source.grid_type,
      source.grid_size,
      source.document_json,
      0,
      source.background_asset_id,
      now,
      now,
    ),
    ...links.results.map((link) => c.env.DB.prepare(
      'INSERT INTO map_document_world_links (map_document_id,world_id,created_at) VALUES (?,?,?)',
    ).bind(id, link.world_id, now)),
  ];

  await c.env.DB.batch(statements);
  return c.json({ id }, 201);
});

mapRoutes.post('/:mapId/worlds/:worldId', async (c) => {
  const mapId = c.req.param('mapId');
  const worldId = c.req.param('worldId');
  await editableMap(c, mapId);
  await authorizedWorld(c, worldId);
  const result = await c.env.DB.prepare(
    'INSERT OR IGNORE INTO map_document_world_links (map_document_id,world_id,created_at) VALUES (?,?,?)',
  ).bind(mapId, worldId, nowIso()).run();
  return c.json({ success: true, created: Boolean(result.meta.changes) }, result.meta.changes ? 201 : 200);
});

mapRoutes.delete('/:mapId/worlds/:worldId', async (c) => {
  const mapId = c.req.param('mapId');
  const worldId = c.req.param('worldId');
  await editableMap(c, mapId);
  await c.env.DB.prepare('DELETE FROM map_document_world_links WHERE map_document_id=? AND world_id=?')
    .bind(mapId, worldId)
    .run();
  return c.body(null, 204);
});
