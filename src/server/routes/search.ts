import { Hono } from 'hono';
import { authorizedWorld, entityAuthorizationPredicate, entityAuthorizationValues } from '../content/authorization';
import { ApiError } from '../http';
import type { AppVariables, Env } from '../types';

export const searchRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function searchPattern(value: string): string {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

searchRoutes.get('/', async (c) => {
  const query = (c.req.query('q') ?? '').trim().slice(0, 100);
  if (query.length < 2) throw new ApiError(422, 'SEARCH_TOO_SHORT', 'Digite ao menos dois caracteres.');
  const userId = c.get('user').id;
  const worldId = c.req.query('worldId') || null;
  if (worldId) await authorizedWorld(c, worldId);
  const pattern = searchPattern(query);
  const entityWorld = worldId ? 'AND e.world_id=?' : '';
  const journalWorld = worldId ? 'AND p.world_id=?' : '';
  const [entities, worlds, campaigns, groups, rpgs, journal] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT e.id,e.name,e.summary,e.entity_type subtype,e.world_id worldId,w.name worldName,'ENTITY' kind
      FROM vault_entities e LEFT JOIN worlds w ON w.id=e.world_id
      WHERE e.archived_at IS NULL AND ${entityAuthorizationPredicate()} ${entityWorld}
      AND (e.name LIKE ? ESCAPE '\\' OR e.summary LIKE ? ESCAPE '\\' OR EXISTS(
        SELECT 1 FROM wiki_entity_aliases a WHERE a.entity_id=e.id AND a.alias LIKE ? ESCAPE '\\'))
      ORDER BY CASE WHEN e.name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,e.updated_at DESC LIMIT 12`)
      .bind(...entityAuthorizationValues(userId), ...(worldId ? [worldId] : []), pattern, pattern, pattern, pattern),
    c.env.DB.prepare(`SELECT w.id,w.name,w.description summary,NULL subtype,w.id worldId,w.name worldName,'WORLD' kind
      FROM worlds w WHERE (w.owner_user_id=? OR (w.archived_at IS NULL AND w.visibility='GROUP' AND EXISTS(
        SELECT 1 FROM world_members wm WHERE wm.world_id=w.id AND wm.user_id=?)))
      AND w.archived_at IS NULL AND w.name LIKE ? ESCAPE '\\' ${worldId ? 'AND w.id=?' : ''}
      ORDER BY w.updated_at DESC LIMIT 6`).bind(userId, userId, pattern, ...(worldId ? [worldId] : [])),
    c.env.DB.prepare(`SELECT DISTINCT c.id,c.name,c.notes summary,c.status subtype,NULL worldId,NULL worldName,'CAMPAIGN' kind
      FROM campaigns c LEFT JOIN campaign_members cm ON cm.campaign_id=c.id
      WHERE (c.user_id=? OR cm.user_id=?) AND (c.name LIKE ? ESCAPE '\\' OR c.notes LIKE ? ESCAPE '\\')
      ${worldId ? `AND EXISTS(SELECT 1 FROM campaign_entities ce JOIN vault_entities ve ON ve.id=ce.entity_id
        WHERE ce.campaign_id=c.id AND ve.world_id=?)` : ''} ORDER BY c.name COLLATE NOCASE LIMIT 6`)
      .bind(userId, userId, pattern, pattern, ...(worldId ? [worldId] : [])),
    c.env.DB.prepare(`SELECT DISTINCT g.id,g.name,g.notes summary,NULL subtype,NULL worldId,NULL worldName,'GROUP' kind
      FROM play_groups g LEFT JOIN play_group_members gm ON gm.group_id=g.id
      WHERE (g.user_id=? OR (gm.user_id=? AND gm.active=1)) AND (g.name LIKE ? ESCAPE '\\' OR g.notes LIKE ? ESCAPE '\\')
      ORDER BY g.name COLLATE NOCASE LIMIT 6`).bind(userId, userId, pattern, pattern),
    c.env.DB.prepare(`SELECT r.id,r.title name,r.notes summary,r.reading_status subtype,NULL worldId,NULL worldName,'RPG' kind
      FROM rpgs r WHERE r.user_id=? AND (r.title LIKE ? ESCAPE '\\' OR r.notes LIKE ? ESCAPE '\\')
      ORDER BY r.title COLLATE NOCASE LIMIT 6`).bind(userId, pattern, pattern),
    c.env.DB.prepare(`SELECT p.id,p.title name,substr(p.content,1,240) summary,'JOURNAL' subtype,p.world_id worldId,w.name worldName,'JOURNAL' kind
      FROM journal_pages p JOIN worlds w ON w.id=p.world_id WHERE w.owner_user_id=? ${journalWorld}
      AND (p.title LIKE ? ESCAPE '\\' OR p.content LIKE ? ESCAPE '\\') ORDER BY p.updated_at DESC LIMIT 8`)
      .bind(userId, ...(worldId ? [worldId] : []), pattern, pattern),
  ]);
  return c.json({ items: [...entities.results, ...worlds.results, ...campaigns.results, ...groups.results, ...rpgs.results, ...journal.results] });
});
