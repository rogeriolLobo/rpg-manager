export interface MapPoint { x: number; y: number }
export interface MapViewport { width: number; height: number }
export interface WorldMapMetadata {
  id: string;
  worldId: string;
  name: string;
  imageObjectKey: string | null;
  parentMapId: string | null;
  viewport: MapViewport;
}
export interface WorldMapPin {
  id: string;
  mapId: string;
  label: string;
  position: MapPoint;
  entityId: string | null;
  childMapId: string | null;
}

export function isValidMapPoint(point: MapPoint, viewport: MapViewport): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.y >= 0 && point.x <= viewport.width && point.y <= viewport.height;
}
