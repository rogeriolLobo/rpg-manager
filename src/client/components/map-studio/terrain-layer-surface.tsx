import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { TerrainLayer, TerrainStroke, TerrainViewport } from '../../../domain/map-studio/terrain/terrain-types';
import { TerrainRenderer } from './terrain-renderer';

export interface TerrainLayerSurfaceHandle {
  renderDraft: (stroke: TerrainStroke | null) => void;
}

interface TerrainLayerSurfaceProps {
  layer: TerrainLayer;
  viewport: TerrainViewport;
}

export const TerrainLayerSurface = forwardRef<TerrainLayerSurfaceHandle, TerrainLayerSurfaceProps>(function TerrainLayerSurface({ layer, viewport }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef(new TerrainRenderer());
  const draftRef = useRef<TerrainStroke | null>(null);
  const layerRef = useRef(layer);
  const viewportRef = useRef(viewport);
  layerRef.current = layer;
  viewportRef.current = viewport;

  const render = () => {
    if (canvasRef.current) rendererRef.current.render(canvasRef.current, layerRef.current, viewportRef.current, draftRef.current);
  };

  useImperativeHandle(ref, () => ({
    renderDraft(stroke) {
      draftRef.current = stroke;
      render();
    },
  }));

  useEffect(() => {
    render();
  }, [layer, viewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => rendererRef.current.dispose(), []);

  const lastStroke = layer.strokes.at(-1);
  return <canvas
    ref={canvasRef}
    className="map-terrain-surface"
    role="img"
    aria-label={`Terrain ${layer.name}`}
    data-layer-id={layer.id}
    data-stroke-count={layer.strokes.length}
    data-visible={layer.visible ? 'true' : 'false'}
    data-last-mode={lastStroke?.mode ?? ''}
    data-last-texture={lastStroke?.textureId ?? ''}
    data-last-brush-size={lastStroke?.brush.size ?? ''}
  />;
});
