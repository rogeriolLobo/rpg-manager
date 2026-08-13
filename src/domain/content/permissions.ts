import type { EntityVisibility, WorldVisibility } from './types';

export interface EntityAccessContext {
  authenticatedUserId: string;
  ownerUserId: string;
  visibility: EntityVisibility;
  archivedAt: string | null;
  isGroupMember: boolean;
  isCampaignMember: boolean;
  isActiveCampaignPlayer: boolean;
  isCampaignGameMaster: boolean;
}

export interface WorldAccessContext {
  authenticatedUserId: string;
  ownerUserId: string;
  visibility: WorldVisibility;
  archivedAt: string | null;
  isWorldMember: boolean;
}

export type ResolvedEntityAccess = 'OWNER' | 'GROUP_MEMBER' | 'CAMPAIGN_MEMBER' | 'PLAYER' | 'GAME_MASTER' | 'NONE';

function isOwner(context: Pick<EntityAccessContext | WorldAccessContext, 'authenticatedUserId' | 'ownerUserId'>): boolean {
  return context.authenticatedUserId === context.ownerUserId;
}

export function resolveEntityVisibility(context: EntityAccessContext): ResolvedEntityAccess {
  if (isOwner(context)) return 'OWNER';
  if (context.archivedAt) return 'NONE';
  if (context.visibility === 'GROUP' && context.isGroupMember) return 'GROUP_MEMBER';
  if (context.visibility === 'CAMPAIGN' && context.isCampaignMember) return 'CAMPAIGN_MEMBER';
  if (context.visibility === 'PLAYERS') {
    if (context.isCampaignGameMaster) return 'GAME_MASTER';
    if (context.isActiveCampaignPlayer) return 'PLAYER';
  }
  if (context.visibility === 'GM_ONLY' && context.isCampaignGameMaster) return 'GAME_MASTER';
  return 'NONE';
}

export function canViewEntity(context: EntityAccessContext): boolean {
  return resolveEntityVisibility(context) !== 'NONE';
}

export function canEditEntity(context: EntityAccessContext): boolean {
  return isOwner(context) && !context.archivedAt;
}

export function canArchiveEntity(context: EntityAccessContext): boolean {
  return isOwner(context) && !context.archivedAt;
}

export function canRestoreEntity(context: EntityAccessContext): boolean {
  return isOwner(context) && Boolean(context.archivedAt);
}

export function canDeleteEntity(context: EntityAccessContext): boolean {
  return isOwner(context);
}

export function canViewWorld(context: WorldAccessContext): boolean {
  if (isOwner(context)) return true;
  return !context.archivedAt && context.visibility === 'GROUP' && context.isWorldMember;
}
