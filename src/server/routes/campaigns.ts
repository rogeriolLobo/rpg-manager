import { Hono, type Context } from 'hono';
import { calculateCampaignProgress, calculateCampaignStage, calculateNextCampaignAction, type CampaignPlanningState, type CampaignStatus } from '../../domain/campaign/planning';
import { campaignEntityLinkSchema, campaignInputSchema, memberInputSchema, sessionInputSchema } from '../../shared/validation/schemas';
import { ApiError, cleanNullable, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

export const campaignRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();
interface CampaignRow { id: string; rpg_id: string; rpg_title: string; rpg_archived_at: string | null; name: string; status: CampaignStatus; session_mode: string; game_master: string; session_zero_date: string | null; first_session_date: string | null; frequency: string | null; next_session_date: string | null; last_session_date: string | null; session_goal: number | null; play_group_id: string | null; play_group_name: string | null; adventure_entity_id:string|null;adventure_name:string|null;legacy_members_text: string; legacy_characters_text: string; notes: string; created_at: string; updated_at: string; completed_at: string | null; sessions_completed: number; has_characters: number }
// LIB-006: r.archived_at (aliado rpg_archived_at) exposto como `rpgArchived` — uma Campaign
// nunca deixa de carregar por causa disso (o RPG arquivado continua existindo, join normal),
// só ganha um indicador visual no cliente (seção 11 do pedido LIB-006).
const SELECT = `SELECT c.*,r.title rpg_title,r.archived_at rpg_archived_at,g.name play_group_name,c.legacy_sessions_completed+(SELECT COUNT(*) FROM campaign_sessions cs WHERE cs.campaign_id=c.id) sessions_completed,
  adventure.name adventure_name,
  EXISTS(SELECT 1 FROM campaign_members cm WHERE cm.campaign_id=c.id AND cm.active=1 AND length(cm.character_name)>0) has_characters
  FROM campaigns c JOIN rpgs r ON r.id=c.rpg_id LEFT JOIN play_groups g ON g.id=c.play_group_id LEFT JOIN vault_entities adventure ON adventure.id=c.adventure_entity_id`;
function present(row: CampaignRow) {
  const state: CampaignPlanningState = { status: row.status, sessionZeroDate: row.session_zero_date, firstSessionDate: row.first_session_date,
    frequency: row.frequency, nextSessionDate: row.next_session_date, hasCharacters: Boolean(row.has_characters), sessionsCompleted: Number(row.sessions_completed), sessionGoal: row.session_goal };
  return { id: row.id, rpgId: row.rpg_id, rpgTitle: row.rpg_title, rpgArchived: Boolean(row.rpg_archived_at), name: row.name, status: row.status, sessionMode: row.session_mode, gameMaster: row.game_master,
    sessionZeroDate: row.session_zero_date, firstSessionDate: row.first_session_date, frequency: row.frequency, nextSessionDate: row.next_session_date,
    lastSessionDate: row.last_session_date, sessionGoal: row.session_goal, playGroupId: row.play_group_id, playGroupName: row.play_group_name,
    adventureEntityId:row.adventure_entity_id,adventureName:row.adventure_name,
    legacyMembersText: row.legacy_members_text, legacyCharactersText: row.legacy_characters_text, notes: row.notes,
    sessionsCompleted: state.sessionsCompleted, progress: calculateCampaignProgress(state), stage: calculateCampaignStage(state), nextAction: calculateNextCampaignAction(state),
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at };
}

async function groupMemberStatements(c: Context<{ Bindings: Env; Variables: AppVariables }>, groupId: string | null | undefined, campaignId: string, now: string): Promise<D1PreparedStatement[]> {
  if (!groupId) return [];
  const group = await c.env.DB.prepare('SELECT id FROM play_groups WHERE id=? AND user_id=?').bind(groupId, c.get('user').id).first();
  if (!group) throw new ApiError(422, 'INVALID_PLAY_GROUP', 'Grupo de jogo inválido.');
  const members = await c.env.DB.prepare('SELECT id,player_name,user_id,notes,is_game_master FROM play_group_members WHERE group_id=? AND active=1 ORDER BY player_name').bind(groupId).all<{id:string;player_name:string;user_id:string|null;notes:string;is_game_master:number}>();
  return members.results.map((member) => c.env.DB.prepare(`INSERT OR IGNORE INTO campaign_members
    (id,campaign_id,group_member_id,user_id,player_name,character_name,notes,active,is_game_master,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), campaignId, member.id, member.user_id, member.player_name, '', member.notes, 1, member.is_game_master, now, now));
}
async function gameMasterName(c: Context<{ Bindings: Env; Variables: AppVariables }>, groupId: string | null | undefined, fallback: string): Promise<string> {
  if (fallback.trim() || !groupId) return fallback;
  const member = await c.env.DB.prepare(`SELECT COALESCE(u.display_name,m.player_name) name FROM play_group_members m
    LEFT JOIN users u ON u.id=m.user_id WHERE m.group_id=? AND m.is_game_master=1 LIMIT 1`).bind(groupId).first<{name:string}>();
  return member?.name ?? fallback;
}
async function validateAdventure(c:Context<{Bindings:Env;Variables:AppVariables}>,adventureId:string|null|undefined):Promise<void>{if(!adventureId)return;const row=await c.env.DB.prepare("SELECT id FROM vault_entities WHERE id=? AND owner_user_id=? AND entity_type='ADVENTURE' AND archived_at IS NULL").bind(adventureId,c.get('user').id).first();if(!row)throw new ApiError(422,'INVALID_ADVENTURE','Adventure principal inválida.');}
async function ownedCampaign(c: Context<{ Bindings: Env; Variables: AppVariables }>, id: string): Promise<CampaignRow> {
  const row = await c.env.DB.prepare(`${SELECT} WHERE c.id=? AND c.user_id=?`).bind(id, c.get('user').id).first<CampaignRow>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Campanha não encontrada.'); return row;
}

campaignRoutes.get('/', async (c) => {
  const worldId = c.req.query('worldId');
  const worldFilter = worldId ? ' AND EXISTS(SELECT 1 FROM campaign_entities filter_ce JOIN vault_entities filter_e ON filter_e.id=filter_ce.entity_id WHERE filter_ce.campaign_id=c.id AND filter_e.world_id=?)' : '';
  // F-024 (BATCH13): filtro opcional para a visão "Meus One-Shots".
  const sessionMode = c.req.query('sessionMode');
  if (sessionMode && sessionMode !== 'CAMPAIGN' && sessionMode !== 'ONE_SHOT') throw new ApiError(422, 'INVALID_SESSION_MODE', 'Formato de mesa inválido.');
  const sessionModeFilter = sessionMode ? ' AND c.session_mode=?' : '';
  const rows = await c.env.DB.prepare(`${SELECT} WHERE c.user_id=?${worldFilter}${sessionModeFilter} ORDER BY CASE c.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'PREPARING' THEN 2 ELSE 3 END,c.updated_at DESC`).bind(c.get('user').id, ...(worldId ? [worldId] : []), ...(sessionMode ? [sessionMode] : [])).all();
  return c.json({ items: (rows.results as unknown as CampaignRow[]).map(present) });
});
campaignRoutes.post('/', async (c) => {
  const input = await readJson(c, campaignInputSchema); const user = c.get('user');
  const rpg = await c.env.DB.prepare('SELECT id FROM rpgs WHERE id=? AND user_id=?').bind(input.rpgId, user.id).first();
  if (!rpg) throw new ApiError(422, 'INVALID_RPG', 'RPG inválido.');
  await validateAdventure(c,input.adventureEntityId);
  const id = crypto.randomUUID(); const now = nowIso();
  const memberStatements = await groupMemberStatements(c, input.playGroupId, id, now);
  const resolvedGameMaster = await gameMasterName(c,input.playGroupId,input.gameMaster);
  const adventureStatement = input.adventureEntityId
    ? [c.env.DB.prepare(`INSERT INTO campaign_entities (campaign_id,entity_id,usage_type,created_at) VALUES (?,?,?,?)`)
      .bind(id, input.adventureEntityId, 'ACTIVE', now)]
    : [];
  await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO campaigns (id,user_id,rpg_id,name,status,session_mode,game_master,session_zero_date,first_session_date,frequency,next_session_date,session_goal,play_group_id,adventure_entity_id,legacy_members_text,legacy_characters_text,notes,created_at,updated_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,user.id,input.rpgId,input.name,input.status,input.sessionMode,resolvedGameMaster,cleanNullable(input.sessionZeroDate),cleanNullable(input.firstSessionDate),input.frequency ?? null,
      cleanNullable(input.nextSessionDate),input.sessionGoal ?? null,cleanNullable(input.playGroupId),cleanNullable(input.adventureEntityId),input.legacyMembersText,input.legacyCharactersText,input.notes,now,now,input.status==='COMPLETED'?now:null),...adventureStatement,...memberStatements]);
  return c.json({ item: present(await ownedCampaign(c,id)) },201);
});
campaignRoutes.get('/:id', async (c) => {
  const row=await ownedCampaign(c,c.req.param('id')); const [members,sessions,entities]=await c.env.DB.batch([
    c.env.DB.prepare('SELECT id,group_member_id groupMemberId,user_id linkedUserId,player_name playerName,character_name characterName,notes,active,is_game_master isGameMaster,created_at createdAt,updated_at updatedAt FROM campaign_members WHERE campaign_id=? ORDER BY is_game_master DESC,active DESC,player_name').bind(row.id),
    c.env.DB.prepare('SELECT id,session_number sessionNumber,title,played_at playedAt,summary,gm_notes gmNotes,next_hooks nextHooks,created_at createdAt,updated_at updatedAt FROM campaign_sessions WHERE campaign_id=? ORDER BY session_number DESC').bind(row.id),
    c.env.DB.prepare(`SELECT e.id,e.entity_type entityType,e.name,e.summary,e.visibility,ce.usage_type usageType FROM campaign_entities ce JOIN vault_entities e ON e.id=ce.entity_id WHERE ce.campaign_id=? ORDER BY ce.usage_type DESC,e.name`).bind(row.id),
  ]); return c.json({item:present(row),members:members.results,sessions:sessions.results,entities:entities.results});
});
campaignRoutes.patch('/:id',async(c)=>{const input=await readJson(c,campaignInputSchema);const user=c.get('user');
  const rpg=await c.env.DB.prepare('SELECT id FROM rpgs WHERE id=? AND user_id=?').bind(input.rpgId,user.id).first();if(!rpg)throw new ApiError(422,'INVALID_RPG','RPG inválido.');
  await validateAdventure(c,input.adventureEntityId);
  const now=nowIso();const memberStatements=await groupMemberStatements(c,input.playGroupId,c.req.param('id'),now);const resolvedGameMaster=await gameMasterName(c,input.playGroupId,input.gameMaster);
  const adventureStatement = input.adventureEntityId
    ? [c.env.DB.prepare(`INSERT INTO campaign_entities (campaign_id,entity_id,usage_type,created_at) VALUES (?,?,?,?)
        ON CONFLICT(campaign_id,entity_id) DO UPDATE SET usage_type=excluded.usage_type`)
      .bind(c.req.param('id'), input.adventureEntityId, 'ACTIVE', now)]
    : [];
  const [result]=await c.env.DB.batch([c.env.DB.prepare(`UPDATE campaigns SET rpg_id=?,name=?,status=?,session_mode=?,game_master=?,session_zero_date=?,first_session_date=?,frequency=?,next_session_date=?,session_goal=?,play_group_id=?,adventure_entity_id=?,legacy_members_text=?,legacy_characters_text=?,notes=?,updated_at=?,completed_at=? WHERE id=? AND user_id=?`)
    .bind(input.rpgId,input.name,input.status,input.sessionMode,resolvedGameMaster,cleanNullable(input.sessionZeroDate),cleanNullable(input.firstSessionDate),input.frequency??null,cleanNullable(input.nextSessionDate),input.sessionGoal??null,cleanNullable(input.playGroupId),cleanNullable(input.adventureEntityId),input.legacyMembersText,input.legacyCharactersText,input.notes,now,input.status==='COMPLETED'?now:null,c.req.param('id'),user.id),...adventureStatement,...memberStatements]);
  if(!result.meta.changes)throw new ApiError(404,'NOT_FOUND','Campanha não encontrada.');return c.json({item:present(await ownedCampaign(c,c.req.param('id')))});});
campaignRoutes.delete('/:id',async(c)=>{const result=await c.env.DB.prepare('DELETE FROM campaigns WHERE id=? AND user_id=?').bind(c.req.param('id'),c.get('user').id).run();if(!result.meta.changes)throw new ApiError(404,'NOT_FOUND','Campanha não encontrada.');return c.body(null,204);});

campaignRoutes.post('/:id/entities/:entityId', async (c) => {
  const campaign = await ownedCampaign(c, c.req.param('id'));
  const input = await readJson(c, campaignEntityLinkSchema);
  const entity = await c.env.DB.prepare('SELECT id FROM vault_entities WHERE id=? AND owner_user_id=? AND archived_at IS NULL')
    .bind(c.req.param('entityId'), c.get('user').id).first();
  if (!entity) throw new ApiError(404, 'NOT_FOUND', 'Entidade não encontrada.');
  await c.env.DB.prepare(`INSERT INTO campaign_entities (campaign_id,entity_id,usage_type,created_at) VALUES (?,?,?,?)
    ON CONFLICT(campaign_id,entity_id) DO UPDATE SET usage_type=excluded.usage_type`)
    .bind(campaign.id, c.req.param('entityId'), input.usageType, nowIso()).run();
  return c.json({ success: true }, 201);
});
campaignRoutes.delete('/:id/entities/:entityId', async (c) => {
  const campaign = await ownedCampaign(c, c.req.param('id'));
  if (campaign.adventure_entity_id === c.req.param('entityId')) {
    throw new ApiError(409, 'PRIMARY_ADVENTURE', 'Remova a Adventure principal da campanha antes de desvinculá-la.');
  }
  const result = await c.env.DB.prepare('DELETE FROM campaign_entities WHERE campaign_id=? AND entity_id=?')
    .bind(campaign.id, c.req.param('entityId')).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Vínculo não encontrado.');
  return c.body(null, 204);
});

campaignRoutes.post('/:id/members',async(c)=>{const campaign=await ownedCampaign(c,c.req.param('id'));const input=await readJson(c,memberInputSchema);const id=crypto.randomUUID(),now=nowIso();
  await c.env.DB.prepare('INSERT INTO campaign_members (id,campaign_id,player_name,character_name,notes,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,campaign.id,input.playerName,input.characterName,input.notes,Number(input.active),now,now).run();return c.json({id},201);});
campaignRoutes.patch('/:id/members/:memberId',async(c)=>{await ownedCampaign(c,c.req.param('id'));const input=await readJson(c,memberInputSchema);const member=await c.env.DB.prepare(`SELECT cm.user_id userId,COALESCE(u.display_name,cm.player_name) playerName FROM campaign_members cm LEFT JOIN users u ON u.id=cm.user_id WHERE cm.id=? AND cm.campaign_id=?`).bind(c.req.param('memberId'),c.req.param('id')).first<{userId:string|null;playerName:string}>();if(!member)throw new ApiError(404,'NOT_FOUND','Membro não encontrado.');const playerName=member.userId?member.playerName:input.playerName;await c.env.DB.prepare(`UPDATE campaign_members SET player_name=?,character_name=?,notes=?,active=?,updated_at=? WHERE id=? AND campaign_id=?`).bind(playerName,input.characterName,input.notes,Number(input.active),nowIso(),c.req.param('memberId'),c.req.param('id')).run();return c.json({success:true});});
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
