import { Hono, type Context } from 'hono';
import { calculateCampaignProgress, calculateCampaignStage, calculateNextCampaignAction, type CampaignPlanningState, type CampaignStatus } from '../../domain/campaign/planning';
import { campaignInputSchema, memberInputSchema, sessionInputSchema } from '../../shared/validation/schemas';
import { ApiError, cleanNullable, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

export const campaignRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();
interface CampaignRow { id: string; rpg_id: string; rpg_title: string; name: string; status: CampaignStatus; game_master: string; session_zero_date: string | null; first_session_date: string | null; frequency: string | null; next_session_date: string | null; last_session_date: string | null; session_goal: number | null; legacy_members_text: string; notes: string; created_at: string; updated_at: string; completed_at: string | null; sessions_completed: number; has_characters: number }
const SELECT = `SELECT c.*,r.title rpg_title,(SELECT COUNT(*) FROM campaign_sessions cs WHERE cs.campaign_id=c.id) sessions_completed,
  EXISTS(SELECT 1 FROM campaign_members cm WHERE cm.campaign_id=c.id AND cm.active=1 AND length(cm.character_name)>0) has_characters
  FROM campaigns c JOIN rpgs r ON r.id=c.rpg_id`;
function present(row: CampaignRow) {
  const state: CampaignPlanningState = { status: row.status, sessionZeroDate: row.session_zero_date, firstSessionDate: row.first_session_date,
    frequency: row.frequency, nextSessionDate: row.next_session_date, hasCharacters: Boolean(row.has_characters), sessionsCompleted: Number(row.sessions_completed), sessionGoal: row.session_goal };
  return { id: row.id, rpgId: row.rpg_id, rpgTitle: row.rpg_title, name: row.name, status: row.status, gameMaster: row.game_master,
    sessionZeroDate: row.session_zero_date, firstSessionDate: row.first_session_date, frequency: row.frequency, nextSessionDate: row.next_session_date,
    lastSessionDate: row.last_session_date, sessionGoal: row.session_goal, legacyMembersText: row.legacy_members_text, notes: row.notes,
    sessionsCompleted: state.sessionsCompleted, progress: calculateCampaignProgress(state), stage: calculateCampaignStage(state), nextAction: calculateNextCampaignAction(state),
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at };
}
async function ownedCampaign(c: Context<{ Bindings: Env; Variables: AppVariables }>, id: string): Promise<CampaignRow> {
  const row = await c.env.DB.prepare(`${SELECT} WHERE c.id=? AND c.user_id=?`).bind(id, c.get('user').id).first<CampaignRow>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Campanha não encontrada.'); return row;
}

campaignRoutes.get('/', async (c) => {
  const rows = await c.env.DB.prepare(`${SELECT} WHERE c.user_id=? ORDER BY CASE c.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'PREPARING' THEN 2 ELSE 3 END,c.updated_at DESC`).bind(c.get('user').id).all();
  return c.json({ items: (rows.results as unknown as CampaignRow[]).map(present) });
});
campaignRoutes.post('/', async (c) => {
  const input = await readJson(c, campaignInputSchema); const user = c.get('user');
  const rpg = await c.env.DB.prepare('SELECT id FROM rpgs WHERE id=? AND user_id=?').bind(input.rpgId, user.id).first();
  if (!rpg) throw new ApiError(422, 'INVALID_RPG', 'RPG inválido.');
  const id = crypto.randomUUID(); const now = nowIso();
  await c.env.DB.prepare(`INSERT INTO campaigns (id,user_id,rpg_id,name,status,game_master,session_zero_date,first_session_date,frequency,next_session_date,session_goal,legacy_members_text,notes,created_at,updated_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,user.id,input.rpgId,input.name,input.status,input.gameMaster,cleanNullable(input.sessionZeroDate),cleanNullable(input.firstSessionDate),input.frequency ?? null,
      cleanNullable(input.nextSessionDate),input.sessionGoal ?? null,input.legacyMembersText,input.notes,now,now,input.status==='COMPLETED'?now:null).run();
  return c.json({ item: present(await ownedCampaign(c,id)) },201);
});
campaignRoutes.get('/:id', async (c) => {
  const row=await ownedCampaign(c,c.req.param('id')); const [members,sessions]=await c.env.DB.batch([
    c.env.DB.prepare('SELECT id,player_name playerName,character_name characterName,notes,active,created_at createdAt,updated_at updatedAt FROM campaign_members WHERE campaign_id=? ORDER BY active DESC,player_name').bind(row.id),
    c.env.DB.prepare('SELECT id,session_number sessionNumber,title,played_at playedAt,summary,gm_notes gmNotes,next_hooks nextHooks,created_at createdAt,updated_at updatedAt FROM campaign_sessions WHERE campaign_id=? ORDER BY session_number DESC').bind(row.id),
  ]); return c.json({item:present(row),members:members.results,sessions:sessions.results});
});
campaignRoutes.patch('/:id',async(c)=>{const input=await readJson(c,campaignInputSchema);const user=c.get('user');
  const rpg=await c.env.DB.prepare('SELECT id FROM rpgs WHERE id=? AND user_id=?').bind(input.rpgId,user.id).first();if(!rpg)throw new ApiError(422,'INVALID_RPG','RPG inválido.');
  const now=nowIso();const result=await c.env.DB.prepare(`UPDATE campaigns SET rpg_id=?,name=?,status=?,game_master=?,session_zero_date=?,first_session_date=?,frequency=?,next_session_date=?,session_goal=?,legacy_members_text=?,notes=?,updated_at=?,completed_at=? WHERE id=? AND user_id=?`)
    .bind(input.rpgId,input.name,input.status,input.gameMaster,cleanNullable(input.sessionZeroDate),cleanNullable(input.firstSessionDate),input.frequency??null,cleanNullable(input.nextSessionDate),input.sessionGoal??null,input.legacyMembersText,input.notes,now,input.status==='COMPLETED'?now:null,c.req.param('id'),user.id).run();
  if(!result.meta.changes)throw new ApiError(404,'NOT_FOUND','Campanha não encontrada.');return c.json({item:present(await ownedCampaign(c,c.req.param('id')))});});
campaignRoutes.delete('/:id',async(c)=>{const result=await c.env.DB.prepare('DELETE FROM campaigns WHERE id=? AND user_id=?').bind(c.req.param('id'),c.get('user').id).run();if(!result.meta.changes)throw new ApiError(404,'NOT_FOUND','Campanha não encontrada.');return c.body(null,204);});

campaignRoutes.post('/:id/members',async(c)=>{const campaign=await ownedCampaign(c,c.req.param('id'));const input=await readJson(c,memberInputSchema);const id=crypto.randomUUID(),now=nowIso();
  await c.env.DB.prepare('INSERT INTO campaign_members (id,campaign_id,player_name,character_name,notes,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,campaign.id,input.playerName,input.characterName,input.notes,Number(input.active),now,now).run();return c.json({id},201);});
campaignRoutes.patch('/:id/members/:memberId',async(c)=>{await ownedCampaign(c,c.req.param('id'));const input=await readJson(c,memberInputSchema);const result=await c.env.DB.prepare(`UPDATE campaign_members SET player_name=?,character_name=?,notes=?,active=?,updated_at=? WHERE id=? AND campaign_id=?`).bind(input.playerName,input.characterName,input.notes,Number(input.active),nowIso(),c.req.param('memberId'),c.req.param('id')).run();if(!result.meta.changes)throw new ApiError(404,'NOT_FOUND','Membro não encontrado.');return c.json({success:true});});
campaignRoutes.delete('/:id/members/:memberId',async(c)=>{await ownedCampaign(c,c.req.param('id'));const result=await c.env.DB.prepare('DELETE FROM campaign_members WHERE id=? AND campaign_id=?').bind(c.req.param('memberId'),c.req.param('id')).run();if(!result.meta.changes)throw new ApiError(404,'NOT_FOUND','Membro não encontrado.');return c.body(null,204);});

campaignRoutes.post('/:id/sessions',async(c)=>{const campaign=await ownedCampaign(c,c.req.param('id'));const input=await readJson(c,sessionInputSchema);const now=nowIso();
  const count=await c.env.DB.prepare('SELECT COALESCE(MAX(session_number),0)+1 next FROM campaign_sessions WHERE campaign_id=?').bind(campaign.id).first<{next:number}>();
  if(input.attendeeMemberIds.length){const placeholders=input.attendeeMemberIds.map(()=>'?').join(',');const valid=await c.env.DB.prepare(`SELECT COUNT(*) total FROM campaign_members WHERE campaign_id=? AND id IN (${placeholders})`).bind(campaign.id,...input.attendeeMemberIds).first<{total:number}>();if(Number(valid?.total)!==input.attendeeMemberIds.length)throw new ApiError(422,'INVALID_ATTENDANCE','Há participantes inválidos.');}
  const id=crypto.randomUUID();const statements:D1PreparedStatement[]=[c.env.DB.prepare(`INSERT INTO campaign_sessions (id,campaign_id,session_number,title,played_at,summary,gm_notes,next_hooks,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id,campaign.id,count?.next??1,input.title,input.playedAt,input.summary,input.gmNotes,input.nextHooks,now,now),c.env.DB.prepare('UPDATE campaigns SET last_session_date=?,first_session_date=COALESCE(first_session_date,?),updated_at=? WHERE id=? AND user_id=?').bind(input.playedAt,input.playedAt,now,campaign.id,c.get('user').id)];
  for(const memberId of input.attendeeMemberIds)statements.push(c.env.DB.prepare('INSERT INTO campaign_session_attendance (session_id,campaign_member_id) VALUES (?,?)').bind(id,memberId));await c.env.DB.batch(statements);return c.json({id,sessionNumber:count?.next??1},201);});
campaignRoutes.get('/:id/sessions',async(c)=>{const campaign=await ownedCampaign(c,c.req.param('id'));const sessions=await c.env.DB.prepare(`SELECT id,session_number sessionNumber,title,played_at playedAt,summary,gm_notes gmNotes,next_hooks nextHooks,created_at createdAt,updated_at updatedAt FROM campaign_sessions WHERE campaign_id=? ORDER BY session_number DESC`).bind(campaign.id).all();return c.json({items:sessions.results});});
campaignRoutes.get('/:id/sessions/:sessionId',async(c)=>{await ownedCampaign(c,c.req.param('id'));const session=await c.env.DB.prepare(`SELECT id,session_number sessionNumber,title,played_at playedAt,summary,gm_notes gmNotes,next_hooks nextHooks FROM campaign_sessions WHERE id=? AND campaign_id=?`).bind(c.req.param('sessionId'),c.req.param('id')).first();if(!session)throw new ApiError(404,'NOT_FOUND','Sessão não encontrada.');const attendance=await c.env.DB.prepare('SELECT campaign_member_id memberId FROM campaign_session_attendance WHERE session_id=?').bind(c.req.param('sessionId')).all();return c.json({item:{...session,attendeeMemberIds:attendance.results.map((x)=>x.memberId)}});});
campaignRoutes.patch('/:id/sessions/:sessionId',async(c)=>{const campaign=await ownedCampaign(c,c.req.param('id'));const input=await readJson(c,sessionInputSchema);const now=nowIso();
  const result=await c.env.DB.prepare('UPDATE campaign_sessions SET title=?,played_at=?,summary=?,gm_notes=?,next_hooks=?,updated_at=? WHERE id=? AND campaign_id=?').bind(input.title,input.playedAt,input.summary,input.gmNotes,input.nextHooks,now,c.req.param('sessionId'),campaign.id).run();if(!result.meta.changes)throw new ApiError(404,'NOT_FOUND','Sessão não encontrada.');const statements:D1PreparedStatement[]=[c.env.DB.prepare('DELETE FROM campaign_session_attendance WHERE session_id=?').bind(c.req.param('sessionId'))];for(const memberId of input.attendeeMemberIds)statements.push(c.env.DB.prepare(`INSERT INTO campaign_session_attendance (session_id,campaign_member_id) SELECT ?,id FROM campaign_members WHERE id=? AND campaign_id=?`).bind(c.req.param('sessionId'),memberId,campaign.id));await c.env.DB.batch(statements);return c.json({success:true});});
campaignRoutes.delete('/:id/sessions/:sessionId',async(c)=>{const campaign=await ownedCampaign(c,c.req.param('id'));const result=await c.env.DB.prepare('DELETE FROM campaign_sessions WHERE id=? AND campaign_id=?').bind(c.req.param('sessionId'),campaign.id).run();if(!result.meta.changes)throw new ApiError(404,'NOT_FOUND','Sessão não encontrada.');const latest=await c.env.DB.prepare('SELECT played_at FROM campaign_sessions WHERE campaign_id=? ORDER BY played_at DESC LIMIT 1').bind(campaign.id).first<{played_at:string}>();await c.env.DB.prepare('UPDATE campaigns SET last_session_date=?,updated_at=? WHERE id=? AND user_id=?').bind(latest?.played_at??null,nowIso(),campaign.id,c.get('user').id).run();return c.body(null,204);});
