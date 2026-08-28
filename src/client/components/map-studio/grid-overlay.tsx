import { createGridPatternGeometry, type MapGridType } from '../../../domain/map-studio/grid-engine';

interface GridOverlayProps { mapId: string; type: MapGridType; size: number; width: number; height: number }

export function GridOverlay({ mapId, type, size, width, height }: GridOverlayProps) {
  const geometry = createGridPatternGeometry(type, size);
  if (!geometry) return null;
  const patternId = `grid-${mapId}-${type}`;
  return (
    <g data-grid-type={type} data-grid-size={size} data-grid-path={geometry.path}>
      <defs>
        <pattern id={patternId} width={geometry.width} height={geometry.height} patternUnits="userSpaceOnUse">
          <path d={geometry.path} fill="none" stroke="currentColor" strokeOpacity=".22" strokeWidth={Math.max(.75, size / 55)} vectorEffect="non-scaling-stroke"/>
        </pattern>
      </defs>
      <rect x="0" y="0" width={width} height={height} fill={`url(#${patternId})`}/>
    </g>
  );
}
