import type { TextureDefinition } from '../../../domain/map-studio/terrain/texture-registry';
import type { TerrainBrush, TerrainPoint } from '../../../domain/map-studio/terrain/terrain-types';
import { resolveTerrainBrushPreset, terrainBrushNoise } from '../../../domain/map-studio/terrain/brush-presets';
import { terrainBrushFalloffAlpha, terrainFlowDepositAlpha } from '../../../domain/map-studio/terrain/brush-engine';

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

function random(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function drawMarks(context: CanvasRenderingContext2D, definition: TextureDefinition, radius: number, scale: number, seed: number): void {
  const next = random(seed);
  const amount = Math.max(0, Math.min(24, Math.round(definition.detailDensity / Math.max(.35, scale))));
  if (amount === 0) return;
  context.strokeStyle = definition.palette[2];
  context.fillStyle = definition.palette[1];
  context.lineWidth = Math.max(1, radius * .025 * scale);
  for (let index = 0; index < amount; index += 1) {
    const angle = next() * Math.PI * 2;
    const distance = Math.sqrt(next()) * radius * .82;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    const size = Math.max(1.5, radius * (.025 + next() * .06) * scale);
    context.beginPath();
    switch (definition.renderer) {
      case 'fibers':
        context.moveTo(x, y + size); context.quadraticCurveTo(x + size * .2, y, x + size * .45, y - size); context.stroke(); break;
      case 'granular':
      case 'flakes':
        context.arc(x, y, size * (definition.renderer === 'flakes' ? .7 : .38), 0, Math.PI * 2); context.fill(); break;
      case 'facets':
        context.moveTo(x - size, y + size * .5); context.lineTo(x - size * .2, y - size); context.lineTo(x + size, y - size * .15); context.closePath(); context.fill(); break;
      case 'waves':
        context.arc(x, y, size * 1.8, Math.PI * .15, Math.PI * .85); context.stroke(); break;
      case 'blocks':
        context.rect(x - size, y - size * .55, size * 2, size * 1.1); context.stroke(); break;
      case 'grain':
        context.ellipse(x, y, size * 2.1, size * .45, 0, 0, Math.PI * 2); context.stroke(); break;
      case 'crosshatch':
        context.moveTo(x - size, y - size); context.lineTo(x + size, y + size); context.moveTo(x + size, y - size); context.lineTo(x - size, y + size); context.stroke(); break;
      case 'plain': break;
    }
  }
}

export function terrainColorWithAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(color);
  if (!match) throw new Error(`Cor Terrain inválida: ${color}`);
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${Number.parseInt(match[1], 16)}, ${Number.parseInt(match[2], 16)}, ${Number.parseInt(match[3], 16)}, ${safeAlpha})`;
}

export function transparentTerrainColor(color: string): string {
  return terrainColorWithAlpha(color, 0);
}

export function terrainBrushGradientStops(color: string, hardness: number): ReadonlyArray<readonly [number, string]> {
  const hardRadius = Math.max(0, Math.min(1, hardness));
  const stops: Array<readonly [number, string]> = [[0, color]];
  if (hardRadius > 0) stops.push([hardRadius, color]);
  if (hardRadius >= 1) return stops;
  for (const progress of [.25, .5, .75, 1]) {
    const offset = hardRadius + (1 - hardRadius) * progress;
    stops.push([offset, terrainColorWithAlpha(color, terrainBrushFalloffAlpha(offset, hardRadius))]);
  }
  return stops;
}

export function drawTextureStamp(
  context: CanvasRenderingContext2D,
  definition: TextureDefinition,
  point: TerrainPoint,
  brush: TerrainBrush,
  strokeId: string,
  stampIndex: number,
): void {
  const pressure = point.pressure ?? 1;
  const radius = Math.max(2, brush.size * pressure / 2);
  const alpha = terrainFlowDepositAlpha(brush.flow, pressure);
  const preset = resolveTerrainBrushPreset(brush);
  const noise = preset.rendererConfig.tip === 'NOISE' ? terrainBrushNoise(strokeId, stampIndex) : null;
  const baseColor = definition.id === 'plain' ? brush.color : definition.palette[0];
  context.save();
  const jitter = noise ? radius * preset.rendererConfig.jitter : 0;
  context.translate(point.x + (noise ? (noise[0] - .5) * jitter : 0), point.y + (noise ? (noise[1] - .5) * jitter : 0));
  context.rotate(brush.textureRotation * Math.PI / 180);
  context.globalAlpha = alpha * (noise ? 1 - preset.rendererConfig.alphaVariance + noise[2] * preset.rendererConfig.alphaVariance : 1);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius);
  terrainBrushGradientStops(baseColor, brush.hardness).forEach(([offset, color]) => gradient.addColorStop(offset, color));
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fill();
  // Preserve the brush mask alpha: texture details enrich the material but must
  // never replace the soft falloff with opaque dark pixels at the stamp edge.
  context.globalCompositeOperation = 'source-atop';
  context.globalAlpha = alpha * definition.detailOpacity;
  drawMarks(context, definition, radius, brush.textureScale, hash(`${strokeId}:${stampIndex}`));
  context.restore();
}
