import { Hono } from 'hono';
import { calculateRpgNextAction, calculateRpgReadiness, calculateRpgRecommendationScore, compareRecommendations, type RecommendationCandidate } from '../../domain/rpg/recommendation';
import { calculateCampaignProgress, calculateCampaignStage, calculateNextCampaignAction, type CampaignPlanningState, type CampaignStatus } from '../../domain/campaign/planning';
import type { AppVariables, Env } from '../types';

export const dashboardRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

dashboardRoutes.get('/', async (c) => {
  const userId = c.get('user').id;
  const [metrics, categories, reading, rpgRows, campaignRows] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT COUNT(*) total,SUM(reading_status='READ') read_count,SUM(has_played=1) played_count,SUM(wants_to_play=1) wants_count,
      SUM(reading_status!='READ') unread_count,SUM(table_status='SCHEDULED') scheduled_count FROM rpgs WHERE user_id=?`).bind(userId),
    c.env.DB.prepare(`SELECT COALESCE(c.name,'Sem categoria') name,COUNT(*) count FROM rpgs r LEFT JOIN categories c ON c.id=r.category_id WHERE r.user_id=? GROUP BY c.name ORDER BY count DESC`).bind(userId),
    c.env.DB.prepare(`SELECT reading_status status,COUNT(*) count FROM rpgs WHERE user_id=? GROUP BY reading_status`).bind(userId),
    c.env.DB.prepare(`SELECT id,title,reading_status,has_played,wants_to_play,priority,play_group_notes,table_status FROM rpgs WHERE user_id=?`).bind(userId),
    c.env.DB.prepare(`SELECT c.id,c.name,c.status,c.session_zero_date,c.first_session_date,c.frequency,c.next_session_date,c.session_goal,r.title rpg_title,
      (SELECT COUNT(*) FROM campaign_sessions s WHERE s.campaign_id=c.id) sessions_completed,
      EXISTS(SELECT 1 FROM campaign_members m WHERE m.campaign_id=c.id AND m.active=1 AND length(m.character_name)>0) has_characters
      FROM campaigns c JOIN rpgs r ON r.id=c.rpg_id WHERE c.user_id=? ORDER BY c.updated_at DESC LIMIT 5`).bind(userId),
  ]);
  const raw = metrics.results[0] as Record<string, number | null> | undefined; const total = Number(raw?.total ?? 0);
  const rpgs = (rpgRows.results as Array<Record<string, unknown>>).map((row) => {
    const candidate: RecommendationCandidate = { title: String(row.title), readingStatus: row.reading_status as RecommendationCandidate['readingStatus'],
      hasPlayed: Boolean(row.has_played), wantsToPlay: Boolean(row.wants_to_play), priority: row.priority as RecommendationCandidate['priority'],
      hasPlayGroup: Boolean(String(row.play_group_notes ?? '').trim()), tableStatus: row.table_status as RecommendationCandidate['tableStatus'] };
    return { id: row.id, ...candidate, score: calculateRpgRecommendationScore(candidate), readiness: calculateRpgReadiness(candidate), nextAction: calculateRpgNextAction(candidate) };
  }).sort(compareRecommendations);
  const campaigns = (campaignRows.results as Array<Record<string, unknown>>).map((row) => { const state: CampaignPlanningState = {
    status: row.status as CampaignStatus, sessionZeroDate: row.session_zero_date as string | null, firstSessionDate: row.first_session_date as string | null,
    frequency: row.frequency as string | null, nextSessionDate: row.next_session_date as string | null, sessionGoal: row.session_goal as number | null,
    sessionsCompleted: Number(row.sessions_completed), hasCharacters: Boolean(row.has_characters) };
    return { id: row.id, name: row.name, rpgTitle: row.rpg_title, status: row.status, nextSessionDate: row.next_session_date,
      frequency: row.frequency, sessionsCompleted: state.sessionsCompleted, progress: calculateCampaignProgress(state), stage: calculateCampaignStage(state), nextAction: calculateNextCampaignAction(state) };
  });
  return c.json({ metrics: { total, read: Number(raw?.read_count ?? 0), played: Number(raw?.played_count ?? 0), wants: Number(raw?.wants_count ?? 0),
    unread: Number(raw?.unread_count ?? 0), scheduled: Number(raw?.scheduled_count ?? 0), readingCompletion: total ? Math.round(Number(raw?.read_count ?? 0) / total * 100) : 0 },
    categories: categories.results, reading: reading.results, recommendations: rpgs.slice(0, 5), readingBacklog: rpgs.filter((r) => r.readingStatus !== 'READ').slice(0, 8),
    activeTables: rpgs.filter((r) => ['PREPARING','SCHEDULED','PLAYING'].includes(r.tableStatus)).slice(0, 5), campaigns });
});

