import { interpolateTerrainStamps } from '../../../domain/map-studio/terrain/brush-engine';
import { terrainBoundsIntersectViewport, TerrainTileIndex, terrainStrokeBounds } from '../../../domain/map-studio/terrain/terrain-spatial-index';
import { textureRegistry } from '../../../domain/map-studio/terrain/texture-registry';
import type { TerrainLayer, TerrainStroke, TerrainViewport } from '../../../domain/map-studio/terrain/terrain-types';
import { drawTextureStamp } from './texture-renderers';

function prepareCanvas(canvas: HTMLCanvasElement): { context: CanvasRenderingContext2D; width: number; height: number; ratio: number } | null {
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width < 1 || bounds.height < 1) return null;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.ceil(bounds.width * ratio);
  const height = Math.ceil(bounds.height * ratio);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext('2d');
  return context ? { context, width: bounds.width, height: bounds.height, ratio } : null;
}

function applyViewportTransform(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  ratio: number,
  viewport: TerrainViewport,
): void {
  const scale = Math.min(width / viewport.width, height / viewport.height);
  const offsetX = (width - viewport.width * scale) / 2;
  const offsetY = (height - viewport.height * scale) / 2;
  context.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * (offsetX - viewport.x * scale), ratio * (offsetY - viewport.y * scale));
}

function drawTerrainStrokes(context: CanvasRenderingContext2D, strokes: TerrainStroke[], layerOpacity: number): void {
  for (const stroke of strokes) {
    context.globalCompositeOperation = stroke.mode === 'ERASE' ? 'destination-out' : 'source-over';
    const definition = textureRegistry.get(stroke.textureId);
    interpolateTerrainStamps(stroke.points, stroke.brush).forEach((point, index) => {
      drawTextureStamp(context, definition, point, stroke.brush, stroke.id, index, layerOpacity);
    });
  }
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 1;
}

export class TerrainRenderer {
  private readonly index = new TerrainTileIndex();
  private frame: number | null = null;
  private backing: HTMLCanvasElement | null = null;
  private draftBacking: HTMLCanvasElement | null = null;
  private cachedLayerId = '';
  private cachedStrokes: TerrainStroke[] = [];
  private cachedVisible = true;
  private cachedViewportKey = '';

  render(canvas: HTMLCanvasElement, layer: TerrainLayer, viewport: TerrainViewport, draft?: TerrainStroke | null): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const prepared = prepareCanvas(canvas);
      if (!prepared) return;
      const { context, width, height, ratio } = prepared;
      const viewportKey = `${canvas.width}:${canvas.height}:${viewport.x}:${viewport.y}:${viewport.width}:${viewport.height}`;
      this.backing ??= document.createElement('canvas');
      const backing = this.backing;
      if (backing.width !== canvas.width) backing.width = canvas.width;
      if (backing.height !== canvas.height) backing.height = canvas.height;
      const backingContext = backing.getContext('2d');
      if (!backingContext) return;

      const sameSurface = this.cachedLayerId === layer.id
        && this.cachedViewportKey === viewportKey
        && this.cachedVisible === layer.visible;
      const appendOnly = sameSurface
        && layer.strokes.length >= this.cachedStrokes.length
        && this.cachedStrokes.every((stroke, index) => layer.strokes[index] === stroke);

      if (!appendOnly) {
        backingContext.setTransform(1, 0, 0, 1, 0, 0);
        backingContext.clearRect(0, 0, backing.width, backing.height);
        this.index.synchronize(layer.strokes);
        if (layer.visible) {
          applyViewportTransform(backingContext, width, height, ratio, viewport);
          drawTerrainStrokes(backingContext, this.index.visible(layer.strokes, viewport), 1);
        }
      } else if (layer.visible && layer.strokes.length > this.cachedStrokes.length) {
        this.index.synchronize(layer.strokes);
        const appended = layer.strokes.slice(this.cachedStrokes.length)
          .filter((stroke) => terrainBoundsIntersectViewport(terrainStrokeBounds(stroke), viewport));
        applyViewportTransform(backingContext, width, height, ratio, viewport);
        drawTerrainStrokes(backingContext, appended, 1);
      }

      this.cachedLayerId = layer.id;
      this.cachedStrokes = layer.strokes;
      this.cachedVisible = layer.visible;
      this.cachedViewportKey = viewportKey;

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (layer.visible && draft && terrainBoundsIntersectViewport(terrainStrokeBounds(draft), viewport)) {
        this.draftBacking ??= document.createElement('canvas');
        const draftBacking = this.draftBacking;
        if (draftBacking.width !== canvas.width) draftBacking.width = canvas.width;
        if (draftBacking.height !== canvas.height) draftBacking.height = canvas.height;
        const draftContext = draftBacking.getContext('2d');
        if (!draftContext) return;
        draftContext.setTransform(1, 0, 0, 1, 0, 0);
        draftContext.clearRect(0, 0, draftBacking.width, draftBacking.height);
        draftContext.drawImage(backing, 0, 0);
        applyViewportTransform(draftContext, width, height, ratio, viewport);
        drawTerrainStrokes(draftContext, [draft], 1);
        context.globalAlpha = layer.opacity;
        context.drawImage(draftBacking, 0, 0);
      } else if (layer.visible) {
        context.globalAlpha = layer.opacity;
        context.drawImage(backing, 0, 0);
      }
      context.globalAlpha = 1;
    });
  }

  dispose(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }
}
