import { describe, expect, it } from 'vitest';
import { canonicalizeRelationEndpoints, isGenealogyRelation, validateRelation } from '../../src/domain/content/relations';

describe('relações entre entidades', () => {
  it('rejeita autorrelação e CUSTOM sem rótulo', () => {
    expect(validateRelation({ sourceEntityId: 'a', targetEntityId: 'a', relationType: 'ALLY', direction: 'BIDIRECTIONAL', label: '' })).toBe(false);
    expect(validateRelation({ sourceEntityId: 'a', targetEntityId: 'b', relationType: 'CUSTOM', direction: 'DIRECTED', label: ' ' })).toBe(false);
  });

  it('aplica direção consistente às relações genealógicas', () => {
    expect(validateRelation({ sourceEntityId: 'a', targetEntityId: 'b', relationType: 'PARENT', direction: 'BIDIRECTIONAL', label: '' })).toBe(false);
    expect(validateRelation({ sourceEntityId: 'a', targetEntityId: 'b', relationType: 'SIBLING', direction: 'DIRECTED', label: '' })).toBe(false);
    expect(validateRelation({ sourceEntityId: 'a', targetEntityId: 'b', relationType: 'PARENT', direction: 'DIRECTED', label: '' })).toBe(true);
  });

  it('canoniza arestas bidirecionais e identifica genealogia', () => {
    expect(canonicalizeRelationEndpoints('z', 'a', 'BIDIRECTIONAL')).toEqual({ sourceEntityId: 'a', targetEntityId: 'z' });
    expect(canonicalizeRelationEndpoints('z', 'a', 'DIRECTED')).toEqual({ sourceEntityId: 'z', targetEntityId: 'a' });
    expect(isGenealogyRelation('PARTNER')).toBe(true);
    expect(isGenealogyRelation('ALLY')).toBe(false);
  });
});
