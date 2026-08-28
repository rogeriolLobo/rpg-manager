export const MAP_GRID_TYPES = ['NONE', 'SQUARE', 'HEX_POINTY', 'HEX_FLAT'] as const;
export type MapGridType = typeof MAP_GRID_TYPES[number];

export interface GridPatternGeometry { width: number; height: number; path: string }

const ROOT_THREE = Math.sqrt(3);

function fixed(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function polygonPath(points: Array<readonly [number, number]>): string {
  return `${points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${fixed(x)} ${fixed(y)}`).join(' ')} Z`;
}

function flatHexagon(centerX: number, centerY: number, radius: number, halfHeight: number): string {
  return polygonPath([
    [centerX + radius, centerY], [centerX + radius / 2, centerY + halfHeight],
    [centerX - radius / 2, centerY + halfHeight], [centerX - radius, centerY],
    [centerX - radius / 2, centerY - halfHeight], [centerX + radius / 2, centerY - halfHeight],
  ]);
}

function pointyHexagon(centerX: number, centerY: number, radius: number, halfWidth: number): string {
  return polygonPath([
    [centerX, centerY - radius], [centerX + halfWidth, centerY - radius / 2],
    [centerX + halfWidth, centerY + radius / 2], [centerX, centerY + radius],
    [centerX - halfWidth, centerY + radius / 2], [centerX - halfWidth, centerY - radius / 2],
  ]);
}

export function createGridPatternGeometry(type: MapGridType, size: number): GridPatternGeometry | null {
  if (type === 'NONE') return null;
  const radius = Math.max(4, size);
  if (type === 'SQUARE') return { width: radius, height: radius, path: `M ${fixed(radius)} 0 H 0 V ${fixed(radius)}` };
  if (type === 'HEX_FLAT') {
    const halfHeight = ROOT_THREE * radius / 2;
    const height = halfHeight * 2;
    return {
      width: radius * 3,
      height,
      path: [
        flatHexagon(radius, 0, radius, halfHeight),
        flatHexagon(radius, height, radius, halfHeight),
        flatHexagon(radius * 2.5, halfHeight, radius, halfHeight),
        flatHexagon(-radius * .5, halfHeight, radius, halfHeight),
      ].join(' '),
    };
  }
  const halfWidth = ROOT_THREE * radius / 2;
  const width = halfWidth * 2;
  return {
    width,
    height: radius * 3,
    path: [
      pointyHexagon(0, radius, radius, halfWidth),
      pointyHexagon(width, radius, radius, halfWidth),
      pointyHexagon(halfWidth, radius * 2.5, radius, halfWidth),
      pointyHexagon(halfWidth, -radius * .5, radius, halfWidth),
    ].join(' '),
  };
}

export function gridViewportBounds(viewport: { x: number; y: number; width: number; height: number }, spacing: number) {
  return {
    minX: Math.floor((viewport.x - spacing) / spacing) * spacing,
    minY: Math.floor((viewport.y - spacing) / spacing) * spacing,
    maxX: Math.ceil((viewport.x + viewport.width + spacing) / spacing) * spacing,
    maxY: Math.ceil((viewport.y + viewport.height + spacing) / spacing) * spacing,
  };
}

export function gridStatusLabel(type: MapGridType): string {
  return ({
    NONE: 'Grade desligada', SQUARE: 'Grade quadrada',
    HEX_FLAT: 'Grade hexagonal (topo)', HEX_POINTY: 'Grade hexagonal (ponta)',
  } satisfies Record<MapGridType, string>)[type];
}
