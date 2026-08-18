import { z } from 'zod';
import { ADVENTURE_TYPES, CAMPAIGN_ENTITY_USAGE_TYPES, CREATURE_STAT_FIELD_TYPES, ENTITY_TYPES, ENTITY_VISIBILITIES, EXTERNAL_RESOURCE_TYPES, LORE_CANON_STATUSES, LORE_TYPES, RELATION_DIRECTIONS, RELATION_TYPES, TEMPORAL_PRECISIONS, WORLD_VISIBILITIES } from '../../domain/content/types';
import { isIsbnInputValid } from '../../domain/rpg/isbn';
import { PUBLICATION_TYPES } from '../../domain/rpg/library-domain';
import { isPublicHttpsUrl } from '../security/cover-url';

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
    z.string().trim().max(1000).refine(isPublicHttpsUrl, 'Use uma URL HTTPS pública.'),
    z.literal(''),
    z.null(),
  ]).optional(),
  // LIB-003: ISBN validado por checksum real (ISO 2108/EAN-13), não por forma.
  // Vazio continua permitido; valor preenchido precisa ser um ISBN-10/13 válido
  // (ver src/domain/rpg/isbn.ts — sem invenção/correção automática).
  isbn: z.union([
    z.string().trim().max(32).refine(isIsbnInputValid, 'ISBN inválido — confira os dígitos.'),
    z.literal(''),
    z.null(),
  ]).optional(),
  coverSourceUrl: z.union([
    z.string().trim().max(1000).refine(isPublicHttpsUrl, 'Use uma URL HTTPS pública.'),
    z.literal(''),
    z.null(),
  ]).optional(),
  coverSourceNote: z.union([z.string().trim().max(1000), z.null()]).optional(),
  // LIB-004: campos editoriais adicionais + provenance, todos opcionais — cadastro manual
  // continua funcionando sem enviar nenhum deles (default MANUAL/em branco, ver
  // src/server/routes/library-writes.ts). Populados quando o RPG vem de uma busca externa
  // confirmada no preview (nunca aplicados automaticamente sem revisão — seção 18 do pedido).
  subtitle: trimmed(200).optional(),
  publisher: trimmed(160).optional(),
  publicationYear: z.number().int().min(1000).max(2100).nullable().optional(),
  language: trimmed(40).optional(),
  publicationType: z.enum(PUBLICATION_TYPES).optional(),
  authors: trimmed(500).optional(),
  // LIB-004A: URL_IMPORT — importação por URL oficial (fallback dentro da mesma
  // busca, seção 10 do pedido). Mesma trava de nunca aplicar automaticamente:
  // preview obrigatório antes de qualquer POST.
  metadataSource: z.enum(['MANUAL', 'OPEN_LIBRARY', 'URL_IMPORT']).optional(),
  metadataSourceId: trimmed(80).optional(),
  metadataSourceUrl: z.union([
    z.string().trim().max(1000).refine(isPublicHttpsUrl, 'Use uma URL HTTPS pública.'),
    z.literal(''),
  ]).optional(),
  metadataFetchedAt: z.iso.datetime().optional(),
  externalWorkId: trimmed(80).optional(),
  externalEditionId: trimmed(80).optional(),
  // LIB-004A: catálogo interno primeiro (seção 9 do pedido) — quando o usuário
  // seleciona um resultado que já é uma Publication conhecida (por título ou
  // alias confirmado), reaproveita por ID em vez de recriar. Validado contra o
  // catálogo real no servidor (nunca confia cegamente — mesmo princípio de
  // ISBN/external ID); um ID inexistente/inválido é ignorado, nunca quebra o
  // create (ver buildCreateLibraryEntryStatements).
  reusePublicationId: trimmed(80).optional(),
});

// LIB-004A: "Importar de uma página oficial" — só a URL entra aqui; o preview
// resultante passa pelo MESMO rpgInputSchema acima antes de qualquer escrita
// (nunca salva automaticamente, seção 13 do pedido).
export const urlImportSchema = z.strictObject({
  url: z.string().trim().min(1).max(2000),
});

