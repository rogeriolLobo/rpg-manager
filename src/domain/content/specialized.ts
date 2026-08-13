import type { CreatureStatFieldDefinition, VaultEntityType } from './types';

export interface SpecializedDetails {
  character: unknown | null;
  npc: unknown | null;
  creature: unknown | null;
  faction: unknown | null;
  item: unknown | null;
}

const detailKeyByType: Partial<Record<VaultEntityType, keyof SpecializedDetails>> = {
  CHARACTER: 'character', NPC: 'npc', CREATURE: 'creature', FACTION: 'faction', ITEM: 'item',
};

export function validateSpecializedDetails(entityType: VaultEntityType, details: SpecializedDetails): boolean {
  const expectedKey = detailKeyByType[entityType];
  return Object.entries(details).every(([key, value]) => value === null || key === expectedKey);
}

export function validateCreatureStatValues(
  fields: CreatureStatFieldDefinition[],
  values: Record<string, string | number | boolean>,
): boolean {
  const definitions = new Map(fields.map((field) => [field.key, field]));
  if (Object.keys(values).some((key) => !definitions.has(key))) return false;
  return fields.every((field) => {
    const value = values[field.key];
    if (value === undefined || value === '') return !field.required;
    if (field.type === 'NUMBER') return typeof value === 'number' && Number.isFinite(value);
    if (field.type === 'BOOLEAN') return typeof value === 'boolean';
    return typeof value === 'string';
  });
}
