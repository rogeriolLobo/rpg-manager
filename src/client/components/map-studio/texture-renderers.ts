import type { TextureDefinition } from '../../../domain/map-studio/terrain/texture-registry';
import type { TerrainBrush, TerrainPoint } from '../../../domain/map-studio/terrain/terrain-types';

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
  const amount = Math.max(3, Math.min(16, Math.round(10 / Math.max(.35, scale))));
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

export function drawTextureStamp(
  context: CanvasRenderingContext2D,
  definition: TextureDefinition,
  point: TerrainPoint,
  brush: TerrainBrush,
  strokeId: string,
  stampIndex: number,
  layerOpacity: number,
): void {
  const pressure = point.pressure ?? 1;
  const radius = Math.max(2, brush.size * pressure / 2);
  const alpha = Math.max(0, Math.min(1, brush.opacity * brush.flow * layerOpacity * pressure));
  const baseColor = definition.id === 'plain' ? brush.color : definition.palette[0];
  context.save();
  context.translate(point.x, point.y);
  context.rotate(brush.textureRotation * Math.PI / 180);
  context.globalAlpha = alpha * Math.max(.12, .28 + brush.hardness * .72);
  context.fillStyle = baseColor;
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fill();
  if (brush.hardness < .98) {
    const gradient = context.createRadialGradient(0, 0, radius * brush.hardness, 0, 0, radius);
    gradient.addColorStop(0, `${baseColor}dd`);
    gradient.addColorStop(1, `${baseColor}00`);
    context.globalAlpha = alpha * (1 - brush.hardness);
    context.fillStyle = gradient;
    context.fill();
  }
  context.beginPath();
  context.arc(0, 0, radius * .94, 0, Math.PI * 2);
  context.clip();
  context.globalAlpha = alpha * .52;
  drawMarks(context, definition, radius, brush.textureScale, hash(`${strokeId}:${stampIndex}`));
  context.restore();
}
