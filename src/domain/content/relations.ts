import type { RelationDirection, RelationType } from './types';

export interface RelationValidationInput {
  sourceEntityId: string;
  targetEntityId: string;
  relationType: RelationType;
  direction: RelationDirection;
  label: string;
}

const BIDIRECTIONAL_FAMILY_TYPES = new Set<RelationType>(['SIBLING', 'PARTNER']);
const DIRECTED_FAMILY_TYPES = new Set<RelationType>(['PARENT', 'CHILD']);

export function validateRelation(input: RelationValidationInput): boolean {
  if (input.sourceEntityId === input.targetEntityId) return false;
  if (input.relationType === 'CUSTOM' && !input.label.trim()) return false;
  if (BIDIRECTIONAL_FAMILY_TYPES.has(input.relationType) && input.direction !== 'BIDIRECTIONAL') return false;
  if (DIRECTED_FAMILY_TYPES.has(input.relationType) && input.direction !== 'DIRECTED') return false;
  return true;
}

export function canonicalizeRelationEndpoints(sourceEntityId: string, targetEntityId: string, direction: RelationDirection) {
  if (direction === 'BIDIRECTIONAL' && sourceEntityId.localeCompare(targetEntityId) > 0) {
    return { sourceEntityId: targetEntityId, targetEntityId: sourceEntityId };
  }
  return { sourceEntityId, targetEntityId };
}

export function isGenealogyRelation(relationType: RelationType): boolean {
  return ['PARENT', 'CHILD', 'SIBLING', 'PARTNER'].includes(relationType);
}
