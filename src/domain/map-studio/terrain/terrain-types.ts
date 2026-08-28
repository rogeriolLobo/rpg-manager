import type {
  TerrainBrushInput,
  TerrainDocumentInput,
  TerrainLayerInput,
  TerrainPointInput,
  TerrainStrokeInput,
} from '../../../shared/validation/schemas';

export type TerrainBrush = TerrainBrushInput;
export type TerrainDocument = TerrainDocumentInput;
export type TerrainLayer = TerrainLayerInput;
export type TerrainPoint = TerrainPointInput;
export type TerrainStroke = TerrainStrokeInput;
export type TerrainMode = TerrainStroke['mode'];
export type TerrainTextureId = TerrainStroke['textureId'];

export interface TerrainViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const TERRAIN_TILE_SIZE = 512;
export const MAX_TERRAIN_POINTS_PER_STROKE = 512;

export const DEFAULT_TERRAIN_BRUSH: TerrainBrush = {
  size: 140,
  opacity: .82,
  hardness: .62,
  flow: .7,
  spacing: .18,
  textureScale: 1,
  textureRotation: 0,
  color: '#4f7cac',
};
