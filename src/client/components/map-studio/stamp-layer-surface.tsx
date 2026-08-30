import { useCallback, useEffect, useRef } from 'react';
import { assetLibrary, type AssetDefinition } from '../../../domain/map-studio/assets/asset-library';
import type { StampObject } from '../../../domain/map-studio/stamps/stamp-types';
import type { TerrainViewport } from '../../../domain/map-studio/terrain/terrain-types';

const pathCache = new Map<string, Path2D[]>();

function pathsFor(asset: AssetDefinition): Path2D[] {
  const cached = pathCache.get(asset.id);
  if (cached) return cached;
  const paths = asset.paths.map((path) => new Path2D(path.d));
  pathCache.set(asset.id, paths);
  return paths;
}

function intersectsViewport(stamp: StampObject, viewport: TerrainViewport): boolean {
  const padding = Math.hypot(stamp.width, stamp.height) / 2;
  const centerX = stamp.x + stamp.width / 2;
  const centerY = stamp.y + stamp.height / 2;
  return centerX + padding >= viewport.x
    && centerX - padding <= viewport.x + viewport.width
    && centerY + padding >= viewport.y
    && centerY - padding <= viewport.y + viewport.height;
}

function prepareCanvas(canvas: HTMLCanvasElement): { context: CanvasRenderingContext2D; width: number; height: number; ratio: number } | null {
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width < 1 || bounds.height < 1) return null;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const rasterWidth = Math.ceil(bounds.width * ratio);
  const rasterHeight = Math.ceil(bounds.height * ratio);
  if (canvas.width !== rasterWidth) canvas.width = rasterWidth;
  if (canvas.height !== rasterHeight) canvas.height = rasterHeight;
  const context = canvas.getContext('2d');
  return context ? { context, width: bounds.width, height: bounds.height, ratio } : null;
}

function drawStamp(context: CanvasRenderingContext2D, stamp: StampObject, asset: AssetDefinition): void {
  const [viewX, viewY, viewWidth, viewHeight] = asset.viewBox;
  const paths = pathsFor(asset);
  context.save();
  context.globalAlpha = stamp.opacity;
  context.translate(stamp.x + stamp.width / 2, stamp.y + stamp.height / 2);
  context.rotate(stamp.rotation * Math.PI / 180);
  context.scale(stamp.flipX ? -1 : 1, stamp.flipY ? -1 : 1);
  context.scale(stamp.width / viewWidth, stamp.height / viewHeight);
  context.translate(-viewX - viewWidth / 2, -viewY - viewHeight / 2);
  asset.paths.forEach((style, index) => {
    if (style.fill !== 'none') {
      context.fillStyle = style.fill;
      context.fill(paths[index]);
    }
    if (style.stroke && style.strokeWidth) {
      context.strokeStyle = style.stroke;
      context.lineWidth = style.strokeWidth;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.stroke(paths[index]);
    }
  });
  context.restore();
}

interface StampLayerSurfaceProps {
  layerId: string;
  layerName: string;
  visible: boolean;
  stamps: readonly StampObject[];
  viewport: TerrainViewport;
}

export function StampLayerSurface({ layerId, layerName, visible, stamps, viewport }: StampLayerSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const render = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const prepared = prepareCanvas(canvas);
      if (!prepared) return;
      const { context, width, height, ratio } = prepared;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (!visible) return;
      const scale = Math.min(width / viewport.width, height / viewport.height);
      const offsetX = (width - viewport.width * scale) / 2;
      const offsetY = (height - viewport.height * scale) / 2;
      context.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * (offsetX - viewport.x * scale), ratio * (offsetY - viewport.y * scale));
      for (const stamp of stamps) {
        if (!intersectsViewport(stamp, viewport)) continue;
        const asset = assetLibrary.get(stamp.assetId);
        if (asset) drawStamp(context, stamp, asset);
      }
    });
  }, [stamps, viewport, visible]);

  useEffect(() => { render(); }, [render]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [render]);
  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="map-stamp-surface"
      role="img"
      aria-label={`Stamps ${layerName}`}
      data-layer-id={layerId}
      data-stamp-count={stamps.length}
      data-visible={visible ? 'true' : 'false'}
    />
  );
}
