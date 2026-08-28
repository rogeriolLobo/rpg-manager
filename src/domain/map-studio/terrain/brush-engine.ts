import { MAX_TERRAIN_POINTS_PER_STROKE, type TerrainBrush, type TerrainMode, type TerrainPoint, type TerrainStroke, type TerrainTextureId } from './terrain-types';

function distance(a: TerrainPoint, b: TerrainPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pointLineDistance(point: TerrainPoint, start: TerrainPoint, end: TerrainPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return distance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function simplifyTerrainPoints(points: TerrainPoint[], tolerance: number): TerrainPoint[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  let furthestIndex = 0;
  let furthestDistance = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const candidate = pointLineDistance(points[index], points[0], points.at(-1)!);
    if (candidate > furthestDistance) {
      furthestDistance = candidate;
      furthestIndex = index;
    }
  }
  if (furthestDistance <= tolerance) return [{ ...points[0] }, { ...points.at(-1)! }];
  const left = simplifyTerrainPoints(points.slice(0, furthestIndex + 1), tolerance);
  const right = simplifyTerrainPoints(points.slice(furthestIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

export function smoothTerrainPoints(points: TerrainPoint[], amount: number): TerrainPoint[] {
  if (points.length <= 2 || amount <= 0) return points.map((point) => ({ ...point }));
  const strength = Math.min(1, amount);
  const result: TerrainPoint[] = [{ ...points[0] }];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const averageX = (previous.x + current.x * 2 + next.x) / 4;
    const averageY = (previous.y + current.y * 2 + next.y) / 4;
    result.push({
      x: current.x + (averageX - current.x) * strength,
      y: current.y + (averageY - current.y) * strength,
      pressure: current.pressure,
    });
  }
  result.push({ ...points.at(-1)! });
  return result;
}

export function terrainFlowDepositAlpha(flow: number, pressure = 1): number {
  return Math.max(0, Math.min(1, flow * pressure));
}

export function terrainStrokeOpacity(opacity: number): number {
  return Math.max(0, Math.min(1, opacity));
}

export function terrainBrushFalloffAlpha(normalizedDistance: number, hardness: number): number {
  const distanceFromCenter = Math.max(0, Math.min(1, normalizedDistance));
  const hardRadius = Math.max(0, Math.min(1, hardness));
  if (distanceFromCenter <= hardRadius) return 1;
  if (hardRadius >= 1) return 1;
  return 1 - (distanceFromCenter - hardRadius) / (1 - hardRadius);
}

function capPoints(points: TerrainPoint[]): TerrainPoint[] {
  if (points.length <= MAX_TERRAIN_POINTS_PER_STROKE) return points;
  const stride = (points.length - 1) / (MAX_TERRAIN_POINTS_PER_STROKE - 1);
  return Array.from({ length: MAX_TERRAIN_POINTS_PER_STROKE }, (_, index) => ({ ...points[Math.round(index * stride)] }));
}

export function interpolateTerrainStamps(points: TerrainPoint[], brush: TerrainBrush): TerrainPoint[] {
  if (points.length <= 1) return points.map((point) => ({ ...point }));
  const spacing = Math.max(1, brush.size * brush.spacing);
  const stamps: TerrainPoint[] = [{ ...points[0] }];
  let carry = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segment = distance(start, end);
    if (segment === 0) continue;
    let travelled = spacing - carry;
    while (travelled <= segment) {
      const ratio = travelled / segment;
      stamps.push({
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
        pressure: start.pressure === undefined && end.pressure === undefined
          ? undefined
          : (start.pressure ?? 1) + ((end.pressure ?? 1) - (start.pressure ?? 1)) * ratio,
      });
      travelled += spacing;
    }
    carry = Math.max(0, segment - (travelled - spacing));
  }
  const last = points.at(-1)!;
  if (distance(stamps.at(-1)!, last) > Number.EPSILON) stamps.push({ ...last });
  return stamps;
}

interface ActiveStroke {
  id: string;
  mode: TerrainMode;
  textureId: TerrainTextureId;
  brush: TerrainBrush;
  points: TerrainPoint[];
}

export class BrushEngine {
  private active: ActiveStroke | null = null;

  beginStroke(id: string, mode: TerrainMode, textureId: TerrainTextureId, brush: TerrainBrush, point: TerrainPoint): TerrainStroke {
    this.active = { id, mode, textureId, brush: { ...brush }, points: [{ ...point }] };
    return this.snapshot();
  }

  addPoint(point: TerrainPoint): TerrainStroke | null {
    if (!this.active) return null;
    const previous = this.active.points.at(-1)!;
    const threshold = Math.max(1, this.active.brush.size * this.active.brush.spacing * .25);
    if (distance(previous, point) < threshold) return this.snapshot();
    this.active.points.push({ ...point });
    if (this.active.points.length > MAX_TERRAIN_POINTS_PER_STROKE * 4) {
      this.active.points = capPoints(this.active.points);
    }
    return this.snapshot();
  }

  endStroke(): TerrainStroke | null {
    if (!this.active) return null;
    const active = this.active;
    this.active = null;
    const tolerance = Math.max(.5, active.brush.size * .018);
    const simplified = simplifyTerrainPoints(active.points, tolerance);
    const points = capPoints(smoothTerrainPoints(simplified, active.brush.smoothing ?? 0));
    return { id: active.id, mode: active.mode, textureId: active.textureId, brush: { ...active.brush }, points };
  }

  cancelStroke(): void {
    this.active = null;
  }

  private snapshot(): TerrainStroke {
    if (!this.active) throw new Error('Nenhum stroke Terrain ativo.');
    return {
      id: this.active.id,
      mode: this.active.mode,
      textureId: this.active.textureId,
      brush: { ...this.active.brush },
      points: this.active.points.map((point) => ({ ...point })),
    };
  }
}
