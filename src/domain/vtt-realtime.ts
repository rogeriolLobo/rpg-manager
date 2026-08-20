// F-031 (correção pós-auditoria): protocolo tipado e versionado do realtime de VTT,
// compartilhado entre client e server — nunca strings/eventos soltos sem contrato (ver
// docs/architecture/VTT_REALTIME_ZERO_COST_AUDIT.md para a arquitetura completa).
//
// Decisão central: toda mensagem STATE carrega o snapshot ATUAL completo (GM ou Player,
// conforme o papel da conexão), nunca um diff parcial — um client que perdeu mensagens (rede
// instável, hibernação do Durable Object) nunca fica com estado inconsistente, porque a
// PRÓXIMA mensagem que chegar já é autocontida. `reason` preserva o valor semântico (permite ao
// frontend animar/destacar por tipo de evento) sem o custo de correção de diffs parciais.

export const VTT_REALTIME_STATE_REASONS = [
  'SNAPSHOT', 'SCENE_CHANGED', 'TOKEN_MOVED', 'FOG_CHANGED', 'COMBAT_UPDATED', 'HANDOUT_REVEALED',
] as const;
export type VttRealtimeStateReason = typeof VTT_REALTIME_STATE_REASONS[number];

export type VttRealtimeRole = 'GM' | 'PLAYER';

// Mesmo shape do payload de GET /vtt/:campaignId/live (visão do jogador, já testado e em
// produção desde F-029/F-030/F-032) — reaproveitado aqui, nunca redesenhado.
export interface VttLiveToken { id: string; label: string; x: number; y: number }
export interface VttLiveCombatant { id: string; name: string; isCurrentTurn: boolean }
export interface VttLiveFogCell { col: number; row: number }
export interface VttPlayerScenePayload {
  id: string; title: string; imageUrl: string; fogEnabled: boolean; gridCols: number; gridRows: number;
  fogCells: VttLiveFogCell[]; tokens: VttLiveToken[]; combatActive: boolean; combatRound: number; combatants: VttLiveCombatant[];
}
// Visão do GM: mesmo shape de GET /scenes/:sceneId (nunca filtrado — GM é dono).
export interface VttGmToken { id: string; sceneId: string; entityId: string | null; entityName: string | null; entityType: string | null; label: string; x: number; y: number; visibleToPlayers: boolean }
export interface VttGmCombatant { id: string; tokenId: string | null; name: string; initiative: number; hpCurrent: number | null; hpMax: number | null; notes: string; visibleToPlayers: boolean; isCurrentTurn: boolean }
export interface VttGmScenePayload {
  item: { id: string; mapId: string | null; title: string; imageUrl: string; notes: string; isActive: boolean; fogEnabled: boolean; gridCols: number; gridRows: number; combatActive: boolean; combatRound: number; resolvedImageUrl: string };
  tokens: VttGmToken[]; fog: VttLiveFogCell[]; combatants: VttGmCombatant[];
}

export type VttRealtimeServerMessage =
  | { type: 'HELLO'; sequence: number; role: VttRealtimeRole }
  | { type: 'STATE'; sequence: number; reason: VttRealtimeStateReason; role: 'PLAYER'; payload: VttPlayerScenePayload | null }
  | { type: 'STATE'; sequence: number; reason: VttRealtimeStateReason; role: 'GM'; payload: VttGmScenePayload | null }
  | { type: 'RESYNC_REQUIRED' }
  | { type: 'PONG' };

export type VttRealtimeClientMessage = { type: 'PING' } | { type: 'RESYNC' };