// LIB-003: variante usada só pelo PATCH de RPG — mesmo princípio do incidente
// de coverUrl (LIB-001, CLAUDE.md seção 18): um RPG legado cujo isbn já
// persistido não bata no checksum (nenhum caso real conhecido hoje, mas a
// proteção precisa existir) não pode ficar impossível de salvar só porque o
// usuário editou outro campo sem tocar no ISBN. A rota faz a checagem real de
// "mudou ou não" comparando com o valor persistido (ver src/server/routes/rpgs.ts)
// — aqui só relaxamos a forma para não bloquear o parse antes dessa checagem.
export const rpgUpdateInputSchema = rpgInputSchema.extend({
  isbn: z.union([z.string().trim().max(32), z.literal(''), z.null()]).optional(),
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

export const themePreferenceSchema = z.strictObject({
  theme: z.enum(['LIGHT', 'DARK', 'SYSTEM']),
});

export const userPreferenceInputSchema = z.strictObject({
  theme: z.enum(['LIGHT', 'DARK', 'SYSTEM']).optional(),
  activeWorldId: z.string().trim().max(80).nullable().optional(),
}).refine((input) => input.theme !== undefined || input.activeWorldId !== undefined, 'Informe ao menos uma preferência.');

export const activeWorldPreferenceSchema = z.strictObject({
  activeWorldId: z.string().trim().max(80).nullable(),
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
  premise: trimmed(5000).default(''),
  hooks: trimmed(10000).default(''),
  keyScenes: trimmed(20000).default(''),
  rewards: trimmed(10000).default(''),
});

export const loreDetailsSchema = z.strictObject({
  loreType: z.enum(LORE_TYPES),
  canonStatus: z.enum(LORE_CANON_STATUSES),
  source: trimmed(1000).default(''),
});

export const characterDetailsSchema = z.strictObject({
  playerUserId: z.string().trim().min(1).max(80).nullable(),
  pronouns: trimmed(80).default(''),
  concept: trimmed(1000).default(''),
  status: trimmed(80).default(''),
  notes: trimmed(10000).default(''),
});

export const npcDetailsSchema = z.strictObject({
  role: trimmed(160).default(''), occupation: trimmed(160).default(''), motivation: trimmed(2000).default(''),
  publicNotes: trimmed(10000).default(''), gmNotes: trimmed(10000).default(''),
});

export const creatureStatFieldSchema = z.strictObject({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().trim().min(1).max(80),
  type: z.enum(CREATURE_STAT_FIELD_TYPES),
  required: z.boolean().default(false),
});

export const creatureStatTemplateInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: trimmed(2000).default(''),
  fields: z.array(creatureStatFieldSchema).max(80).refine((fields) => new Set(fields.map((field) => field.key)).size === fields.length, 'As chaves dos campos devem ser únicas.'),
});

export const creatureDetailsSchema = z.strictObject({
  classification: trimmed(160).default(''), habitat: trimmed(1000).default(''), behavior: trimmed(5000).default(''),
  dangerNotes: trimmed(5000).default(''),
  statBlock: z.strictObject({ templateId: z.string().trim().min(1).max(80), values: z.record(z.string(), z.union([z.string().max(5000), z.number().finite(), z.boolean()])) }).nullable(),
});

export const factionDetailsSchema = z.strictObject({
  purpose: trimmed(2000).default(''), scope: trimmed(160).default(''), status: trimmed(80).default(''),
  publicDescription: trimmed(10000).default(''), gmNotes: trimmed(10000).default(''),
});

export const itemDetailsSchema = z.strictObject({
  itemType: trimmed(160).default(''), rarity: trimmed(80).default(''), publicDescription: trimmed(10000).default(''), gmNotes: trimmed(10000).default(''),
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
  lore: loreDetailsSchema.nullable().default(null),
  character: characterDetailsSchema.nullable().default(null),
  npc: npcDetailsSchema.nullable().default(null),
  creature: creatureDetailsSchema.nullable().default(null),
  faction: factionDetailsSchema.nullable().default(null),
  item: itemDetailsSchema.nullable().default(null),
});

