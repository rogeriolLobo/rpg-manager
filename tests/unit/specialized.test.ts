import { describe, expect, it } from 'vitest';
import { validateCreatureStatValues, validateSpecializedDetails } from '../../src/domain/content/specialized';

describe('specialized entity details', () => {
  const empty = { character: null, npc: null, creature: null, faction: null, item: null };

  it('accepts only the details matching the entity type', () => {
    expect(validateSpecializedDetails('NPC', { ...empty, npc: {} })).toBe(true);
    expect(validateSpecializedDetails('NPC', { ...empty, creature: {} })).toBe(false);
    expect(validateSpecializedDetails('LORE', empty)).toBe(true);
  });

  it('validates a system-defined creature stat block without hardcoded attributes', () => {
    const fields = [
      { key: 'defesa', label: 'Defesa', type: 'NUMBER' as const, required: true },
      { key: 'voa', label: 'Voa', type: 'BOOLEAN' as const, required: false },
    ];
    expect(validateCreatureStatValues(fields, { defesa: 14, voa: true })).toBe(true);
    expect(validateCreatureStatValues(fields, { defesa: '14' })).toBe(false);
    expect(validateCreatureStatValues(fields, { defesa: 14, forca: 18 })).toBe(false);
  });
});
