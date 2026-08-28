import { TERRAIN_TILE_SIZE, type TerrainStroke, type TerrainViewport } from './terrain-types';

export interface TerrainBounds { minX: number; minY: number; maxX: number; maxY: number }

export function terrainStrokeBounds(stroke: TerrainStroke): TerrainBounds {
  const radius = stroke.brush.size / 2;
  return stroke.points.reduce<TerrainBounds>((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x - radius),
    minY: Math.min(bounds.minY, point.y - radius),
    maxX: Math.max(bounds.maxX, point.x + radius),
    maxY: Math.max(bounds.maxY, point.y + radius),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function tileKeys(bounds: TerrainBounds, tileSize = TERRAIN_TILE_SIZE): string[] {
  const keys: string[] = [];
  const startX = Math.floor(bounds.minX / tileSize);
  const endX = Math.floor(bounds.maxX / tileSize);
  const startY = Math.floor(bounds.minY / tileSize);
  const endY = Math.floor(bounds.maxY / tileSize);
  for (let y = startY; y <= endY; y += 1) for (let x = startX; x <= endX; x += 1) keys.push(`${x}:${y}`);
  return keys;
}

export function terrainBoundsIntersectViewport(bounds: TerrainBounds, viewport: TerrainViewport): boolean {
  return bounds.maxX >= viewport.x && bounds.minX <= viewport.x + viewport.width
    && bounds.maxY >= viewport.y && bounds.minY <= viewport.y + viewport.height;
}

export class TerrainTileIndex {
  private readonly boundsByStroke = new Map<string, TerrainBounds>();
  private readonly tilesByStroke = new Map<string, string[]>();
  private readonly strokeById = new Map<string, TerrainStroke>();

  synchronize(strokes: TerrainStroke[]): Set<string> {
    const dirty = new Set<string>();
    const incoming = new Set(strokes.map((stroke) => stroke.id));
    for (const [strokeId, keys] of this.tilesByStroke) {
      if (incoming.has(strokeId)) continue;
      keys.forEach((key) => dirty.add(key));
      this.tilesByStroke.delete(strokeId);
      this.boundsByStroke.delete(strokeId);
      this.strokeById.delete(strokeId);
    }
    for (const stroke of strokes) {
      if (this.strokeById.get(stroke.id) === stroke) continue;
      this.tilesByStroke.get(stroke.id)?.forEach((key) => dirty.add(key));
      const bounds = terrainStrokeBounds(stroke);
      const keys = tileKeys(bounds);
      keys.forEach((key) => dirty.add(key));
      this.strokeById.set(stroke.id, stroke);
      this.boundsByStroke.set(stroke.id, bounds);
      this.tilesByStroke.set(stroke.id, keys);
    }
    return dirty;
  }

  visible(strokes: TerrainStroke[], viewport: TerrainViewport): TerrainStroke[] {
    this.synchronize(strokes);
    return strokes.filter((stroke) => terrainBoundsIntersectViewport(this.boundsByStroke.get(stroke.id)!, viewport));
  }
}