export const wikiFolderInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  parentFolderId: z.string().trim().max(80).nullable().default(null),
});

export const worldTagInputSchema = z.strictObject({ name: z.string().trim().min(1).max(60) });

export const wikiEntityOrganizationSchema = z.strictObject({
  folderId: z.string().trim().max(80).nullable(),
  tagIds: z.array(z.string().trim().min(1).max(80)).max(50),
  aliases: z.array(z.string().trim().min(1).max(160)).max(30),
});

export const journalFolderInputSchema = wikiFolderInputSchema;

export const journalPageInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  content: trimmed(100000).default(''),
  folderId: z.string().trim().max(80).nullable().default(null),
});

// F-003: mesma política de URL do coverUrl (LIB-001) — sintática, sem allowlist de host, sem
// fetch do servidor (o navegador é quem abre o link, via <a href>).
export const externalResourceInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  url: z.string().trim().max(2000).refine(isPublicHttpsUrl, 'Use uma URL HTTPS pública.'),
  description: trimmed(2000).default(''),
  resourceType: z.enum(EXTERNAL_RESOURCE_TYPES),
});

export const worldInviteInputSchema = z.strictObject({
  expiresInDays: z.number().int().min(1).max(30).default(7),
  maxUses: z.number().int().min(1).max(100).default(1),
});

export const entityRelationInputSchema = z.strictObject({
  sourceEntityId: z.string().trim().min(1).max(80),
  targetEntityId: z.string().trim().min(1).max(80),
  relationType: z.enum(RELATION_TYPES),
  label: trimmed(160).default(''),
  description: trimmed(4000).default(''),
  direction: z.enum(RELATION_DIRECTIONS),
  visibility: z.enum(ENTITY_VISIBILITIES),
  strength: z.number().int().min(1).max(5).nullable().default(null),
});

export const worldEraInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: trimmed(2000).default(''),
  sortOrder: z.number().int().min(-9999).max(9999),
});

export const worldCalendarInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  months: z.array(z.strictObject({ name: z.string().trim().min(1).max(80), days: z.number().int().min(1).max(1000) })).min(1).max(36),
  weekdays: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
  cycles: z.array(z.strictObject({ name: z.string().trim().min(1).max(80), lengthDays: z.number().int().min(1).max(1_000_000), offset: z.number().int().min(-1_000_000).max(1_000_000) })).max(30),
  holidays: z.array(z.strictObject({ name: z.string().trim().min(1).max(120), monthIndex: z.number().int().min(0).max(35), day: z.number().int().min(1).max(1000), description: trimmed(1000).default('') })).max(200),
});

export const eventTemporalInputSchema = z.strictObject({
  historicalDate: trimmed(160).default(''),
  sortKey: z.number().int().min(-9_000_000_000).max(9_000_000_000).nullable(),
  eraId: z.string().trim().min(1).max(80).nullable(),
  precision: z.enum(TEMPORAL_PRECISIONS),
  calendarDate: z.strictObject({
    year: z.number().int().min(-1_000_000).max(1_000_000),
    monthIndex: z.number().int().min(0).max(35),
    day: z.number().int().min(1).max(1000),
  }).nullable(),
  displayText: trimmed(160).default(''),
});

export const campaignEntityLinkSchema = z.strictObject({
  usageType: z.enum(CAMPAIGN_ENTITY_USAGE_TYPES),
});

export type RpgInput = z.infer<typeof rpgInputSchema>;
export type CampaignInput = z.infer<typeof campaignInputSchema>;
export type SessionInput = z.infer<typeof sessionInputSchema>;
export type WorldInput = z.infer<typeof worldInputSchema>;
export type VaultEntityInput = z.infer<typeof vaultEntityInputSchema>;
export type EntityRelationInput = z.infer<typeof entityRelationInputSchema>;
export type WorldEraInput = z.infer<typeof worldEraInputSchema>;
export type WorldCalendarInput = z.infer<typeof worldCalendarInputSchema>;
export type EventTemporalInput = z.infer<typeof eventTemporalInputSchema>;
export type CreatureStatTemplateInput = z.infer<typeof creatureStatTemplateInputSchema>;
