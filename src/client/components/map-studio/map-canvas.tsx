import type { PointerEvent as ReactPointerEvent } from 'react';
import type { MapEditorDocument, MapEditorObject } from '../../../domain/map-studio/editor';
import type { MapTool } from './workspace-chrome';

interface MapCanvasProps {
  mapId: string;
  document: MapEditorDocument;
  selected: MapEditorObject | null;
  width: number;
  height: number;
  gridType: 'NONE' | 'SQUARE' | 'HEX_POINTY' | 'HEX_FLAT';
  gridSize: number;
  backgroundUrl: string | null;
  tool: MapTool;
  viewBox: string;
  onObjectPointerDown: (event: ReactPointerEvent<SVGElement>, object: MapEditorObject) => void;
  onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerFinish: () => void;
}

export function MapCanvas({
  mapId, document, selected, width, height, gridType, gridSize, backgroundUrl, tool, viewBox,
  onObjectPointerDown, onPointerDown, onPointerMove, onPointerFinish,
}: MapCanvasProps) {
  return (
    <main className={`map-canvas-viewport ${tool === 'PAN' ? 'is-panning' : ''}`} aria-label="Área de criação do mapa">
      <svg
        role="img"
        aria-label="Canvas do mapa"
        viewBox={viewBox}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerFinish}
        onPointerCancel={onPointerFinish}
      >
        <defs>
          <pattern id={`grid-${mapId}`} width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
            <path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke="rgba(40,40,40,.22)" strokeWidth={Math.max(1, gridSize / 40)}/>
          </pattern>
        </defs>
        <rect x="0" y="0" width={width} height={height} fill={document.backgroundColor}/>
        {backgroundUrl && <image href={backgroundUrl} x="0" y="0" width={width} height={height} preserveAspectRatio="xMidYMid slice"/>}
        {gridType !== 'NONE' && <rect x="0" y="0" width={width} height={height} fill={`url(#grid-${mapId})`}/>}
        {document.layers.map((layer) => layer.visible && (
          <g key={layer.id} opacity={layer.locked ? .72 : 1}>
            {layer.objects.map((object) => {
              const transform = `rotate(${object.rotation} ${object.x + object.width / 2} ${object.y + object.height / 2})`;
              const common = { transform, onPointerDown: (event: ReactPointerEvent<SVGElement>) => onObjectPointerDown(event, object) };
              if (object.type === 'ELLIPSE') return <ellipse key={object.id} {...common} cx={object.x + object.width / 2} cy={object.y + object.height / 2} rx={object.width / 2} ry={object.height / 2} fill={object.fill}/>;
              if (object.type === 'TEXT') return <text key={object.id} {...common} x={object.x} y={object.y + object.height * .72} fill={object.fill} fontSize={Math.max(14, object.height * .55)}>{object.text || 'Texto'}</text>;
              return <rect key={object.id} {...common} x={object.x} y={object.y} width={object.width} height={object.height} rx={8} fill={object.fill}/>;
            })}
          </g>
        ))}
        {selected && (
          <rect x={selected.x} y={selected.y} width={selected.width} height={selected.height} transform={`rotate(${selected.rotation} ${selected.x + selected.width / 2} ${selected.y + selected.height / 2})`} fill="none" stroke="#d47b2a" strokeWidth={Math.max(2, width / 700)} strokeDasharray="12 8" pointerEvents="none"/>
        )}
      </svg>
    </main>
  );
}
