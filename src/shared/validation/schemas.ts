import { z } from 'zod';

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
  plannedPlayDate: optionalDate,
  tableStatus: z.enum(['IDEA', 'PREPARING', 'SCHEDULED', 'PLAYING', 'COMPLETED']),
  gameMaster: trimmed(100).default(''),
  notes: trimmed(10000).default(''),
  coverUrl: z.union([z.url().max(1000), z.literal(''), z.null()]).optional(),
});

export const campaignInputSchema = z.strictObject({
  rpgId: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  status: z.enum(['PLANNING', 'SESSION_ZERO', 'PREPARING', 'IN_PROGRESS', 'PAUSED', 'COMPLETED']),
  gameMaster: trimmed(100).default(''),
  sessionZeroDate: optionalDate,
  firstSessionDate: optionalDate,
  frequency: z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'IRREGULAR']).nullable().optional(),
  nextSessionDate: optionalDate,
  sessionGoal: z.number().int().positive().max(999).nullable().optional(),
  legacyMembersText: trimmed(2000).default(''),
  notes: trimmed(10000).default(''),
});

export const memberInputSchema = z.strictObject({
  playerName: z.string().trim().min(1).max(100),
  characterName: trimmed(100).default(''),
  notes: trimmed(2000).default(''),
  active: z.boolean().default(true),
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

export type RpgInput = z.infer<typeof rpgInputSchema>;
export type CampaignInput = z.infer<typeof campaignInputSchema>;
export type SessionInput = z.infer<typeof sessionInputSchema>;

