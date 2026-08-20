import { Hono, type Context } from 'hono';
import { calculateCampaignProgress, calculateCampaignStage, calculateNextCampaignAction, type CampaignPlanningState, type CampaignStatus } from '../../domain/campaign/planning';
import { campaignEntityLinkSchema, campaignInputSchema, memberInputSchema, sessionInputSchema } from '../../shared/validation/schemas';
import { authorizeCampaignManagement, authorizeCampaignOwnership } from '../content/authorization';
import { ApiError, cleanNullable, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

export const campaignRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();
interface CampaignRow { id: string; user_id: string; rpg_id: string; rpg_title: string; rpg_archived_at: string | null; name: string; status: CampaignStatus; session_mode: string; game_master: string; session_zero_date: string | null; first_session_date: string | null; frequency: string | null; next_session_date: string | null; last_session_date: string | null; session_goal: number | null; play_group_id: string | null; play_group_name: string | null; adventure_entity_id:string|null;adventure_name:string|null;legacy_members_text: string; legacy_characters_text: string; notes: string; created_at: string; updated_at: string; completed_at: string | null; sessions_completed: number; has_characters: number }
// LIB-006: r.archived_at (aliado rpg_archived_at) exposto como `rpgArchived` — uma Campaign
// nunca deixa de carregar por causa disso (o RPG arquivado continua existindo, join normal),
// só ganha um indicador visual no cliente (seção 11 do pedido LIB-006).
const SELECT = `SELECT c.*,r.title rpg_title,r.archived_at rpg_archived_at,g.name play_group_name,c.legacy_sessions_completed+(SELECT COUNT(*) FROM campaign_sessions cs WHERE cs.campaign_id=c.id) sessions_completed,
  adventure.name adventure_name,
  EXISTS(SELECT 1 FROM campaign_members cm WHERE cm.campaign_id=c.id AND cm.active=1 AND length(cm.character_name)>0) has_characters
  FROM campaigns c JOIN rpgs r ON r.id=c.rpg_id LEFT JOIN play_groups g ON g.id=c.play_group_id LEFT JOIN vault_entities adventure ON adventure.id=c.adventure_entity_id`;
// BATCH23 (Multi-GM): isOwner exposto para o client decidir se mostra ações exclusivas do
// Owner (ex.: revogar Co-GM, excluir Campaign) — a autorização de verdade continua sempre no
// servidor (authorizeCampaignOwnership), isto é só para não oferecer um botão que sempre
// resultaria em 404 para quem não é o Owner.
function present(row: CampaignRow, viewerUserId: string) {
  const state: CampaignPlanningState = { status: row.status, sessionZeroDate: row.session_zero_date, firstSessionDate: row.first_session_date,
    frequency: row.frequency, nextSessionDate: row.next_session_date, hasCharacters: Boolean(row.has_characters), sessionsCompleted: Number(row.sessions_completed), sessionGoal: row.session_goal };
  return { id: row.id, isOwner: row.user_id === viewerUserId, rpgId: row.rpg_id, rpgTitle: row.rpg_title, rpgArchived: Boolean(row.rpg_archived_at), name: row.name, status: row.status, sessionMode: row.session_mode, gameMaster: row.game_master,
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
// BATCH23 (Multi-GM): Owner OU Co-GM — usado por rotas operacionais (detalhe, membros,
// sessões) que a Seção 3 do pedido de finalização lista como permitidas a Co-GM ("consultar
// conteúdo necessário", "conduzir Session"). Configurações administrativas sensíveis (PATCH/
// DELETE da própria Campaign, vínculo de entidades de referência) continuam em ownedCampaign
// (Owner-only) — nunca a mesma função para os dois níveis.
async function managedCampaign(c: Context<{ Bindings: Env; Variables: AppVariables }>, id: string): Promise<CampaignRow> {
  await authorizeCampaignManagement(c, id);
  const row = await c.env.DB.prepare(`${SELECT} WHERE c.id=?`).bind(id).first<CampaignRow>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Campanha não encontrada.'); return row;
}

campaignRoutes.get('/', async (c) => {
  const worldId = c.req.query('worldId');
  const worldFilter = worldId ? ' AND EXISTS(SELECT 1 FROM campaign_entities filter_ce JOIN vault_entities filter_e ON filter_e.id=filter_ce.entity_id WHERE filter_ce.campaign_id=c.id AND filter_e.world_id=?)' : '';
  // F-024 (BATCH13): filtro opcional para a visão "Meus One-Shots".
  const sessionMode = c.req.query('sessionMode');
  if (sessionMode && sessionMode !== 'CAMPAIGN' && sessionMode !== 'ONE_SHOT') throw new ApiError(422, 'INVALID_SESSION_MODE', 'Formato de mesa inválido.');
  const sessionModeFilter = sessionMode ? ' AND c.session_mode=?' : '';
  // BATCH23 (Multi-GM): inclui campanhas onde o usuário é Co-GM, não só Owner — sem isso, um
  // Co-GM nunca descobriria suas mesas co-administradas nesta listagem (mesmo princípio da
  // Seção 23 do pedido: "backend existe" não basta, a funcionalidade precisa ser descoberta).
  const userId = c.get('user').id;
  const rows = await c.env.DB.prepare(`${SELECT} WHERE (c.user_id=? OR EXISTS(SELECT 1 FROM campaign_co_gms cg WHERE cg.campaign_id=c.id AND cg.user_id=?))${worldFilter}${sessionModeFilter} ORDER BY CASE c.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'PREPARING' THEN 2 ELSE 3 END,c.updated_at DESC`).bind(userId, userId, ...(worldId ? [worldId] : []), ...(sessionMode ? [sessionMode] : [])).all();
  return c.json({ items: (rows.results as unknown as CampaignRow[]).map((row) => present(row, userId)) });
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
  return c.json({ item: present(await ownedCampaign(c,id),c.get('user').id) },201);
});
// F-033 (Player View integrada): campanhas onde o usuário é membro ativo — a lista "Minhas
// Mesas" que o jogador precisa para descobrir suas campanhas sem depender de um link enviado
// pelo GM (seção 15 do pedido). Nunca expõe legacyMembersText/notes (privados do GM).
interface PlayerCampaignRow { id: string; name: string; status: CampaignStatus; rpg_title: string; game_master: string; next_session_date: string | null; character_name: string; character_entity_id: string | null }
campaignRoutes.get('/mine', async (c) => {
  const rows = await c.env.DB.prepare(`SELECT c.id,c.name,c.status,r.title rpg_title,c.game_master,c.next_session_date,cm.character_name,cm.character_entity_id
    FROM campaign_members cm JOIN campaigns c ON c.id=cm.campaign_id JOIN rpgs r ON r.id=c.rpg_id
    WHERE cm.user_id=? AND cm.active=1 ORDER BY (c.next_session_date IS NULL),c.next_session_date,c.name`).bind(c.get('user').id).all<PlayerCampaignRow>();
  return c.json({ items: rows.results.map((row) => ({ id: row.id, name: row.name, status: row.status, rpgTitle: row.rpg_title, gameMaster: row.game_master, nextSessionDate: row.next_session_date, characterName: row.character_name, characterEntityId: row.character_entity_id })) });
});

// F-033: agregado da visão do jogador para UMA campanha — resumo + "meu personagem" (id, o
// client busca os dados via GET /vault/:id já existente, que já aplica a MESMA barreira de
// visibility PLAYERS/CAMPAIGN via campaign_entities, nenhuma autorização nova aqui) + handouts
// já revelados da Adventure ligada (nunca um não revelado) + se há cena ativa no VTT (link para
// GET /vtt/:campaignId/live, F-031, reaproveitado — nunca uma segunda implementação de VTT).
interface HandoutSummaryRow { id: string; title: string; content: string; external_resource_title: string | null }
campaignRoutes.get('/:id/player-home', async (c) => {
  const campaignId = c.req.param('id'); const userId = c.get('user').id;
  const access = await c.env.DB.prepare(`SELECT c.id,c.name,c.status,r.title rpg_title,c.game_master,c.next_session_date,c.adventure_entity_id,
    (c.user_id=? OR EXISTS(SELECT 1 FROM campaign_members cm WHERE cm.campaign_id=c.id AND cm.user_id=? AND cm.active=1)) authorized
    FROM campaigns c JOIN rpgs r ON r.id=c.rpg_id WHERE c.id=?`).bind(userId, userId, campaignId)
    .first<{ id: string; name: string; status: CampaignStatus; rpg_title: string; game_master: string; next_session_date: string | null; adventure_entity_id: string | null; authorized: number }>();
  if (!access || !access.authorized) throw new ApiError(404, 'NOT_FOUND', 'Campanha não encontrada.');
  const membership = await c.env.DB.prepare('SELECT character_name,character_entity_id FROM campaign_members WHERE campaign_id=? AND user_id=? AND active=1')
    .bind(campaignId, userId).first<{ character_name: string; character_entity_id: string | null }>();
  const handouts = access.adventure_entity_id
    ? (await c.env.DB.prepare(`SELECT h.id,h.title,h.content,er.title external_resource_title FROM adventure_handouts h LEFT JOIN external_resources er ON er.id=h.external_resource_id
        WHERE h.adventure_entity_id=? AND h.revealed_at IS NOT NULL ORDER BY h.sort_order,h.created_at`).bind(access.adventure_entity_id).all<HandoutSummaryRow>()).results
    : [];
  const hasActiveScene = Boolean(await c.env.DB.prepare('SELECT 1 FROM vtt_scenes WHERE campaign_id=? AND is_active=1').bind(campaignId).first());
  return c.json({
    item: { id: access.id, name: access.name, status: access.status, rpgTitle: access.rpg_title, gameMaster: access.game_master, nextSessionDate: access.next_session_date,
      characterName: membership?.character_name ?? '', characterEntityId: membership?.character_entity_id ?? null, hasActiveScene },
    handouts: handouts.map((h) => ({ id: h.id, title: h.title, content: h.content, externalResourceTitle: h.external_resource_title })),
  });
});

campaignRoutes.get('/:id', async (c) => {
  const row=await managedCampaign(c,c.req.param('id')); const [members,sessions,entities]=await c.env.DB.batch([
    c.env.DB.prepare('SELECT id,group_member_id groupMemberId,user_id linkedUserId,player_name playerName,character_name characterName,character_entity_id characterEntityId,notes,active,is_game_master isGameMaster,created_at createdAt,updated_at updatedAt FROM campaign_members WHERE campaign_id=? ORDER BY is_game_master DESC,active DESC,player_name').bind(row.id),
    c.env.DB.prepare('SELECT id,session_number sessionNumber,title,played_at playedAt,summary,gm_notes gmNotes,next_hooks nextHooks,created_at createdAt,updated_at updatedAt FROM campaign_sessions WHERE campaign_id=? ORDER BY session_number DESC').bind(row.id),
    c.env.DB.prepare(`SELECT e.id,e.entity_type entityType,e.name,e.summary,e.visibility,ce.usage_type usageType FROM campaign_entities ce JOIN vault_entities e ON e.id=ce.entity_id WHERE ce.campaign_id=? ORDER BY ce.usage_type DESC,e.name`).bind(row.id),
  ]); return c.json({item:present(row,c.get('user').id),members:members.results,sessions:sessions.results,entities:entities.results});
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
  if(!result.meta.changes)throw new ApiError(404,'NOT_FOUND','Campanha não encontrada.');return c.json({item:present(await ownedCampaign(c,c.req.param('id')),c.get('user').id)});});
campaignRoutes.delete('/:id',async(c)=>{const result=await c.env.DB.prepare('DELETE FROM campaigns WHERE id=? AND user_id=?').bind(c.req.param('id'),c.get('user').id).run();if(!result.meta.changes)throw new ApiError(404,'NOT_FOUND','Campanha não encontrada.');return c.body(null,204);});

// BATCH23 (Multi-GM, Seção 4 do pedido de finalização): lista de Co-GMs — leitura permitida a
// Owner OU Co-GM (qualquer um dos dois pode ver quem mais administra a mesa); revogar é
// exclusivo do Owner (authorizeCampaignOwnership), mesma linha de "Co-GM não pode promover
// outro Owner/remover Owner" — remover OUTRO Co-GM é igualmente sensível, fica só com o Owner.
campaignRoutes.get('/:id/co-gms', async (c) => {
  await managedCampaign(c, c.req.param('id'));
  const rows = await c.env.DB.prepare(`SELECT cg.user_id userId,u.display_name displayName,cg.created_at createdAt
    FROM campaign_co_gms cg JOIN users u ON u.id=cg.user_id WHERE cg.campaign_id=? ORDER BY cg.created_at`).bind(c.req.param('id')).all();
  return c.json({ items: rows.results });
});
campaignRoutes.delete('/:id/co-gms/:userId', async (c) => {
  await authorizeCampaignOwnership(c, c.req.param('id'));
  const result = await c.env.DB.prepare('DELETE FROM campaign_co_gms WHERE campaign_id=? AND user_id=?').bind(c.req.param('id'), c.req.param('userId')).run();
  if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Co-GM não encontrado.');
  return c.body(null, 204);
});

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

// F-033: liga o membro a um Vault Entity CHARACTER do próprio GM — vira "Meu Personagem" na
// visão do jogador. Mesmo padrão de validateAdventure (owner-only, nunca cross-account).
async function validateCharacterEntity(c:Context<{Bindings:Env;Variables:AppVariables}>,entityId:string|null|undefined):Promise<void>{if(!entityId)return;const row=await c.env.DB.prepare("SELECT id FROM vault_entities WHERE id=? AND owner_user_id=? AND entity_type='CHARACTER' AND archived_at IS NULL").bind(entityId,c.get('user').id).first();if(!row)throw new ApiError(422,'INVALID_CHARACTER','Personagem inválido.');}
// Vincula a entidade à campanha via campaign_entities (mesmo mecanismo de adventureEntityId) —
// sem isso, a barreira de visibility PLAYERS/CAMPAIGN de authorizedEntity() nunca deixaria o
// jogador ler a própria ficha (GET /vault/:id, reaproveitado sem rota nova).
function characterLinkStatement(c:Context<{Bindings:Env;Variables:AppVariables}>,campaignId:string,entityId:string|null|undefined,now:string):D1PreparedStatement[]{if(!entityId)return[];return[c.env.DB.prepare('INSERT OR IGNORE INTO campaign_entities (campaign_id,entity_id,usage_type,created_at) VALUES (?,?,?,?)').bind(campaignId,entityId,'REFERENCE',now)];}

campaignRoutes.post('/:id/members',async(c)=>{const campaign=await managedCampaign(c,c.req.param('id'));const input=await readJson(c,memberInputSchema);await validateCharacterEntity(c,input.characterEntityId);const id=crypto.randomUUID(),now=nowIso();
  await c.env.DB.batch([c.env.DB.prepare('INSERT INTO campaign_members (id,campaign_id,player_name,character_name,notes,active,character_entity_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,campaign.id,input.playerName,input.characterName,input.notes,Number(input.active),input.characterEntityId,now,now),...characterLinkStatement(c,campaign.id,input.characterEntityId,now)]);return c.json({id},201);});
campaignRoutes.patch('/:id/members/:memberId',async(c)=>{const campaign=await managedCampaign(c,c.req.param('id'));const input=await readJson(c,memberInputSchema);await validateCharacterEntity(c,input.characterEntityId);const member=await c.env.DB.prepare(`SELECT cm.user_id userId,COALESCE(u.display_name,cm.player_name) playerName FROM campaign_members cm LEFT JOIN users u ON u.id=cm.user_id WHERE cm.id=? AND cm.campaign_id=?`).bind(c.req.param('memberId'),c.req.param('id')).first<{userId:string|null;playerName:string}>();if(!member)throw new ApiError(404,'NOT_FOUND','Membro não encontrado.');const playerName=member.userId?member.playerName:input.playerName;const now=nowIso();await c.env.DB.batch([c.env.DB.prepare(`UPDATE campaign_members SET player_name=?,character_name=?,notes=?,active=?,character_entity_id=?,updated_at=? WHERE id=? AND campaign_id=?`).bind(playerName,input.characterName,input.notes,Number(input.active),input.characterEntityId,now,c.req.param('memberId'),c.req.param('id')),...characterLinkStatement(c,campaign.id,input.characterEntityId,now)]);return c.json({success:true});});
campaignRoutes.delete('/:id/members/:memberId',async(c)=>{await managedCampaign(c,c.req.param('id'));const result=await c.env.DB.prepare('DELETE FROM campaign_members WHERE id=? AND campaign_id=?').bind(c.req.param('memberId'),c.req.param('id')).run();if(!result.meta.changes)throw new ApiError(404,'NOT_FOUND','Membro não encontrado.');return c.body(null,204);});

campaignRoutes.post('/:id/sessions',async(c)=>{const campaign=await managedCampaign(c,c.req.param('id'));const input=await readJson(c,sessionInputSchema);const now=nowIso();
  const count=await c.env.DB.prepare('SELECT COALESCE(MAX(session_number),0)+1 next FROM campaign_sessions WHERE campaign_id=?').bind(campaign.id).first<{next:number}>();
  if(input.attendeeMemberIds.length){const placeholders=input.attendeeMemberIds.map(()=>'?').join(',');const valid=await c.env.DB.prepare(`SELECT COUNT(*) total FROM campaign_members WHERE campaign_id=? AND id IN (${placeholders})`).bind(campaign.id,...input.attendeeMemberIds).first<{total:number}>();if(Number(valid?.total)!==input.attendeeMemberIds.length)throw new ApiError(422,'INVALID_ATTENDANCE','Há participantes inválidos.');}
  const id=crypto.randomUUID();const statements:D1PreparedStatement[]=[c.env.DB.prepare(`INSERT INTO campaign_sessions (id,campaign_id,session_number,title,played_at,summary,gm_notes,next_hooks,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id,campaign.id,count?.next??1,input.title,input.playedAt,input.summary,input.gmNotes,input.nextHooks,now,now),c.env.DB.prepare('UPDATE campaigns SET last_session_date=?,first_session_date=COALESCE(first_session_date,?),updated_at=? WHERE id=? AND user_id=?').bind(input.playedAt,input.playedAt,now,campaign.id,c.get('user').id)];
  for(const memberId of input.attendeeMemberIds)statements.push(c.env.DB.prepare('INSERT INTO campaign_session_attendance (session_id,campaign_member_id) VALUES (?,?)').bind(id,memberId));await c.env.DB.batch(statements);return c.json({id,sessionNumber:count?.next??1},201);});
campaignRoutes.get('/:id/sessions',async(c)=>{const campaign=await managedCampaign(c,c.req.param('id'));const sessions=await c.env.DB.prepare(`SELECT id,session_number sessionNumber,title,played_at playedAt,summary,gm_notes gmNotes,next_hooks nextHooks,created_at createdAt,updated_at updatedAt FROM campaign_sessions WHERE campaign_id=? ORDER BY session_number DESC`).bind(campaign.id).all();return c.json({items:sessions.results});});
campaignRoutes.get('/:id/sessions/:sessionId',async(c)=>{await managedCampaign(c,c.req.param('id'));const session=await c.env.DB.prepare(`SELECT id,session_number sessionNumber,title,played_at playedAt,summary,gm_notes gmNotes,next_hooks nextHooks FROM campaign_sessions WHERE id=? AND campaign_id=?`).bind(c.req.param('sessionId'),c.req.param('id')).first();if(!session)throw new ApiError(404,'NOT_FOUND','Sessão não encontrada.');const attendance=await c.env.DB.prepare('SELECT campaign_member_id memberId FROM campaign_session_attendance WHERE session_id=?').bind(c.req.param('sessionId')).all();return c.json({item:{...session,attendeeMemberIds:attendance.results.map((x)=>x.memberId)}});});
campaignRoutes.patch('/:id/sessions/:sessionId',async(c)=>{const campaign=await managedCampaign(c,c.req.param('id'));const input=await readJson(c,sessionInputSchema);const now=nowIso();
  const result=await c.env.DB.prepare('UPDATE campaign_sessions SET title=?,played_at=?,summary=?,gm_notes=?,next_hooks=?,updated_at=? WHERE id=? AND campaign_id=?').bind(input.title,input.playedAt,input.summary,input.gmNotes,input.nextHooks,now,c.req.param('sessionId'),campaign.id).run();if(!result.meta.changes)throw new ApiError(404,'NOT_FOUND','Sessão não encontrada.');const statements:D1PreparedStatement[]=[c.env.DB.prepare('DELETE FROM campaign_session_attendance WHERE session_id=?').bind(c.req.param('sessionId'))];for(const memberId of input.attendeeMemberIds)statements.push(c.env.DB.prepare(`INSERT INTO campaign_session_attendance (session_id,campaign_member_id) SELECT ?,id FROM campaign_members WHERE id=? AND campaign_id=?`).bind(c.req.param('sessionId'),memberId,campaign.id));await c.env.DB.batch(statements);return c.json({success:true});});
campaignRoutes.delete('/:id/sessions/:sessionId',async(c)=>{const campaign=await managedCampaign(c,c.req.param('id'));const result=await c.env.DB.prepare('DELETE FROM campaign_sessions WHERE id=? AND campaign_id=?').bind(c.req.param('sessionId'),campaign.id).run();if(!result.meta.changes)throw new ApiError(404,'NOT_FOUND','Sessão não encontrada.');const latest=await c.env.DB.prepare('SELECT played_at FROM campaign_sessions WHERE campaign_id=? ORDER BY played_at DESC LIMIT 1').bind(campaign.id).first<{played_at:string}>();
  // BATCH23: já autorizado (Owner OU Co-GM) via managedCampaign acima — o WHERE aqui usa só
  // campaign.id (nunca `AND user_id=?`, que travaria silenciosamente esta atualização quando
  // quem excluiu a sessão for um Co-GM, não o Owner).
  await c.env.DB.prepare('UPDATE campaigns SET last_session_date=?,updated_at=? WHERE id=?').bind(latest?.played_at??null,nowIso(),campaign.id).run();return c.body(null,204);});
