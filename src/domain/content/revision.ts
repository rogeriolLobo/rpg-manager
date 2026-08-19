// F-001: Revision History — tipos puros, sem D1/fetch. Ver
// src/server/content/revisions.ts para a camada de escrita/leitura, e
// docs/product/RPG_MANAGER_FINAL_STATUS.md para o desenho completo.

export const REVISION_RESOURCE_TYPES = ['VAULT_ENTITY', 'JOURNAL_PAGE', 'WORLD'] as const;
export type RevisionResourceType = typeof REVISION_RESOURCE_TYPES[number];

export const REVISION_ACTIONS = ['CREATE', 'UPDATE', 'RESTORE'] as const;
export type RevisionAction = typeof REVISION_ACTIONS[number];

export interface RevisionSummary {
  revisionNumber: number;
  action: RevisionAction;
  actorUserId: string;
  actorName: string;
  restoredFromRevisionNumber: number | null;
  createdAt: string;
}

export interface RevisionDetail<TSnapshot> extends RevisionSummary {
  snapshot: TSnapshot;
}
