import type { AssetDefinition } from '../assets/asset-library';
import type { StampBrushSettings, StampObject, StampPoint } from './stamp-types';
import { MAX_STAMPS_PER_GESTURE } from './stamp-types';

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: string): () => number {
  let state = hashSeed(seed) || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function deterministicUuid(random: () => number): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function sampleStampBrushPath(points: readonly StampPoint[], spacing: number): StampPoint[] {
  if (!points.length) return [];
  if (points.length === 1) return [{ ...points[0] }];
  const result: StampPoint[] = [{ ...points[0] }];
  const interval = Math.max(4, spacing);
  let remaining = interval;
  let previous = points[0];
  for (let index = 1; index < points.length; index += 1) {
    const next = points[index];
    let deltaX = next.x - previous.x;
    let deltaY = next.y - previous.y;
    let distance = Math.hypot(deltaX, deltaY);
    while (distance >= remaining) {
      const ratio = remaining / distance;
      previous = { x: previous.x + deltaX * ratio, y: previous.y + deltaY * ratio };
      result.push(previous);
      deltaX = next.x - previous.x;
      deltaY = next.y - previous.y;
      distance = Math.hypot(deltaX, deltaY);
      remaining = interval;
    }
    remaining -= distance;
    previous = next;
  }
  return result;
}

export interface GenerateStampBrushInput {
  asset: AssetDefinition;
  layerId: string;
  points: readonly StampPoint[];
  settings: StampBrushSettings;
  seed: string;
  mapWidth: number;
  mapHeight: number;
}

export function generateStampBrushObjects(input: GenerateStampBrushInput): StampObject[] {
  const random = seededRandom(input.seed);
  const density = Math.max(1, Math.min(5, Math.round(input.settings.density)));
  const samples = sampleStampBrushPath(input.points, input.settings.spacing);
  const objects: StampObject[] = [];
  const aspect = input.asset.defaultWidth / input.asset.defaultHeight;
  for (const sample of samples) {
    for (let densityIndex = 0; densityIndex < density; densityIndex += 1) {
      if (objects.length >= MAX_STAMPS_PER_GESTURE) return objects;
      const scaleVariance = (random() * 2 - 1) * input.settings.scaleVariance;
      const scale = Math.max(.1, input.settings.scale * (1 + scaleVariance));
      const width = Math.max(4, input.asset.defaultWidth * scale);
      const height = Math.max(4, width / aspect);
      const jitterRadius = input.settings.spacing * input.settings.positionJitter;
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * jitterRadius;
      const centerX = Math.min(input.mapWidth, Math.max(0, sample.x + Math.cos(angle) * radius));
      const centerY = Math.min(input.mapHeight, Math.max(0, sample.y + Math.sin(angle) * radius));
      objects.push({
        id: deterministicUuid(random),
        type: 'STAMP',
        assetId: input.asset.id,
        layerId: input.layerId,
        x: centerX - width / 2,
        y: centerY - height / 2,
        width,
        height,
        rotation: input.settings.rotation + (random() * 2 - 1) * input.settings.rotationVariance,
        opacity: 1,
        flipX: input.settings.randomFlip ? random() >= .5 : false,
        flipY: false,
      });
    }
  }
  return objects;
}
