import { describe, expect, it } from 'vitest';
import { classifyLibraryEntryState } from '../../src/domain/rpg/library-entry-state';

describe('classifyLibraryEntryState (LIB-006)', () => {
  it('classifica como NOT_IN_LIBRARY quando nenhuma entry é encontrada', () => {
    expect(classifyLibraryEntryState(null)).toBe('NOT_IN_LIBRARY');
    expect(classifyLibraryEntryState(undefined)).toBe('NOT_IN_LIBRARY');
  });
  it('classifica como ACTIVE_IN_LIBRARY quando archivedAt é null', () => {
    expect(classifyLibraryEntryState({ archivedAt: null })).toBe('ACTIVE_IN_LIBRARY');
  });
  it('classifica como ARCHIVED_IN_LIBRARY quando archivedAt tem um timestamp', () => {
    expect(classifyLibraryEntryState({ archivedAt: '2026-08-18T00:00:00.000Z' })).toBe('ARCHIVED_IN_LIBRARY');
  });
});
