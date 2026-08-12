import { Hono, type Context } from 'hono';
import { calculateRpgNextAction, calculateRpgReadiness, calculateRpgRecommendationScore, type RecommendationCandidate } from '../../domain/rpg/recommendation';
import { rpgInputSchema } from '../../shared/validation/schemas';
import { ApiError, cleanNullable, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

export const rpgRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

interface RpgRow {
  id: string; title: string; category_id: string | null; category_name: string | null; subgenre_id: string | null; subgenre_name: string | null;
  reading_status: RecommendationCandidate['readingStatus']; has_played: number; wants_to_play: number; priority: RecommendationCandidate['priority'];
  play_group_notes: string; planned_play_date: string | null; table_status: RecommendationCandidate['tableStatus']; game_master: string; notes: string;
  cover_url: string | null; created_at: string; updated_at: string;
}

function present(row: RpgRow) {
  const candidate: RecommendationCandidate = {
    title: row.title, readingStatus: row.reading_status, hasPlayed: Boolean(row.has_played), wantsToPlay: Boolean(row.wants_to_play),
    priority: row.priority, hasPlayGroup: Boolean(row.play_group_notes.trim()), tableStatus: row.table_status,
  };
  return {
    id: row.id, title: row.title, categoryId: row.category_id, categoryName: row.category_name, subgenreId: row.subgenre_id,
    subgenreName: row.subgenre_name, readingStatus: row.reading_status, hasPlayed: candidate.hasPlayed, wantsToPlay: candidate.wantsToPlay,
    priority: row.priority, playGroupNotes: row.play_group_notes, plannedPlayDate: row.planned_play_date, tableStatus: row.table_status,
    gameMaster: row.game_master, notes: row.notes, coverUrl: row.cover_url, createdAt: row.created_at, updatedAt: row.updated_at,
    recommendationScore: calculateRpgRecommendationScore(candidate), readiness: calculateRpgReadiness(candidate), nextAction: calculateRpgNextAction(candidate),
  };
}

const SELECT = `SELECT r.*,c.name category_name,s.name subgenre_name FROM rpgs r
  LEFT JOIN categories c ON c.id=r.category_id LEFT JOIN subgenres s ON s.id=r.subgenre_id`;

async function validateTaxonomy(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  categoryId: string | null | undefined,
  subgenreId: string | null | undefined,
): Promise<void> {
  if (!subgenreId) return;
  if (!categoryId) throw new ApiError(422, 'INVALID_TAXONOMY', 'O subgênero exige uma categoria.');
  const subgenre = await c.env.DB.prepare('SELECT id FROM subgenres WHERE id=? AND category_id=?').bind(subgenreId, categoryId).first();
  if (!subgenre) throw new ApiError(422, 'INVALID_TAXONOMY', 'O subgênero não pertence à categoria selecionada.');
}

rpgRoutes.get('/metadata', async (c) => {
  const [categories, subgenres] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id,name FROM categories ORDER BY sort_order,name'),
    c.env.DB.prepare('SELECT id,category_id categoryId,name FROM subgenres ORDER BY name'),
  ]);
  return c.json({ categories: categories.results, subgenres: subgenres.results });
});

