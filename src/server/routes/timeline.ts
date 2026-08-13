import { Hono, type Context } from 'hono';
import { validateCalendarConfig, validateCalendarDate, type WorldCalendarConfig } from '../../domain/content/calendar';
import { TEMPORAL_PRECISIONS, type TemporalPrecision } from '../../domain/content/types';
import { eventTemporalInputSchema, worldCalendarInputSchema, worldEraInputSchema } from '../../shared/validation/schemas';
import { authorizedWorld, entityAuthorizationPredicate, entityAuthorizationValues, ownedEntity, ownedWorld } from '../content/authorization';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

interface EraRow { id: string; world_id: string; name: string; description: string; sort_order: number }
interface CalendarRow { id: string; world_id: string; name: string; months_json: string; weekdays_json: string; cycles_json: string; holidays_json: string }
interface EventRow {
  id: string;
  name: string;
  summary: string;
  description: string;
  visibility: string;
  historical_date: string | null;
  sort_key: number | null;
  precision: TemporalPrecision | null;
  era_id: string | null;
  era_name: string | null;
  calendar_id: string | null;
  calendar_year: number | null;
  calendar_month_index: number | null;
  calendar_day: number | null;
  display_text: string | null;
}

function normalizeName(name: string): string {
  return name.trim().normalize('NFKC').toLocaleLowerCase('pt-BR');
}

function presentEra(row: EraRow) {
  return { id: row.id, name: row.name, description: row.description, sortOrder: row.sort_order };
}

function parseCalendar(row: CalendarRow | null): (WorldCalendarConfig & { id: string }) | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    months: JSON.parse(row.months_json) as WorldCalendarConfig['months'],
    weekdays: JSON.parse(row.weekdays_json) as WorldCalendarConfig['weekdays'],
    cycles: JSON.parse(row.cycles_json) as WorldCalendarConfig['cycles'],
    holidays: JSON.parse(row.holidays_json) as WorldCalendarConfig['holidays'],
  };
}

function presentEvent(row: EventRow) {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    description: row.description,
    visibility: row.visibility,
    temporal: {
      historicalDate: row.historical_date ?? '',
      sortKey: row.sort_key,
      precision: row.precision ?? 'UNKNOWN',
      eraId: row.era_id,
      eraName: row.era_name,
      calendarId: row.calendar_id,
      calendarDate: row.calendar_id && row.calendar_year !== null && row.calendar_month_index !== null && row.calendar_day !== null
        ? { year: row.calendar_year, monthIndex: row.calendar_month_index, day: row.calendar_day }
        : null,
      displayText: row.display_text ?? '',
    },
  };
}

async function calendarForWorld(c: AppContext, worldId: string): Promise<CalendarRow | null> {
  return c.env.DB.prepare('SELECT * FROM world_calendars WHERE world_id=?').bind(worldId).first<CalendarRow>();
}

export const timelineRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

