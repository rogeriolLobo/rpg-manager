import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import type { MapEditorDocument } from '../../../domain/map-studio/editor';
import { BrushEngine } from '../../../domain/map-studio/terrain/brush-engine';
import { findTerrainLayer } from '../../../domain/map-studio/terrain/terrain-document';
import { textureRegistry } from '../../../domain/map-studio/terrain/texture-registry';
import { DEFAULT_TERRAIN_BRUSH, type TerrainBrush, type TerrainMode, type TerrainPoint, type TerrainStroke, type TerrainTextureId, type TerrainViewport } from '../../../domain/map-studio/terrain/terrain-types';
import type { MapCanvasHandle } from './map-canvas';

interface BoundsLike { left: number; top: number; width: number; height: number }

export function viewportScale(bounds: Pick<BoundsLike, 'width' | 'height'>, viewport: TerrainViewport): number {
  return Math.min(bounds.width / viewport.width, bounds.height / viewport.height);
}

export function isScreenPointInsideViewport(clientX: number, clientY: number, bounds: BoundsLike, viewport: TerrainViewport): boolean {
  const scale = viewportScale(bounds, viewport);
  const offsetX = (bounds.width - viewport.width * scale) / 2;
  const offsetY = (bounds.height - viewport.height * scale) / 2;
  const localX = clientX - bounds.left;
  const localY = clientY - bounds.top;
  return localX >= offsetX && localX <= bounds.width - offsetX
    && localY >= offsetY && localY <= bounds.height - offsetY;
}

export function screenToMapPoint(clientX: number, clientY: number, bounds: BoundsLike, viewport: TerrainViewport, pressure = 1): TerrainPoint {
  const scale = viewportScale(bounds, viewport);
  const offsetX = (bounds.width - viewport.width * scale) / 2;
  const offsetY = (bounds.height - viewport.height * scale) / 2;
  return {
    x: viewport.x + (clientX - bounds.left - offsetX) / scale,
    y: viewport.y + (clientY - bounds.top - offsetY) / scale,
    pressure,
  };
}

export function isTerrainPointInsideMap(point: TerrainPoint, width: number, height: number): boolean {
  return point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height;
}

export function clampTerrainPoint(point: TerrainPoint, width: number, height: number): TerrainPoint {
  return { ...point, x: Math.min(width, Math.max(0, point.x)), y: Math.min(height, Math.max(0, point.y)) };
}

interface UseTerrainToolOptions {
  document: MapEditorDocument;
  activeLayerId: string | null;
  archived: boolean;
  canvasRef: RefObject<MapCanvasHandle | null>;
  onCommitStroke: (layerId: string, stroke: TerrainStroke) => void;
}

export function useTerrainTool({ document, activeLayerId, archived, canvasRef, onCommitStroke }: UseTerrainToolOptions) {
  const [mode, setMode] = useState<TerrainMode>('PAINT');
  const [textureId, setTextureId] = useState<TerrainTextureId>('grass');
  const [brush, setBrush] = useState<TerrainBrush>(() => textureRegistry.applyDefaults('grass', DEFAULT_TERRAIN_BRUSH));
  const [feedback, setFeedback] = useState('');
  const engineRef = useRef(new BrushEngine());
  const strokeLayerIdRef = useRef<string | null>(null);
  const activeLayer = useMemo(() => findTerrainLayer(document, activeLayerId), [activeLayerId, document]);

  const selectTexture = useCallback((nextTextureId: TerrainTextureId) => {
    setTextureId(nextTextureId);
    setBrush((current) => textureRegistry.applyDefaults(nextTextureId, current));
  }, []);

  const begin = useCallback((point: TerrainPoint): boolean => {
    if (archived || !activeLayer) {
      setFeedback('Crie ou selecione uma Terrain Layer antes de pintar.');
      return false;
    }
    if (activeLayer.locked) {
      setFeedback('Desbloqueie a Terrain Layer antes de pintar.');
      return false;
    }
    if (!activeLayer.visible) {
      setFeedback('Mostre a Terrain Layer antes de pintar.');
      return false;
    }
    setFeedback('');
    strokeLayerIdRef.current = activeLayer.id;
    const draft = engineRef.current.beginStroke(crypto.randomUUID(), mode, textureId, brush, point);
    canvasRef.current?.renderTerrainDraft(activeLayer.id, draft);
    return true;
  }, [activeLayer, archived, brush, canvasRef, mode, textureId]);

  const add = useCallback((point: TerrainPoint) => {
    const layerId = strokeLayerIdRef.current;
    if (!layerId) return;
    const draft = engineRef.current.addPoint(point);
    if (draft) canvasRef.current?.renderTerrainDraft(layerId, draft);
  }, [canvasRef]);

  const finish = useCallback(() => {
    const layerId = strokeLayerIdRef.current;
    if (!layerId) return;
    const stroke = engineRef.current.endStroke();
    strokeLayerIdRef.current = null;
    canvasRef.current?.renderTerrainDraft(layerId, null);
    if (stroke) onCommitStroke(layerId, stroke);
  }, [canvasRef, onCommitStroke]);

  const cancel = useCallback(() => {
    const layerId = strokeLayerIdRef.current;
    engineRef.current.cancelStroke();
    strokeLayerIdRef.current = null;
    if (layerId) canvasRef.current?.renderTerrainDraft(layerId, null);
  }, [canvasRef]);

  return {
    activeLayer,
    mode,
    textureId,
    brush,
    feedback,
    setMode,
    setBrush,
    selectTexture,
    begin,
    add,
    finish,
    cancel,
  };
}