rpgRoutes.get('/', async (c) => {
  const user = c.get('user');
  const query = c.req.query();
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize ?? '24', 10) || 24));
  const where = ['r.user_id=?']; const values: unknown[] = [user.id];
  if (query.search) { where.push('r.title LIKE ? ESCAPE \'\\\''); values.push(`%${query.search.slice(0, 100).replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`); }
  const filters: Record<string, string> = { category: 'r.category_id', subgenre: 'r.subgenre_id', readingStatus: 'r.reading_status', priority: 'r.priority', tableStatus: 'r.table_status' };
  for (const [key, column] of Object.entries(filters)) if (query[key]) { where.push(`${column}=?`); values.push(query[key]); }
  if (query.hasPlayed === 'true' || query.hasPlayed === 'false') { where.push('r.has_played=?'); values.push(query.hasPlayed === 'true' ? 1 : 0); }
  if (query.wantsToPlay === 'true' || query.wantsToPlay === 'false') { where.push('r.wants_to_play=?'); values.push(query.wantsToPlay === 'true' ? 1 : 0); }
  const recommendationScore = `(CASE WHEN r.wants_to_play=1 THEN 100 ELSE 0 END + CASE r.priority WHEN 'HIGH' THEN 40 WHEN 'MEDIUM' THEN 25 WHEN 'LOW' THEN 10 ELSE 0 END + CASE WHEN r.reading_status='READ' THEN 30 ELSE 0 END + CASE WHEN length(trim(r.play_group_notes))>0 THEN 20 ELSE 0 END + CASE WHEN r.has_played=1 THEN -20 ELSE 20 END + CASE r.table_status WHEN 'PREPARING' THEN 15 WHEN 'SCHEDULED' THEN 20 WHEN 'PLAYING' THEN 25 ELSE 0 END)`;
  const orderBy: Record<string, string> = {
    title: 'r.title COLLATE NOCASE',
    priority: "CASE r.priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END,r.title COLLATE NOCASE",
    readiness: `${recommendationScore} DESC,r.wants_to_play DESC,CASE r.priority WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END DESC,CASE WHEN r.reading_status='READ' THEN 1 ELSE 0 END DESC,CASE WHEN length(trim(r.play_group_notes))>0 THEN 1 ELSE 0 END DESC,r.title COLLATE NOCASE`,
    recent: 'r.created_at DESC',
  };
  const order = orderBy[query.sort ?? 'title'] ?? orderBy.title;
  const clause = where.join(' AND ');
  const [rows, count] = await c.env.DB.batch([
    c.env.DB.prepare(`${SELECT} WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...values, pageSize, (page - 1) * pageSize),
    c.env.DB.prepare(`SELECT COUNT(*) total FROM rpgs r WHERE ${clause}`).bind(...values),
  ]);
  const items = (rows.results as unknown as RpgRow[]).map(present);
  return c.json({ items, pagination: { page, pageSize, total: Number((count.results[0] as { total: number }).total) } });
});

rpgRoutes.post('/', async (c) => {
  const input = await readJson(c, rpgInputSchema); const user = c.get('user'); const id = crypto.randomUUID(); const now = nowIso();
  await validateTaxonomy(c, input.categoryId, input.subgenreId);
  try {
    await c.env.DB.prepare(`INSERT INTO rpgs (id,user_id,title,category_id,subgenre_id,reading_status,has_played,wants_to_play,priority,
      play_group_notes,planned_play_date,table_status,game_master,notes,cover_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, user.id, input.title, cleanNullable(input.categoryId), cleanNullable(input.subgenreId), input.readingStatus, Number(input.hasPlayed), Number(input.wantsToPlay), input.priority,
        input.playGroupNotes, cleanNullable(input.plannedPlayDate), input.tableStatus, input.gameMaster, input.notes, cleanNullable(input.coverUrl), now, now).run();
  } catch (error) { if (String(error).includes('UNIQUE')) throw new ApiError(409, 'DUPLICATE_RPG', 'Já existe um RPG com este título.'); throw error; }
  const row = await c.env.DB.prepare(`${SELECT} WHERE r.id=? AND r.user_id=?`).bind(id, user.id).first<RpgRow>();
  return c.json({ item: present(row!) }, 201);
});

rpgRoutes.get('/:id', async (c) => {
  const row = await c.env.DB.prepare(`${SELECT} WHERE r.id=? AND r.user_id=?`).bind(c.req.param('id'), c.get('user').id).first<RpgRow>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'RPG não encontrado.');
  const campaigns = await c.env.DB.prepare('SELECT id,name,status,next_session_date nextSessionDate FROM campaigns WHERE rpg_id=? AND user_id=? ORDER BY created_at DESC')
    .bind(row.id, c.get('user').id).all();
  return c.json({ item: present(row), campaigns: campaigns.results });
});

rpgRoutes.patch('/:id', async (c) => {
  const input = await readJson(c, rpgInputSchema); const user = c.get('user');
  await validateTaxonomy(c, input.categoryId, input.subgenreId);
  const result = await c.env.DB.prepare(`UPDATE rpgs SET title=?,category_id=?,subgenre_id=?,reading_status=?,has_played=?,wants_to_play=?,priority=?,
    play_group_notes=?,planned_play_date=?,table_status=?,game_master=?,notes=?,cover_url=?,updated_at=? WHERE id=? AND user_id=?`)
    .bind(input.title, cleanNullable(input.categoryId), cleanNullable(input.subgenreId), input.readingStatus, Number(input.hasPlayed), Number(input.wantsToPlay), input.priority,
      input.playGroupNotes, cleanNullable(input.plannedPlayDate), input.tableStatus, input.gameMaster, input.notes, cleanNullable(input.coverUrl), nowIso(), c.req.param('id'), user.id).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'RPG não encontrado.');
  const row = await c.env.DB.prepare(`${SELECT} WHERE r.id=? AND r.user_id=?`).bind(c.req.param('id'), user.id).first<RpgRow>();
  return c.json({ item: present(row!) });
});

rpgRoutes.delete('/:id', async (c) => {
  try {
    const result = await c.env.DB.prepare('DELETE FROM rpgs WHERE id=? AND user_id=?').bind(c.req.param('id'), c.get('user').id).run();
    if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'RPG não encontrado.');
  } catch (error) { if (String(error).includes('FOREIGN KEY')) throw new ApiError(409, 'RPG_HAS_CAMPAIGNS', 'Exclua ou reassocie as campanhas antes de excluir este RPG.'); throw error; }
  return c.body(null, 204);
});
