import type { TerrainBrush } from './terrain-types';

export const TERRAIN_BRUSH_PRESET_IDS = ['SOFT_ROUND', 'HARD_ROUND', 'TEXTURED_NOISE'] as const;
export type TerrainBrushPresetId = typeof TERRAIN_BRUSH_PRESET_IDS[number];

export interface TerrainBrushPreset {
  id: TerrainBrushPresetId;
  name: string;
  description: string;
  defaults: Pick<TerrainBrush, 'hardness' | 'flow' | 'spacing' | 'smoothing'>;
  rendererConfig: { tip: 'ROUND' | 'NOISE'; jitter: number; alphaVariance: number };
}

const PRESETS: Record<TerrainBrushPresetId, TerrainBrushPreset> = {
  SOFT_ROUND: {
    id: 'SOFT_ROUND', name: 'Soft Round', description: 'Borda suave para transições naturais.', rendererConfig: { tip: 'ROUND', jitter: 0, alphaVariance: 0 },
    defaults: { hardness: .28, flow: .62, spacing: .1, smoothing: .68 },
  },
  HARD_ROUND: {
    id: 'HARD_ROUND', name: 'Hard Round', description: 'Borda firme para recortes precisos.', rendererConfig: { tip: 'ROUND', jitter: 0, alphaVariance: 0 },
    defaults: { hardness: .94, flow: .82, spacing: .12, smoothing: .5 },
  },
  TEXTURED_NOISE: {
    id: 'TEXTURED_NOISE', name: 'Textured Noise', description: 'Depósito orgânico determinístico.', rendererConfig: { tip: 'NOISE', jitter: .09, alphaVariance: .3 },
    defaults: { hardness: .5, flow: .48, spacing: .16, smoothing: .58 },
  },
};

export function listTerrainBrushPresets(): TerrainBrushPreset[] {
  return TERRAIN_BRUSH_PRESET_IDS.map((id) => PRESETS[id]);
}

export function getTerrainBrushPreset(id: TerrainBrushPresetId | undefined): TerrainBrushPreset | null {
  return id ? PRESETS[id] : null;
}

export function applyTerrainBrushPreset(brush: TerrainBrush, id: TerrainBrushPresetId): TerrainBrush {
  return { ...brush, presetId: id, ...PRESETS[id].defaults };
}

export function resolveTerrainBrushPreset(brush: TerrainBrush): TerrainBrushPreset {
  // Strokes anteriores ao MS-02 não têm preset. HARD_ROUND mantém o depósito circular V1.
  return PRESETS[brush.presetId ?? 'HARD_ROUND'];
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

export function terrainBrushNoise(strokeId: string, stampIndex: number): readonly [number, number, number] {
  let state = hash(`${strokeId}:${stampIndex}:tip`) || 1;
  const next = () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
  };
  return [next(), next(), next()];
}
