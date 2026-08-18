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
export const LORE_TYPES = ['HISTORY', 'RELIGION', 'CULTURE', 'LEGEND', 'PROPHECY', 'SECRET', 'CUSTOM'] as const;
export const LORE_CANON_STATUSES = ['DRAFT', 'CANON', 'RUMOR'] as const;
export const WORLD_VISIBILITIES = ['PRIVATE', 'GROUP'] as const;
export const WORLD_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export const WORLD_MEMBER_ROLES = ['OWNER', 'VIEWER'] as const;
export const CAMPAIGN_ENTITY_USAGE_TYPES = ['REFERENCE', 'ACTIVE'] as const;
export const RELATION_TYPES = [
  'ALLY',
  'ENEMY',
  'RIVAL',
  'FAMILY',
  'PARENT',
  'CHILD',
  'SIBLING',
  'PARTNER',
  'ROMANCE',
  'EMPLOYER',
  'SUBORDINATE',
  'MEMBER_OF',
  'LEADER_OF',
  'OWES',
  'KNOWS',
  'SECRET',
  'CUSTOM',
] as const;
export const RELATION_DIRECTIONS = ['DIRECTED', 'BIDIRECTIONAL'] as const;
export const TEMPORAL_PRECISIONS = ['EXACT', 'DAY', 'MONTH', 'YEAR', 'ERA', 'APPROXIMATE', 'UNKNOWN'] as const;
export const CREATURE_STAT_FIELD_TYPES = ['TEXT', 'NUMBER', 'BOOLEAN'] as const;
// F-003: tipo de referência externa (link) — tabela própria (external_resources), não um
// Vault Entity — ver src/server/routes/external-resources.ts para a justificativa completa.
export const EXTERNAL_RESOURCE_TYPES = ['ARTICLE', 'IMAGE', 'MAP', 'PDF', 'VIDEO', 'AUDIO', 'OTHER'] as const;

export type VaultEntityType = typeof ENTITY_TYPES[number];
export type EntityVisibility = typeof ENTITY_VISIBILITIES[number];
export type AdventureType = typeof ADVENTURE_TYPES[number];
export type LoreType = typeof LORE_TYPES[number];
export type LoreCanonStatus = typeof LORE_CANON_STATUSES[number];
export type WorldVisibility = typeof WORLD_VISIBILITIES[number];
export type WorldStatus = typeof WORLD_STATUSES[number];
export type WorldMemberRole = typeof WORLD_MEMBER_ROLES[number];
export type CampaignEntityUsageType = typeof CAMPAIGN_ENTITY_USAGE_TYPES[number];
export type RelationType = typeof RELATION_TYPES[number];
export type RelationDirection = typeof RELATION_DIRECTIONS[number];
export type TemporalPrecision = typeof TEMPORAL_PRECISIONS[number];
export type CreatureStatFieldType = typeof CREATURE_STAT_FIELD_TYPES[number];
export type ExternalResourceType = typeof EXTERNAL_RESOURCE_TYPES[number];

export interface CreatureStatFieldDefinition {
  key: string;
  label: string;
  type: CreatureStatFieldType;
  required: boolean;
}

export interface AdventureDetailsInput {
  adventureType: AdventureType;
  recommendedSessions: number | null;
  notes: string;
  premise?: string;
  hooks?: string;
  keyScenes?: string;
  rewards?: string;
}

export interface LoreDetailsInput {
  loreType: LoreType;
  canonStatus: LoreCanonStatus;
  source: string;
}
