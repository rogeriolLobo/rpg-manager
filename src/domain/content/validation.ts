import type { AdventureDetailsInput, LoreDetailsInput, VaultEntityType } from './types';

export function validateAdventureDetails(entityType: VaultEntityType, details: AdventureDetailsInput | null): boolean {
  if (entityType !== 'ADVENTURE') return details === null;
  if (!details) return false;
  return details.recommendedSessions === null
    || (Number.isInteger(details.recommendedSessions) && details.recommendedSessions > 0 && details.recommendedSessions <= 999);
}

export function validateLoreDetails(entityType: VaultEntityType, details: LoreDetailsInput | null): boolean {
  return entityType === 'LORE' || details === null;
}

export interface LocationParentCandidate {
  entityId: string | null;
  entityType: VaultEntityType;
  parentId: string | null;
  parentType: VaultEntityType | null;
  parentAncestorIds: readonly string[];
}

export function validateLocationParent(candidate: LocationParentCandidate): boolean {
  if (!candidate.parentId) return true;
  if (candidate.entityType !== 'LOCATION' || candidate.parentType !== 'LOCATION') return false;
  if (!candidate.entityId) return true;
  return candidate.parentId !== candidate.entityId && !candidate.parentAncestorIds.includes(candidate.entityId);
}

export function createWorldSlug(name: string): string {
  const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80);
  return slug || 'mundo';
}
