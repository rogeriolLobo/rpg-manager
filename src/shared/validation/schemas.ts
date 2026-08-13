import { z } from 'zod';
import { ADVENTURE_TYPES, CAMPAIGN_ENTITY_USAGE_TYPES, ENTITY_TYPES, ENTITY_VISIBILITIES, WORLD_VISIBILITIES } from '../../domain/content/types';
import { isAllowedCoverUrl, isPublicHttpsUrl } from '../security/cover-url';

const trimmed = (max: number) => z.string().trim().max(max);
const optionalDate = z.union([z.iso.date(), z.literal(''), z.null()]).optional();

export const registerSchema = z.strictObject({
  email: z.email().max(254),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(12).max(128),
  turnstileToken: z.string().max(4096).optional(),
});

export const loginSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
  turnstileToken: z.string().max(4096).optional(),
});

export const recoverSchema = z.strictObject({
  email: z.email().max(254),
  recoveryCode: z.string().trim().min(8).max(80),
  newPassword: z.string().min(12).max(128),
  turnstileToken: z.string().max(4096).optional(),
});

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
  revokeOtherSessions: z.boolean().default(true),
});

export const deleteAccountSchema = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  confirmation: z.literal('EXCLUIR MINHA CONTA'),
});

export const rpgInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  categoryId: z.string().trim().max(80).nullable().optional(),
  subgenreId: z.string().trim().max(80).nullable().optional(),
  readingStatus: z.enum(['NOT_STARTED', 'READING', 'READ']),
  hasPlayed: z.boolean(),
  wantsToPlay: z.boolean(),
  priority: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH']),
  playGroupNotes: trimmed(1000).default(''),
  playGroupId: z.string().trim().max(80).nullable().optional(),
  plannedPlayDate: optionalDate,
  tableStatus: z.enum(['IDEA', 'PREPARING', 'SCHEDULED', 'PLAYING', 'COMPLETED']),
  gameMaster: trimmed(100).default(''),
  notes: trimmed(10000).default(''),
  coverUrl: z.union([
    z.string().trim().max(1000).refine(isAllowedCoverUrl, 'Use uma URL HTTPS de um domínio de capas autorizado.'),
    z.literal(''),
    z.null(),
  ]).optional(),
  isbn: z.union([z.string().trim().max(32), z.null()]).optional(),
  coverSourceUrl: z.union([
    z.string().trim().max(1000).refine(isPublicHttpsUrl, 'Use uma URL HTTPS pública.'),
    z.literal(''),
    z.null(),
  ]).optional(),
  coverSourceNote: z.union([z.string().trim().max(1000), z.null()]).optional(),
});

export const campaignInputSchema = z.strictObject({
  rpgId: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  status: z.enum(['PLANNING', 'SESSION_ZERO', 'PREPARING', 'IN_PROGRESS', 'PAUSED', 'COMPLETED']),
  gameMaster: trimmed(100).default(''),
  playGroupId: z.string().trim().max(80).nullable().optional(),
  adventureEntityId: z.string().trim().max(80).nullable().optional(),
  sessionZeroDate: optionalDate,
  firstSessionDate: optionalDate,
  frequency: z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'IRREGULAR']).nullable().optional(),
  nextSessionDate: optionalDate,
  sessionGoal: z.number().int().positive().max(999).nullable().optional(),
  legacyMembersText: trimmed(2000).default(''),
  legacyCharactersText: trimmed(2000).default(''),
  notes: trimmed(10000).default(''),
});

export const memberInputSchema = z.strictObject({
  playerName: z.string().trim().min(1).max(100),
  characterName: trimmed(100).default(''),
  notes: trimmed(2000).default(''),
  active: z.boolean().default(true),
});

export const playGroupInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  notes: trimmed(5000).default(''),
});

export const playGroupMemberCreateSchema = z.strictObject({
  playerName: z.string().trim().min(1).max(100),
  userId: z.string().trim().max(80).nullable().optional(),
  notes: trimmed(2000).default(''),
  active: z.boolean().default(true),
  isGameMaster: z.boolean().default(false),
});

export const playGroupMemberUpdateSchema = z.strictObject({
  playerName: z.string().trim().min(1).max(100),
  notes: trimmed(2000).default(''),
  active: z.boolean().default(true),
  isGameMaster: z.boolean().default(false),
});

export const sessionInputSchema = z.strictObject({
  title: trimmed(160).default(''),
  playedAt: z.iso.datetime({ local: true }).or(z.iso.date()),
  summary: trimmed(10000).default(''),
  gmNotes: trimmed(10000).default(''),
  nextHooks: trimmed(5000).default(''),
  attendeeMemberIds: z.array(z.string().min(1).max(80)).max(100).default([]),
});

export const profileSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(80),
});

export const worldInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  description: trimmed(10000).default(''),
  defaultRpgId: z.string().trim().max(80).nullable().optional(),
  visibility: z.enum(WORLD_VISIBILITIES),
});

export const worldMemberInputSchema = z.strictObject({
  userId: z.string().trim().min(1).max(80),
});

export const adventureDetailsSchema = z.strictObject({
  adventureType: z.enum(ADVENTURE_TYPES),
  recommendedSessions: z.number().int().positive().max(999).nullable(),
  notes: trimmed(10000).default(''),
});

export const vaultEntityInputSchema = z.strictObject({
  entityType: z.enum(ENTITY_TYPES),
  name: z.string().trim().min(1).max(160),
  summary: trimmed(1000).default(''),
  description: trimmed(20000).default(''),
  visibility: z.enum(ENTITY_VISIBILITIES),
  worldId: z.string().trim().max(80).nullable().optional(),
  groupId: z.string().trim().max(80).nullable().optional(),
  parentEntityId: z.string().trim().max(80).nullable().optional(),
  adventure: adventureDetailsSchema.nullable(),
});

export const campaignEntityLinkSchema = z.strictObject({
  usageType: z.enum(CAMPAIGN_ENTITY_USAGE_TYPES),
});

export type RpgInput = z.infer<typeof rpgInputSchema>;
export type CampaignInput = z.infer<typeof campaignInputSchema>;
export type SessionInput = z.infer<typeof sessionInputSchema>;
export type WorldInput = z.infer<typeof worldInputSchema>;
export type VaultEntityInput = z.infer<typeof vaultEntityInputSchema>;
