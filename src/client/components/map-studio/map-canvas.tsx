import { forwardRef, useImperativeHandle, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { MapEditorDocument, MapEditorObject } from '../../../domain/map-studio/editor';
import type { MapGridType } from '../../../domain/map-studio/grid-engine';
import { listUnifiedMapLayers } from '../../../domain/map-studio/terrain/terrain-document';
import type { TerrainMode, TerrainStroke, TerrainViewport } from '../../../domain/map-studio/terrain/terrain-types';
import type { MapTool } from './workspace-chrome';
import { GridOverlay } from './grid-overlay';
import { TerrainLayerSurface, type TerrainLayerSurfaceHandle } from './terrain-layer-surface';

export interface MapCanvasHandle {
  renderTerrainDraft: (layerId: string, stroke: TerrainStroke | null) => void;
  updateBrushCursor: (clientX: number, clientY: number, visible: boolean) => void;
}

interface MapCanvasProps {
  mapId: string;
  document: MapEditorDocument;
  selected: MapEditorObject | null;
  width: number;
  height: number;
  gridType: MapGridType;
  gridSize: number;
  backgroundUrl: string | null;
  tool: MapTool;
  viewport: TerrainViewport;
  brushSize: number;
  brushHardness: number;
  brushColor: string;
  brushMode: TerrainMode;
  onObjectPointerDown: (event: ReactPointerEvent<SVGElement>, object: MapEditorObject) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerFinish: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
}

export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas({
  mapId, document, selected, width, height, gridType, gridSize, backgroundUrl, tool, viewport, brushSize, brushHardness, brushColor, brushMode,
  onObjectPointerDown, onPointerDown, onPointerMove, onPointerFinish, onPointerCancel, onPointerLeave,
}, ref) {
  const viewportRef = useRef<HTMLElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const terrainRefs = useRef(new Map<string, TerrainLayerSurfaceHandle>());
  const unifiedLayers = useMemo(() => listUnifiedMapLayers(document), [document]);
  const viewBox = `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`;

  useImperativeHandle(ref, () => ({
    renderTerrainDraft(layerId, stroke) {
      terrainRefs.current.get(layerId)?.renderDraft(stroke);
    },
    updateBrushCursor(clientX, clientY, visible) {
      const element = cursorRef.current;
      const canvas = viewportRef.current;
      if (!element || !canvas || !visible || tool !== 'TERRAIN') {
        if (element) element.hidden = true;
        return;
      }
      const bounds = canvas.getBoundingClientRect();
      const scale = Math.min(bounds.width / viewport.width, bounds.height / viewport.height);
      const offsetX = (bounds.width - viewport.width * scale) / 2;
      const offsetY = (bounds.height - viewport.height * scale) / 2;
      const localX = clientX - bounds.left;
      const localY = clientY - bounds.top;
      const inside = localX >= offsetX && localX <= bounds.width - offsetX && localY >= offsetY && localY <= bounds.height - offsetY;
      const mapX = viewport.x + (localX - offsetX) / scale;
      const mapY = viewport.y + (localY - offsetY) / scale;
      if (!inside || mapX < 0 || mapX > width || mapY < 0 || mapY > height) {
        element.hidden = true;
        return;
      }
      const diameter = Math.max(4, brushSize * scale);
      element.hidden = false;
      element.style.width = `${diameter}px`;
      element.style.height = `${diameter}px`;
      element.style.setProperty('--brush-hardness', `${Math.max(8, brushHardness * 100)}%`);
      element.style.setProperty('--brush-color', brushColor);
      element.dataset.mode = brushMode;
      element.style.transform = `translate(${localX - diameter / 2}px,${localY - diameter / 2}px)`;
    },
  }), [brushColor, brushHardness, brushMode, brushSize, height, tool, viewport, width]);

  return (
    <main
      ref={viewportRef}
      className={`map-canvas-viewport ${tool === 'PAN' ? 'is-panning' : ''} ${tool === 'TERRAIN' ? 'is-painting' : ''}`}
      aria-label="Área de criação do mapa"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerFinish}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
    >
      <svg className="map-canvas-surface" role="img" aria-label="Canvas do mapa" viewBox={viewBox}>
        <rect x="0" y="0" width={width} height={height} fill={document.backgroundColor}/>
        {backgroundUrl && <image href={backgroundUrl} x="0" y="0" width={width} height={height} preserveAspectRatio="xMidYMid slice"/>}
      </svg>
      {unifiedLayers.map((layer) => layer.type === 'TERRAIN' ? (
        <TerrainLayerSurface
          key={layer.id}
          ref={(handle) => {
            if (handle) terrainRefs.current.set(layer.id, handle);
            else terrainRefs.current.delete(layer.id);
          }}
          layer={layer}
          viewport={viewport}
        />
      ) : layer.visible ? (
        <svg key={layer.id} className="map-canvas-surface map-object-surface" viewBox={viewBox} aria-hidden="true">
          <g opacity={layer.locked ? .72 : 1}>
            {layer.objects.map((object) => {
              const transform = `rotate(${object.rotation} ${object.x + object.width / 2} ${object.y + object.height / 2})`;
              const common = {
                transform,
                'data-map-object': object.id,
                onPointerDown: (event: ReactPointerEvent<SVGElement>) => onObjectPointerDown(event, object),
              };
              if (object.type === 'ELLIPSE') return <ellipse key={object.id} {...common} cx={object.x + object.width / 2} cy={object.y + object.height / 2} rx={object.width / 2} ry={object.height / 2} fill={object.fill}/>;
              if (object.type === 'TEXT') return <text key={object.id} {...common} x={object.x} y={object.y + object.height * .72} fill={object.fill} fontSize={Math.max(14, object.height * .55)}>{object.text || 'Texto'}</text>;
              return <rect key={object.id} {...common} x={object.x} y={object.y} width={object.width} height={object.height} rx={8} fill={object.fill}/>;
            })}
          </g>
        </svg>
      ) : null)}
      <svg className="map-canvas-surface map-overlay-surface" viewBox={viewBox} aria-hidden="true">
        <GridOverlay mapId={mapId} type={gridType} size={gridSize} width={width} height={height}/>
        {selected && (
          <rect x={selected.x} y={selected.y} width={selected.width} height={selected.height} transform={`rotate(${selected.rotation} ${selected.x + selected.width / 2} ${selected.y + selected.height / 2})`} fill="none" stroke="#d47b2a" strokeWidth={Math.max(2, width / 700)} strokeDasharray="12 8"/>
        )}
      </svg>
      <div ref={cursorRef} hidden className="map-brush-cursor" aria-hidden="true"/>
    </main>
  );
});
