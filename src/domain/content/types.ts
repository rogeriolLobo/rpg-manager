export const ENTITY_TYPES = [
  'CHARACTER',
  'NPC',
  'CREATURE',
  'LOCATION',
  'FACTION',
  'ITEM',
  'LORE',
  'EVENT',
  'QUEST',
  'HANDOUT',
  'ADVENTURE',
] as const;

export const ENTITY_VISIBILITIES = ['PRIVATE', 'GROUP', 'CAMPAIGN', 'PLAYERS', 'GM_ONLY'] as const;
export const ADVENTURE_TYPES = ['ONE_SHOT', 'SHORT_CAMPAIGN', 'LONG_CAMPAIGN', 'SANDBOX', 'MODULE', 'CUSTOM'] as const;
export const WORLD_VISIBILITIES = ['PRIVATE', 'GROUP'] as const;
export const WORLD_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export const WORLD_MEMBER_ROLES = ['OWNER', 'VIEWER'] as const;
export const CAMPAIGN_ENTITY_USAGE_TYPES = ['REFERENCE', 'ACTIVE'] as const;

export type VaultEntityType = typeof ENTITY_TYPES[number];
export type EntityVisibility = typeof ENTITY_VISIBILITIES[number];
export type AdventureType = typeof ADVENTURE_TYPES[number];
export type WorldVisibility = typeof WORLD_VISIBILITIES[number];
export type WorldStatus = typeof WORLD_STATUSES[number];
export type WorldMemberRole = typeof WORLD_MEMBER_ROLES[number];
export type CampaignEntityUsageType = typeof CAMPAIGN_ENTITY_USAGE_TYPES[number];

export interface AdventureDetailsInput {
  adventureType: AdventureType;
  recommendedSessions: number | null;
  notes: string;
}
