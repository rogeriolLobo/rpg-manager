import type { Context } from 'hono';
import { canViewEntity, canViewWorld, type EntityAccessContext, type WorldAccessContext } from '../../domain/content/permissions';
import type { EntityVisibility, WorldVisibility } from '../../domain/content/types';
import { ApiError } from '../http';
import type { AppVariables, Env } from '../types';

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

export interface AuthorizedEntityRow {
  id: string;
  owner_user_id: string;
  visibility: EntityVisibility;
  archived_at: string | null;
  is_group_member: number;
  is_campaign_member: number;
  is_active_campaign_player: number;
  is_campaign_game_master: number;
  [key: string]: unknown;
}

export interface AuthorizedWorldRow {
  id: string;
  owner_user_id: string;
  visibility: WorldVisibility;
  archived_at: string | null;
  is_world_member: number;
  [key: string]: unknown;
}

export const entityAuthorizationColumns = (userIdPlaceholder = '?') => `
  EXISTS(SELECT 1 FROM play_group_members pgm WHERE pgm.group_id=e.group_id AND pgm.user_id=${userIdPlaceholder} AND pgm.active=1) is_group_member,
  EXISTS(SELECT 1 FROM campaign_entities ce JOIN campaign_members cm ON cm.campaign_id=ce.campaign_id
    WHERE ce.entity_id=e.id AND cm.user_id=${userIdPlaceholder}) is_campaign_member,
  EXISTS(SELECT 1 FROM campaign_entities ce JOIN campaign_members cm ON cm.campaign_id=ce.campaign_id
    WHERE ce.entity_id=e.id AND cm.user_id=${userIdPlaceholder} AND cm.active=1 AND cm.is_game_master=0) is_active_campaign_player,
  EXISTS(SELECT 1 FROM campaign_entities ce JOIN campaign_members cm ON cm.campaign_id=ce.campaign_id
    WHERE ce.entity_id=e.id AND cm.user_id=${userIdPlaceholder} AND cm.active=1 AND cm.is_game_master=1) is_campaign_game_master`;

export const entityAuthorizationPredicate = (alias = 'e') => `(${alias}.owner_user_id=? OR (${alias}.archived_at IS NULL AND (
  (${alias}.visibility='GROUP' AND EXISTS(SELECT 1 FROM play_group_members pgm WHERE pgm.group_id=${alias}.group_id AND pgm.user_id=? AND pgm.active=1)) OR
  (${alias}.visibility='CAMPAIGN' AND EXISTS(SELECT 1 FROM campaign_entities ce JOIN campaign_members cm ON cm.campaign_id=ce.campaign_id WHERE ce.entity_id=${alias}.id AND cm.user_id=?)) OR
  (${alias}.visibility='PLAYERS' AND EXISTS(SELECT 1 FROM campaign_entities ce JOIN campaign_members cm ON cm.campaign_id=ce.campaign_id WHERE ce.entity_id=${alias}.id AND cm.user_id=? AND cm.active=1)) OR
  (${alias}.visibility='GM_ONLY' AND EXISTS(SELECT 1 FROM campaign_entities ce JOIN campaign_members cm ON cm.campaign_id=ce.campaign_id WHERE ce.entity_id=${alias}.id AND cm.user_id=? AND cm.active=1 AND cm.is_game_master=1))
)))`;

export const entityAuthorizationValues = (userId: string): string[] => [userId,userId,userId,userId,userId];

export function entityAccessContext(userId: string, row: AuthorizedEntityRow): EntityAccessContext {
  return {
    authenticatedUserId: userId,
    ownerUserId: row.owner_user_id,
    visibility: row.visibility,
    archivedAt: row.archived_at,
    isGroupMember: Boolean(row.is_group_member),
    isCampaignMember: Boolean(row.is_campaign_member),
    isActiveCampaignPlayer: Boolean(row.is_active_campaign_player),
    isCampaignGameMaster: Boolean(row.is_campaign_game_master),
  };
}

export function worldAccessContext(userId: string, row: AuthorizedWorldRow): WorldAccessContext {
  return {
    authenticatedUserId: userId,
    ownerUserId: row.owner_user_id,
    visibility: row.visibility,
    archivedAt: row.archived_at,
    isWorldMember: Boolean(row.is_world_member),
  };
}

export async function authorizedEntity(c: AppContext, id: string): Promise<AuthorizedEntityRow> {
  const userId = c.get('user').id;
  const row = await c.env.DB.prepare(`SELECT e.*,${entityAuthorizationColumns()} FROM vault_entities e WHERE e.id=?`)
    .bind(userId,userId,userId,userId,id).first<AuthorizedEntityRow>();
  if (!row || !canViewEntity(entityAccessContext(userId,row))) throw new ApiError(404,'NOT_FOUND','Entidade não encontrada.');
  return row;
}

export async function ownedEntity(c: AppContext, id: string): Promise<AuthorizedEntityRow> {
  const row = await c.env.DB.prepare('SELECT * FROM vault_entities WHERE id=? AND owner_user_id=?')
    .bind(id,c.get('user').id).first<AuthorizedEntityRow>();
  if (!row) throw new ApiError(404,'NOT_FOUND','Entidade não encontrada.');
  return {...row,is_group_member:0,is_campaign_member:0,is_active_campaign_player:0,is_campaign_game_master:0};
}

export async function authorizedWorld(c: AppContext, id: string): Promise<AuthorizedWorldRow> {
  const userId=c.get('user').id;
  const row=await c.env.DB.prepare(`SELECT w.*,EXISTS(SELECT 1 FROM world_members wm WHERE wm.world_id=w.id AND wm.user_id=?) is_world_member FROM worlds w WHERE w.id=?`)
    .bind(userId,id).first<AuthorizedWorldRow>();
  if(!row||!canViewWorld(worldAccessContext(userId,row)))throw new ApiError(404,'NOT_FOUND','Mundo não encontrado.');
  return row;
}

export async function ownedWorld(c: AppContext,id:string):Promise<AuthorizedWorldRow>{
  const row=await c.env.DB.prepare('SELECT * FROM worlds WHERE id=? AND owner_user_id=?').bind(id,c.get('user').id).first<AuthorizedWorldRow>();
  if(!row)throw new ApiError(404,'NOT_FOUND','Mundo não encontrado.');
  return {...row,is_world_member:1};
}

// F-022 (BATCH12): predicado de DESCOBERTA por World — NUNCA de autorização (sempre
// combinado com entityAuthorizationPredicate/entityAuthorizationColumns na mesma query,
// nunca usado sozinho). Uma entidade "pertence" ao seu world_id OU foi explicitamente
// linkada nele (world_entity_links, ver migrations/0032_world_entity_links.sql) — o LINK
// nunca amplia QUEM pode ver a entidade, só EM QUAIS Worlds ela é descoberta (Wiki/Vault
// filtrado por World/busca). Bind: worldId duas vezes (mesmo valor).
export const worldEntityDiscoveryPredicate = (alias = 'e'): string =>
  `(${alias}.world_id=? OR EXISTS(SELECT 1 FROM world_entity_links wel WHERE wel.world_id=? AND wel.entity_id=${alias}.id))`;