timelineRoutes.get('/worlds/:worldId', async (c) => {
  const userId = c.get('user').id;
  const world = await authorizedWorld(c, c.req.param('worldId'));
  const query = c.req.query();
  if (query.precision && !TEMPORAL_PRECISIONS.includes(query.precision as TemporalPrecision)) throw new ApiError(422, 'INVALID_PRECISION', 'Precisão temporal inválida.');
  const where = ['e.world_id=?', "e.entity_type='EVENT'", 'e.archived_at IS NULL', entityAuthorizationPredicate('e')];
  const filterValues: unknown[] = [];
  if (query.eraId) { where.push('d.era_id=?'); filterValues.push(query.eraId); }
  if (query.precision) { where.push('COALESCE(d.precision,\'UNKNOWN\')=?'); filterValues.push(query.precision); }
  if (query.search) {
    where.push("(e.name LIKE ? ESCAPE '\\' OR e.summary LIKE ? ESCAPE '\\' OR d.historical_date LIKE ? ESCAPE '\\')");
    const search = `%${query.search.slice(0, 100).replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    filterValues.push(search, search, search);
  }
  const [events, eras, calendar] = await Promise.all([
    c.env.DB.prepare(`SELECT e.id,e.name,e.summary,e.description,e.visibility,d.historical_date,d.sort_key,d.precision,d.era_id,
      era.name era_name,d.calendar_id,d.calendar_year,d.calendar_month_index,d.calendar_day,d.display_text
      FROM vault_entities e
      LEFT JOIN event_temporal_details d ON d.entity_id=e.id
      LEFT JOIN world_eras era ON era.id=d.era_id
      WHERE ${where.join(' AND ')}
      ORDER BY CASE WHEN d.sort_key IS NULL THEN 1 ELSE 0 END,d.sort_key,era.sort_order,e.name COLLATE NOCASE LIMIT 500`)
      .bind(world.id, ...entityAuthorizationValues(userId), ...filterValues).all<EventRow>(),
    c.env.DB.prepare('SELECT * FROM world_eras WHERE world_id=? AND archived_at IS NULL ORDER BY sort_order,name COLLATE NOCASE').bind(world.id).all<EraRow>(),
    calendarForWorld(c, world.id),
  ]);
  return c.json({
    world: { id: world.id, name: String(world.name), isOwner: world.owner_user_id === userId },
    eras: eras.results.map(presentEra),
    calendar: parseCalendar(calendar),
    events: events.results.map(presentEvent),
  });
});

timelineRoutes.post('/worlds/:worldId/eras', async (c) => {
  const worldId = c.req.param('worldId');
  await ownedWorld(c, worldId);
  const input = await readJson(c, worldEraInputSchema);
  const id = crypto.randomUUID(); const now = nowIso();
  try {
    await c.env.DB.prepare('INSERT INTO world_eras(id,world_id,name,name_normalized,description,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(id, worldId, input.name, normalizeName(input.name), input.description, input.sortOrder, now, now).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) throw new ApiError(409, 'ERA_EXISTS', 'Já existe uma era com este nome.');
    throw error;
  }
  const row = await c.env.DB.prepare('SELECT * FROM world_eras WHERE id=?').bind(id).first<EraRow>();
  return c.json({ item: presentEra(row!) }, 201);
});

timelineRoutes.patch('/eras/:eraId', async (c) => {
  const current = await c.env.DB.prepare(`SELECT era.* FROM world_eras era JOIN worlds world ON world.id=era.world_id
    WHERE era.id=? AND world.owner_user_id=? AND era.archived_at IS NULL`).bind(c.req.param('eraId'), c.get('user').id).first<EraRow>();
  if (!current) throw new ApiError(404, 'NOT_FOUND', 'Era não encontrada.');
  const input = await readJson(c, worldEraInputSchema);
  try {
    await c.env.DB.prepare('UPDATE world_eras SET name=?,name_normalized=?,description=?,sort_order=?,updated_at=? WHERE id=?')
      .bind(input.name, normalizeName(input.name), input.description, input.sortOrder, nowIso(), current.id).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) throw new ApiError(409, 'ERA_EXISTS', 'Já existe uma era com este nome.');
    throw error;
  }
  return c.json({ item: presentEra((await c.env.DB.prepare('SELECT * FROM world_eras WHERE id=?').bind(current.id).first<EraRow>())!) });
});

timelineRoutes.delete('/eras/:eraId', async (c) => {
  const current = await c.env.DB.prepare(`SELECT era.id FROM world_eras era JOIN worlds world ON world.id=era.world_id
    WHERE era.id=? AND world.owner_user_id=? AND era.archived_at IS NULL`).bind(c.req.param('eraId'), c.get('user').id).first<{ id: string }>();
  if (!current) throw new ApiError(404, 'NOT_FOUND', 'Era não encontrada.');
  const use = await c.env.DB.prepare('SELECT entity_id FROM event_temporal_details WHERE era_id=? LIMIT 1').bind(current.id).first();
  if (use) throw new ApiError(409, 'ERA_IN_USE', 'Remova a era dos eventos antes de arquivá-la.');
  await c.env.DB.prepare('UPDATE world_eras SET archived_at=?,updated_at=? WHERE id=?').bind(nowIso(), nowIso(), current.id).run();
  return c.body(null, 204);
});

timelineRoutes.put('/worlds/:worldId/calendar', async (c) => {
  const worldId = c.req.param('worldId');
  await ownedWorld(c, worldId);
  const input = await readJson(c, worldCalendarInputSchema);
  if (!validateCalendarConfig(input)) throw new ApiError(422, 'INVALID_CALENDAR', 'O calendário contém nomes repetidos ou datas fora dos meses.');
  const current = await calendarForWorld(c, worldId);
  if (current) {
    const dates = await c.env.DB.prepare(`SELECT calendar_year year,calendar_month_index monthIndex,calendar_day day
      FROM event_temporal_details WHERE calendar_id=?`).bind(current.id).all<{ year: number; monthIndex: number; day: number }>();
    if (dates.results.some((date) => !validateCalendarDate(input, date))) {
      throw new ApiError(409, 'CALENDAR_IN_USE', 'A alteração tornaria datas de eventos existentes inválidas.');
    }
  }
  const id = current?.id ?? crypto.randomUUID(); const now = nowIso();
  await c.env.DB.prepare(`INSERT INTO world_calendars(id,world_id,name,months_json,weekdays_json,cycles_json,holidays_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(world_id) DO UPDATE SET name=excluded.name,months_json=excluded.months_json,
    weekdays_json=excluded.weekdays_json,cycles_json=excluded.cycles_json,holidays_json=excluded.holidays_json,updated_at=excluded.updated_at`)
    .bind(id, worldId, input.name, JSON.stringify(input.months), JSON.stringify(input.weekdays), JSON.stringify(input.cycles), JSON.stringify(input.holidays), now, now).run();
  return c.json({ item: parseCalendar((await calendarForWorld(c, worldId))!) });
});

timelineRoutes.patch('/events/:entityId', async (c) => {
  const entity = await ownedEntity(c, c.req.param('entityId'));
  if (entity.entity_type !== 'EVENT' || !entity.world_id || entity.archived_at) throw new ApiError(422, 'INVALID_EVENT', 'Somente eventos ativos de um World possuem data histórica.');
  const input = await readJson(c, eventTemporalInputSchema);
  if (input.eraId) {
    const era = await c.env.DB.prepare('SELECT id FROM world_eras WHERE id=? AND world_id=? AND archived_at IS NULL').bind(input.eraId, entity.world_id).first();
    if (!era) throw new ApiError(422, 'INVALID_ERA', 'Era inválida para este World.');
  }
  const calendar = await calendarForWorld(c, String(entity.world_id));
  if (input.calendarDate && (!calendar || !validateCalendarDate(parseCalendar(calendar)!, input.calendarDate))) {
    throw new ApiError(422, 'INVALID_CALENDAR_DATE', 'A data não existe no calendário deste World.');
  }
  await c.env.DB.prepare(`INSERT INTO event_temporal_details(entity_id,era_id,historical_date,sort_key,precision,calendar_id,calendar_year,calendar_month_index,calendar_day,display_text,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(entity_id) DO UPDATE SET era_id=excluded.era_id,historical_date=excluded.historical_date,
    sort_key=excluded.sort_key,precision=excluded.precision,calendar_id=excluded.calendar_id,calendar_year=excluded.calendar_year,
    calendar_month_index=excluded.calendar_month_index,calendar_day=excluded.calendar_day,display_text=excluded.display_text,updated_at=excluded.updated_at`)
    .bind(entity.id, input.eraId, input.historicalDate, input.sortKey, input.precision, input.calendarDate ? calendar!.id : null,
      input.calendarDate?.year ?? null, input.calendarDate?.monthIndex ?? null, input.calendarDate?.day ?? null, input.displayText, nowIso()).run();
  return c.json({ ok: true });
});
